"""
THEIA - FastAPI main application
Hub IoT supervision backend.
"""
import asyncio
import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.database import get_db, close_db, start_retention_job
from backend.services.system_monitor import system_monitor
from backend.services.gps_reader import gps_reader
from backend.services.lora_bridge import lora_bridge
from backend.services import hotspot_watchdog
from backend.routers import health, missions, devices, events, logs, stream, tiles, admin, config, notifications, auth, push
from backend.middleware.auth import AuthMiddleware
from backend.security import cors_origin_regex
try:
    from backend.routers import firmware
except ImportError as e:
    firmware = None  # type: ignore
    print(f"[THEIA] firmware router not available: {e}")

_tasks: list[asyncio.Task] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: init DB + start background services
    await get_db()
    print(f"[THEIA] Database initialized -- BUILD: {THEIA_BUILD}")
    print(f"[THEIA] Phantom suppression: ACTIVE (require EMPTY validation)")

    _tasks.append(asyncio.create_task(system_monitor.start(interval=5.0)))
    print("[THEIA] System monitor started")

    # GPS reader uses gpsd (not direct serial) -- always try to start it.
    # gpsd manages the serial device independently; the reader just connects
    # to gpsd's socket, so no serial port check is needed here.
    _tasks.append(asyncio.create_task(gps_reader.start(interval=2.0)))
    print("[THEIA] GPS reader started (via gpsd)")

    # LoRa bridge: always start -- it auto-scans for USB serial ports
    _tasks.append(asyncio.create_task(lora_bridge.start()))
    print("[THEIA] LoRa bridge started (auto-scan mode)")

    _tasks.append(asyncio.create_task(hotspot_watchdog.run_once()))
    if hotspot_watchdog.ENABLED:
        print(f"[THEIA] Auto-hotspot watchdog scheduled (fires after {hotspot_watchdog.DELAY_S:.0f}s "
              f"if offline and within {hotspot_watchdog.BOOT_WINDOW_S:.0f}s of boot; disable with THEIA_AUTO_HOTSPOT=0)")

    start_retention_job()
    print("[THEIA] Data retention job scheduled (events={0}d, logs={1}d, battery={2}d)".format(
        os.getenv("RETENTION_EVENTS_DAYS", "90"),
        os.getenv("RETENTION_LOGS_DAYS", "30"),
        os.getenv("RETENTION_BATTERY_DAYS", "60"),
    ))

    yield

    # Shutdown
    system_monitor.stop()
    gps_reader.stop()
    lora_bridge.stop()
    for t in _tasks:
        t.cancel()
    await close_db()
    print("[THEIA] Shutdown complete")


app = FastAPI(
    title="THEIA API",
    description="IoT Hub Surveillance Backend",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: With credentials=True, the spec requires an explicit origin (not "*").
# Only loopback, LAN (RFC1918), Tailscale and *.local origins are echoed back
# (see backend/security.py). Extra origins: THEIA_CORS_ORIGINS=https://a,https://b
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=cors_origin_regex(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Auth middleware -- must be added AFTER CORS middleware (starlette processes in reverse)
app.add_middleware(AuthMiddleware)

# Register all routers under /api prefix
app.include_router(health.router, prefix="/api")
app.include_router(missions.router, prefix="/api")
app.include_router(devices.router, prefix="/api")
app.include_router(events.router, prefix="/api")
app.include_router(logs.router, prefix="/api")
app.include_router(stream.router, prefix="/api")
app.include_router(tiles.router, prefix="/api")
app.include_router(admin.router)  # admin has its own /api/admin prefix
app.include_router(config.router)  # config has its own /api/config prefix
app.include_router(notifications.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(push.router, prefix="/api")
if firmware:
    app.include_router(firmware.router, prefix="/api")


def _get_build_tag() -> str:
    import subprocess
    try:
        return subprocess.check_output(
            ["git", "describe", "--tags", "--always", "--dirty"],
            cwd=os.path.dirname(__file__), stderr=subprocess.DEVNULL,
        ).decode().strip() or "unknown"
    except Exception:
        return "unknown"

THEIA_BUILD = _get_build_tag()

@app.get("/")
async def root():
    return {"name": "THEIA API", "version": "1.0.0", "build": THEIA_BUILD, "status": "running"}
