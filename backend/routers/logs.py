"""
THEIA - Logs query router
"""
import asyncio
from fastapi import APIRouter
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
