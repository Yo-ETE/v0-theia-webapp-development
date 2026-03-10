"""
THEIA - Devices CRUD router (with PATCH support for zone/side/floor assignment)
"""
import uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.database import get_db
from backend.services.lora_bridge import blacklist_tx


def _compute_status(device: dict) -> dict:
    """Compute online/offline/unknown status from last_seen timestamp."""
    d = dict(device)
    last_seen = d.get("last_seen")
    if not last_seen:
        d["status"] = "unknown"
        return d
    try:
        # Normalize all timestamp formats to naive local time
        if last_seen.endswith("Z"):
            last_seen = last_seen[:-1]
        # Strip timezone info and T separator for uniform parsing
        last_seen = last_seen.replace("T", " ").split("+")[0].split(".")[0]
        ls_dt = datetime.fromisoformat(last_seen)
        now = datetime.now()
        delta = now - ls_dt
        if delta < timedelta(seconds=30):
            d["status"] = "online"
        elif delta < timedelta(minutes=3):
            d["status"] = "idle"
        else:
            d["status"] = "offline"
    except Exception:
        d["status"] = "unknown"
    return d

router = APIRouter(prefix="/devices", tags=["devices"])


class DeviceCreate(BaseModel):
    dev_eui: str
    name: str
    type: str = "microwave_tx"
    serial_port: str = ""
    mission_id: str | None = None
    zone: str = ""
    position: str = ""


class DeviceUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    serial_port: str | None = None
    mission_id: str | None = None
    zone: str | None = None
    zone_id: str | None = None
    zone_label: str | None = None
    side: str | None = None
    sensor_position: float | None = None
    orientation: str | None = None  # "inward" or "outward"
    floor: int | None = None
    position: str | None = None
    muted: bool | None = None
    enabled: bool | None = None


@router.get("")
async def list_devices(mission_id: str | None = None, include_disabled: bool = False):
    db = await get_db()
    enabled_filter = "" if include_disabled else " AND enabled=1"
    if mission_id:
        cursor = await db.execute(
            f"SELECT * FROM devices WHERE mission_id=?{enabled_filter} ORDER BY name",
            (mission_id,),
        )
    else:
        cursor = await db.execute(
            f"SELECT * FROM devices WHERE 1=1{enabled_filter} ORDER BY name"
        )
    rows = await cursor.fetchall()
    return [_compute_status(dict(r)) for r in rows]


@router.get("/{device_id}")
async def get_device(device_id: str):
    db = await get_db()
    cursor = await db.execute("SELECT * FROM devices WHERE id=?", (device_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Device not found")
    return _compute_status(dict(row))


@router.post("", status_code=201)
async def create_device(body: DeviceCreate):
    db = await get_db()
    did = str(uuid.uuid4())[:8]
    await db.execute(
        """INSERT INTO devices (id, dev_eui, name, type, serial_port, mission_id, zone, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (did, body.dev_eui, body.name, body.type, body.serial_port,
         body.mission_id, body.zone, body.position),
    )
    await db.commit()
    await db.execute(
        "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
        ("info", "api", f"Device enrolled: {body.name} ({body.dev_eui})"),
    )
    await db.commit()
    cursor = await db.execute("SELECT * FROM devices WHERE id=?", (did,))
    return dict(await cursor.fetchone())


@router.patch("/{device_id}")
async def patch_device(device_id: str, body: DeviceUpdate):
    db = await get_db()
    cursor = await db.execute("SELECT * FROM devices WHERE id=?", (device_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Device not found")

    # Use exclude_unset so explicitly-sent null values (e.g. zone_id=null
    # to unassign) are included, while omitted fields are skipped.
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        cursor = await db.execute("SELECT * FROM devices WHERE id=?", (device_id,))
        return dict(await cursor.fetchone())

    if "enabled" in updates:
        updates["enabled"] = 1 if updates["enabled"] else 0
    if "muted" in updates:
        updates["muted"] = 1 if updates["muted"] else 0

    # Columns with FOREIGN KEY constraints MUST be set to None (SQL NULL), not ""
    # Otherwise SQLite rejects "" as an invalid FK reference
    fk_cols = {"mission_id"}
    for col in fk_cols:
        if col in updates and (updates[col] is None or updates[col] == ""):
            updates[col] = None

    # Convert None to empty string for non-FK TEXT columns (SQLite compat)
    nullable_text_cols = {"zone_id", "zone_label", "side", "zone", "position", "orientation"}
    for col in nullable_text_cols:
        if col in updates and updates[col] is None:
            updates[col] = ""

    # Reset numeric columns to their defaults when set to None
    # EXCEPT floor: NULL means "not assigned to any floor" (0 = ground floor)
    nullable_num_defaults = {"sensor_position": 0.5}
    for col, default in nullable_num_defaults.items():
        if col in updates and updates[col] is None:
            updates[col] = default
    # floor: keep NULL when explicitly set to None (unassign)
    # Don't convert to 0 -- 0 is a valid floor number (ground floor)

    set_clause = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [device_id]
    await db.execute(f"UPDATE devices SET {set_clause} WHERE id=?", values)
    await db.commit()

    cursor = await db.execute("SELECT * FROM devices WHERE id=?", (device_id,))
    return _compute_status(dict(await cursor.fetchone()))


@router.put("/{device_id}")
async def update_device(device_id: str, body: DeviceUpdate):
    return await patch_device(device_id, body)


@router.get("/battery-history/all")
async def get_all_battery_history(hours: int = 24):
    """Return battery history for ALL enabled devices (for overlay chart)."""
    db = await get_db()
    # Use 'localtime' since timestamps are stored in local time
    cursor = await db.execute(
        """SELECT bh.device_id, d.name, d.dev_eui, bh.voltage, bh.timestamp
           FROM battery_history bh
           JOIN devices d ON d.id = bh.device_id AND d.enabled=1
           WHERE bh.timestamp >= datetime('now', 'localtime', ?)
           ORDER BY bh.timestamp ASC""",
        (f"-{hours} hours",),
    )
    rows = await cursor.fetchall()
    # Group by device
    by_device: dict[str, dict] = {}
    for r in rows:
        did = r["device_id"]
        if did not in by_device:
            by_device[did] = {"device_id": did, "name": r["name"], "dev_eui": r["dev_eui"], "readings": []}
        by_device[did]["readings"].append({"voltage": r["voltage"], "timestamp": r["timestamp"]})
    return list(by_device.values())


@router.get("/{device_id}/battery-history")
async def get_battery_history(device_id: str, hours: int = 24):
    """Return battery voltage history for a device over the last N hours."""
    db = await get_db()
    cursor = await db.execute("SELECT id FROM devices WHERE id=?", (device_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Device not found")

    cursor = await db.execute(
        """SELECT voltage, timestamp FROM battery_history
           WHERE device_id=? AND timestamp >= datetime('now', 'localtime', ?)
           ORDER BY timestamp ASC""",
        (device_id, f"-{hours} hours"),
    )
    rows = await cursor.fetchall()
    return [{"voltage": r["voltage"], "timestamp": r["timestamp"]} for r in rows]


@router.delete("/{device_id}")
async def delete_device(device_id: str, hard: bool = False):
    db = await get_db()
    # Check device exists
    cursor = await db.execute("SELECT id, name, dev_eui, enabled FROM devices WHERE id=?", (device_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Device not found")

    device = dict(row)

    if hard:
        # Hard DELETE: completely remove the device from DB
        # Blacklist the dev_eui to prevent immediate re-enroll from LoRa frames
        dev_eui = device.get("dev_eui", "")
        if dev_eui:
            blacklist_tx(dev_eui)
        await db.execute("DELETE FROM devices WHERE id=?", (device_id,))
        await db.commit()
        await db.execute(
            "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
            ("info", "api", f"Device hard-deleted: {device.get('name', '')} ({dev_eui}) - blacklisted 5min"),
        )
        await db.commit()
    else:
        # ── Soft-delete: set enabled=0 so the bridge ignores future frames ──
        # (Hard DELETE would cause the bridge to auto-re-create the device
        #  as soon as it receives a LoRa frame from this TX)
        await db.execute(
            "UPDATE devices SET enabled=0, mission_id=NULL, zone=NULL, zone_id=NULL, zone_label=NULL, side=NULL WHERE id=?",
            (device_id,),
        )
        await db.commit()
        await db.execute(
            "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
            ("info", "api", f"Device disabled: {device.get('name', '')} ({device.get('dev_eui', '')})"),
        )
        await db.commit()

    return {"ok": True, "deleted": device_id, "hard": hard}
