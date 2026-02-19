"""
THEIA - Missions CRUD router
"""
import json
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.database import get_db

router = APIRouter(prefix="/missions", tags=["missions"])


class MissionCreate(BaseModel):
    name: str
    description: str = ""
    location_lat: float | None = None
    location_lon: float | None = None
    location_label: str = ""
    zones: list = []


class MissionUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    location_lat: float | None = None
    location_lon: float | None = None
    location_label: str | None = None
    zones: list | None = None


def _row_to_dict(row) -> dict:
    d = dict(row)
    if "zones" in d and isinstance(d["zones"], str):
        try:
            d["zones"] = json.loads(d["zones"])
        except Exception:
            d["zones"] = []
    return d


@router.get("")
async def list_missions():
    db = await get_db()
    cursor = await db.execute("SELECT * FROM missions ORDER BY created_at DESC")
    rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


@router.get("/{mission_id}")
async def get_mission(mission_id: str):
    db = await get_db()
    cursor = await db.execute("SELECT * FROM missions WHERE id=?", (mission_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Mission not found")
    return _row_to_dict(row)


@router.post("", status_code=201)
async def create_mission(body: MissionCreate):
    db = await get_db()
    mid = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """INSERT INTO missions (id, name, description, location_lat, location_lon, location_label, zones, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (mid, body.name, body.description, body.location_lat, body.location_lon,
         body.location_label, json.dumps(body.zones), now, now),
    )
    await db.commit()
    # Insert log
    await db.execute(
        "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
        ("info", "api", f"Mission created: {body.name} ({mid})"),
    )
    await db.commit()
    return {"id": mid, "name": body.name, "status": "planning"}


@router.put("/{mission_id}")
async def update_mission(mission_id: str, body: MissionUpdate):
    db = await get_db()
    cursor = await db.execute("SELECT * FROM missions WHERE id=?", (mission_id,))
    existing = await cursor.fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Mission not found")

    updates = body.model_dump(exclude_none=True)
    if "zones" in updates:
        updates["zones"] = json.dumps(updates["zones"])
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    set_clause = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [mission_id]
    await db.execute(f"UPDATE missions SET {set_clause} WHERE id=?", values)
    await db.commit()
    return {"ok": True}


@router.delete("/{mission_id}")
async def delete_mission(mission_id: str):
    db = await get_db()
    await db.execute("DELETE FROM missions WHERE id=?", (mission_id,))
    await db.commit()
    return {"ok": True}
