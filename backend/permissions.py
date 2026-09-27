"""
THEIA - Per-user permissions, enforced on the server.

The interface has offered 17 permission switches per user for a long time, with presets for
Administrateur / Operateur / Visualisateur. None of it reached the backend: there was no
`permissions` column, the Pydantic models dropped the field the UI sent, and authorisation
came down to one question -- is this user an admin? Ticking a box hid a button and nothing
more, so anyone who could call the API directly kept every right the UI pretended to remove.

This module holds the two halves the enforcement needs: what a user is allowed to do, and
which permission a given request requires. The middleware applies it.

Kept deliberately small. It does NOT duplicate the preset catalogue from lib/types.ts -- the
UI owns presentation, the server only ever asks "is this key true for this user". The one
default that must agree between them is the viewer fallback below, because that is what an
account with no stored permissions is treated as.
"""
from __future__ import annotations

import json
import time

from backend.database import get_db

# Mirrors PERMISSION_PRESETS.viewer in lib/types.ts. Applied to any non-admin account that
# has no stored permissions -- including every account created before this existed, which is
# why it is the read-only preset and not an empty dict: those users could already read.
VIEWER_DEFAULT: dict[str, bool] = {
    "dashboard": True, "missions": True, "devices": False, "logs": False, "administration": False,
    "missions_create": False, "missions_edit": False, "missions_delete": False, "missions_control": False,
    "devices_assign": False, "devices_unassign": False, "devices_flash": False,
    "devices_enroll": False, "devices_delete": False,
    "system_backup": False, "system_update": False, "system_reboot": False,
}

# (method, path prefix, exact?) -> any one of these permissions is enough.
#
# Only writes and the two page-scoped reads are listed. Reading missions and events stays
# open to any authenticated account: the live view is the reason someone is given an account
# at all, and the UI already hides what a viewer cannot act on.
#
# Where one endpoint serves two intents -- editing a mission vs pressing Pause, attaching a
# sensor vs detaching it -- the entry below lists BOTH permissions and is only a coarse
# pre-filter: it refuses an account that has neither, early and cheaply. The handler then
# separates them with `ensure()`, because it can see the body and the middleware cannot.
#
# The union alone was not enough, and that showed the first time it was used in anger:
# revoking missions_control changed nothing, since missions_edit still satisfied the route.
PERMISSION_ROUTES: list[tuple[str, str, bool, tuple[str, ...]]] = [
    ("POST",   "/api/missions",  True,  ("missions_create",)),
    ("PATCH",  "/api/missions/", False, ("missions_edit", "missions_control")),
    ("DELETE", "/api/missions/", False, ("missions_delete",)),
    ("POST",   "/api/devices",   True,  ("devices_enroll",)),
    ("PATCH",  "/api/devices/",  False, ("devices_assign", "devices_unassign")),
    ("DELETE", "/api/devices/",  False, ("devices_delete",)),
    ("GET",    "/api/devices",   False, ("devices",)),
    ("GET",    "/api/logs",      False, ("logs",)),
]


def required_permissions(method: str, path: str) -> tuple[str, ...] | None:
    """Which permissions would satisfy this request, or None if it needs no specific one."""
    path = path.rstrip("/") or "/"
    for m, prefix, exact, perms in PERMISSION_ROUTES:
        if method != m:
            continue
        if exact:
            if path == prefix.rstrip("/"):
                return perms
        elif path.startswith(prefix) or path == prefix.rstrip("/"):
            return perms
    return None


# Permissions live in the database, not in the session token, so revoking a right takes
# effect without waiting for a week-old token to expire. A short cache keeps that from
# costing a query on every poll of /api/devices.
_CACHE: dict[int, tuple[float, dict[str, bool]]] = {}
_CACHE_TTL_S = 20.0


def invalidate(user_id: int | None = None) -> None:
    """Drop cached permissions after an admin edits them. None clears everything."""
    if user_id is None:
        _CACHE.clear()
    else:
        _CACHE.pop(user_id, None)


async def permissions_for(user_id: int) -> dict[str, bool]:
    now = time.monotonic()
    cached = _CACHE.get(user_id)
    if cached and now - cached[0] < _CACHE_TTL_S:
        return cached[1]

    perms = dict(VIEWER_DEFAULT)
    try:
        db = await get_db()
        cursor = await db.execute("SELECT role, permissions FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        if row:
            if row["role"] == "admin":
                # An admin is not described by stored flags; the role is the grant.
                perms = {k: True for k in VIEWER_DEFAULT}
            elif row["permissions"]:
                stored = json.loads(row["permissions"])
                if isinstance(stored, dict):
                    # Unknown keys are ignored and missing ones stay at the viewer default,
                    # so adding a permission later cannot silently grant it to everyone.
                    perms = {k: bool(stored.get(k, VIEWER_DEFAULT[k])) for k in VIEWER_DEFAULT}
    except Exception:
        # Never fail open: an unreadable permissions row leaves the read-only default.
        pass

    _CACHE[user_id] = (now, perms)
    return perms


async def allows(user_id: int, needed: tuple[str, ...]) -> bool:
    perms = await permissions_for(user_id)
    return any(perms.get(p, False) for p in needed)


async def ensure(request, *needed: str) -> None:
    """
    Check a permission from inside a route handler, where the parsed body is available.

    The middleware can only see the method and the path, so PATCH on a mission had to accept
    `missions_edit` OR `missions_control`: one endpoint serves both editing a zone and
    pressing Pause. Tested on the hub, that union is too coarse to be worth much -- revoking
    `missions_control` alone changed nothing, because `missions_edit` still satisfied the
    route. Handlers that can tell the two intents apart call this instead.

    Admins pass by role, as everywhere else.
    """
    from fastapi import HTTPException  # local: keeps this module free of web framework at import

    user = getattr(getattr(request, "state", None), "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.get("role") == "admin":
        return
    try:
        user_id = int(user.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid session")
    if not await allows(user_id, needed):
        raise HTTPException(status_code=403, detail=f"Permission requise : {' ou '.join(needed)}")
