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
        if line.startswith("LD45;"):
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
        presence = d > 20  # basic threshold, can be refined per-device

        # Lookup device: by dev_eui (TX ID) first, fallback to serial_port
        db = await get_db()
        row = None
        if tx_id:
            cursor = await db.execute(
                "SELECT id, mission_id, zone, zone_id, zone_label, side, name "
                "FROM devices WHERE dev_eui=? AND enabled=1",
                (tx_id,),
            )
            row = await cursor.fetchone()

            # Auto-enroll: create device if unknown TX ID appears
            if not row:
                import uuid
                did = str(uuid.uuid4())[:8]
                await db.execute(
                    """INSERT INTO devices (id, dev_eui, name, type, serial_port, enabled)
                       VALUES (?, ?, ?, 'microwave_tx', ?, 1)""",
                    (did, tx_id, f"TX-{tx_id}", self.port),
                )
                await db.commit()
                print(f"[THEIA] Auto-enrolled new TX: {tx_id} on {self.port}")
                await db.execute(
                    "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
                    ("info", "lora", f"Auto-enrolled TX {tx_id} from {self.port}"),
                )
                await db.commit()
                cursor = await db.execute(
                    "SELECT id, mission_id, zone, zone_id, zone_label, side, name "
                    "FROM devices WHERE id=?",
                    (did,),
                )
                row = await cursor.fetchone()

        # Fallback: single-TX mode (match by serial port)
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

        # Update device telemetry
        now_iso = datetime.now(timezone.utc).isoformat()
        if device_id:
            await db.execute(
                """UPDATE devices SET
                    battery=?, last_seen=?, rssi=?, serial_port=?
                   WHERE id=?""",
                (vbatt, now_iso, self.last_rssi, self.port, device_id),
            )

        direction = "D" if angle > 30 else ("G" if angle < -30 else "C")
        payload = {
            "x": x, "y": y, "distance": d, "speed": v,
            "angle": round(angle, 1),
            "presence": presence,
            "direction": direction,
            "vbatt_tx": vbatt,
            "tx_id": tx_id,
        }

        # Insert event if device is assigned to a mission
        if mission_id:
            await db.execute(
                """INSERT INTO events
                   (mission_id, device_id, event_type, zone, rssi, snr, payload)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (mission_id, device_id, "detection", zone, self.last_rssi, 0,
                 json.dumps(payload)),
            )

        await db.commit()

        # Broadcast via SSE (real-time to webapp)
        await sse_manager.broadcast("detection", {
            "device_id": device_id,
            "device_name": device_name,
            "tx_id": tx_id,
            "serial_port": self.port,
            "mission_id": mission_id,
            "zone": zone,
            "zone_id": zone_id,
            "zone_label": zone_label,
            "side": side,
            "presence": presence,
            "distance": d,
            "speed": v,
            "angle": round(angle, 1),
            "direction": direction,
            "vbatt_tx": vbatt,
            "rssi": self.last_rssi,
            "timestamp": now_iso,
        })

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

        if mission_id:
            await db.execute(
                """INSERT INTO events (mission_id, device_id, event_type, zone, rssi, snr, payload)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (mission_id, device_id, event_type, zone, rssi, snr, json.dumps(payload)),
            )

        await db.commit()

        await sse_manager.broadcast("detection", {
            "device_id": device_id,
            "dev_eui": dev_eui,
            "mission_id": mission_id,
            "zone": zone,
            "event_type": event_type,
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
            "ports": ports,
            "total_ports": len(self._readers),
            "packets_received": total_ok,
            "packets_errors": total_err,
        }

    def _scan_ports(self) -> list[str]:
        """Find all available serial ports."""
        # If env var is set, use only that
        if LORA_SERIAL_PORT and os.path.exists(LORA_SERIAL_PORT):
            return [LORA_SERIAL_PORT]

        found = []
        for pattern in ["/dev/ttyUSB*", "/dev/ttyACM*"]:
            found.extend(sorted(glob.glob(pattern)))

        # Exclude GPS port if configured
        gps_port = os.getenv("GPS_DEVICE", "")
        return [p for p in found if p != gps_port]

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
                    print(f"[THEIA] Started reader for {port}")

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
