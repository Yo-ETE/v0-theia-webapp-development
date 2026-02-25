"""
THEIA - Firmware provisioning router
Flash Arduino sketches to ESP32 via arduino-cli.
"""
import asyncio
import glob
import os
import shutil
import tempfile
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.database import get_db

router = APIRouter(prefix="/firmware", tags=["firmware"])

APP_DIR = os.getenv("APP_DIR", "/opt/theia/app")
FIRMWARE_DIR = os.path.join(APP_DIR, "firmware")
# Fallback for dev: use project-local firmware dir
if not os.path.isdir(FIRMWARE_DIR):
    FIRMWARE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "firmware")

ARDUINO_CLI = shutil.which("arduino-cli") or "/usr/local/bin/arduino-cli"
# Default FQBN for Heltec ESP32-S3 WiFi LoRa V3
DEFAULT_FQBN = "esp32:esp32:heltec_wifi_lora_32_V3"


@router.get("/ports")
async def list_ports():
    """List available USB serial ports."""
    ports = []
    for pattern in ["/dev/ttyUSB*", "/dev/ttyACM*"]:
        for p in sorted(glob.glob(pattern)):
            real = os.path.realpath(p)
            ports.append({"port": p, "real": real})
    return ports


@router.get("/sketches")
async def list_sketches():
    """List available firmware sketches."""
    sketches = []
    if not os.path.isdir(FIRMWARE_DIR):
        return sketches
    for entry in sorted(os.listdir(FIRMWARE_DIR)):
        sketch_dir = os.path.join(FIRMWARE_DIR, entry)
        if os.path.isdir(sketch_dir):
            # Find .ino file inside
            ino_files = [f for f in os.listdir(sketch_dir) if f.endswith(".ino")]
            if ino_files:
                # Check if it's a built-in template (has __TX_ID__ placeholder)
                with open(os.path.join(sketch_dir, ino_files[0]), "r") as f:
                    content = f.read()
                is_template = "__TX_ID__" in content
                sketches.append({
                    "name": entry,
                    "file": ino_files[0],
                    "path": sketch_dir,
                    "is_template": is_template,
                    "sensor_type": "ld2450" if "LD2450" in entry else ("c4001" if "C4001" in entry else "unknown"),
                })
    return sketches


class UploadSketchRequest(BaseModel):
    filename: str
    content: str  # base64 encoded


@router.post("/upload-sketch")
async def upload_sketch(req: UploadSketchRequest):
    """Upload a custom .ino sketch (base64 encoded content)."""
    import base64
    if not req.filename.endswith(".ino"):
        raise HTTPException(status_code=400, detail="Le fichier doit etre un .ino")

    sketch_name = req.filename.replace(".ino", "")
    sketch_dir = os.path.join(FIRMWARE_DIR, sketch_name)
    os.makedirs(sketch_dir, exist_ok=True)

    try:
        content = base64.b64decode(req.content)
    except Exception:
        raise HTTPException(status_code=400, detail="Contenu base64 invalide")

    filepath = os.path.join(sketch_dir, req.filename)
    with open(filepath, "wb") as f:
        f.write(content)

    return {"ok": True, "name": sketch_name, "path": sketch_dir}


class FlashRequest(BaseModel):
    port: str
    tx_id: str
    sensor_type: str  # "ld2450" or "c4001"
    sketch_name: str | None = None  # If None, uses built-in for sensor_type
    fqbn: str | None = None


@router.post("/flash")
async def flash_device(req: FlashRequest):
    """Compile and flash a sketch to an ESP32. Returns SSE stream of progress."""
    db = await get_db()

    # Check TX_ID uniqueness
    cursor = await db.execute("SELECT id FROM devices WHERE dev_eui=?", (req.tx_id,))
    existing = await cursor.fetchone()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"{req.tx_id} deja cree. Choisissez un autre identifiant."
        )

    # Determine which sketch to use
    if req.sketch_name:
        sketch_dir = os.path.join(FIRMWARE_DIR, req.sketch_name)
    else:
        # Use built-in template based on sensor_type
        if req.sensor_type == "c4001":
            sketch_dir = os.path.join(FIRMWARE_DIR, "TX_C4001")
        else:
            sketch_dir = os.path.join(FIRMWARE_DIR, "TX_LD2450")

    if not os.path.isdir(sketch_dir):
        raise HTTPException(status_code=404, detail=f"Sketch introuvable: {sketch_dir}")

    # Find .ino file
    ino_files = [f for f in os.listdir(sketch_dir) if f.endswith(".ino")]
    if not ino_files:
        raise HTTPException(status_code=404, detail="Aucun fichier .ino dans le sketch")

    fqbn = req.fqbn or DEFAULT_FQBN

    async def stream_flash():
        # Create temp copy with TX_ID replaced
        tmp_dir = tempfile.mkdtemp(prefix="theia_flash_")
        # Arduino requires sketch dir name == .ino file name (without extension)
        ino_name = ino_files[0].replace(".ino", "")
        tmp_sketch_dir = os.path.join(tmp_dir, ino_name)
        shutil.copytree(sketch_dir, tmp_sketch_dir)

        # Replace __TX_ID__ placeholder
        ino_path = os.path.join(tmp_sketch_dir, ino_files[0])
        with open(ino_path, "r") as f:
            code = f.read()
        code = code.replace("__TX_ID__", req.tx_id)
        with open(ino_path, "w") as f:
            f.write(code)

        yield f"data: [INFO] Sketch prepare pour {req.tx_id} ({req.sensor_type})\n\n"
        yield f"data: [INFO] FQBN: {fqbn}\n\n"
        yield f"data: [INFO] Port: {req.port}\n\n"

        # Check arduino-cli exists
        if not os.path.isfile(ARDUINO_CLI) and not shutil.which("arduino-cli"):
            yield f"data: [ERROR] arduino-cli non trouve. Lancez install.sh pour l'installer.\n\n"
            yield "data: [DONE] FAIL\n\n"
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return

        cli = shutil.which("arduino-cli") or ARDUINO_CLI

        # Compile
        yield f"data: [STEP] Compilation en cours...\n\n"
        compile_cmd = [cli, "compile", "--fqbn", fqbn, tmp_sketch_dir]
        try:
            proc = await asyncio.create_subprocess_exec(
                *compile_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                yield f"data: [COMPILE] {line.decode('utf-8', errors='replace').rstrip()}\n\n"
            await proc.wait()

            if proc.returncode != 0:
                yield f"data: [ERROR] Compilation echouee (code {proc.returncode})\n\n"
                yield "data: [DONE] FAIL\n\n"
                shutil.rmtree(tmp_dir, ignore_errors=True)
                return
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"
            yield "data: [DONE] FAIL\n\n"
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return

        yield f"data: [STEP] Compilation reussie. Upload vers {req.port}...\n\n"

        # Upload
        upload_cmd = [cli, "upload", "--fqbn", fqbn, "-p", req.port, tmp_sketch_dir]
        try:
            proc = await asyncio.create_subprocess_exec(
                *upload_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                yield f"data: [UPLOAD] {line.decode('utf-8', errors='replace').rstrip()}\n\n"
            await proc.wait()

            if proc.returncode != 0:
                yield f"data: [ERROR] Upload echoue (code {proc.returncode})\n\n"
                yield "data: [DONE] FAIL\n\n"
                shutil.rmtree(tmp_dir, ignore_errors=True)
                return
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"
            yield "data: [DONE] FAIL\n\n"
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return

        yield f"data: [STEP] Flash termine avec succes!\n\n"

        # Register device in DB
        try:
            dev_type = "c4001" if req.sensor_type == "c4001" else "microwave_tx"
            did = str(uuid.uuid4())[:8]
            await db.execute(
                "INSERT INTO devices (id, dev_eui, name, type, serial_port, enabled) VALUES (?, ?, ?, ?, ?, 1)",
                (did, req.tx_id, f"TX-{req.tx_id}", dev_type, req.port),
            )
            await db.execute(
                "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
                ("info", "firmware", f"Device {req.tx_id} ({req.sensor_type}) flashe et enregistre sur {req.port}"),
            )
            await db.commit()
            yield f"data: [STEP] Device {req.tx_id} enregistre en base de donnees\n\n"
        except Exception as e:
            yield f"data: [WARN] Flash OK mais enregistrement DB echoue: {str(e)}\n\n"

        yield "data: [DONE] OK\n\n"
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return StreamingResponse(
        stream_flash(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
