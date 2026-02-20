"""
THEIA - Devices CRUD router (with PATCH support for zone/side/floor assignment)
"""
import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.database import get_db

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
    floor: int | None = None
    position: str | None = None
    enabled: bool | None = None


@router.get("")
async def list_devices(mission_id: str | None = None):
    db = await get_db()
    if mission_id:
        cursor = await db.execute(
            "SELECT * FROM devices WHERE mission_id=? ORDER BY name", (mission_id,)
        )
    else:
        cursor = await db.execute("SELECT * FROM devices ORDER BY name")
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/{device_id}")
async def get_device(device_id: str):
    db = await get_db()
    cursor = await db.execute("SELECT * FROM devices WHERE id=?", (device_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Device not found")
    return dict(row)


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

    # Convert None values to empty string for TEXT columns (SQLite compat)
    nullable_text_cols = {"mission_id", "zone_id", "zone_label", "side", "zone", "position"}
    for col in nullable_text_cols:
        if col in updates and updates[col] is None:
            updates[col] = ""

    set_clause = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [device_id]
    await db.execute(f"UPDATE devices SET {set_clause} WHERE id=?", values)
    await db.commit()

    cursor = await db.execute("SELECT * FROM devices WHERE id=?", (device_id,))
    return dict(await cursor.fetchone())


@router.put("/{device_id}")
async def update_device(device_id: str, body: DeviceUpdate):
    return await patch_device(device_id, body)


@router.delete("/{device_id}")
async def delete_device(device_id: str):
    db = await get_db()
    await db.execute("DELETE FROM devices WHERE id=?", (device_id,))
    await db.commit()
    return {"ok": True}
