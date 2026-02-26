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


def _get_bridge_ports() -> set[str]:
    """Get the set of real paths currently held open by the LoRa bridge.
    Any port in this set is the RX -- do NOT flash it."""
    try:
        from backend.services.lora_bridge import lora_bridge
        bridge_reals: set[str] = set()
        for port_path in lora_bridge._readers.keys():
            bridge_reals.add(os.path.realpath(port_path))
            bridge_reals.add(port_path)
        return bridge_reals
    except Exception:
        return set()


@router.get("/ports")
async def list_ports():
    """List available USB serial ports for flashing new TX devices.

    Exclusion strategy (in order of reliability):
    1. GPS symlink (/dev/theia-gps) -- always reliable for GPS.
    2. LoRa bridge active ports -- the bridge holds the RX port open,
       so any port in its _readers dict IS the RX regardless of ttyUSB numbering.
       This is the ONLY reliable way to identify the RX after USB re-enumeration
       (symlinks and MAC addresses are unreliable for identical ESP32 boards).
    3. Enrolled device ports from DB.
    """
    import subprocess

    # ── Step 1: GPS symlink exclusion ──
    gps_reserved: set[str] = set()
    system_symlinks: dict[str, str] = {}
    for symlink in sorted(glob.glob("/dev/theia-*")):
        real = os.path.realpath(symlink)
        system_symlinks[symlink] = real
        if "gps" in symlink:
            gps_reserved.add(real)

    # ── Step 2: LoRa bridge active ports = RX (definitive) ──
    bridge_ports = _get_bridge_ports()
    if bridge_ports:
        print(f"[THEIA] list_ports: bridge holds ports: {bridge_ports}")

    # ── Step 3: enrolled device ports from DB ──
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

    all_reserved = gps_reserved | bridge_ports | enrolled_ports

    # ── Step 4: scan raw ttyUSB/ttyACM ports, filter out reserved ──
    ports = []
    skipped: list[dict] = []
    for pattern in ["/dev/ttyUSB*", "/dev/ttyACM*"]:
        for p in sorted(glob.glob(pattern)):
            real = os.path.realpath(p)

            if real in all_reserved or p in all_reserved:
                if real in gps_reserved:
                    reason = "gps"
                elif real in bridge_ports or p in bridge_ports:
                    reason = "rx-bridge"
                else:
                    reason = "enrolled"
                skipped.append({"port": p, "real": real, "reason": reason})
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

    # ── Step 5: baseline snapshot ──
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
        "bridge_ports": sorted(bridge_ports),
        "system_reals": sorted(gps_reserved),
        "enrolled_count": len(enrolled_ports) // 2,
        "all_raw": all_raw_reals,
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

    # Definitive check: is this port held open by the LoRa bridge?
    bridge_ports = _get_bridge_ports()
    if real in bridge_ports or port in bridge_ports:
        return {"safe": False, "reason": "Port utilise par le recepteur LoRa (bridge actif)", "port": port, "real": real}

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
        # Direct symlink check -- GPS only (RX symlink is unreliable after re-enum)
        for symlink in ["/dev/theia-gps"]:
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
        # ── DEFINITIVE SAFETY: check if target port is held by LoRa bridge ──
        # The bridge holds the RX serial port open. If the target port's realpath
        # matches any port the bridge is reading, it IS the RX.
        bridge_ports = _get_bridge_ports()
        yield f"data: [INFO] Port cible: {req.port} -> {current_real}\n\n"
        yield f"data: [INFO] Ports bridge (RX): {sorted(bridge_ports) if bridge_ports else 'aucun'}\n\n"
        print(f"[THEIA] Pre-flash: target={req.port}({current_real}), bridge_ports={bridge_ports}")

        if current_real in bridge_ports or req.port in bridge_ports:
            msg = f"SECURITE: {req.port} ({current_real}) est actuellement utilise par le recepteur LoRa. Flash ANNULE."
            print(f"[THEIA] FLASH BLOCKED (port held by bridge): {msg}")
            yield f"data: [ERROR] {msg}\n\n"
            yield "data: [DONE] FAIL\n\n"
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return
        else:
            yield f"data: [INFO] Port {req.port} libre (pas utilise par le bridge RX)\n\n"

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
