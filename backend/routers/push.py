"""
THEIA - Web Push subscription management router
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from backend.database import get_db
from backend.services.push_service import get_vapid_keys, broadcast_push

router = APIRouter(prefix="/push", tags=["push"])


class SubscriptionPayload(BaseModel):
    endpoint: str
    keys: dict  # { p256dh: str, auth: str }


@router.get("/vapid-key")
async def vapid_public_key():
    """Return the VAPID public key for Web Push subscription."""
    _, pub = get_vapid_keys()
    return {"public_key": pub}


@router.post("/subscribe")
async def subscribe(payload: SubscriptionPayload, request: Request):
    """Register a Web Push subscription for this browser."""
    db = await get_db()
    user = getattr(request.state, "user", None)
    user_id = user["id"] if user else None

    # Upsert: if endpoint exists, update keys
    existing = await db.execute(
        "SELECT id FROM push_subscriptions WHERE endpoint=?", (payload.endpoint,)
    )
    row = await existing.fetchone()
    if row:
        await db.execute(
            "UPDATE push_subscriptions SET p256dh=?, auth=?, user_id=? WHERE id=?",
            (payload.keys.get("p256dh", ""), payload.keys.get("auth", ""), user_id, row["id"]),
        )
    else:
        await db.execute(
            "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)",
            (user_id, payload.endpoint, payload.keys.get("p256dh", ""), payload.keys.get("auth", "")),
        )
    await db.commit()
    return {"ok": True}


@router.delete("/subscribe")
async def unsubscribe(payload: SubscriptionPayload):
    """Remove a Web Push subscription."""
    db = await get_db()
    await db.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (payload.endpoint,))
    await db.commit()
    return {"ok": True}


@router.post("/test")
async def test_push(request: Request):
    """(Admin only) Send a test push notification to all subscribers."""
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    sent = await broadcast_push(
        title="THEIA - Test",
        body="Notification push de test. Tout fonctionne !",
        data={"type": "test"},
        tag="theia-test",
    )
    return {"ok": True, "sent": sent}


@router.get("/subscriptions/count")
async def subscription_count():
    """Return the number of active push subscriptions."""
    db = await get_db()
    cursor = await db.execute("SELECT COUNT(*) as count FROM push_subscriptions")
    row = await cursor.fetchone()
    return {"count": row["count"] if row else 0}
