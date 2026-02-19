"""
THEIA - LoRa bridge service
Reads serial frames from Heltec LoRa RX USB, parses detection payloads,
inserts events into DB, and broadcasts via SSE.

Expected frame format (JSON over serial):
{"dev_eui":"AABBCCDD","type":"detection","rssi":-67,"snr":9.5,"payload":{...}}
"""
import asyncio
import json
import os
import uuid
from datetime import datetime, timezone

from backend.database import get_db
from backend.sse import sse_manager

LORA_SERIAL_PORT = os.getenv("LORA_SERIAL_PORT", "/dev/ttyACM0")
LORA_BAUD_RATE = int(os.getenv("LORA_BAUD_RATE", "115200"))


class LoRaBridge:
    def __init__(self):
        self._running = False
        self._data: dict = {
            "connected": False,
            "port": LORA_SERIAL_PORT,
            "baud_rate": LORA_BAUD_RATE,
            "rssi": 0,
            "snr": 0,
            "packets_received": 0,
            "packets_errors": 0,
            "last_message": None,
        }

    @property
    def data(self) -> dict:
        return self._data

    def _open_serial(self):
        import serial
        return serial.Serial(
            port=LORA_SERIAL_PORT,
            baudrate=LORA_BAUD_RATE,
            timeout=1,
        )

    async def _process_frame(self, raw: str):
        try:
            frame = json.loads(raw.strip())
        except json.JSONDecodeError:
            self._data["packets_errors"] += 1
            return

        dev_eui = frame.get("dev_eui", "")
        event_type = frame.get("type", "unknown")
        rssi = frame.get("rssi", 0)
        snr = frame.get("snr", 0)
        payload = frame.get("payload", {})

        self._data["rssi"] = rssi
        self._data["snr"] = snr
        self._data["packets_received"] += 1
        self._data["last_message"] = datetime.now(timezone.utc).isoformat()

        # Update device last_seen + RSSI
        db = await get_db()
        await db.execute(
            "UPDATE devices SET rssi=?, snr=?, last_seen=? WHERE dev_eui=?",
            (rssi, snr, datetime.now(timezone.utc).isoformat(), dev_eui),
        )

        # Lookup device for mission_id / zone
        cursor = await db.execute(
            "SELECT id, mission_id, zone FROM devices WHERE dev_eui=?",
            (dev_eui,),
        )
        row = await cursor.fetchone()
        device_id = row["id"] if row else None
        mission_id = row["mission_id"] if row else None
        zone = row["zone"] if row else ""

        # Insert event
        await db.execute(
            """INSERT INTO events (mission_id, device_id, event_type, zone, rssi, snr, payload)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (mission_id, device_id, event_type, zone, rssi, snr, json.dumps(payload)),
        )
        await db.commit()

        # Broadcast SSE
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

        # Log
        await db.execute(
            "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
            ("info", "lora", f"RX from {dev_eui}: {event_type} RSSI={rssi} SNR={snr}"),
        )
        await db.commit()

    async def start(self):
        self._running = True
        while self._running:
            try:
                ser = await asyncio.get_event_loop().run_in_executor(
                    None, self._open_serial
                )
                self._data["connected"] = True
                print(f"[THEIA] LoRa bridge connected on {LORA_SERIAL_PORT}")

                while self._running:
                    raw = await asyncio.get_event_loop().run_in_executor(
                        None, ser.readline
                    )
                    if raw:
                        line = raw.decode("utf-8", errors="replace").strip()
                        if line:
                            await self._process_frame(line)

            except Exception as e:
                self._data["connected"] = False
                self._data["packets_errors"] += 1
                print(f"[THEIA] LoRa bridge error: {e}")
                await asyncio.sleep(5)

    def stop(self):
        self._running = False


lora_bridge = LoRaBridge()
