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

    @staticmethod
    def _safe_val(obj, attr, default=0.0):
        """Safely get attribute, calling it if it's a method."""
        val = getattr(obj, attr, default)
        if callable(val):
            try:
                val = val()
            except Exception:
                val = default
        if val is None:
            val = default
        return val

    def _read_gpsd(self) -> dict:
        """Read from gpsd synchronously."""
        try:
            import gpsd
            gpsd.connect()
            packet = gpsd.get_current()

            mode = int(self._safe_val(packet, "mode", 0))
            fix = mode >= 2
            lat = float(self._safe_val(packet, "lat", 0.0)) if fix else 0.0
            lon = float(self._safe_val(packet, "lon", 0.0)) if fix else 0.0
            alt = float(self._safe_val(packet, "alt", 0.0)) if mode >= 3 else 0.0
            speed = float(self._safe_val(packet, "speed", 0.0))
            sats = int(self._safe_val(packet, "sats", 0))
            hdop = float(self._safe_val(packet, "hdop", 0.0))

            return {
                "fix": fix,
                "latitude": lat,
                "longitude": lon,
                "altitude": alt,
                "speed": speed,
                "satellites": sats,
                "hdop": hdop,
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
