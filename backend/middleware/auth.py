"""
THEIA - Authentication middleware
Checks JWT cookie on every request and injects user into request.state.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from backend.routers.auth import jwt_decode

# Routes that do NOT require authentication
PUBLIC_ROUTES = {
    ("POST", "/api/auth/login"),
    ("GET", "/api/health"),
    ("GET", "/api/push/vapid-key"),
    ("GET", "/"),
}

# Prefixes that are public (SSE stream uses token query param)
PUBLIC_PREFIXES = [
    "/api/stream",   # SSE -- authenticated via query param below
    "/api/tiles",    # map tiles proxy -- no auth needed
]

# Suffix patterns that are public (static file serves via <img src>)
PUBLIC_SUFFIXES = [
    "/plan-image/file",  # plan images loaded via <img> -- can't send Bearer
]

# Routes/prefixes that require admin role
ADMIN_ROUTES_EXACT = {
    ("POST", "/api/auth/users"),
}
ADMIN_PREFIXES = [
    "/api/admin",
    "/api/config",
]
# Admin routes by method + prefix pattern
ADMIN_PATTERNS = [
    ("DELETE", "/api/auth/users/"),
    ("PATCH", "/api/auth/users/"),
]


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        method = request.method
        path = request.url.path

        # Allow OPTIONS (CORS preflight)
        if method == "OPTIONS":
            return await call_next(request)

        # Check if route is public
        if (method, path) in PUBLIC_ROUTES:
            return await call_next(request)
        # Strip query params for suffix matching
        path_no_q = path.split("?")[0]
        for suffix in PUBLIC_SUFFIXES:
            if path_no_q.endswith(suffix):
                return await call_next(request)
        for prefix in PUBLIC_PREFIXES:
            if path.startswith(prefix):
                # For SSE stream, require token query param
                if path.startswith("/api/stream"):
                    token = request.query_params.get("token")
                    if not token:
                        return JSONResponse({"detail": "Token required"}, status_code=401)
                    payload = jwt_decode(token)
                    if not payload:
                        return JSONResponse({"detail": "Invalid token"}, status_code=401)
                    request.state.user = payload
                return await call_next(request)

        # Extract JWT from cookie
        token = request.cookies.get("theia_session")
        if not token:
            # Also check Authorization header (for API clients)
            auth_header = request.headers.get("authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]

        if not token:
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)

        payload = jwt_decode(token)
        if not payload:
            response = JSONResponse({"detail": "Invalid or expired session"}, status_code=401)
            response.delete_cookie("theia_session", path="/")
            return response

        # Inject user into request state
        request.state.user = payload

        # Check admin-only routes
        is_admin_route = False
        if (method, path) in ADMIN_ROUTES_EXACT:
            is_admin_route = True
        for prefix in ADMIN_PREFIXES:
            if path.startswith(prefix):
                is_admin_route = True
                break
        for m, prefix in ADMIN_PATTERNS:
            if method == m and path.startswith(prefix):
                is_admin_route = True
                break

        if is_admin_route and payload.get("role") != "admin":
            return JSONResponse({"detail": "Admin access required"}, status_code=403)

        return await call_next(request)
