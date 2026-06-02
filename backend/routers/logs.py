"""
THEIA - Logs query router
"""
import asyncio
from fastapi import APIRouter, HTTPException
from backend.database import get_db

router = APIRouter(prefix="/logs", tags=["logs"])


@router.get("/system")
async def system_logs(lines: int = 200, unit: str = "theia-api"):
    """Read Pi systemd journal logs for theia-api / theia-web / gpsd."""
    allowed_units = {"theia-api", "theia-web", "gpsd"}
    if unit not in allowed_units:
        unit = "theia-api"
    try:
        proc = await asyncio.create_subprocess_exec(
            "journalctl", "-u", unit, "-n", str(min(lines, 500)),
            "--no-pager", "--output=short-iso",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
        raw = stdout.decode("utf-8", errors="replace").strip().split("\n")
        return [{"line": l} for l in raw if l]
    except Exception as e:
        return [{"line": f"[ERROR] {e}"}]


@router.get("/sources")
async def list_sources():
    """Return distinct log sources from DB."""
    db = await get_db()
    cursor = await db.execute("SELECT DISTINCT source FROM logs ORDER BY source")
    rows = await cursor.fetchall()
    return [r["source"] for r in rows]


@router.get("")
async def list_logs(
    source: str | None = None,
    level: str | None = None,
    search: str | None = None,
    limit: int = 200,
    offset: int = 0,
):
    db = await get_db()
    conditions = []
    params: list = []

    if source:
        conditions.append("source=?")
        params.append(source)
    if level:
        conditions.append("level=?")
        params.append(level)
    if search:
        conditions.append("message LIKE ?")
        params.append(f"%{search}%")

    where = " AND ".join(conditions) if conditions else "1=1"
    query = f"SELECT * FROM logs WHERE {where} ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.post("/command")
async def execute_command(device: str, cmd: str):
    """Execute command on Pi Xaver/Hub via SSH. Allowed commands only."""
    # Whitelist of allowed commands for safety
    allowed_cmds = {
        "status-xaver01": "ssh theia-xaver@192.168.84.111 'systemctl status xaver-detect'",
        "status-xaver02": "ssh theia-xaver@192.168.84.242 'systemctl status xaver-detect'",
        "status-hub": "ssh theia@192.168.84.179 'systemctl status theia-api'",
        "stop-xaver01": "ssh theia-xaver@192.168.84.111 'sudo systemctl stop xaver-detect'",
        "stop-xaver02": "ssh theia-xaver@192.168.84.242 'sudo systemctl stop xaver-detect'",
        "restart-xaver01": "ssh theia-xaver@192.168.84.111 'sudo systemctl restart xaver-detect'",
        "restart-xaver02": "ssh theia-xaver@192.168.84.242 'sudo systemctl restart xaver-detect'",
        "restart-hub-api": "ssh theia@192.168.84.179 'sudo systemctl restart theia-api'",
        "logs-xaver01": "ssh theia-xaver@192.168.84.111 'sudo journalctl -u xaver-detect -n 50 --no-pager'",
        "logs-xaver02": "ssh theia-xaver@192.168.84.242 'sudo journalctl -u xaver-detect -n 50 --no-pager'",
        "logs-hub": "ssh theia@192.168.84.179 'sudo journalctl -u theia-api -n 50 --no-pager'",
        "test-lora-xaver01": "ssh theia-xaver@192.168.84.111 'python3 -c \"import serial; s = serial.Serial('/dev/ttyUSB0', 115200, timeout=2); print(s.readline())\"'",
        "ps-xaver01": "ssh theia-xaver@192.168.84.111 'ps aux | grep xaver'",
        "ps-xaver02": "ssh theia-xaver@192.168.84.242 'ps aux | grep xaver'",
    }

    full_cmd = allowed_cmds.get(f"{device}-{cmd}")
    if not full_cmd:
        raise HTTPException(status_code=400, detail=f"Unknown command: {device}/{cmd}")

    try:
        proc = await asyncio.create_subprocess_shell(
            full_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10.0)
        output = (stdout + stderr).decode("utf-8", errors="replace")
        return {"output": output, "returncode": proc.returncode}
    except asyncio.TimeoutError:
        return {"output": "[TIMEOUT] Command took too long", "returncode": 1}
    except Exception as e:
        return {"output": f"[ERROR] {str(e)}", "returncode": 1}
