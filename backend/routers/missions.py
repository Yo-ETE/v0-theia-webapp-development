"""
THEIA - Missions CRUD router
Field names aligned with frontend: center_lat, center_lon, zoom, environment, location
"""
import json
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from backend.database import get_db

router = APIRouter(prefix="/missions", tags=["missions"])


class MissionCreate(BaseModel):
    id: str | None = None
    name: str
    description: str = ""
    location: str = ""
    environment: str = "horizontal"
    center_lat: float = 48.8566
    center_lon: float = 2.3522
    zoom: int = 19
    zones: list = Field(default_factory=list)
    floors: list = Field(default_factory=list)


class MissionUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    location: str | None = None
    environment: str | None = None
    center_lat: float | None = None
    center_lon: float | None = None
    zoom: int | None = None
    zones: list | None = None
    floors: list | None = None
    started_at: str | None = None
    ended_at: str | None = None
    device_count: int | None = None
    event_count: int | None = None


def _row_to_dict(row) -> dict:
    """Convert a DB row to a frontend-compatible dict."""
    d = dict(row)
    for json_field in ("zones", "floors"):
        if json_field in d and isinstance(d[json_field], str):
            try:
                d[json_field] = json.loads(d[json_field])
            except Exception:
                d[json_field] = []
    # Ensure all expected fields exist
    d.setdefault("environment", "horizontal")
    d.setdefault("center_lat", 48.8566)
    d.setdefault("center_lon", 2.3522)
    d.setdefault("zoom", 19)
    d.setdefault("floors", [])
    d.setdefault("started_at", None)
    d.setdefault("ended_at", None)
    d.setdefault("device_count", 0)
    d.setdefault("event_count", 0)
    return d


async def _get_full_mission(db, mission_id: str) -> dict:
    """Fetch a mission and return full dict."""
    cursor = await db.execute("SELECT * FROM missions WHERE id=?", (mission_id,))
    row = await cursor.fetchone()
    if not row:
        return None
    d = _row_to_dict(row)
    # Count devices assigned to this mission
    cursor2 = await db.execute("SELECT COUNT(*) FROM devices WHERE mission_id=? AND enabled=1", (mission_id,))
    count = await cursor2.fetchone()
    d["device_count"] = count[0] if count else 0
    # Count events
    cursor3 = await db.execute("SELECT COUNT(*) FROM events WHERE mission_id=?", (mission_id,))
    ecount = await cursor3.fetchone()
    d["event_count"] = ecount[0] if ecount else 0
    return d


@router.get("")
async def list_missions():
    db = await get_db()
    cursor = await db.execute("SELECT * FROM missions ORDER BY created_at DESC")
    rows = await cursor.fetchall()
    missions = [_row_to_dict(r) for r in rows]

    # Bulk-count devices and events per mission
    dc = await db.execute("SELECT mission_id, COUNT(*) FROM devices WHERE mission_id != '' AND enabled=1 GROUP BY mission_id")
    dev_counts = {r[0]: r[1] for r in await dc.fetchall()}
    ec = await db.execute("SELECT mission_id, COUNT(*) FROM events GROUP BY mission_id")
    evt_counts = {r[0]: r[1] for r in await ec.fetchall()}

    for m in missions:
        m["device_count"] = dev_counts.get(m["id"], 0)
        m["event_count"] = evt_counts.get(m["id"], 0)
    return missions


@router.get("/{mission_id}")
async def get_mission(mission_id: str):
    db = await get_db()
    result = await _get_full_mission(db, mission_id)
    if not result:
        raise HTTPException(status_code=404, detail="Mission not found")
    return result


@router.post("", status_code=201)
async def create_mission(body: MissionCreate):
    db = await get_db()
    # Use client-provided ID if present, otherwise generate one
    mid = body.id if body.id else str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """INSERT INTO missions
           (id, name, description, location, environment, center_lat, center_lon, zoom, zones, floors, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (mid, body.name, body.description, body.location, body.environment,
         body.center_lat, body.center_lon, body.zoom,
         json.dumps(body.zones), json.dumps(body.floors),
         "draft", now, now),
    )
    await db.commit()
    await db.execute(
        "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
        ("info", "api", f"Mission created: {body.name} ({mid})"),
    )
    await db.commit()
    # Return full mission object
    return await _get_full_mission(db, mid)


@router.patch("/{mission_id}")
async def patch_mission(mission_id: str, body: MissionUpdate):
    """Partial update -- only updates fields that are not None."""
    db = await get_db()
    cursor = await db.execute("SELECT id FROM missions WHERE id=?", (mission_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Mission not found")

    # exclude_unset keeps explicitly-sent null values (e.g. ended_at=null)
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return await _get_full_mission(db, mission_id)

    # JSON-serialize list fields
    for json_field in ("zones", "floors"):
        if json_field in updates:
            updates[json_field] = json.dumps(updates[json_field])

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    if "status" in updates:
        print(f"[THEIA] Mission {mission_id} status -> {updates['status']}")

    set_clause = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [mission_id]
    await db.execute(f"UPDATE missions SET {set_clause} WHERE id=?", values)
    await db.commit()

    # Invalidate LoRa bridge mission status cache so recording starts/stops immediately
    if "status" in updates:
        try:
            from backend.services.lora_bridge import lora_bridge
            lora_bridge.invalidate_mission_cache(mission_id)
        except Exception:
            pass

    return await _get_full_mission(db, mission_id)


@router.put("/{mission_id}")
async def update_mission(mission_id: str, body: MissionUpdate):
    """Full update -- same behavior as PATCH for backwards compat."""
    return await patch_mission(mission_id, body)


@router.delete("/{mission_id}")
async def delete_mission(mission_id: str):
    db = await get_db()
    await db.execute("DELETE FROM missions WHERE id=?", (mission_id,))
    await db.commit()
    return {"ok": True}
