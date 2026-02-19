"""
THEIA - System monitor service
Collects CPU, RAM, disk, temperature, uptime, network info via psutil.
"""
import asyncio
import time
import subprocess
import psutil
from backend.sse import sse_manager


class SystemMonitor:
    def __init__(self):
        self._running = False
        self._data: dict = {}

    @property
    def data(self) -> dict:
        return self._data

    def _collect(self) -> dict:
        cpu_temp = None
        try:
            temps = psutil.sensors_temperatures()
            if "cpu_thermal" in temps:
                cpu_temp = temps["cpu_thermal"][0].current
            elif "cpu-thermal" in temps:
                cpu_temp = temps["cpu-thermal"][0].current
        except Exception:
            pass

        mem = psutil.virtual_memory()
        disk = psutil.disk_usage("/")
        boot = psutil.boot_time()
        uptime_s = int(time.time() - boot)

        # Network IPs
        ips = {}
        for iface, addrs in psutil.net_if_addrs().items():
            for a in addrs:
                if a.family.name == "AF_INET" and not a.address.startswith("127."):
                    ips[iface] = a.address

        # Tailscale IP
        tailscale_ip = None
        try:
            result = subprocess.run(
                ["tailscale", "ip", "-4"],
                capture_output=True, text=True, timeout=3
            )
            if result.returncode == 0:
                tailscale_ip = result.stdout.strip()
        except Exception:
            pass

        return {
            "cpu_percent": psutil.cpu_percent(interval=0.5),
            "ram_percent": mem.percent,
            "ram_used_mb": round(mem.used / 1048576),
            "ram_total_mb": round(mem.total / 1048576),
            "disk_percent": disk.percent,
            "disk_used_gb": round(disk.used / 1073741824, 1),
            "disk_total_gb": round(disk.total / 1073741824, 1),
            "temperature": cpu_temp,
            "uptime_seconds": uptime_s,
            "network": {
                "interfaces": ips,
                "tailscale_ip": tailscale_ip,
            },
        }

    async def start(self, interval: float = 5.0):
        self._running = True
        while self._running:
            try:
                self._data = await asyncio.get_event_loop().run_in_executor(
                    None, self._collect
                )
                await sse_manager.broadcast("system_status", self._data)
            except Exception as e:
                print(f"[THEIA] system_monitor error: {e}")
            await asyncio.sleep(interval)

    def stop(self):
        self._running = False


system_monitor = SystemMonitor()
