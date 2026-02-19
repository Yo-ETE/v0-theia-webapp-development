"""
THEIA - Logs query router
"""
from fastapi import APIRouter
from backend.database import get_db

router = APIRouter(prefix="/logs", tags=["logs"])


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
