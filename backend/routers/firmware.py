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
DATA_DIR = os.getenv("THEIA_DATA_DIR", "/opt/theia/data")
RX_MAC_FILE = os.path.join(DATA_DIR, "rx_mac.txt")
# Heltec WiFi LoRa 32 V3 FQBN from standard ESP32 core
# Uses RadioLib for LoRa -- no Heltec SDK dependency
DEFAULT_FQBN = "esp32:esp32:heltec_wifi_lora_32_V3"
FALLBACK_FQBN = "esp32:esp32:esp32s3"


def _find_esptool() -> str | None:
    """Locate esptool binary (system or bundled with arduino-cli)."""
    esptool = shutil.which("esptool") or shutil.which("esptool.py")
    if esptool:
        return esptool
    for p in glob.glob(os.path.expanduser("~/.arduino15/packages/esp32/tools/esptool_py/*/esptool")):
        if os.path.isfile(p):
            return p
    for p in glob.glob(os.path.expanduser("~/.arduino15/packages/esp32/tools/esptool_py/*/esptool.py")):
        if os.path.isfile(p):
            return p
    return None


async def _read_esp32_mac(port: str) -> str | None:
    """Read the ESP32 chip MAC address via esptool (non-blocking).
    Uses --no-stub to avoid modifying the device. Returns MAC string or None."""
    esptool = _find_esptool()
    if not esptool:
        print("[THEIA] esptool not found, cannot read ESP32 MAC")
        return None

    try:
        real = os.path.realpath(port)
        proc = await asyncio.create_subprocess_exec(
            esptool, "--port", real, "--no-stub", "read_mac",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            print(f"[THEIA] esptool read_mac timeout on {port}")
            return None
        output = stdout.decode(errors="replace")
        # Parse MAC from output like: "MAC: aa:bb:cc:dd:ee:ff"
        for line in output.splitlines():
            if "MAC:" in line.upper():
                parts = line.split("MAC:")
                if len(parts) > 1:
                    mac = parts[1].strip().lower()
                    if len(mac) == 17 and mac.count(":") == 5:
                        return mac
        print(f"[THEIA] esptool read_mac: no MAC found in output for {port}")
        print(f"[THEIA] esptool stdout: {output[:200]}")
        print(f"[THEIA] esptool stderr: {stderr.decode(errors='replace')[:200]}")
    except Exception as e:
        print(f"[THEIA] esptool read_mac error on {port}: {e}")
    return None


def _get_rx_mac() -> str | None:
    """Get the stored RX MAC address."""
    try:
        if os.path.isfile(RX_MAC_FILE):
            mac = open(RX_MAC_FILE).read().strip().lower()
            if len(mac) == 17 and mac.count(":") == 5:
                return mac
    except Exception:
        pass
    return None


def _store_rx_mac(mac: str):
    """Store the RX MAC address to disk."""
    try:
        os.makedirs(os.path.dirname(RX_MAC_FILE), exist_ok=True)
        with open(RX_MAC_FILE, "w") as f:
            f.write(mac.lower().strip())
        print(f"[THEIA] RX MAC stored: {mac}")
    except Exception as e:
        print(f"[THEIA] Failed to store RX MAC: {e}")


@router.post("/capture-rx-mac")
async def capture_rx_mac():
    """Read and store the RX ESP32's MAC address from /dev/theia-rx.
    This is the definitive device identity that survives USB re-enumeration."""
    if not os.path.exists("/dev/theia-rx"):
        raise HTTPException(status_code=404, detail="/dev/theia-rx non disponible")
    mac = await _read_esp32_mac("/dev/theia-rx")
    if not mac:
        raise HTTPException(status_code=500, detail="Impossible de lire le MAC de l'ESP32 RX")
    _store_rx_mac(mac)
    return {"mac": mac, "port": os.path.realpath("/dev/theia-rx")}


@router.get("/rx-mac")
async def get_rx_mac_endpoint():
    """Get the stored RX MAC address."""
    mac = _get_rx_mac()
    return {"mac": mac, "stored": mac is not None}


def _get_busy_serial_ports() -> set[str]:
    """Use fuser to find which /dev/ttyUSB* ports are currently held open by a process.
    A busy port = active serial connection = the RX (or GPS). Do NOT flash it.
    This is the ONLY reliable method when devices are identical (same VID/PID/MAC)."""
    import subprocess
    busy: set[str] = set()
    for pattern in ["/dev/ttyUSB*", "/dev/ttyACM*"]:
        for port in glob.glob(pattern):
            try:
                result = subprocess.run(
                    ["fuser", port],
                    capture_output=True, text=True, timeout=3
                )
                # fuser writes PIDs to stderr, returns 0 if port is in use
                if result.returncode == 0:
                    busy.add(port)
                    busy.add(os.path.realpath(port))
            except Exception:
                pass
    return busy


@router.get("/ports")
async def list_ports():
    """List available USB serial ports for flashing new TX devices.

    Exclusion strategy -- fuser ONLY:
    Any port with a process holding it open is BUSY (RX reader, gpsd, etc).
    This is the ONLY reliable method when ESP32 boards are identical
    (same VID/PID/MAC/USB-serial). fuser checks the kernel FD table.

    We do NOT exclude enrolled device ports: TX devices are autonomous after
    flashing (LoRa), their stored serial_port is stale and would block
    legitimate new device detection after USB re-enumeration.
    """
    import subprocess

    # ── Step 1: find ALL busy ports via fuser (kernel-level, 100% reliable) ──
    busy_ports = _get_busy_serial_ports()

    # ── Step 2: system symlinks (for debug info only, NOT for exclusion) ──
    system_symlinks: dict[str, str] = {}
    for symlink in sorted(glob.glob("/dev/theia-*")):
        system_symlinks[symlink] = os.path.realpath(symlink)

    # ── Step 3: scan raw ttyUSB/ttyACM ports, exclude only busy (fuser) ──
    ports = []
    skipped: list[dict] = []
    all_raw: list[str] = []
    for pattern in ["/dev/ttyUSB*", "/dev/ttyACM*"]:
        for p in sorted(glob.glob(pattern)):
            real = os.path.realpath(p)
            all_raw.append(p)

            if real in busy_ports or p in busy_ports:
                skipped.append({"port": p, "real": real, "reason": "busy (fuser)"})
                continue

            info: dict = {
                "port": p, "real": real,
                "label": "", "vid": "", "pid": "",
                "manufacturer": "", "description": "",
            }

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

            try:
                for link in glob.glob("/dev/serial/by-id/*"):
                    if os.path.realpath(link) == real:
                        info["label"] = os.path.basename(link)
                        break
            except Exception:
                pass

            info["usb_serial"] = _get_usb_serial(real)

            parts = []
            if info["description"]:
                parts.append(info["description"])
            elif info["manufacturer"]:
                parts.append(info["manufacturer"])
            if info["vid"] and info["pid"]:
                parts.append(f"{info['vid']}:{info['pid']}")
            info["summary"] = " - ".join(parts) if parts else os.path.basename(p)

            ports.append(info)

    print(f"[THEIA] list_ports: raw={[p for p in all_raw]}, busy={sorted(busy_ports)}, "
          f"skipped={[s['port']+'('+s['reason']+')' for s in skipped]}, "
          f"available={[p['port'] for p in ports]}")

    return {
        "ports": ports,
        "system": [
            {"symlink": k, "real": v, "role": k.replace("/dev/theia-", "")}
            for k, v in system_symlinks.items()
        ],
        "busy_ports": sorted(busy_ports),
        "all_raw": all_raw,
        "skipped": skipped,
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


@router.get("/sketches/{name}")
async def get_sketch_content(name: str):
    """Get the source code of a firmware sketch."""
    sketch_dir = os.path.join(FIRMWARE_DIR, name)
    if not os.path.isdir(sketch_dir):
        raise HTTPException(status_code=404, detail="Firmware introuvable")
    ino_files = [f for f in os.listdir(sketch_dir) if f.endswith(".ino")]
    if not ino_files:
        raise HTTPException(status_code=404, detail="Aucun fichier .ino")
    filepath = os.path.join(sketch_dir, ino_files[0])
    with open(filepath, "r") as f:
        content = f.read()
    return {"name": name, "file": ino_files[0], "content": content}


@router.put("/sketches/{name}")
async def update_sketch_content(name: str, body: dict):
    """Update the source code of a firmware sketch."""
    content = body.get("content", "")
    if not content.strip():
        raise HTTPException(status_code=400, detail="Contenu vide")
    sketch_dir = os.path.join(FIRMWARE_DIR, name)
    if not os.path.isdir(sketch_dir):
        raise HTTPException(status_code=404, detail="Firmware introuvable")
    ino_files = [f for f in os.listdir(sketch_dir) if f.endswith(".ino")]
    if not ino_files:
        raise HTTPException(status_code=404, detail="Aucun fichier .ino")
    filepath = os.path.join(sketch_dir, ino_files[0])
    with open(filepath, "w") as f:
        f.write(content)
    return {"ok": True, "name": name}


@router.delete("/sketches/{name}")
async def delete_sketch(name: str):
    """Delete a firmware sketch directory."""
    sketch_dir = os.path.join(FIRMWARE_DIR, name)
    if not os.path.isdir(sketch_dir):
        raise HTTPException(status_code=404, detail="Firmware introuvable")
    shutil.rmtree(sketch_dir)
    return {"ok": True, "name": name}


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
    """Get a unique identity for a USB-serial device.
    Returns the USB serial number if unique, otherwise the sysfs device path
    (which identifies the physical USB port the device is plugged into)."""
    import subprocess
    GENERIC_SERIALS = {"0", "0001", "0000", "1", "12345678", ""}
    try:
        real = os.path.realpath(port_path)
        result = subprocess.run(
            ["udevadm", "info", "-a", real],
            capture_output=True, text=True, timeout=3
        )
        # First pass: try to find a unique USB serial
        for line in result.stdout.splitlines():
            line = line.strip()
            if 'ATTRS{serial}' in line and '"' in line:
                serial = line.split('"')[1]
                if serial and serial not in GENERIC_SERIALS and len(serial) >= 6:
                    return serial
        # Fallback: use the sysfs device path (identifies physical USB port)
        result2 = subprocess.run(
            ["udevadm", "info", "-q", "path", real],
            capture_output=True, text=True, timeout=3
        )
        devpath = result2.stdout.strip()
        if devpath:
            return f"path:{devpath}"
    except Exception:
        pass
    return None


# Cache of known RX USB serial numbers (populated at first flash)
_rx_usb_serials: set[str] = set()


async def _build_reserved_map(db) -> dict[str, str]:
    """Build a map of reserved port paths -> reason label.
    NOTE: Only GPS is reserved by symlink. RX is excluded by ESP32 MAC check
    (symlinks are unreliable after USB re-enumeration)."""
    global _rx_usb_serials
    reserved: dict[str, str] = {}
    # 1) System symlinks -- only GPS (NOT RX, symlinks unreliable after re-enum)
    for symlink in glob.glob("/dev/theia-*"):
        real = os.path.realpath(symlink)
        role = symlink.replace("/dev/theia-", "").upper()
        # Only reserve non-RX symlinks (GPS, etc.)
        if "rx" not in symlink.lower():
            reserved[symlink] = f"{role} systeme ({symlink})"
            reserved[real] = f"{role} systeme ({symlink})"
        else:
            # Still fingerprint RX for USB serial check (secondary safety)
            if os.path.exists(real):
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
    """Verify a port is safe to flash.
    Uses fuser (kernel FD check) as the SOLE authority: if a process holds the
    port open, it's busy (RX reader, gpsd, etc.). Otherwise it's available."""
    import subprocess as _sp
    if not os.path.exists(port):
        raise HTTPException(status_code=404, detail=f"Port {port} n'existe pas")

    real = os.path.realpath(port)

    # fuser: definitive check -- is any process holding this port open?
    busy_ports = _get_busy_serial_ports()
    if real in busy_ports or port in busy_ports:
        # Try to identify what's using it
        role = "inconnu"
        for symlink in glob.glob("/dev/theia-*"):
            if os.path.realpath(symlink) == real:
                role = symlink.replace("/dev/theia-", "")
                break
        return {"safe": False, "reason": f"Port occupe par un processus actif (role probable: {role})", "port": port, "real": real}

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

    usb_serial = _get_usb_serial(port)
    return {"safe": True, "port": port, "real": real, "label": label, "usb_serial": usb_serial, **info}


class FlashRequest(BaseModel):
    port: str
    tx_id: str
    sensor_type: str  # "ld2450" or "c4001"
    sketch_name: str | None = None  # If None, uses built-in for sensor_type
    fqbn: str | None = None
    port_serial: str | None = None  # USB identity captured at detection time for safety verification


@router.post("/flash")
async def flash_device(req: FlashRequest):
    """Compile and flash a sketch to an ESP32. Returns SSE stream of progress."""
    db = await get_db()

    # ── SAFETY: fuser check (kernel-level, the SOLE authority) ──
    # With identical ESP32 boards (same VID/PID/MAC/USB-serial), the ONLY
    # reliable method is checking if a process holds the port's file descriptor.
    # Busy = RX reader / gpsd / etc. Free = safe to flash.
    import subprocess as _sp_init
    target_real = os.path.realpath(req.port)
    try:
        fuser_result = _sp_init.run(["fuser", target_real], capture_output=True, text=True, timeout=3)
        if fuser_result.returncode == 0:
            pids = fuser_result.stderr.strip()
            # Identify likely role
            role = "inconnu"
            for symlink in glob.glob("/dev/theia-*"):
                if os.path.realpath(symlink) == target_real:
                    role = symlink.replace("/dev/theia-", "")
                    break
            msg = f"SECURITE: {req.port} ({target_real}) est utilise par un processus (PIDs:{pids}, role: {role}). Flash bloque."
            print(f"[THEIA] FLASH BLOCKED (fuser): {msg}")
            raise HTTPException(status_code=400, detail=msg)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[THEIA] fuser check error (non-blocking): {e}")

    print(f"[THEIA] Flash target APPROVED (fuser: port libre): {req.port} -> {target_real}")

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

        # ── PRE-UPLOAD SAFETY: fuser check (kernel-level, 100% reliable) ──
        # This is the SOLE safety gate. fuser checks the kernel file descriptor
        # table: if ANY process holds this port open, it's the RX/GPS/etc.
        # Symlinks, MAC addresses, USB serials are all unreliable after
        # USB re-enumeration with identical ESP32 boards.
        import subprocess as _sp
        current_real = os.path.realpath(req.port)
        yield f"data: [INFO] Port cible: {req.port} -> {current_real}\n\n"
        try:
            fuser_result = _sp.run(["fuser", current_real], capture_output=True, text=True, timeout=3)
            port_is_busy = fuser_result.returncode == 0
            if port_is_busy:
                pids = fuser_result.stderr.strip()
                # Identify what's likely using it
                role = "inconnu"
                for symlink in glob.glob("/dev/theia-*"):
                    if os.path.realpath(symlink) == current_real:
                        role = symlink.replace("/dev/theia-", "")
                        break
                msg = f"SECURITE: {req.port} ({current_real}) est utilise par un processus (PIDs:{pids}, role probable: {role}). Flash ANNULE."
                print(f"[THEIA] FLASH BLOCKED (fuser): {msg}")
                yield f"data: [ERROR] {msg}\n\n"
                yield "data: [DONE] FAIL\n\n"
                shutil.rmtree(tmp_dir, ignore_errors=True)
                return
            else:
                yield f"data: [INFO] Port {req.port} libre (fuser: aucun processus)\n\n"
        except Exception as e:
            yield f"data: [WARN] Impossible de verifier fuser sur {req.port}: {e}\n\n"

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

        # Register device in DB (upsert: re-activate if soft-deleted, update if exists)
        try:
            dev_type = "c4001" if req.sensor_type == "c4001" else "microwave_tx"
            rx_symlink = "/dev/theia-rx"
            store_port = rx_symlink if os.path.exists(rx_symlink) else req.port

            # Check if dev_eui already exists (soft-deleted or active)
            cursor = await db.execute(
                "SELECT id, enabled FROM devices WHERE dev_eui=?", (req.tx_id,)
            )
            existing = await cursor.fetchone()

            if existing:
                # Re-activate and update existing device
                await db.execute(
                    "UPDATE devices SET name=?, type=?, serial_port=?, enabled=1, "
                    "mission_id=NULL, zone=NULL, zone_id=NULL, zone_label=NULL, side=NULL "
                    "WHERE dev_eui=?",
                    (f"TX-{req.tx_id}", dev_type, store_port, req.tx_id),
                )
                action = "reactive" if not existing["enabled"] else "mis a jour"
            else:
                # Create new device
                did = str(uuid.uuid4())[:8]
                await db.execute(
                    "INSERT INTO devices (id, dev_eui, name, type, serial_port, enabled) VALUES (?, ?, ?, ?, ?, 1)",
                    (did, req.tx_id, f"TX-{req.tx_id}", dev_type, store_port),
                )
                action = "cree"

            await db.execute(
                "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
                ("info", "firmware", f"Device {req.tx_id} ({req.sensor_type}) flashe et {action} sur {req.port}"),
            )
            await db.commit()
            yield f"data: [STEP] Device {req.tx_id} {action} en base de donnees\n\n"
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
