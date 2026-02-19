"""
THEIA - GPS reader service via gpsd
Reads NMEA data from USB GPS dongle through gpsd daemon.
"""
import asyncio
import os
from backend.sse import sse_manager

GPS_DEVICE = os.getenv("GPS_DEVICE", "/dev/ttyUSB0")


class GPSReader:
    def __init__(self):
        self._running = False
        self._data: dict = {
            "fix": False,
            "latitude": 0.0,
            "longitude": 0.0,
            "altitude": 0.0,
            "speed": 0.0,
            "satellites": 0,
            "hdop": 0.0,
        }

    @property
    def data(self) -> dict:
        return self._data

    def _read_gpsd(self) -> dict:
        """Read from gpsd synchronously."""
        try:
            import gpsd
            gpsd.connect()
            packet = gpsd.get_current()

            fix = packet.mode >= 2
            return {
                "fix": fix,
                "latitude": packet.lat if fix else 0.0,
                "longitude": packet.lon if fix else 0.0,
                "altitude": packet.alt if packet.mode >= 3 else 0.0,
                "speed": getattr(packet, "speed", 0.0) or 0.0,
                "satellites": getattr(packet, "sats", 0) or 0,
                "hdop": getattr(packet, "hdop", 0.0) or 0.0,
            }
        except Exception as e:
            print(f"[THEIA] gps_reader error: {e}")
            return self._data

    async def start(self, interval: float = 2.0):
        self._running = True
        while self._running:
            try:
                self._data = await asyncio.get_event_loop().run_in_executor(
                    None, self._read_gpsd
                )
                await sse_manager.broadcast("gps_update", self._data)
            except Exception as e:
                print(f"[THEIA] gps_reader loop error: {e}")
            await asyncio.sleep(interval)

    def stop(self):
        self._running = False


gps_reader = GPSReader()
