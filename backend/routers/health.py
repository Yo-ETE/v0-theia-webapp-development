"""
THEIA - Health & status endpoints
"""
from fastapi import APIRouter
from backend.services.system_monitor import system_monitor
from backend.services.gps_reader import gps_reader
from backend.services.lora_bridge import lora_bridge

router = APIRouter()


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "mode": "pi",
        "services": {
            "system_monitor": system_monitor.data.get("cpu_percent") is not None,
            "gps": gps_reader.data.get("fix", False),
            "lora": lora_bridge.data.get("connected", False),
        },
    }


@router.get("/status")
async def status():
    sys_data = system_monitor.data or {}
    net_data = sys_data.pop("network", {}) if isinstance(sys_data, dict) else {}
    import socket

    return {
        "hub": {
            "cpu_percent": sys_data.get("cpu_percent", 0),
            "ram_percent": sys_data.get("ram_percent", 0),
            "ram_used_mb": sys_data.get("ram_used_mb", 0),
            "ram_total_mb": sys_data.get("ram_total_mb", 0),
            "disk_percent": sys_data.get("disk_percent", 0),
            "disk_used_gb": sys_data.get("disk_used_gb", 0),
            "disk_total_gb": sys_data.get("disk_total_gb", 0),
            "temperature": sys_data.get("temperature"),
            "uptime_seconds": sys_data.get("uptime_seconds", 0),
        },
        "gps": gps_reader.data,
        "lora": lora_bridge.data,
        "network": {
            "hostname": socket.gethostname(),
            "lan_ip": next(iter(net_data.get("interfaces", {}).values()), "---"),
            "tailscale_ip": net_data.get("tailscale_ip"),
            "interfaces": net_data.get("interfaces", {}),
            "internet": net_data.get("internet", {"connected": False, "ping_ms": 0}),
            "wifi": net_data.get("wifi", {"connected": False, "ssid": "", "signal": 0}),
            "ethernet": net_data.get("ethernet", {"connected": False, "ip": ""}),
            "usb_modem": net_data.get("usb_modem", {"connected": False, "ip": "", "interface": ""}),
        },
        "alerts": [],
    }


@router.get("/gps")
async def gps():
    return gps_reader.data
