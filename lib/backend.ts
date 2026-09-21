// Single source of truth for the FastAPI backend origin.
//
// The browser talks to the backend directly (port 8000 on the same host as the page):
//   - same protocol as the page, so an HTTPS page (tailscale serve) never triggers mixed-content blocking
//   - NEXT_PUBLIC_BACKEND_URL (build time) overrides everything, e.g. when the API sits behind a reverse proxy

/** Backend origin without trailing slash, e.g. "http://192.168.1.42:8000" */
export function backendOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_BACKEND_URL
  if (configured) return configured.replace(/\/+$/, "")
  // Server-side rendering never calls the backend from here; keep a sane default
  if (typeof window === "undefined") return "http://localhost:8000"
  return `${window.location.protocol}//${window.location.hostname}:8000`
}
