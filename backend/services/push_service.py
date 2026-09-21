"""
THEIA - Web Push Notification Service
Uses VAPID keys for Web Push API (pywebpush).
Keys are auto-generated on first run and stored alongside the DB.
"""
import asyncio
import os
import json
import base64
from pathlib import Path

# VAPID key file paths (next to DB)
DB_DIR = os.path.dirname(os.getenv("DB_PATH", "/opt/theia/data/theia.db"))
VAPID_PRIVATE_PATH = os.path.join(DB_DIR, ".theia_vapid_private.pem")
VAPID_PUBLIC_PATH = os.path.join(DB_DIR, ".theia_vapid_public.txt")
# Some push services (Apple) reject a "localhost" subject: set THEIA_VAPID_SUB=mailto:you@example.com
VAPID_SUB = os.getenv("THEIA_VAPID_SUB", "mailto:theia@localhost")
PUSH_TIMEOUT = 10

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
    # Private key: owner-only from the first byte (no world-readable window)
    fd = os.open(VAPID_PRIVATE_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(pem)

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
        from pywebpush import webpush
        from py_vapid import Vapid
    except ImportError:
        print("[THEIA-PUSH] pywebpush not installed, skipping push")
        return False

    priv_key, _ = get_vapid_keys()
    # pywebpush expects a raw/DER key string, a file path or a Vapid object: a PEM string fails to decode
    vapid = Vapid.from_pem(priv_key.encode())

    payload = json.dumps({
        "title": title,
        "body": body,
        "data": data or {},
        "tag": tag or "theia-detection",
        "icon": "/icon-512x512.jpg",
    })

    def _send():
        # webpush() is blocking (requests): run it off the event loop, with a timeout.
        # A fresh claims dict per call: pywebpush writes "aud"/"exp" into it, and a shared
        # dict would send the first push service's audience to all the others.
        webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=vapid,
            vapid_claims={"sub": VAPID_SUB},
            ttl=300,
            timeout=PUSH_TIMEOUT,
        )

    try:
        await asyncio.get_running_loop().run_in_executor(None, _send)
        return True
    except Exception as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        # 404 / 410 = subscription gone, should be removed
        if status in (404, 410):
            print(f"[THEIA-PUSH] Subscription expired ({status}): {subscription_info.get('endpoint', '')[:60]}")
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
    infos = [
        {"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}}
        for s in subs
    ]
    # Send to all subscribers in parallel: one slow endpoint must not delay the others
    results = await asyncio.gather(
        *(send_push(info, title, body, data, tag) for info in infos),
        return_exceptions=True,
    )
    for s, result in zip(subs, results):
        if result is True:
            sent += 1
        elif result == "expired":
            expired_ids.append(s["id"])

    # Clean up expired subscriptions
    if expired_ids:
        placeholders = ",".join("?" * len(expired_ids))
        await db.execute(f"DELETE FROM push_subscriptions WHERE id IN ({placeholders})", expired_ids)
        await db.commit()
        print(f"[THEIA-PUSH] Cleaned {len(expired_ids)} expired subscriptions")

    return sent
