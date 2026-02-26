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

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.database import get_db

router = APIRouter(prefix="/firmware", tags=["firmware"])

APP_DIR = os.getenv("APP_DIR", "/opt/theia/app")
FIRMWARE_DIR = os.path.join(APP_DIR, "firmware", "templates")
# Fallback paths
if not os.path.isdir(FIRMWARE_DIR):
    FIRMWARE_DIR = os.path.join(APP_DIR, "firmware")
if not os.path.isdir(FIRMWARE_DIR):
    FIRMWARE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "firmware", "templates")
if not os.path.isdir(FIRMWARE_DIR):
    FIRMWARE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "firmware")

ARDUINO_CLI = shutil.which("arduino-cli") or "/usr/local/bin/arduino-cli"
# Heltec WiFi LoRa 32 V3 FQBN from standard ESP32 core
# Uses RadioLib for LoRa -- no Heltec SDK dependency
DEFAULT_FQBN = "esp32:esp32:heltec_wifi_lora_32_V3"
FALLBACK_FQBN = "esp32:esp32:esp32s3"


@router.get("/ports")
async def list_ports():
    """List available USB serial ports, excluding system ports (GPS, RX).

    Logic:
    1. Resolve all /dev/theia-* symlinks to build a set of "reserved" real paths.
    2. Scan /dev/ttyUSB* and /dev/ttyACM* raw ports.
    3. Exclude any raw port whose realpath matches a reserved system symlink.
    4. Exclude any raw port already used by an enrolled device in the DB.
    5. Show the remaining "free" ports with USB device identification.
    """
    import subprocess

    # ── Step 1: build reserved real-path set from /dev/theia-* symlinks ──
    reserved_real_paths: set[str] = set()
    system_symlinks: dict[str, str] = {}  # symlink -> real
    for symlink in sorted(glob.glob("/dev/theia-*")):
        real = os.path.realpath(symlink)
        reserved_real_paths.add(real)
        system_symlinks[symlink] = real

    # ── Step 2: also reserve ports used by enrolled devices ──
    db = await get_db()
    enrolled_ports: set[str] = set()
    try:
        cursor = await db.execute(
            "SELECT serial_port FROM devices WHERE enabled=1 AND serial_port IS NOT NULL AND serial_port != ''"
        )
        rows = await cursor.fetchall()
        for row in rows:
            sp = dict(row)["serial_port"]
            if sp and os.path.exists(sp):
                enrolled_ports.add(sp)
                enrolled_ports.add(os.path.realpath(sp))
    except Exception:
        pass

    all_reserved = reserved_real_paths | enrolled_ports

    # ── Step 3: scan raw ttyUSB/ttyACM ports, filter out reserved ──
    ports = []
    skipped: list[dict] = []  # for debug
    for pattern in ["/dev/ttyUSB*", "/dev/ttyACM*"]:
        for p in sorted(glob.glob(pattern)):
            real = os.path.realpath(p)

            # Skip if this real path is a known system device or enrolled device
            if real in all_reserved or p in all_reserved:
                reason = "system" if real in reserved_real_paths else "enrolled"
                skipped.append({"port": p, "real": real, "reason": reason})
                continue

            info: dict = {
                "port": p, "real": real,
                "label": "", "vid": "", "pid": "",
                "manufacturer": "", "description": "",
            }

            # USB device info via udevadm
            try:
                result = subprocess.run(
                    ["udevadm", "info", "-a", real],
                    capture_output=True, text=True, timeout=3
                )
                for line in result.stdout.splitlines():
                    line = line.strip()
                    if 'ATTRS{idVendor}' in line and not info["vid"]:
                        info["vid"] = line.split('"')[1] if '"' in line else ""
                    elif 'ATTRS{idProduct}' in line and not info["pid"]:
                        info["pid"] = line.split('"')[1] if '"' in line else ""
                    elif 'ATTRS{manufacturer}' in line and not info["manufacturer"]:
                        info["manufacturer"] = line.split('"')[1] if '"' in line else ""
                    elif 'ATTRS{product}' in line and not info["description"]:
                        info["description"] = line.split('"')[1] if '"' in line else ""
            except Exception:
                pass

            # Human-readable link from /dev/serial/by-id/
            try:
                for link in glob.glob("/dev/serial/by-id/*"):
                    if os.path.realpath(link) == real:
                        info["label"] = os.path.basename(link)
                        break
            except Exception:
                pass

            # Build summary
            parts = []
            if info["description"]:
                parts.append(info["description"])
            elif info["manufacturer"]:
                parts.append(info["manufacturer"])
            if info["vid"] and info["pid"]:
                parts.append(f"{info['vid']}:{info['pid']}")
            info["summary"] = " - ".join(parts) if parts else os.path.basename(p)

            ports.append(info)

    # ── Step 4: build the full list of raw USB real paths (for baseline snapshot) ──
    all_raw_reals: list[str] = []
    for pattern in ["/dev/ttyUSB*", "/dev/ttyACM*"]:
        for p in sorted(glob.glob(pattern)):
            all_raw_reals.append(os.path.realpath(p))

    return {
        "ports": ports,
        "system": [
            {"symlink": k, "real": v, "role": k.replace("/dev/theia-", "")}
            for k, v in system_symlinks.items()
        ],
        "system_reals": sorted(reserved_real_paths),  # real paths of ALL system devices
        "enrolled_count": len(enrolled_ports) // 2,  # each device has port + real
        "all_raw": all_raw_reals,  # complete snapshot of all plugged USB serial devices
        "skipped": skipped,  # debug: which ports were filtered out and why
    }


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


@router.post("/upload-sketch")
async def upload_sketch(
    file: UploadFile = File(...),
    sensor_type: str = Form("unknown"),
):
    """Upload a custom .ino sketch file."""
    if not file.filename or not file.filename.endswith((".ino", ".cpp", ".c")):
        raise HTTPException(status_code=400, detail="Le fichier doit etre un .ino, .cpp, ou .c")

    # Normalize: always save as .ino
    base_name = file.filename.rsplit(".", 1)[0]
    sketch_name = f"custom_{base_name}"
    sketch_dir = os.path.join(FIRMWARE_DIR, sketch_name)
    os.makedirs(sketch_dir, exist_ok=True)

    content = await file.read()
    ino_filename = f"{sketch_name}.ino"
    filepath = os.path.join(sketch_dir, ino_filename)
    with open(filepath, "wb") as f:
        f.write(content)

    return {"ok": True, "name": sketch_name, "path": sketch_dir}


def _get_usb_serial(port_path: str) -> str | None:
    """Get the USB serial number for a port (used to fingerprint devices).
    Only returns 'specific' serials (>= 6 chars, not generic patterns)."""
    import subprocess
    # Generic serials shared by many CP2102 / CH340 devices -- NOT unique
    GENERIC_SERIALS = {"0", "0001", "0000", "1", "12345678", ""}
    try:
        real = os.path.realpath(port_path)
        result = subprocess.run(
            ["udevadm", "info", "-a", real],
            capture_output=True, text=True, timeout=3
        )
        for line in result.stdout.splitlines():
            line = line.strip()
            if 'ATTRS{serial}' in line and '"' in line:
                serial = line.split('"')[1]
                if serial and serial not in GENERIC_SERIALS and len(serial) >= 6:
                    return serial
    except Exception:
        pass
    return None


# Cache of known RX USB serial numbers (populated at first flash)
_rx_usb_serials: set[str] = set()


async def _build_reserved_map(db) -> dict[str, str]:
    """Build a map of reserved port paths -> reason label.
    Also fingerprints system devices by USB serial number."""
    global _rx_usb_serials
    reserved: dict[str, str] = {}
    # 1) System symlinks -- resolve fresh each time (ALWAYS re-resolve)
    for symlink in glob.glob("/dev/theia-*"):
        real = os.path.realpath(symlink)
        role = symlink.replace("/dev/theia-", "").upper()
        reserved[symlink] = f"{role} systeme ({symlink})"
        reserved[real] = f"{role} systeme ({symlink})"
        # Fingerprint RX with SPECIFIC USB serials only (>= 6 chars, not generic)
        if "rx" in symlink.lower() and os.path.exists(real):
            serial = _get_usb_serial(real)
            if serial:
                _rx_usb_serials.add(serial)
                print(f"[THEIA] RX fingerprint: {symlink} -> {real} serial={serial}")
    # Save system keys so enrolled devices NEVER overwrite them
    system_keys = set(reserved.keys())
    # 2) Enrolled device ports (lower priority -- never overwrite system)
    try:
        cursor = await db.execute(
            "SELECT serial_port, name, dev_eui FROM devices WHERE enabled=1 AND serial_port IS NOT NULL AND serial_port != ''"
        )
        for row in await cursor.fetchall():
            d = dict(row)
            sp = d["serial_port"]
            label = f"device {d.get('dev_eui') or d.get('name', '?')}"
            if sp and os.path.exists(sp):
                if sp not in system_keys:
                    reserved[sp] = label
                real = os.path.realpath(sp)
                if real not in system_keys:
                    reserved[real] = label
    except Exception:
        pass
    return reserved


def _check_usb_serial_is_rx(port_path: str) -> str | None:
    """Check if a port's USB serial matches a known RX device. Returns reason if blocked.
    Only triggers on SPECIFIC serial numbers (not generic CP2102/CH340 serials)."""
    serial = _get_usb_serial(port_path)
    if serial and serial in _rx_usb_serials:
        return f"USB serial {serial} correspond au recepteur RX"
    return None


@router.get("/verify-port")
async def verify_port(port: str):
    """Verify a port is safe to flash -- not a system/enrolled device."""
    import subprocess as _sp
    if not os.path.exists(port):
        raise HTTPException(status_code=404, detail=f"Port {port} n'existe pas")

    real = os.path.realpath(port)
    db = await get_db()
    reserved = await _build_reserved_map(db)

    block = reserved.get(port) or reserved.get(real)
    if block:
        return {"safe": False, "reason": block, "port": port, "real": real}

    # Also check USB serial fingerprint
    rx_match = _check_usb_serial_is_rx(port)
    if rx_match:
        return {"safe": False, "reason": rx_match, "port": port, "real": real}

    # Get device info via udevadm
    info: dict[str, str] = {}
    try:
        result = _sp.run(["udevadm", "info", "-a", real], capture_output=True, text=True, timeout=3)
        for line in result.stdout.splitlines():
            line = line.strip()
            if 'ATTRS{idVendor}' in line and "vid" not in info:
                info["vid"] = line.split('"')[1] if '"' in line else ""
            elif 'ATTRS{idProduct}' in line and "pid" not in info:
                info["pid"] = line.split('"')[1] if '"' in line else ""
            elif 'ATTRS{manufacturer}' in line and "manufacturer" not in info:
                info["manufacturer"] = line.split('"')[1] if '"' in line else ""
            elif 'ATTRS{product}' in line and "description" not in info:
                info["description"] = line.split('"')[1] if '"' in line else ""
    except Exception:
        pass

    # Build a label from serial-by-id if available
    label = ""
    for link in glob.glob("/dev/serial/by-id/*"):
        if os.path.realpath(link) == real:
            label = os.path.basename(link)
            break

    return {"safe": True, "port": port, "real": real, "label": label, **info}


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

    # ── SAFETY LEVEL 1: direct symlink check (ALWAYS works, no DB needed) ──
    target_real = os.path.realpath(req.port)
    for symlink in ["/dev/theia-rx", "/dev/theia-gps"]:
        if os.path.exists(symlink):
            sym_real = os.path.realpath(symlink)
            if target_real == sym_real or req.port == symlink:
                role = symlink.replace("/dev/theia-", "").upper()
                print(f"[THEIA] FLASH BLOCKED (direct check): {req.port} -> {target_real} is {role} ({symlink} -> {sym_real})")
                raise HTTPException(
                    status_code=400,
                    detail=f"SECURITE: {req.port} est le {role} systeme ({symlink}). Impossible de flasher le recepteur !"
                )

    # ── SAFETY LEVEL 2: full reserved map (system + enrolled devices) ──
    reserved = await _build_reserved_map(db)
    print(f"[THEIA] Flash safety: target={req.port} -> {target_real}, reserved_map={dict(reserved)}")
    block_reason = reserved.get(req.port) or reserved.get(target_real)
    if block_reason:
        print(f"[THEIA] FLASH BLOCKED (reserved map): {req.port} -> {target_real} is {block_reason}")
        raise HTTPException(
            status_code=400,
            detail=f"Port {req.port} ({target_real}) est {block_reason}. Impossible de flasher dessus."
        )

    # ── SAFETY LEVEL 3: USB serial fingerprint ──
    rx_match = _check_usb_serial_is_rx(req.port)
    if rx_match:
        print(f"[THEIA] FLASH BLOCKED by USB serial: {req.port} -> {rx_match}")
        raise HTTPException(
            status_code=400,
            detail=f"SECURITE: {req.port} est identifie comme le RX ({rx_match}). Flash bloque."
        )

    print(f"[THEIA] Flash target APPROVED: {req.port} -> {target_real} ({len(reserved)} reserved paths)")

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

        # Compile -- try primary FQBN, then fallback
        fqbns_to_try = [fqbn]
        if fqbn == DEFAULT_FQBN and FALLBACK_FQBN != DEFAULT_FQBN:
            fqbns_to_try.append(FALLBACK_FQBN)

        compiled = False
        used_fqbn = fqbn
        for try_fqbn in fqbns_to_try:
            yield f"data: [STEP] Compilation en cours (FQBN: {try_fqbn})...\n\n"
            compile_cmd = [cli, "compile", "--fqbn", try_fqbn, tmp_sketch_dir]
            try:
                proc = await asyncio.create_subprocess_exec(
                    *compile_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
                output_lines = []
                while True:
                    line = await proc.stdout.readline()
                    if not line:
                        break
                    decoded = line.decode('utf-8', errors='replace').rstrip()
                    output_lines.append(decoded)
                    yield f"data: [COMPILE] {decoded}\n\n"
                await proc.wait()

                if proc.returncode == 0:
                    compiled = True
                    used_fqbn = try_fqbn
                    break
                else:
                    yield f"data: [WARN] Compilation echouee avec {try_fqbn} (code {proc.returncode})\n\n"
                    if try_fqbn != fqbns_to_try[-1]:
                        yield f"data: [INFO] Essai avec FQBN alternatif...\n\n"
            except Exception as e:
                yield f"data: [WARN] Erreur: {str(e)}\n\n"

        if not compiled:
            yield f"data: [ERROR] Compilation echouee avec tous les FQBN testes.\n\n"
            yield f"data: [INFO] Verifiez que le board Heltec ESP32 est installe: sudo bash install.sh\n\n"
            yield "data: [DONE] FAIL\n\n"
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return

        yield f"data: [STEP] Compilation reussie ({used_fqbn}). Upload vers {req.port}...\n\n"

        # ── PRE-UPLOAD SAFETY: FULL re-check ──
        # USB re-enumeration may have swapped port assignments since detection
        current_real = os.path.realpath(req.port)
        # Direct symlink check first (most reliable)
        for symlink in ["/dev/theia-rx", "/dev/theia-gps"]:
            if os.path.exists(symlink) and os.path.realpath(symlink) == current_real:
                role = symlink.replace("/dev/theia-", "").upper()
                yield f"data: [ERROR] SECURITE: {req.port} ({current_real}) est le {role} systeme. Flash annule.\n\n"
                yield "data: [DONE] FAIL\n\n"
                shutil.rmtree(tmp_dir, ignore_errors=True)
                return
        pre_reserved = await _build_reserved_map(db)
        pre_block = pre_reserved.get(req.port) or pre_reserved.get(current_real)
        if pre_block:
            yield f"data: [ERROR] SECURITE: {req.port} ({current_real}) est maintenant {pre_block}. Flash annule.\n\n"
            yield "data: [DONE] FAIL\n\n"
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return
        # Also re-check USB serial fingerprint
        pre_rx = _check_usb_serial_is_rx(req.port)
        if pre_rx:
            yield f"data: [ERROR] SECURITE: {req.port} identifie comme RX ({pre_rx}). Flash annule.\n\n"
            yield "data: [DONE] FAIL\n\n"
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return
        yield f"data: [INFO] Port verifie: {req.port} -> {current_real} (OK, USB serial check OK)\n\n"

        # Upload
        upload_cmd = [cli, "upload", "--fqbn", used_fqbn, "-p", req.port, tmp_sketch_dir]
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
            # Always store the resolved real path, never a symlink like /dev/theia-*
            store_port = os.path.realpath(req.port)
            # Extra guard: NEVER store a system symlink path
            if store_port.startswith("/dev/theia-"):
                store_port = req.port  # fallback to original
            await db.execute(
                "INSERT INTO devices (id, dev_eui, name, type, serial_port, enabled) VALUES (?, ?, ?, ?, ?, 1)",
                (did, req.tx_id, f"TX-{req.tx_id}", dev_type, store_port),
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
