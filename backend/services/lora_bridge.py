"""
THEIA - LoRa bridge service (multi-port, raw LD45 + JSON)

Reads serial frames from one or more Heltec LoRa RX modules connected via USB.
Supports two frame formats:

1. Raw LD2450:  LD45;x;y;d;v;vbatt   (from current Arduino firmware)
2. JSON legacy: {"dev_eui":"...","type":"detection","rssi":-67,...}

Device identification:
- Each USB serial port is mapped to a device via the `serial_port` field in the DB.
- When a device is enrolled with serial_port="/dev/ttyUSB1", all frames from
  that port are attributed to that device (and its mission/zone).
- If no device matches the port, frames are logged but not attributed.

Multi-port:
- Auto-scans /dev/ttyUSB* and /dev/ttyACM* every 10s for new devices.
- Each port gets its own reader coroutine.
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
# Optional: pin a single port (backwards compat)
LORA_SERIAL_PORT = os.getenv("LORA_SERIAL_PORT", "")
SCAN_INTERVAL = 10  # seconds between port scans


class PortReader:
    """Reads one serial port and processes frames."""

    def __init__(self, port: str, baud: int = DEFAULT_BAUD):
        self.port = port
        self.baud = baud
        self.running = False
        self.packets_ok = 0
        self.packets_err = 0
        self.last_rssi: int = -120
        self._last_insert_ts: dict[str, float] = {}  # rate-limit DB inserts per device
        # --- Phantom / stale frame suppression ---
        # The RX LoRa module can generate phantom data (noise) even when the TX
        # is off. In normal operation, a real TX sends EMPTY frames regularly
        # between presence events. If we NEVER see an EMPTY frame but keep
        # getting presence frames, the data is phantom noise.
        self._last_empty_ts: dict[str, float] = {}        # tx_id -> last EMPTY timestamp
        self._presence_count: dict[str, int] = {}          # tx_id -> consecutive presence count
        self._tx_validated: dict[str, bool] = {}            # tx_id -> seen at least 1 EMPTY
        self._PRESENCE_WITHOUT_EMPTY_LIMIT = 10  # max consecutive presence frames before we require an EMPTY

    async def start(self):
        import serial
        self.running = True
        while self.running:
            try:
                ser = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: serial.Serial(port=self.port, baudrate=self.baud, timeout=1),
                )
                print(f"[THEIA] LoRa reader connected: {self.port}")

                while self.running:
                    raw = await asyncio.get_event_loop().run_in_executor(
                        None, ser.readline
                    )
                    if raw:
                        line = raw.decode("utf-8", errors="replace").strip()
                        if line:
                            await self._process_line(line)

            except Exception as e:
                print(f"[THEIA] LoRa reader error on {self.port}: {e}")
                await asyncio.sleep(5)

    def stop(self):
        self.running = False

    async def _process_line(self, line: str):
        """Route to the correct parser based on frame format."""
        if line.startswith("[RX]"):
            await self._parse_rx_frame(line)
        elif line.startswith("LD45;"):
            await self._parse_ld45(line)
        elif line.startswith("{"):
            await self._parse_json(line)
        elif line.startswith("---"):
            # Log header line from Serial.println, skip
            pass
        else:
            # Could be human-readable log lines from the RX (Angle:, Presence:, etc.)
            # Parse key-value pairs for enrichment
            await self._parse_rx_log(line)

    # ------------------------------------------------------------------ [RX] frame
    async def _parse_rx_frame(self, line: str):
        """Parse the actual RX Arduino output format:
        [RX] TX01 | x=6 y=-3257 d=3259 v=0 rssi=-39 battTX=4.09

        Also supports Gravity Microwave sensor format:
        [RX] TX02 | presence=1 d=150 rssi=-42 battTX=3.95
        """
        import re

        # Strip the [RX] prefix
        content = line[4:].strip()
        # Split on |
        parts = content.split("|", 1)
        if len(parts) < 2:
            self.packets_err += 1
            return

        tx_id = parts[0].strip()
        data_str = parts[1].strip()

        # --- Handle EMPTY frames first ---
        # Format: "[RX] TX01 | EMPTY => OFF rssi=-63 battTX=3.66"
        # The "EMPTY" keyword means the sensor reports no target.
        if data_str.startswith("EMPTY"):
            # Parse any trailing key=value pairs (rssi, battTX)
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
            # Mark this TX as validated (we saw a real EMPTY from it)
            key = tx_id or self.port
            self._last_empty_ts[key] = time.time()
            self._presence_count[key] = 0
            self._tx_validated[key] = True
            # Broadcast EMPTY as presence=False so the frontend clears the marker
            await self._handle_detection(
                tx_id=tx_id, sensor_type="ld2450",
                x=0, y=0, d=0, v=0,
                angle=0.0, presence=False, vbatt=vbatt,
            )
            return

        # Parse key=value pairs for detection frames
        kv = {}
        for match in re.finditer(r'(\w+)=([^\s]+)', data_str):
            kv[match.group(1)] = match.group(2)

        # Extract RSSI from frame (not from separate log line)
        try:
            self.last_rssi = int(kv.get("rssi", self.last_rssi))
        except (ValueError, TypeError):
            pass

        # Determine sensor type from available fields
        has_xy = "x" in kv and "y" in kv
        has_presence_only = "presence" in kv and not has_xy

        try:
            if has_xy:
                # LD2450-type sensor: x, y, d, v
                x = int(kv.get("x", "0"))
                y = int(kv.get("y", "0"))
                d = int(kv.get("d", "0"))
                v = int(kv.get("v", "0"))
            elif has_presence_only:
                # Gravity Microwave sensor: presence, d
                x = 0
                y = 0
                d = int(kv.get("d", "0"))
                v = 0
            else:
                self.packets_err += 1
                return

            vbatt = float(kv["battTX"]) if "battTX" in kv else None
        except (ValueError, KeyError):
            self.packets_err += 1
            return

        self.packets_ok += 1

        # Compute angle and presence
        angle = math.degrees(math.atan2(x, y)) if (x != 0 or y != 0) else 0.0
        if has_presence_only:
            presence = kv.get("presence", "0") == "1"
        else:
            # LD2450 presence rules:
            # 1) x or y must be non-zero (x=0 y=0 means no target)
            # 2) distance must be > 15 cm (noise floor)
            # 3) distance must be < 600 cm (LD2450 reliable range ~6m,
            #    beyond that it picks up wall reflections / ghost targets)
            presence = (x != 0 or y != 0) and 15 < d < 600

        # Determine sensor type string
        sensor_type = "gravity_mw" if has_presence_only else "ld2450"

        # --- Phantom frame suppression ---
        # The RX LoRa module generates noise/phantom data even when the TX is off.
        # A REAL TX sends explicit "EMPTY" frames (handled above, before this code).
        # Only explicit EMPTY frames validate a TX. Noise frames with x=0/y=0 do NOT
        # count as EMPTY -- they are just zero-value noise.
        # If we get presence frames from a TX that was never validated via explicit
        # EMPTY, or too many presence frames without an EMPTY, suppress as phantom.
        key = tx_id or self.port
        if not presence:
            # This is NOT a real EMPTY -- it's a computed "no presence" from noise.
            # Do NOT validate the TX. Just reset the presence counter.
            self._presence_count[key] = 0
        else:
            self._presence_count[key] = self._presence_count.get(key, 0) + 1
            if not self._tx_validated.get(key, False):
                # TX not validated: never received an explicit "EMPTY" keyword frame
                presence = False
            elif self._presence_count[key] > self._PRESENCE_WITHOUT_EMPTY_LIMIT:
                # Too many consecutive presence without an explicit EMPTY
                presence = False
                if self._presence_count[key] % 20 == 0:
                    print(f"[THEIA] Phantom suppressed: {key} d={d} ({self._presence_count[key]} presence without EMPTY)")

        # Reuse the common device-lookup + event-insert + SSE-broadcast logic
        await self._handle_detection(
            tx_id=tx_id,
            sensor_type=sensor_type,
            x=x, y=y, d=d, v=v,
            angle=angle,
            presence=presence,
            vbatt=vbatt,
        )

    # ------------------------------------------------------------------ common handler
    async def _handle_detection(
        self, *, tx_id: str | None, sensor_type: str,
        x: int, y: int, d: int, v: int,
        angle: float, presence: bool, vbatt: float | None,
    ):
        """Common logic for all sensor parsers: lookup device, store event, broadcast SSE."""
        db = await get_db()
        row = None

        if tx_id:
            cursor = await db.execute(
                "SELECT id, mission_id, zone, zone_id, zone_label, side, name "
                "FROM devices WHERE dev_eui=? AND enabled=1",
                (tx_id,),
            )
            row = await cursor.fetchone()

            # Auto-enroll unknown TX
            if not row:
                import uuid
                did = str(uuid.uuid4())[:8]
                dev_type = "gravity_mw" if sensor_type == "gravity_mw" else "microwave_tx"
                await db.execute(
                    """INSERT INTO devices (id, dev_eui, name, type, serial_port, enabled)
                       VALUES (?, ?, ?, ?, ?, 1)""",
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
                    "SELECT id, mission_id, zone, zone_id, zone_label, side, name "
                    "FROM devices WHERE id=?", (did,),
                )
                row = await cursor.fetchone()

        # Fallback: match by serial port
        if not row:
            cursor = await db.execute(
                "SELECT id, mission_id, zone, zone_id, zone_label, side, name "
                "FROM devices WHERE serial_port=? AND enabled=1",
                (self.port,),
            )
            row = await cursor.fetchone()

        device_id = row["id"] if row else None
        mission_id = row["mission_id"] if row else None
        zone = row["zone"] if row else ""
        zone_id = row["zone_id"] if row else None
        zone_label = row["zone_label"] if row else ""
        side = row["side"] if row else ""
        device_name = row["name"] if row else (tx_id or self.port)

        now_iso = datetime.now(timezone.utc).isoformat()
        if device_id:
            await db.execute(
                """UPDATE devices SET
                    battery=?, last_seen=?, rssi=?, serial_port=?
                   WHERE id=?""",
                (vbatt, now_iso, self.last_rssi, self.port, device_id),
            )

        direction = "D" if angle > 30 else ("G" if angle < -30 else "C")
        # When no presence, reset distance to 0 to avoid stale values on the map
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

        # --- FINAL phantom gate (safety net for ALL code paths) ---
        # Even if a parser didn't suppress a phantom frame, block the INSERT here.
        # A TX must have sent at least one explicit "EMPTY" keyword frame
        # (which sets _tx_validated) before we store ANY presence event.
        phantom_key = tx_id or self.port
        if presence and not self._tx_validated.get(phantom_key, False):
            # Never saw an EMPTY from this TX -> phantom noise, suppress
            presence = False
            effective_distance = 0
            payload["presence"] = False
            payload["distance"] = 0

        # Only store detection events in DB when there IS real presence
        # AND distance is significant (> 15cm to avoid sensor noise)
        # Rate-limit: max 1 INSERT per device per 8 seconds to avoid DB bloat
        if mission_id and presence and d > 15:
            device_key = device_id or self.port
            now_ts = time.time()
            last_insert_ts = self._last_insert_ts.get(device_key, 0)
            if now_ts - last_insert_ts >= 8.0:
                self._last_insert_ts[device_key] = now_ts
                payload_json = json.dumps(payload)
                try:
                    await db.execute(
                        """INSERT INTO events
                           (mission_id, device_id, event_type, zone, zone_id, side, rssi, snr, payload)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (mission_id, device_id, "detection", zone, zone_id, side,
                         self.last_rssi, 0, payload_json),
                    )
                except Exception:
                    # Fallback: old schema without zone_id / side columns
                    await db.execute(
                        """INSERT INTO events
                           (mission_id, device_id, event_type, zone, rssi, snr, payload)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (mission_id, device_id, "detection", zone,
                         self.last_rssi, 0, payload_json),
                    )
                print(f"[THEIA-DB] INSERT event: d={d} dir={direction} zone_id={zone_id} mission={mission_id}")
        elif presence and not mission_id:
            print(f"[THEIA-DB] SKIP (no mission): dev={device_id} d={d}")

        await db.commit()

        # Always broadcast SSE so the webapp can clear stale detections
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

    # ------------------------------------------------------------------ LD45 raw
    async def _parse_ld45(self, line: str):
        """Parse LD2450 frames in two formats:
        - With TX ID:  LD45;TX01;x;y;d;v;vbatt   (recommended)
        - Legacy:      LD45;x;y;d;v;vbatt         (single-TX setups)

        TX ID allows multiple TX sensors to share one RX on a single serial port.
        Each TX is identified by its dev_eui (= TX_ID from Arduino #define).
        """
        parts = line.split(";")
        if len(parts) < 5:
            self.packets_err += 1
            return

        # Detect format: if parts[1] is non-numeric, it's a TX ID
        tx_id = None
        try:
            int(parts[1])
            # Legacy format: LD45;x;y;d;v[;vbatt]
            idx_start = 1
        except ValueError:
            # New format: LD45;TX_ID;x;y;d;v[;vbatt]
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
        # LD2450 presence: non-zero coords + valid distance range (15-600cm)
        presence = (x != 0 or y != 0) and 15 < d < 600

        # Phantom frame suppression (same logic as _parse_rx_frame)
        # LD45 frames never contain explicit "EMPTY" keyword, so TX validation
        # can only come from the [RX] parser seeing "EMPTY" in the data.
        key = tx_id or self.port
        if not presence:
            # Zero-value noise, not a real EMPTY. Don't validate TX.
            self._presence_count[key] = 0
        else:
            self._presence_count[key] = self._presence_count.get(key, 0) + 1
            if not self._tx_validated.get(key, False):
                presence = False
            elif self._presence_count[key] > self._PRESENCE_WITHOUT_EMPTY_LIMIT:
                presence = False

        await self._handle_detection(
            tx_id=tx_id, sensor_type="ld2450",
            x=x, y=y, d=d, v=v,
            angle=angle, presence=presence, vbatt=vbatt,
        )

    # ------------------------------------------------------------------ RX log lines
    async def _parse_rx_log(self, line: str):
        """Parse human-readable log lines from the RX serial output.
        Example: 'RSSI   : -34' or 'Batt RX: 4.086 V'"""
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
        """Parse legacy JSON frames: {"dev_eui":"...","type":"...","payload":{...}}"""
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
            "SELECT id, mission_id, zone FROM devices WHERE dev_eui=?",
            (dev_eui,),
        )
        row = await cursor.fetchone()
        device_id = row["id"] if row else None
        mission_id = row["mission_id"] if row else None
        zone = row["zone"] if row else ""

        # Only store detection events with real presence data (same rules as _handle_detection)
        presence = payload.get("presence", False) if isinstance(payload, dict) else False
        distance = 0
        if isinstance(payload, dict):
            distance = int(payload.get("distance", 0) or 0)
        # Phantom gate: TX must be validated via explicit EMPTY frame
        phantom_key = dev_eui or self.port
        if presence and not self._tx_validated.get(phantom_key, False):
            presence = False
            distance = 0
        if mission_id and event_type == "detection" and presence and distance > 15:
            device_key = device_id or dev_eui
            now_ts = time.time()
            last_insert_ts = self._last_insert_ts.get(device_key, 0)
            if now_ts - last_insert_ts >= 8.0:
                self._last_insert_ts[device_key] = now_ts
                await db.execute(
                    """INSERT INTO events (mission_id, device_id, event_type, zone, rssi, snr, payload)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (mission_id, device_id, event_type, zone, rssi, snr, json.dumps(payload)),
                )
        elif mission_id and event_type != "detection":
            # Non-detection events (status, etc.) are always stored
            await db.execute(
                """INSERT INTO events (mission_id, device_id, event_type, zone, rssi, snr, payload)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
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

    @property
    def data(self) -> dict:
        total_ok = sum(r.packets_ok for r in self._readers.values())
        total_err = sum(r.packets_err for r in self._readers.values())
        # Pick the reader with the most packets as the primary (active LoRa port)
        first_port = "---"
        first_reader = None
        best_packets = -1
        for port, reader in self._readers.items():
            if reader.packets_ok > best_packets:
                best_packets = reader.packets_ok
                first_port = port
                first_reader = reader
        # Fallback: if no packets yet, pick the first port
        if first_reader is None and self._readers:
            first_port = next(iter(self._readers.keys()))
            first_reader = next(iter(self._readers.values()))
        ports = {
            port: {
                "packets_ok": r.packets_ok,
                "packets_err": r.packets_err,
                "rssi": r.last_rssi,
            }
            for port, r in self._readers.items()
        }
        return {
            "connected": len(self._readers) > 0,
            "port": first_port,
            "baud_rate": first_reader.baud if first_reader else 0,
            "rssi": first_reader.last_rssi if first_reader else None,
            "snr": None,
            "ports": ports,
            "total_ports": len(self._readers),
            "packets_received": total_ok,
            "packets_errors": total_err,
        }

    def _scan_ports(self) -> list[str]:
        """Find all available serial ports."""
        # If LORA_SERIAL_PORT is explicitly set, use only that port
        if LORA_SERIAL_PORT and os.path.exists(LORA_SERIAL_PORT):
            return [LORA_SERIAL_PORT]

        found = []
        for pattern in ["/dev/ttyUSB*", "/dev/ttyACM*"]:
            found.extend(sorted(glob.glob(pattern)))

        # Only exclude GPS port if GPS_DEVICE is explicitly set by the user.
        # The GPS uses gpsd (not direct serial), so by default we don't
        # exclude any port -- the RX may be on /dev/ttyUSB0.
        gps_port = os.getenv("GPS_DEVICE", "")
        if gps_port:
            return [p for p in found if p != gps_port]
        return found

    async def start(self):
        """Main loop: scans ports periodically and starts readers for new ones."""
        self._running = True
        print("[THEIA] LoRa bridge starting (multi-port mode)")

        while self._running:
            ports = self._scan_ports()

            # Start readers for new ports
            for port in ports:
                if port not in self._readers:
                    reader = PortReader(port)
                    self._readers[port] = reader
                    task = asyncio.create_task(reader.start())
                    self._tasks.append(task)
                    gps_excl = os.getenv("GPS_DEVICE", "")
                    print(f"[THEIA] Started reader for {port} (GPS_exclude={gps_excl or 'none'}, phantom_gate=ACTIVE)")

            # Remove readers for disconnected ports
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
