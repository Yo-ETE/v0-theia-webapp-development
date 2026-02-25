"""
THEIA - Notifications router
"""
from fastapi import APIRouter, HTTPException
from backend.database import get_db

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(dismissed: int = 0, limit: int = 50):
    """List notifications. By default returns non-dismissed only."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM notifications WHERE dismissed=? ORDER BY created_at DESC LIMIT ?",
        (dismissed, limit),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/count")
async def notification_count():
    """Count of unread, non-dismissed notifications (for badge)."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT COUNT(*) as count FROM notifications WHERE read=0 AND dismissed=0"
    )
    row = await cursor.fetchone()
    return {"count": row["count"] if row else 0}


@router.patch("/{notif_id}/read")
async def mark_read(notif_id: int):
    db = await get_db()
    await db.execute("UPDATE notifications SET read=1 WHERE id=?", (notif_id,))
    await db.commit()
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read():
    db = await get_db()
    await db.execute("UPDATE notifications SET read=1 WHERE read=0 AND dismissed=0")
    await db.commit()
    return {"ok": True}


@router.post("/dismiss-all")
async def dismiss_all():
    db = await get_db()
    await db.execute("UPDATE notifications SET dismissed=1 WHERE dismissed=0")
    await db.commit()
    return {"ok": True}


@router.delete("/{notif_id}")
async def delete_notification(notif_id: int):
    db = await get_db()
    cursor = await db.execute("SELECT id FROM notifications WHERE id=?", (notif_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Notification not found")
    await db.execute("DELETE FROM notifications WHERE id=?", (notif_id,))
    await db.commit()
    return {"ok": True}
