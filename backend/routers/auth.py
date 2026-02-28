"""
THEIA - Authentication router
Handles login, logout, user management (admin only).
JWT stored in HTTP-only cookie.
"""
import os
import secrets
import hashlib
import hmac
import json
import time
from datetime import datetime

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# JWT secret management
# ---------------------------------------------------------------------------
_SECRET_PATH = os.getenv("THEIA_SECRET_PATH", "/opt/theia/data/.theia_secret")
_jwt_secret: str | None = None

def _get_secret() -> str:
    global _jwt_secret
    if _jwt_secret:
        return _jwt_secret
    if os.path.exists(_SECRET_PATH):
        with open(_SECRET_PATH, "r") as f:
            _jwt_secret = f.read().strip()
    else:
        _jwt_secret = secrets.token_hex(32)
        os.makedirs(os.path.dirname(_SECRET_PATH), exist_ok=True)
        with open(_SECRET_PATH, "w") as f:
            f.write(_jwt_secret)
        os.chmod(_SECRET_PATH, 0o600)
    return _jwt_secret

# ---------------------------------------------------------------------------
# Minimal JWT implementation (no PyJWT dependency needed)
# Uses HMAC-SHA256 -- perfectly secure for a local hub
# ---------------------------------------------------------------------------
import base64 as _b64

def _b64url_encode(data: bytes) -> str:
    return _b64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _b64url_decode(s: str) -> bytes:
    s += "=" * (4 - len(s) % 4)
    return _b64.urlsafe_b64decode(s)

def _jwt_encode(payload: dict, secret: str) -> str:
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64url_encode(json.dumps(payload).encode())
    sig_input = f"{header}.{body}".encode()
    sig = hmac.new(secret.encode(), sig_input, hashlib.sha256).digest()
    return f"{header}.{body}.{_b64url_encode(sig)}"

def _jwt_decode(token: str, secret: str) -> dict | None:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        sig_input = f"{parts[0]}.{parts[1]}".encode()
        expected_sig = hmac.new(secret.encode(), sig_input, hashlib.sha256).digest()
        actual_sig = _b64url_decode(parts[2])
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None
        payload = json.loads(_b64url_decode(parts[1]))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None

# Public helpers for middleware
def get_jwt_secret() -> str:
    return _get_secret()

def jwt_decode(token: str) -> dict | None:
    return _jwt_decode(token, _get_secret())

# ---------------------------------------------------------------------------
# Password hashing (bcrypt-like using hashlib -- no external dependency)
# Uses PBKDF2-HMAC-SHA256 with 100k iterations
# ---------------------------------------------------------------------------
def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return f"{salt}${dk.hex()}"

def _verify_password(password: str, stored: str) -> bool:
    try:
        salt, dk_hex = stored.split("$", 1)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
        return hmac.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False

# ---------------------------------------------------------------------------
# Rate limiting for login attempts
# ---------------------------------------------------------------------------
_login_attempts: dict[str, list[float]] = {}
_MAX_ATTEMPTS = 5
_WINDOW_SECONDS = 300  # 5 minutes

def _check_rate_limit(ip: str) -> bool:
    now = time.time()
    attempts = _login_attempts.get(ip, [])
    attempts = [t for t in attempts if now - t < _WINDOW_SECONDS]
    _login_attempts[ip] = attempts
    return len(attempts) < _MAX_ATTEMPTS

def _record_attempt(ip: str):
    now = time.time()
    _login_attempts.setdefault(ip, []).append(now)

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    username: str
    password: str

class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "viewer"

class UpdateUserRequest(BaseModel):
    password: str | None = None
    role: str | None = None

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/login")
async def login(req: LoginRequest, request: Request):
    ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(ip):
        raise HTTPException(429, "Too many login attempts. Try again in 5 minutes.")

    db = await get_db()
    cursor = await db.execute(
        "SELECT id, username, password_hash, role FROM users WHERE username = ?",
        (req.username,)
    )
    row = await cursor.fetchone()

    if not row or not _verify_password(req.password, row["password_hash"]):
        _record_attempt(ip)
        raise HTTPException(401, "Invalid username or password")

    # Update last_login
    await db.execute(
        "UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?",
        (row["id"],)
    )
    await db.commit()

    # Generate JWT (7 day expiry)
    token = _jwt_encode({
        "sub": row["id"],
        "username": row["username"],
        "role": row["role"],
        "exp": int(time.time()) + 7 * 24 * 3600,
    }, _get_secret())

    response = JSONResponse({"ok": True, "user": {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
    }})
    response.set_cookie(
        key="theia_session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=7 * 24 * 3600,
        path="/",
    )
    return response


@router.post("/logout")
async def logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie("theia_session", path="/")
    return response


@router.get("/me")
async def me(request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "Not authenticated")
    return {"id": user["sub"], "username": user["username"], "role": user["role"]}


# ---------------------------------------------------------------------------
# User management (admin only)
# ---------------------------------------------------------------------------

@router.get("/users")
async def list_users(request: Request):
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    db = await get_db()
    cursor = await db.execute("SELECT id, username, role, created_at, last_login FROM users ORDER BY id")
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.post("/users")
async def create_user(req: CreateUserRequest, request: Request):
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    if req.role not in ("admin", "viewer"):
        raise HTTPException(400, "Role must be 'admin' or 'viewer'")
    if len(req.username) < 2:
        raise HTTPException(400, "Username must be at least 2 characters")
    if len(req.password) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")

    db = await get_db()
    # Check if username exists
    cursor = await db.execute("SELECT id FROM users WHERE username = ?", (req.username,))
    if await cursor.fetchone():
        raise HTTPException(409, "Username already exists")

    pw_hash = _hash_password(req.password)
    await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        (req.username, pw_hash, req.role)
    )
    await db.commit()
    return {"ok": True, "message": f"User '{req.username}' created"}


@router.patch("/users/{user_id}")
async def update_user(user_id: int, req: UpdateUserRequest, request: Request):
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(403, "Admin only")

    db = await get_db()
    cursor = await db.execute("SELECT id, username FROM users WHERE id = ?", (user_id,))
    target = await cursor.fetchone()
    if not target:
        raise HTTPException(404, "User not found")

    if req.role and req.role not in ("admin", "viewer"):
        raise HTTPException(400, "Role must be 'admin' or 'viewer'")

    if req.password:
        if len(req.password) < 4:
            raise HTTPException(400, "Password must be at least 4 characters")
        await db.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (_hash_password(req.password), user_id)
        )
    if req.role:
        await db.execute("UPDATE users SET role = ? WHERE id = ?", (req.role, user_id))
    await db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, request: Request):
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    if user["sub"] == user_id:
        raise HTTPException(400, "Cannot delete yourself")

    db = await get_db()
    await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    await db.commit()
    return {"ok": True}
