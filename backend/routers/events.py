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
    query = f"""
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
    params.extend([limit, offset])

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()

    result = []
    for r in rows:
        d = dict(r)
        if "payload" in d and isinstance(d["payload"], str):
            try:
                d["payload"] = json.loads(d["payload"])
            except Exception:
                pass
        result.append(d)
    return result
