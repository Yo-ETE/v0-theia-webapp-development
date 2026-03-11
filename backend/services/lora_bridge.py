"""
THEIA - LoRa bridge service (multi-port, raw LD45 + JSON)

Reads serial frames from one or more Heltec LoRa RX modules connected via USB.
Supports two frame formats:

1. Raw LD2450:  LD45;x;y;d;v;vbatt   (from current Arduino firmware)
2. JSON legacy: {"dev_eui":"...","type":"detection","rssi":-67,...}

Port detection:
- Best: /dev/theia-rx udev symlink (stable, survives reboots).
- Override: LORA_SERIAL_PORT env var.
- Fallback: scans /dev/ttyUSB* + /dev/ttyACM*, excludes GPS_DEVICE.
"""
import asyncio
import glob
import json
import math
import os
import time
from datetime import datetime

from backend.database import get_db
from backend.sse import sse_manager

def _fmt_delta(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}min"
    if seconds < 86400:
        return f"{seconds // 3600}h{(seconds % 3600) // 60:02d}"
    return f"{seconds // 86400}j {(seconds % 86400) // 3600}h"

DEFAULT_BAUD = int(os.getenv("LORA_BAUD_RATE", "115200"))
LORA_SERIAL_PORT = os.getenv("LORA_SERIAL_PORT", "")
SCAN_INTERVAL = 10
_DEBUG = os.getenv("THEIA_DEBUG", "").lower() in ("1", "true", "yes")

# Blacklist for recently deleted TX (prevents immediate re-enroll after hard delete)
# Format: {dev_eui: deletion_timestamp}
_deleted_tx_blacklist: dict[str, float] = {}
BLACKLIST_DURATION = 300  # 5 minutes blacklist after hard delete


def blacklist_tx(dev_eui: str):
    """Add a TX to the deletion blacklist (called from devices router on hard delete)."""
    _deleted_tx_blacklist[dev_eui] = time.time()
    print(f"[THEIA] TX {dev_eui} blacklisted for {BLACKLIST_DURATION}s (prevents re-enroll)")


def is_tx_blacklisted(dev_eui: str) -> bool:
    """Check if a TX is blacklisted (recently hard deleted)."""
    if dev_eui not in _deleted_tx_blacklist:
        return False
    elapsed = time.time() - _deleted_tx_blacklist[dev_eui]
    if elapsed > BLACKLIST_DURATION:
        del _deleted_tx_blacklist[dev_eui]
        return False
    return True


class PortReader:
    """Reads one serial port and processes frames."""

    def __init__(self, port: str, baud: int = DEFAULT_BAUD):
        self.port = port
        self.baud = baud
        self.running = False
        self.connected_real: str | None = None
        self.packets_ok = 0
        self.packets_err = 0
        self.last_rssi: int = -120
        self._last_insert_ts: dict[str, float] = {}
        self._last_empty_ts: dict[str, float] = {}
        self._presence_count: dict[str, int] = {}
        self._presence_window: dict[str, list] = {}
        self._tx_validated: dict[str, bool] = {}
        self._PRESENCE_WITHOUT_EMPTY_LIMIT = 200
        self._mission_status_cache: dict[str, tuple[str, float]] = {}
        self._device_last_seen: dict[str, float] = {}
        self._notif_cooldown: dict[tuple[str, str], float] = {}
        self._detection_notif_ts: dict[str, float] = {}

    async def _create_notification(self, ntype: str, severity: str, device_id: str | None, device_name: str, message: str):
        """Create a notification with 1-hour anti-spam per (type, device_id)."""
        cooldown_key = (ntype, device_id or device_name)
        now = time.time()
        last = self._notif_cooldown.get(cooldown_key, 0)
        if now - last < 3600:
            return
        self._notif_cooldown[cooldown_key] = now
        try:
            db = await get_db()
            await db.execute(
                "INSERT INTO notifications (type, severity, device_id, device_name, message) VALUES (?, ?, ?, ?, ?)",
                (ntype, severity, device_id, device_name, message),
            )
            await db.execute(
                "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
                (severity if severity != "critical" else "error", "device", message),
            )
            await db.commit()
            await sse_manager.broadcast("notification", {
                "type": ntype, "severity": severity,
                "device_name": device_name, "message": message,
            })
        except Exception as e:
            print(f"[THEIA] Failed to create notification: {e}")

    async def _check_notification_rules(self, mission_id: str, device_name: str, zone_id: str, distance: int, direction: str):
        """Check mission notification config and send push/SMS if rules match."""
        try:
            db = await get_db()
            cursor = await db.execute(
                "SELECT name, notification_config FROM missions WHERE id=?", (mission_id,)
            )
            row = await cursor.fetchone()
            if not row or not row["notification_config"]:
                return

            config = json.loads(row["notification_config"]) if isinstance(row["notification_config"], str) else row["notification_config"]
            if not config.get("enabled", False):
                return

            zones = config.get("zones", ["all"])
            if zones != ["all"] and zone_id not in zones:
                return

            cooldown_min = config.get("cooldown_minutes", 5)
            now = time.time()
            last = self._detection_notif_ts.get(mission_id, 0)
            if now - last < cooldown_min * 60:
                return
            self._detection_notif_ts[mission_id] = now

            mission_name = row["name"] or mission_id
            msg = f"Detection sur {mission_name} - {device_name} ({direction}, {distance}cm)"
            channels = config.get("channels", [])

            await db.execute(
                "INSERT INTO notifications (type, severity, device_name, message) VALUES (?, ?, ?, ?)",
                ("detection_alert", "warning", device_name, msg),
            )
            await db.commit()
            await sse_manager.broadcast("notification", {
                "type": "detection_alert", "severity": "warning",
                "device_name": device_name, "message": msg,
            })

            if "web_push" in channels:
                try:
                    from backend.services.push_service import broadcast_push
                    await broadcast_push(
                        title=f"THEIA - {mission_name}",
                        body=f"{device_name}: detection {direction} a {distance}cm",
                        data={"mission_id": mission_id, "type": "detection_alert"},
                        tag=f"theia-{mission_id}",
                    )
                except Exception as e:
                    print(f"[THEIA-NOTIF] Push error: {e}")

            if "sms" in channels:
                try:
                    from backend.services.sms_service import send_sms
                    cursor2 = await db.execute("SELECT value FROM settings WHERE key='sms_config'")
                    sms_row = await cursor2.fetchone()
                    if sms_row:
                        sms_config = json.loads(sms_row["value"]) if isinstance(sms_row["value"], str) else sms_row["value"]
                        await send_sms(msg, sms_config)
                except Exception as e:
                    print(f"[THEIA-NOTIF] SMS error: {e}")

            print(f"[THEIA-NOTIF] Alert sent for mission {mission_name}: {msg}")
        except Exception as e:
            print(f"[THEIA-NOTIF] Error checking notification rules: {e}")

    async def start(self):
        import serial
        self.running = True
        while self.running:
            try:
                self.connected_real = os.path.realpath(self.port)
                ser = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: serial.Serial(port=self.port, baudrate=self.baud, timeout=1),
                )
                print(f"[THEIA] LoRa reader connected: {self.port} -> {self.connected_real}")
                while self.running:
                    raw = await asyncio.get_event_loop().run_in_executor(None, ser.readline)
                    if raw:
                        line = raw.decode("utf-8", errors="replace").strip()
                        if line:
                            await self._process_line(line)
            except Exception as e:
                print(f"[THEIA] LoRa reader error on {self.port}: {e}")
                await asyncio.sleep(2)

    def stop(self):
        self.running = False

    async def _process_line(self, line: str):
        if line.startswith("[RX]"):
            await self._parse_rx_frame(line)
        elif line.startswith("[TX]"):
            await self._parse_rx_frame("[RX]" + line[4:])
        elif line.startswith("LD45;"):
            await self._parse_ld45(line)
        elif line.startswith("{"):
            await self._parse_json(line)
        elif line.startswith("---"):
            pass
        else:
            await self._parse_rx_log(line)

    # ------------------------------------------------------------------ [RX] frame
    async def _parse_rx_frame(self, line: str):
        """Parse: [RX] TX01 | x=6 y=-3257 d=3259 v=0 rssi=-39 battTX=4.09"""
        import re
        content = line[4:].strip()
        parts = content.split("|", 1)
        if len(parts) < 2:
            self.packets_err += 1
            return

        tx_id = parts[0].strip()
        data_str = parts[1].strip()

        # EMPTY frames
        if data_str.startswith("EMPTY"):
            for match in re.finditer(r'(\w+)=([^\s]+)', data_str):
                k, v_str = match.group(1), match.group(2)
                if k == "rssi":
                    try: self.last_rssi = int(v_str)
                    except ValueError: pass
            vbatt = None
            batt_match = re.search(r'battTX=([^\s]+)', data_str)
            if batt_match:
                try: vbatt = float(batt_match.group(1))
                except ValueError: pass
            self.packets_ok += 1
            key = tx_id or self.port
            self._last_empty_ts[key] = time.time()
            self._presence_count[key] = 0
            self._tx_validated[key] = True
            await self._handle_detection(
                tx_id=tx_id, sensor_type="unknown",
                x=0, y=0, d=0, v=0,
                angle=0.0, presence=False, vbatt=vbatt,
            )
            return

        # LD45 semicolon format embedded in RX frame: LD45;TXnn;x;y;d;v;battV
        if data_str.startswith("LD45;"):
            parts = data_str.split(";")
            if len(parts) >= 6:
                try:
                    x = int(parts[2])
                    y = int(parts[3])
                    d = int(parts[4])
                    v = int(parts[5])
                    vbatt = float(parts[6]) if len(parts) >= 7 else None
                except (ValueError, IndexError):
                    self.packets_err += 1
                    return
                self.packets_ok += 1
                angle = math.degrees(math.atan2(x, y)) if (x != 0 or y != 0) else 0.0

                # Détection type capteur (même logique que _parse_ld45)
                if x == 0 and y == 0 and d == 1:
                    sensor_type = "gravity_mw"
                    presence = True
                    # Keep d=1 to indicate presence in payload (heatmap needs this)
                elif x == 0 and y == 0 and d == 0:
                    sensor_type = "gravity_mw"
                    presence = False
                elif x == 0 and y == d and d > 0:
                    sensor_type = "c4001"
                    presence = True
                else:
                    sensor_type = "ld2450"
                    presence = (x != 0 or y != 0) and 15 < d < 600
                    if not presence and d > 15:
                        presence = True

                await self._handle_detection(
                    tx_id=tx_id, sensor_type=sensor_type,
                    x=x, y=y, d=d, v=v,
                    angle=angle, presence=presence, vbatt=vbatt,
                )
                return

        # key=value format: x=0 y=0 d=1 v=0 rssi=-45 battTX=4.10
        kv = {}
        for match in re.finditer(r'(\w+)=([^\s]+)', data_str):
            kv[match.group(1)] = match.group(2)

        try:
            self.last_rssi = int(kv.get("rssi", self.last_rssi))
        except (ValueError, TypeError):
            pass

        has_xy = "x" in kv and "y" in kv
        has_presence_only = "presence" in kv and not has_xy

        try:
            if has_xy:
                x = int(kv.get("x", "0"))
                y = int(kv.get("y", "0"))
                d = int(kv.get("d", kv.get("distance", "0")))
                v = int(kv.get("v", "0"))
            elif has_presence_only:
                x, y, v = 0, 0, 0
                d = int(kv.get("d", kv.get("distance", "0")))
            else:
                self.packets_err += 1
                return
            batt_key = "battTX" if "battTX" in kv else ("vbatt" if "vbatt" in kv else None)
            vbatt = float(kv[batt_key]) if batt_key else None
        except (ValueError, KeyError):
            self.packets_err += 1
            return

        self.packets_ok += 1
        angle = math.degrees(math.atan2(x, y)) if (x != 0 or y != 0) else 0.0

        # Détection type capteur — gravity_mw via marqueur d=1 ou presence= explicite
        if has_presence_only:
            presence = kv.get("presence", "0") == "1"
            sensor_type = "gravity_mw"
        elif x == 0 and y == 0 and d == 1:
            # Marqueur gravity_mw (SEN0192) : x=0 y=0 d=1 (presence)
            sensor_type = "gravity_mw"
            presence = True
            # Keep d=1 to indicate presence in payload (heatmap needs this)
        elif x == 0 and y == 0 and d == 0:
            # Absence gravity_mw (d=0)
            sensor_type = "gravity_mw"
            presence = False
        elif x == 0 and y == d and d > 0:
            sensor_type = "c4001"
            presence = True
        else:
            sensor_type = "ld2450"
            presence = (x != 0 or y != 0) and 15 < d < 600

        await self._handle_detection(
            tx_id=tx_id, sensor_type=sensor_type,
            x=x, y=y, d=d, v=v,
            angle=angle, presence=presence, vbatt=vbatt,
        )

    # ------------------------------------------------------------------ common handler
    async def _handle_detection(
        self, *, tx_id: str | None, sensor_type: str,
        x: int, y: int, d: int, v: int,
        angle: float, presence: bool, vbatt: float | None,
    ):
        """Common logic: lookup device, phantom gate, store event, broadcast SSE."""
        db = await get_db()
        row = None

        if tx_id:
            cursor = await db.execute(
                "SELECT id, mission_id, zone, zone_id, zone_label, side, name, type, muted, floor "
                "FROM devices WHERE dev_eui=? AND enabled=1",
                (tx_id,),
            )
            row = await cursor.fetchone()
            if row:
                db_type = row["type"] or ""
                if "c4001" in db_type.lower() or db_type == "depth_only":
                    sensor_type = "c4001"
            if not row:
                # Check blacklist first (recently hard-deleted devices)
                if is_tx_blacklisted(tx_id):
                    return  # Silently ignore frames from recently deleted TX

                cursor = await db.execute(
                    "SELECT id FROM devices WHERE dev_eui=? AND enabled=0",
                    (tx_id,),
                )
                disabled_row = await cursor.fetchone()
                if disabled_row:
                    return

                import uuid
                did = str(uuid.uuid4())[:8]
                is_c4001 = (x == 0 and y == d and d > 0)
                if sensor_type == "gravity_mw":
                    dev_type = "gravity_mw"
                elif is_c4001:
                    dev_type = "c4001"
                    sensor_type = "c4001"
                else:
                    dev_type = "microwave_tx"
                await db.execute(
                    "INSERT INTO devices (id, dev_eui, name, type, serial_port, enabled) VALUES (?, ?, ?, ?, ?, 1)",
                    (did, tx_id, f"TX-{tx_id}", dev_type, self.port),
                )
                await db.execute(
                    "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
                    ("info", "lora", f"Auto-enrolled TX {tx_id} ({sensor_type}) from {self.port}"),
                )
                await db.commit()
                print(f"[THEIA] Auto-enrolled new TX: {tx_id} ({sensor_type}) on {self.port}")
                cursor = await db.execute(
                    "SELECT id, mission_id, zone, zone_id, zone_label, side, name, type, muted, floor, sensor_position, orientation FROM devices WHERE id=?",
                    (did,),
                )
                row = await cursor.fetchone()

        if not row:
            cursor = await db.execute(
                "SELECT id, mission_id, zone, zone_id, zone_label, side, name, type, muted, floor, sensor_position, orientation "
                "FROM devices WHERE serial_port=? AND enabled=1",
                (self.port,),
            )
            row = await cursor.fetchone()
            if row:
                db_type = row["type"] or ""
                if "c4001" in db_type.lower() or db_type == "depth_only":
                    sensor_type = "c4001"

        device_id = row["id"] if row else None
        mission_id = row["mission_id"] if row else None
        zone = row["zone"] if row else ""
        zone_id = row["zone_id"] if row else None
        zone_label = row["zone_label"] if row else ""

        device_floor = None
        if row:
            try:
                device_floor = row["floor"]
            except (KeyError, IndexError):
                device_floor = None
        if not zone_label and device_floor is not None:
            zone_label = f"Etage {device_floor}"

        mission_active = False
        mission_status_db = None
        if mission_id and mission_id.strip():
            cached = self._mission_status_cache.get(mission_id)
            now_cache = time.time()
            if cached and (now_cache - cached[1]) < 5.0:
                mission_status_db = cached[0]
                mission_active = (mission_status_db == "active")
            else:
                mc = await db.execute("SELECT status FROM missions WHERE id=?", (mission_id,))
                mrow = await mc.fetchone()
                if mrow:
                    mission_status_db = mrow["status"]
                    mission_active = (mission_status_db == "active")
                else:
                    mission_status_db = "NOT_FOUND"
                self._mission_status_cache[mission_id] = (mission_status_db, now_cache)
        else:
            mission_id = None

        side = row["side"] if row else ""
        device_name = row["name"] if row else (tx_id or self.port)
        sensor_position = None
        device_orientation = None
        device_floor = None
        if row:
            try:
                sensor_position = row["sensor_position"]
                device_orientation = row["orientation"]
                device_floor = row["floor"]
            except (KeyError, IndexError):
                pass

        now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if device_id:
            await db.execute(
                "UPDATE devices SET battery=?, last_seen=?, rssi=?, serial_port=? WHERE id=?",
                (vbatt, now_iso, self.last_rssi, self.port, device_id),
            )
            if vbatt is not None and vbatt > 0:
                cache_key = f"batt_{device_id}"
                last_batt_ts = self._last_insert_ts.get(cache_key, 0)
                if time.time() - last_batt_ts >= 30:
                    self._last_insert_ts[cache_key] = time.time()
                    try:
                        await db.execute(
                            "INSERT INTO battery_history (device_id, voltage, timestamp) VALUES (?, ?, ?)",
                            (device_id, vbatt, now_iso),
                        )
                    except Exception as e:
                        print(f"[THEIA] battery_history insert error: {e}")

        direction = "D" if angle > 30 else ("G" if angle < -30 else "C")
        effective_distance = d if presence else 0
        payload = {
            "x": x, "y": y, "distance": effective_distance, "speed": v,
            "angle": round(angle, 1),
            "presence": presence,
            "direction": direction if presence else "C",
            "vbatt_tx": vbatt,
            "tx_id": tx_id,
            "sensor_type": sensor_type,
            "floor": device_floor,
        }            
        # --- SINGLE phantom gate ---
        phantom_key = tx_id or self.port
        PHANTOM_CONSEC = 2
        PHANTOM_WINDOW = 6
        PHANTOM_RATIO_THRESH = 3

        window = self._presence_window.get(phantom_key, [])
        window.append(presence)
        if len(window) > PHANTOM_WINDOW:
            window = window[-PHANTOM_WINDOW:]
        self._presence_window[phantom_key] = window

        if presence and not self._tx_validated.get(phantom_key, False):
            count = self._presence_count.get(phantom_key, 0) + 1
            self._presence_count[phantom_key] = count
            presence_in_window = sum(1 for v in window if v)
            if count >= PHANTOM_CONSEC or presence_in_window >= PHANTOM_RATIO_THRESH:
                self._tx_validated[phantom_key] = True
                if _DEBUG:
                    print(f"[THEIA] TX {phantom_key} auto-validated (consec={count}, window={presence_in_window}/{len(window)})")
            else:
                presence = False
                effective_distance = 0
                payload["presence"] = False
                payload["distance"] = 0
        elif presence and self._tx_validated.get(phantom_key, False):
            self._presence_count[phantom_key] = self._presence_count.get(phantom_key, 0) + 1
        elif not presence:
            self._presence_count[phantom_key] = 0

        try:
            is_muted = bool(dict(row).get("muted", 0)) if row else False
        except Exception:
            is_muted = False

        distance_ok = d > 15 or sensor_type in ("gravity_mw", "c4001")
        if mission_id and mission_active and presence and distance_ok and not is_muted:
            device_key = device_id or self.port
            now_ts = time.time()
            last_insert_ts = self._last_insert_ts.get(device_key, 0)
            if now_ts - last_insert_ts >= 2.0:
                self._last_insert_ts[device_key] = now_ts
                payload_json = json.dumps(payload)
                try:
                    await db.execute(
                        "INSERT INTO events (mission_id, device_id, event_type, zone, zone_id, side, rssi, snr, payload, sensor_position, orientation, floor, device_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (mission_id, device_id, "detection", zone, zone_id, side, self.last_rssi, 0, payload_json, sensor_position, device_orientation, device_floor, device_name),
                    )
                except Exception:
                    await db.execute(
                        "INSERT INTO events (mission_id, device_id, event_type, zone, rssi, snr, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (mission_id, device_id, "detection", zone, self.last_rssi, 0, payload_json),
                    )
                if _DEBUG:
                    print(f"[THEIA-DB] INSERT event: d={d} dir={direction} zone_id={zone_id} mission={mission_id}")
                await self._check_notification_rules(mission_id, device_name or device_id or "", zone_id or "", d, direction if presence else "C")
        elif presence and mission_id and not mission_active:
            pass
        elif presence and not mission_id:
            pass

        await db.commit()

        await sse_manager.broadcast("detection", {
            "device_id": device_id,
            "device_name": device_name,
            "tx_id": tx_id,
            "sensor_type": sensor_type,
            "serial_port": self.port,
            "mission_id": mission_id,
            "zone": zone,
            "zone_id": zone_id,
            "zone_label": zone_label,
            "side": side,
            "sensor_position": sensor_position,
            "orientation": device_orientation,
            "floor": device_floor,
            "presence": presence,
            "distance": effective_distance,
            "speed": v,
            "angle": round(angle, 1),
            "direction": direction if presence else "C",
            "vbatt_tx": vbatt,
            "rssi": self.last_rssi,
            "timestamp": now_iso,
        })

        dev_key = tx_id or self.port
        was_offline = (dev_key in self._device_last_seen and
                       time.time() - self._device_last_seen.get(dev_key, 0) > 60)
        self._device_last_seen[dev_key] = time.time()

        if was_offline and device_id:
            await self._create_notification(
                "device_online", "info", device_id, device_name,
                f"{device_name} reconnecte"
            )

        if vbatt is not None and vbatt > 0 and device_id:
            if vbatt < 3.3:
                await self._create_notification(
                    "battery_low", "critical", device_id, device_name,
                    f"{device_name} batterie critique ({vbatt:.2f}V)"
                )
            elif vbatt < 3.5:
                await self._create_notification(
                    "battery_low", "warning", device_id, device_name,
                    f"{device_name} batterie faible ({vbatt:.2f}V)"
                )

        if self.last_rssi < -90 and device_id:
            await self._create_notification(
                "rssi_weak", "warning", device_id, device_name,
                f"{device_name} signal faible ({self.last_rssi}dBm)"
            )

    # ------------------------------------------------------------------ LD45 raw
    async def _parse_ld45(self, line: str):
        """Parse LD2450 frames: LD45;TX01;x;y;d;v;vbatt or LD45;x;y;d;v;vbatt"""
        parts = line.split(";")
        if len(parts) < 5:
            self.packets_err += 1
            return

        tx_id = None
        try:
            int(parts[1])
            idx_start = 1
        except ValueError:
            tx_id = parts[1].strip()
            idx_start = 2

        try:
            x = int(parts[idx_start])
            y = int(parts[idx_start + 1])
            d = int(parts[idx_start + 2])
            v = int(parts[idx_start + 3])
            vbatt = float(parts[idx_start + 4]) if len(parts) > idx_start + 4 else None
        except (ValueError, IndexError):
            self.packets_err += 1
            return

        self.packets_ok += 1
        angle = math.degrees(math.atan2(x, y)) if (x != 0 or y != 0) else 0.0

        # Détection type capteur
        if x == 0 and y == 0 and d == 1:
            # Marqueur gravity_mw (SEN0192) : présence (d=1)
            sensor_type = "gravity_mw"
            presence = True
            # Keep d=1 for heatmap
        elif x == 0 and y == 0 and d == 0:
            # Absence gravity_mw (d=0)
            sensor_type = "gravity_mw"
            presence = False
        elif x == 0 and y == d and d > 0:
            # C4001 depth-only
            sensor_type = "c4001"
            presence = True
        else:
            # LD2450 full 2D
            sensor_type = "ld2450"
            presence = (x != 0 or y != 0) and 15 < d < 600
            if not presence and d > 15:
                presence = True

        await self._handle_detection(
            tx_id=tx_id, sensor_type=sensor_type,
            x=x, y=y, d=d, v=v,
            angle=angle, presence=presence, vbatt=vbatt,
        )

    # ------------------------------------------------------------------ RX log lines
    async def _parse_rx_log(self, line: str):
        if ":" not in line:
            return
        key, _, val = line.partition(":")
        key = key.strip().lower()
        val = val.strip()
        if key == "rssi":
            try:
                self.last_rssi = int(val)
            except ValueError:
                pass

    # ------------------------------------------------------------------ JSON legacy
    async def _parse_json(self, line: str):
        try:
            frame = json.loads(line)
        except json.JSONDecodeError:
            self.packets_err += 1
            return

        self.packets_ok += 1
        dev_eui = frame.get("dev_eui", "")
        rssi = frame.get("rssi", 0)
        payload = frame.get("payload", {})
        self.last_rssi = rssi

        presence = payload.get("presence", False) if isinstance(payload, dict) else False
        distance = 0
        x_val = 0
        y_val = 0
        v_val = 0
        if isinstance(payload, dict):
            distance = int(payload.get("distance", 0) or 0)
            x_val = int(payload.get("x", 0) or 0)
            y_val = int(payload.get("y", 0) or 0)
            v_val = int(payload.get("speed", payload.get("v", 0)) or 0)

        angle = math.degrees(math.atan2(x_val, y_val)) if (x_val != 0 or y_val != 0) else 0.0
        sensor_type = "ld2450"
        if x_val == 0 and y_val == distance and distance > 0:
            sensor_type = "c4001"
        elif distance > 0 and x_val == 0 and y_val == 0:
            sensor_type = "gravity_mw"

        vbatt = None
        if isinstance(payload, dict):
            vbatt_raw = payload.get("vbatt") or payload.get("battery")
            if vbatt_raw is not None:
                try: vbatt = float(vbatt_raw)
                except (ValueError, TypeError): pass

        await self._handle_detection(
            tx_id=dev_eui, sensor_type=sensor_type,
            x=x_val, y=y_val, d=distance, v=v_val,
            angle=angle, presence=presence, vbatt=vbatt,
        )


class LoRaBridge:
    """Manages multiple PortReaders, one per detected serial port."""

    def __init__(self):
        self._running = False
        self._readers: dict[str, PortReader] = {}
        self._tasks: list[asyncio.Task] = []
        self._watchdog_cooldown: dict[tuple[str, str], float] = {}

    def invalidate_mission_cache(self, mission_id: str):
        """Clear cached mission status so readers pick up the new status immediately."""
        for reader in self._readers.values():
            reader._mission_status_cache.pop(mission_id, None)
        print(f"[THEIA] Mission cache invalidated: {mission_id}")

    @property
    def data(self) -> dict:
        total_ok = sum(r.packets_ok for r in self._readers.values())
        total_err = sum(r.packets_err for r in self._readers.values())
        first_port = "---"
        first_reader = None
        best_packets = -1
        for port, reader in self._readers.items():
            if reader.packets_ok > best_packets:
                best_packets = reader.packets_ok
                first_port = port
                first_reader = reader
        if first_reader is None and self._readers:
            first_port = next(iter(self._readers.keys()))
            first_reader = next(iter(self._readers.values()))
        ports = {
            port: {"packets_ok": r.packets_ok, "packets_err": r.packets_err, "rssi": r.last_rssi}
            for port, r in self._readers.items()
        }
        best_rssi = first_reader.last_rssi if first_reader else None
        if best_rssi == -120:
            for r in self._readers.values():
                if r.last_rssi != -120:
                    best_rssi = r.last_rssi
                    break
        return {
            "connected": len(self._readers) > 0,
            "port": first_port,
            "baud_rate": first_reader.baud if first_reader else 0,
            "rssi": best_rssi,
            "snr": None,
            "ports": ports,
            "total_ports": len(self._readers),
            "packets_received": total_ok,
            "packets_errors": total_err,
        }

    THEIA_RX_SYMLINK = "/dev/theia-rx"

    def _scan_ports(self) -> list[str]:
        if LORA_SERIAL_PORT and os.path.exists(LORA_SERIAL_PORT):
            return [LORA_SERIAL_PORT]
        if os.path.exists(self.THEIA_RX_SYMLINK):
            return [self.THEIA_RX_SYMLINK]
        gps_port = os.getenv("GPS_DEVICE", "")
        gps_real = ""
        if gps_port:
            try:
                gps_real = os.path.realpath(gps_port)
            except Exception:
                gps_real = gps_port
        found = []
        for pattern in ["/dev/ttyUSB*", "/dev/ttyACM*"]:
            found.extend(sorted(glob.glob(pattern)))
        if gps_real:
            found = [p for p in found if os.path.realpath(p) != gps_real]
        return found

    async def _device_watchdog(self):
        """Background task: check all devices for offline status every 30s."""
        await asyncio.sleep(60)
        while self._running:
            try:
                db = await get_db()
                cursor = await db.execute(
                    "SELECT id, name, last_seen, battery, rssi FROM devices WHERE enabled=1 AND last_seen IS NOT NULL"
                )
                rows = await cursor.fetchall()
                now_ts = time.time()
                for row in rows:
                    d = dict(row)
                    last_seen_str = d.get("last_seen")
                    if not last_seen_str:
                        continue
                    try:
                        if last_seen_str.endswith("Z"):
                            last_seen_str = last_seen_str[:-1]
                        last_seen_str = last_seen_str.replace("T", " ").split("+")[0].split(".")[0]
                        ls_dt = datetime.fromisoformat(last_seen_str)
                        delta_s = now_ts - ls_dt.timestamp()
                    except Exception:
                        continue

                    device_id = d["id"]
                    device_name = d["name"]

                    if delta_s > 120:
                        cooldown_key = ("device_offline", device_id)
                        last_notif = self._watchdog_cooldown.get(cooldown_key, 0)
                        if now_ts - last_notif > 3600:
                            existing = await db.execute(
                                "SELECT id FROM notifications WHERE device_id=? AND type='device_offline' AND dismissed=0 LIMIT 1",
                                (device_id,),
                            )
                            if await existing.fetchone():
                                self._watchdog_cooldown[cooldown_key] = now_ts
                                continue
                            self._watchdog_cooldown[cooldown_key] = now_ts
                            await db.execute(
                                "INSERT INTO notifications (type, severity, device_id, device_name, message) VALUES (?, ?, ?, ?, ?)",
                                ("device_offline", "warning", device_id, device_name,
                                 f"{device_name} hors ligne (aucun signal depuis {_fmt_delta(int(delta_s))})"),
                            )
                            await db.execute(
                                "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
                                ("warning", "device", f"{device_name} deconnecte (pas de signal depuis {_fmt_delta(int(delta_s))})"),
                            )
                            await db.commit()
                            await sse_manager.broadcast("notification", {
                                "type": "device_offline", "severity": "warning",
                                "device_name": device_name,
                                "message": f"{device_name} hors ligne",
                            })
            except Exception as e:
                print(f"[THEIA] Watchdog error: {e}")
            await asyncio.sleep(30)

    async def start(self):
        self._running = True
        print("[THEIA] LoRa bridge starting (multi-port mode)")
        self._tasks.append(asyncio.create_task(self._device_watchdog()))
        _first_scan = True
        while self._running:
            ports = self._scan_ports()
            if _first_scan:
                udev_ok = os.path.exists(self.THEIA_RX_SYMLINK)
                if udev_ok:
                    real = os.path.realpath(self.THEIA_RX_SYMLINK)
                    print(f"[THEIA] Port scan: /dev/theia-rx -> {real}")
                else:
                    by_id = [os.path.basename(p) for p in glob.glob("/dev/serial/by-id/*")]
                    print(f"[THEIA] Port scan: /dev/theia-rx NOT found, by-id={by_id}, selected={ports}")
                    if not ports:
                        print("[THEIA] WARNING: No serial ports found! Run: sudo bash scripts/setup-udev-rules.sh")
                _first_scan = False
            for port in ports:
                if port not in self._readers:
                    reader = PortReader(port)
                    self._readers[port] = reader
                    task = asyncio.create_task(reader.start())
                    self._tasks.append(task)
                    real = os.path.realpath(port) if port != os.path.realpath(port) else ""
                    print(f"[THEIA] Started reader for {port}{f' -> {real}' if real else ''} (phantom_gate=ACTIVE)")
            for port in list(self._readers.keys()):
                if port not in ports:
                    self._readers[port].stop()
                    del self._readers[port]
                    print(f"[THEIA] Removed reader for {port}")
            await asyncio.sleep(SCAN_INTERVAL)

    def stop(self):
        self._running = False
        for reader in self._readers.values():
            reader.stop()
        for t in self._tasks:
            t.cancel()


lora_bridge = LoRaBridge()
