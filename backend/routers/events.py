"""
THEIA - Events query router
"""
import json
from fastapi import APIRouter
from backend.database import get_db

router = APIRouter(prefix="/events", tags=["events"])


@router.get("")
async def list_events(
    mission_id: str | None = None,
    device_id: str | None = None,
    event_type: str | None = None,
    from_ts: str | None = None,
    to_ts: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    db = await get_db()
    conditions = []
    params: list = []

    if mission_id:
        conditions.append("mission_id=?")
        params.append(mission_id)
    if device_id:
        conditions.append("device_id=?")
        params.append(device_id)
    if event_type:
        conditions.append("event_type=?")
        params.append(event_type)
    if from_ts:
        conditions.append("timestamp>=?")
        params.append(from_ts)
    if to_ts:
        conditions.append("timestamp<=?")
        params.append(to_ts)

    where = " AND ".join(conditions) if conditions else "1=1"
    # Try query with new columns first, fall back to old schema
    query_new = f"""
        SELECT
            e.id, e.mission_id, e.device_id,
            e.event_type AS type,
            e.zone AS zone_name,
            e.zone_id,
            e.side,
            e.rssi, e.snr, e.payload, e.timestamp,
            d.name AS device_name,
            d.dev_eui AS tx_id,
            COALESCE(d.zone_label, e.zone) AS zone_label
        FROM events e
        LEFT JOIN devices d ON d.id = e.device_id
        WHERE {where}
        ORDER BY e.timestamp DESC
        LIMIT ? OFFSET ?
    """
    query_old = f"""
        SELECT
            e.id, e.mission_id, e.device_id,
            e.event_type AS type,
            e.zone AS zone_name,
            '' AS zone_id,
            '' AS side,
            e.rssi, e.snr, e.payload, e.timestamp,
            d.name AS device_name,
            d.dev_eui AS tx_id,
            COALESCE(d.zone_label, e.zone) AS zone_label
        FROM events e
        LEFT JOIN devices d ON d.id = e.device_id
        WHERE {where}
        ORDER BY e.timestamp DESC
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])

    try:
        cursor = await db.execute(query_new, params)
    except Exception:
        cursor = await db.execute(query_old, params)
    rows = await cursor.fetchall()

    result = []
    for r in rows:
        d = dict(r)
        if "payload" in d and isinstance(d["payload"], str):
            try:
                d["payload"] = json.loads(d["payload"])
            except Exception:
                pass
        # Filter out ghost events: detection events with no real presence
        if d.get("type") == "detection":
            p = d.get("payload", {})
            if isinstance(p, dict):
                # distance may be int, float, or string in the JSON payload
                try:
                    dist = float(p.get("distance", 0))
                except (TypeError, ValueError):
                    dist = 0.0
                # presence may be bool, string "true"/"false", or int 0/1
                pres = p.get("presence")
                if isinstance(pres, str):
                    pres = pres.lower() not in ("false", "0", "")
                # Skip if no real distance (< 15cm) or no presence
                if not pres or dist < 15:
                    continue
        result.append(d)
    return result


@router.delete("")
async def purge_events(mission_id: str | None = None):
    """Delete all events for a mission (or all events if no mission_id)."""
    db = await get_db()
    if mission_id:
        await db.execute("DELETE FROM events WHERE mission_id=?", (mission_id,))
    else:
        await db.execute("DELETE FROM events")
    await db.commit()
    return {"ok": True}
