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

        # Internet connectivity check (ping)
        internet = {"connected": False, "ping_ms": 0}
        try:
            result = subprocess.run(
                ["ping", "-c", "1", "-W", "2", "8.8.8.8"],
                capture_output=True, text=True, timeout=4
            )
            if result.returncode == 0:
                internet["connected"] = True
                # Parse ping time from output
                for line in result.stdout.split("\n"):
                    if "time=" in line:
                        t = line.split("time=")[1].split(" ")[0]
                        internet["ping_ms"] = round(float(t), 1)
                        break
        except Exception:
            pass

        # WiFi info
        wifi_info: dict = {"connected": False, "ssid": "", "signal": 0, "tx_rate": "", "rx_rate": ""}
        try:
            iw = subprocess.run(
                ["iwconfig", "wlan0"], capture_output=True, text=True, timeout=3
            )
            if iw.returncode == 0 and "ESSID:" in iw.stdout:
                essid = iw.stdout.split('ESSID:"')[1].split('"')[0] if 'ESSID:"' in iw.stdout else ""
                if essid:
                    wifi_info["connected"] = True
                    wifi_info["ssid"] = essid
                if "Signal level=" in iw.stdout:
                    sig = iw.stdout.split("Signal level=")[1].split(" ")[0]
                    wifi_info["signal"] = int(sig)
                if "Bit Rate=" in iw.stdout:
                    rate = iw.stdout.split("Bit Rate=")[1].split(" ")[0]
                    wifi_info["tx_rate"] = f"{rate} Mb/s"
        except Exception:
            pass

        # Ethernet info
        eth_info: dict = {"connected": False, "ip": ""}
        try:
            if "eth0" in ips:
                eth_info["connected"] = True
                eth_info["ip"] = ips["eth0"]
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
                "internet": internet,
                "wifi": wifi_info,
                "ethernet": eth_info,
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
