"""
THEIA - Web Push Notification Service
Uses VAPID keys for Web Push API (pywebpush).
Keys are auto-generated on first run and stored alongside the DB.
"""
import os
import json
import base64
from pathlib import Path

# VAPID key file paths (next to DB)
DB_DIR = os.path.dirname(os.getenv("DB_PATH", "/opt/theia/data/theia.db"))
VAPID_PRIVATE_PATH = os.path.join(DB_DIR, ".theia_vapid_private.pem")
VAPID_PUBLIC_PATH = os.path.join(DB_DIR, ".theia_vapid_public.txt")
VAPID_CLAIMS = {"sub": "mailto:theia@localhost"}

_vapid_private_key: str | None = None
_vapid_public_key: str | None = None


def _generate_vapid_keys():
    """Generate VAPID key pair using the cryptography library."""
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization

    private_key = ec.generate_private_key(ec.SECP256R1())

    # Save private key PEM
    pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    os.makedirs(DB_DIR, exist_ok=True)
    Path(VAPID_PRIVATE_PATH).write_bytes(pem)

    # Extract raw public key (uncompressed point, 65 bytes)
    pub_numbers = private_key.public_key().public_numbers()
    x_bytes = pub_numbers.x.to_bytes(32, "big")
    y_bytes = pub_numbers.y.to_bytes(32, "big")
    raw_pub = b"\x04" + x_bytes + y_bytes
    pub_b64 = base64.urlsafe_b64encode(raw_pub).rstrip(b"=").decode()
    Path(VAPID_PUBLIC_PATH).write_text(pub_b64)

    print(f"[THEIA] VAPID keys generated: {VAPID_PUBLIC_PATH}")
    return pem.decode(), pub_b64


def get_vapid_keys() -> tuple[str, str]:
    """Return (private_key_pem, public_key_b64url). Generate if missing."""
    global _vapid_private_key, _vapid_public_key
    if _vapid_private_key and _vapid_public_key:
        return _vapid_private_key, _vapid_public_key

    if os.path.exists(VAPID_PRIVATE_PATH) and os.path.exists(VAPID_PUBLIC_PATH):
        _vapid_private_key = Path(VAPID_PRIVATE_PATH).read_text()
        _vapid_public_key = Path(VAPID_PUBLIC_PATH).read_text().strip()
    else:
        _vapid_private_key, _vapid_public_key = _generate_vapid_keys()

    return _vapid_private_key, _vapid_public_key


async def send_push(subscription_info: dict, title: str, body: str, data: dict | None = None, tag: str | None = None):
    """Send a push notification to a single subscription."""
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        print("[THEIA-PUSH] pywebpush not installed, skipping push")
        return False

    priv_key, _ = get_vapid_keys()

    payload = json.dumps({
        "title": title,
        "body": body,
        "data": data or {},
        "tag": tag or "theia-detection",
        "icon": "/icon-512x512.jpg",
    })

    try:
        webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=priv_key,
            vapid_claims=VAPID_CLAIMS,
            ttl=300,
        )
        return True
    except Exception as e:
        error_str = str(e)
        # 410 Gone = subscription expired, should be removed
        if "410" in error_str or "Gone" in error_str:
            print(f"[THEIA-PUSH] Subscription expired (410): {subscription_info.get('endpoint', '')[:60]}")
            return "expired"
        print(f"[THEIA-PUSH] Error sending push: {e}")
        return False


async def broadcast_push(title: str, body: str, data: dict | None = None, tag: str | None = None):
    """Send push to ALL active subscriptions. Removes expired ones."""
    from backend.database import get_db
    db = await get_db()

    cursor = await db.execute("SELECT id, endpoint, p256dh, auth FROM push_subscriptions")
    subs = await cursor.fetchall()

    if not subs:
        return 0

    sent = 0
    expired_ids = []
    for sub in subs:
        sub_info = {
            "endpoint": sub["endpoint"],
            "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
        }
        result = await send_push(sub_info, title, body, data, tag)
        if result is True:
            sent += 1
        elif result == "expired":
            expired_ids.append(sub["id"])

    # Clean up expired subscriptions
    if expired_ids:
        placeholders = ",".join("?" * len(expired_ids))
        await db.execute(f"DELETE FROM push_subscriptions WHERE id IN ({placeholders})", expired_ids)
        await db.commit()
        print(f"[THEIA-PUSH] Cleaned {len(expired_ids)} expired subscriptions")

    return sent
