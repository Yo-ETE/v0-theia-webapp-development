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
from datetime import datetime, timezone

from backend.database import get_db
from backend.sse import sse_manager

DEFAULT_BAUD = int(os.getenv("LORA_BAUD_RATE", "115200"))
LORA_SERIAL_PORT = os.getenv("LORA_SERIAL_PORT", "")
SCAN_INTERVAL = 10


class PortReader:
    """Reads one serial port and processes frames."""

    def __init__(self, port: str, baud: int = DEFAULT_BAUD):
        self.port = port
        self.baud = baud
        self.running = False
        self.connected_real: str | None = None  # realpath at time of serial.open()
        self.packets_ok = 0
        self.packets_err = 0
        self.last_rssi: int = -120
        self._last_insert_ts: dict[str, float] = {}
        self._last_empty_ts: dict[str, float] = {}
        self._presence_count: dict[str, int] = {}
        self._tx_validated: dict[str, bool] = {}
        self._PRESENCE_WITHOUT_EMPTY_LIMIT = 200
        self._mission_status_cache: dict[str, tuple[str, float]] = {}  # mission_id -> (status, timestamp)
        # Per-device alert tracking: {tx_id: last_seen_ts}
        self._device_last_seen: dict[str, float] = {}
        # Anti-spam: {(type, device_id): last_notif_ts}
        self._notif_cooldown: dict[tuple[str, str], float] = {}

    async def _create_notification(self, ntype: str, severity: str, device_id: str | None, device_name: str, message: str):
        """Create a notification with 1-hour anti-spam per (type, device_id)."""
        cooldown_key = (ntype, device_id or device_name)
        now = time.time()
        last = self._notif_cooldown.get(cooldown_key, 0)
        if now - last < 3600:
            return  # anti-spam: 1 per type/device per hour
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

    async def start(self):
        import serial
        self.running = True
        while self.running:
            try:
                # Resolve realpath BEFORE opening (this is what the kernel will use)
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
                await asyncio.sleep(2)  # fast reconnect (USB re-enumeration)

    def stop(self):
        self.running = False

    async def _process_line(self, line: str):
        if line.startswith("[RX]"):
            await self._parse_rx_frame(line)
        elif line.startswith("[TX]"):
            # TX frames have same format as RX: [TX] TX03 | x=0 y=0 ...
            # Treat them identically (TX might be read directly via USB)
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
            # sensor_type will be overridden from DB in _handle_detection if device is known
            await self._handle_detection(
                tx_id=tx_id, sensor_type="unknown",
                x=0, y=0, d=0, v=0,
                angle=0.0, presence=False, vbatt=vbatt,
            )
            return

        # LD45 semicolon format: LD45;TXnn;x;y;d;v;battV
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
                presence = (x != 0 or y != 0) and 15 < d < 600
                # Also detect presence when x==0 but d>15 (C4001 depth-only)
                if not presence and d > 15:
                    presence = True
                if x == 0 and y == d and d > 0:
                    sensor_type = "c4001"
                else:
                    sensor_type = "ld2450"
                await self._handle_detection(
                    tx_id=tx_id, sensor_type=sensor_type,
                    x=x, y=y, d=d, v=v,
                    angle=angle, presence=presence, vbatt=vbatt,
                )
                return

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
            # Accept both "battTX" (RX format) and "vbatt" (TX direct format)
            batt_key = "battTX" if "battTX" in kv else ("vbatt" if "vbatt" in kv else None)
            vbatt = float(kv[batt_key]) if batt_key else None
        except (ValueError, KeyError):
            self.packets_err += 1
            return

        self.packets_ok += 1
        angle = math.degrees(math.atan2(x, y)) if (x != 0 or y != 0) else 0.0
        if has_presence_only:
            presence = kv.get("presence", "0") == "1"
        else:
            presence = (x != 0 or y != 0) and 15 < d < 600

        # Detect sensor type:
        # - gravity_mw: presence-only sensor (no x,y)
        # - c4001: depth-only sensor (x always 0, y == d)
        # - ld2450: full 2D sensor (real x,y coordinates)
        if has_presence_only:
            sensor_type = "gravity_mw"
        elif x == 0 and y == d and d > 0:
            sensor_type = "c4001"
        else:
            sensor_type = "ld2450"

        # Phantom suppression is handled ONLY in _handle_detection (single gate).
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
                # Override sensor_type from DB device type for known sensors
                db_type = row["type"] or ""
                if "c4001" in db_type.lower() or db_type == "depth_only":
                    sensor_type = "c4001"
            if not row:
                # Check if a disabled (soft-deleted) device with this dev_eui exists
                # If so, do NOT re-create it -- the user intentionally removed it
                cursor = await db.execute(
                    "SELECT id FROM devices WHERE dev_eui=? AND enabled=0",
                    (tx_id,),
                )
                disabled_row = await cursor.fetchone()
                if disabled_row:
                    # Device was soft-deleted, silently ignore frames from it
                    return

                import uuid
                did = str(uuid.uuid4())[:8]
                # Detect C4001 pattern: x==0 and y==d (depth-only sensor)
                is_c4001 = (x == 0 and y == d and d > 0) or sensor_type == "gravity_mw"
                dev_type = "c4001" if is_c4001 else ("gravity_mw" if sensor_type == "gravity_mw" else "microwave_tx")
                if is_c4001:
                    sensor_type = "c4001"
                await db.execute(
                    "INSERT INTO devices (id, dev_eui, name, type, serial_port, enabled) VALUES (?, ?, ?, ?, ?, 1)",
                    (did, tx_id, f"TX-{tx_id}", dev_type, self.port),
                )
                await db.commit()
                print(f"[THEIA] Auto-enrolled new TX: {tx_id} ({sensor_type}) on {self.port}")
                await db.execute(
                    "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
                    ("info", "lora", f"Auto-enrolled TX {tx_id} ({sensor_type}) from {self.port}"),
                )
                await db.commit()
                cursor = await db.execute(
                    "SELECT id, mission_id, zone, zone_id, zone_label, side, name, type, muted, floor FROM devices WHERE id=?",
                    (did,),
                )
                row = await cursor.fetchone()

        if not row:
            cursor = await db.execute(
                "SELECT id, mission_id, zone, zone_id, zone_label, side, name, type, muted, floor "
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

        # For floor-mode devices: derive zone_label from floor number if zone_label is empty
        device_floor = None
        if row:
            try:
                device_floor = row["floor"]
            except (KeyError, IndexError):
                device_floor = None
        if not zone_label and device_floor is not None:
            zone_label = f"Etage {device_floor}"

        # Check mission status: only record events if mission is "active"
        # Use a 5-second cache to avoid querying SQLite on every frame
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
            mission_id = None  # Normalize empty string to None
        side = row["side"] if row else ""
        device_name = row["name"] if row else (tx_id or self.port)

        now_iso = datetime.now(timezone.utc).isoformat()
        if device_id:
            await db.execute(
                "UPDATE devices SET battery=?, last_seen=?, rssi=?, serial_port=? WHERE id=?",
                (vbatt, now_iso, self.last_rssi, self.port, device_id),
            )
            # Record battery history (throttled: max 1 per 30 seconds per device)
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
                    except Exception:
                        pass  # table might not exist yet

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
        }

        # --- SINGLE phantom gate (for ALL code paths) ---
        # Validation: explicit EMPTY frame OR 5+ consecutive presence frames.
        phantom_key = tx_id or self.port
        if presence and not self._tx_validated.get(phantom_key, False):
            count = self._presence_count.get(phantom_key, 0) + 1
            self._presence_count[phantom_key] = count
            if count >= 5:
                self._tx_validated[phantom_key] = True
                print(f"[THEIA] TX {phantom_key} auto-validated after {count} consecutive frames")
            else:
                presence = False
                effective_distance = 0
                payload["presence"] = False
                payload["distance"] = 0
        elif presence and self._tx_validated.get(phantom_key, False):
            # TX is validated -- allow all presence through.
            # Just track the counter for diagnostics.
            self._presence_count[phantom_key] = self._presence_count.get(phantom_key, 0) + 1
        elif not presence:
            self._presence_count[phantom_key] = 0

        # Check muted flag: muted devices still broadcast SSE but skip DB event storage
        # sqlite3.Row doesn't support .get(), so convert to dict or use try/except
        try:
            is_muted = bool(dict(row).get("muted", 0)) if row else False
        except Exception:
            is_muted = False

        # Store detection in DB (rate-limited: 1 per 2s per device)
        # Only record when mission status is "active" (Pause stops recording)
        # Muted devices skip event creation entirely
        if mission_id and mission_active and presence and d > 15 and not is_muted:
            device_key = device_id or self.port
            now_ts = time.time()
            last_insert_ts = self._last_insert_ts.get(device_key, 0)
            if now_ts - last_insert_ts >= 2.0:
                self._last_insert_ts[device_key] = now_ts
                payload_json = json.dumps(payload)
                try:
                    await db.execute(
                        "INSERT INTO events (mission_id, device_id, event_type, zone, zone_id, side, rssi, snr, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (mission_id, device_id, "detection", zone, zone_id, side, self.last_rssi, 0, payload_json),
                    )
                except Exception:
                    await db.execute(
                        "INSERT INTO events (mission_id, device_id, event_type, zone, rssi, snr, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (mission_id, device_id, "detection", zone, self.last_rssi, 0, payload_json),
                    )
                print(f"[THEIA-DB] INSERT event: d={d} dir={direction} zone_id={zone_id} mission={mission_id}")
        elif presence and mission_id and not mission_active:
            pass  # Mission paused/completed -- SSE still broadcasts but no DB insert
        elif presence and not mission_id:
            pass  # No mission assigned -- skip silently

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
            "presence": presence,
            "distance": effective_distance,
            "speed": v,
            "angle": round(angle, 1),
            "direction": direction if presence else "C",
            "vbatt_tx": vbatt,
            "rssi": self.last_rssi,
            "timestamp": now_iso,
        })

        # --- Health monitoring: track device activity + check battery/RSSI ---
        dev_key = tx_id or self.port
        was_offline = (dev_key in self._device_last_seen and
                       time.time() - self._device_last_seen.get(dev_key, 0) > 60)
        self._device_last_seen[dev_key] = time.time()

        # Device came back online after being offline
        if was_offline and device_id:
            await self._create_notification(
                "device_online", "info", device_id, device_name,
                f"{device_name} reconnecte"
            )

        # Battery alerts
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

        # RSSI alert (persistent weak signal)
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
        presence = (x != 0 or y != 0) and 15 < d < 600

        # Phantom suppression handled in _handle_detection (single gate)
        await self._handle_detection(
            tx_id=tx_id, sensor_type="ld2450",
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
        event_type = frame.get("type", "unknown")
        rssi = frame.get("rssi", 0)
        snr = frame.get("snr", 0)
        payload = frame.get("payload", {})
        self.last_rssi = rssi

        db = await get_db()
        await db.execute(
            "UPDATE devices SET rssi=?, snr=?, last_seen=? WHERE dev_eui=?",
            (rssi, snr, datetime.now(timezone.utc).isoformat(), dev_eui),
        )

        cursor = await db.execute(
            "SELECT id, mission_id, zone FROM devices WHERE dev_eui=?", (dev_eui,),
        )
        row = await cursor.fetchone()
        device_id = row["id"] if row else None
        mission_id = row["mission_id"] if row else None
        zone = row["zone"] if row else ""

        # Check mission status for recording gate
        mission_active = False
        if mission_id and mission_id.strip():
            mc = await db.execute("SELECT status FROM missions WHERE id=?", (mission_id,))
            mrow = await mc.fetchone()
            mission_active = (mrow["status"] == "active") if mrow else False
        else:
            mission_id = None

        presence = payload.get("presence", False) if isinstance(payload, dict) else False
        distance = 0
        if isinstance(payload, dict):
            distance = int(payload.get("distance", 0) or 0)
        # Phantom gate for JSON path: auto-validate after 5 frames (like _handle_detection)
        phantom_key = dev_eui or self.port
        if presence and not self._tx_validated.get(phantom_key, False):
            count = self._presence_count.get(phantom_key, 0) + 1
            self._presence_count[phantom_key] = count
            if count >= 5:
                self._tx_validated[phantom_key] = True
                print(f"[THEIA] TX {phantom_key} auto-validated (JSON path) after {count} frames")
            else:
                presence = False
                distance = 0
        elif not presence:
            self._presence_count[phantom_key] = 0
        if mission_id and mission_active and event_type == "detection" and presence and distance > 15:
            device_key = device_id or dev_eui
            now_ts = time.time()
            last_insert_ts = self._last_insert_ts.get(device_key, 0)
            if now_ts - last_insert_ts >= 2.0:
                self._last_insert_ts[device_key] = now_ts
                await db.execute(
                    "INSERT INTO events (mission_id, device_id, event_type, zone, rssi, snr, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (mission_id, device_id, event_type, zone, rssi, snr, json.dumps(payload)),
                )
        elif mission_id and event_type != "detection":
            await db.execute(
                "INSERT INTO events (mission_id, device_id, event_type, zone, rssi, snr, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (mission_id, device_id, event_type, zone, rssi, snr, json.dumps(payload)),
            )

        await db.commit()

        await sse_manager.broadcast(event_type, {
            "device_id": device_id,
            "dev_eui": dev_eui,
            "mission_id": mission_id,
            "zone": zone,
            "event_type": event_type,
            "presence": presence,
            "distance": distance,
            "rssi": rssi,
            "snr": snr,
            "payload": payload,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })


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
        # Use real RSSI if available, otherwise keep default -120
        best_rssi = first_reader.last_rssi if first_reader else None
        # If still at default (-120), check other readers for a better value
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
        await asyncio.sleep(60)  # Wait 60s at startup before first check
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
                            last_seen_str = last_seen_str[:-1] + "+00:00"
                        if "+" not in last_seen_str and "T" in last_seen_str:
                            ls_dt = datetime.fromisoformat(last_seen_str).replace(tzinfo=timezone.utc)
                        else:
                            ls_dt = datetime.fromisoformat(last_seen_str)
                        delta_s = now_ts - ls_dt.timestamp()
                    except Exception:
                        continue

                    device_id = d["id"]
                    device_name = d["name"]

                    # Offline > 120s and not already notified recently
                    if delta_s > 120:
                        cooldown_key = ("device_offline", device_id)
                        last_notif = self._watchdog_cooldown.get(cooldown_key, 0)
                        if now_ts - last_notif > 3600:
                            self._watchdog_cooldown[cooldown_key] = now_ts
                            await db.execute(
                                "INSERT INTO notifications (type, severity, device_id, device_name, message) VALUES (?, ?, ?, ?, ?)",
                                ("device_offline", "warning", device_id, device_name,
                                 f"{device_name} hors ligne (aucun signal depuis {int(delta_s)}s)"),
                            )
                            await db.execute(
                                "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
                                ("warning", "device", f"{device_name} deconnecte (pas de signal depuis {int(delta_s)}s)"),
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
        # Start device health watchdog
        self._tasks.append(asyncio.create_task(self._device_watchdog()))
        _first_scan = True
        while self._running:
            ports = self._scan_ports()
            if _first_scan:
                udev_ok = os.path.exists(self.THEIA_RX_SYMLINK)
                if udev_ok:
                    real = os.path.realpath(self.THEIA_RX_SYMLINK)
                    print(f"[THEIA] Port scan: /dev/theia-rx -> {real}")
                    # RX identification is now done via bridge port tracking (not MAC)
                    # Bridge _readers dict contains the actual RX port after connection
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
