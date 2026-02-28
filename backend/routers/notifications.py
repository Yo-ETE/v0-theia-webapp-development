"""
THEIA - Notifications router
"""
from fastapi import APIRouter, HTTPException
from backend.database import get_db

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(dismissed: int = 0, limit: int = 50, include_detections: int = 0):
    """List notifications. By default returns non-dismissed, non-detection only.
    Detection alerts are shown in the mission pages, not in the bell menu.
    Pass include_detections=1 to include them.
    """
    db = await get_db()
    if include_detections:
        cursor = await db.execute(
            "SELECT * FROM notifications WHERE dismissed=? ORDER BY created_at DESC LIMIT ?",
            (dismissed, limit),
        )
    else:
        cursor = await db.execute(
            "SELECT * FROM notifications WHERE dismissed=? AND type != 'detection_alert' ORDER BY created_at DESC LIMIT ?",
            (dismissed, limit),
        )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/count")
async def notification_count():
    """Count of unread, non-dismissed, non-detection notifications (for badge)."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT COUNT(*) as count FROM notifications WHERE read=0 AND dismissed=0 AND type != 'detection_alert'"
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
    await db.execute("UPDATE notifications SET read=1 WHERE read=0 AND dismissed=0 AND type != 'detection_alert'")
    await db.commit()
    return {"ok": True}


@router.post("/dismiss-all")
async def dismiss_all():
    db = await get_db()
    await db.execute("UPDATE notifications SET dismissed=1 WHERE dismissed=0 AND type != 'detection_alert'")
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
