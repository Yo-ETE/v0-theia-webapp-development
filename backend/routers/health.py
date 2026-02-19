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
    return {
        "system": system_monitor.data,
        "gps": gps_reader.data,
        "lora": lora_bridge.data,
    }


@router.get("/gps")
async def gps():
    return gps_reader.data
