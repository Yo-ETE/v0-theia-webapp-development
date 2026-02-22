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

from backend.database import get_db, close_db
from backend.services.system_monitor import system_monitor
from backend.services.gps_reader import gps_reader
from backend.services.lora_bridge import lora_bridge
from backend.routers import health, missions, devices, events, logs, stream, tiles, admin, config

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


THEIA_BUILD = "2026-02-22-v7-events-heatmap"

@app.get("/")
async def root():
    return {"name": "THEIA API", "version": "1.0.0", "build": THEIA_BUILD, "status": "running"}
