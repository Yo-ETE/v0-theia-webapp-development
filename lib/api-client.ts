// THEIA API Client
// All requests go to /api/* (Next.js API routes)
// The API routes decide: mock data in preview, proxy to FastAPI in pi mode

const API_BASE = "/api"

/**
 * Authenticated fetch wrapper. Always sends credentials (cookies).
 * Use this instead of raw `fetch()` for any request to the backend.
 */
export function authFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      ...init?.headers,
    },
  })
}

// Direct backend URL for write operations (bypasses Next.js API routes entirely)
// On the Pi, Next.js and FastAPI run on the same host.
// We derive the backend URL from the current browser location.
function getDirectBackendUrl(): string | null {
  if (typeof window === "undefined") return null
  // If we're on the Pi (not localhost:3000 on v0 preview), use port 8000
  const host = window.location.hostname
  // Always try direct backend on port 8000
  return `http://${host}:8000`
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  })

  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = "/login"
      throw new Error("Session expired")
    }
    const error = await res.json().catch(() => ({ error: res.statusText }))
    console.error(`[THEIA] API Error ${res.status} on ${url}:`, error)
    throw new Error(error.error || `API Error: ${res.status}`)
  }

  return res.json()
}

// Direct request to FastAPI backend (bypasses Next.js routes)
// Used for critical write operations that MUST reach the database
async function directBackendRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const backendUrl = getDirectBackendUrl()
  if (!backendUrl) {
    // SSR or can't determine backend -- fall back to Next.js route
    return request<T>(path, options)
  }

  const url = `${backendUrl}/api${path}`
  console.log("[THEIA] Direct backend call:", options?.method ?? "GET", url)
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  })

  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = "/login"
      throw new Error("Session expired")
    }
    const error = await res.json().catch(() => ({ error: res.statusText }))
    console.error(`[THEIA] Direct backend error ${res.status} on ${url}:`, error)
    throw new Error(error.error || `Backend Error: ${res.status}`)
  }

  return res.json()
}

// ─── Status ──────────────────────────────────────────────────────

export function fetchStatus() {
  return request<import("./types").SystemStatus>("/status")
}

export function fetchHealth() {
  return request<{ status: string; mode: string }>("/health")
}

// ─── Missions ────────────────────────────────────────────────────

export function fetchMissions() {
  return request<import("./types").Mission[]>("/missions")
}

export function fetchMission(id: string) {
  return request<import("./types").Mission>(`/missions/${id}`)
}

export function createMission(data: Partial<import("./types").Mission>) {
  return request<import("./types").Mission>("/missions", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function updateMission(id: string, data: Partial<import("./types").Mission>) {
  // Critical: call backend directly to ensure SQLite is updated
  try {
    return await directBackendRequest<import("./types").Mission>(`/missions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    })
  } catch {
    // Fallback to Next.js route
    return request<import("./types").Mission>(`/missions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    })
  }
}

export async function deleteMission(id: string) {
  try {
    return await directBackendRequest<{ ok: boolean }>(`/missions/${id}`, { method: "DELETE" })
  } catch {
    return request<{ ok: boolean }>(`/missions/${id}`, { method: "DELETE" })
  }
}

// ─── Devices ─────────────────────────────────────────────────────

export function fetchDevices(includeDisabled = false) {
  const qs = includeDisabled ? "?include_disabled=true" : ""
  return request<import("./types").Device[]>(`/devices${qs}`)
}

export function createDevice(data: { dev_eui: string; name: string; type?: string; serial_port?: string }) {
  return request<import("./types").Device>("/devices", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function updateDevice(id: string, data: Partial<import("./types").Device>) {
  // Critical: call backend directly to ensure SQLite is updated
  try {
    return await directBackendRequest<import("./types").Device>(`/devices/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    })
  } catch {
    // Fallback to Next.js route if direct call fails
    return request<import("./types").Device>(`/devices/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    })
  }
}

export async function deleteDevice(id: string, hard = false) {
  const qs = hard ? "?hard=true" : ""
  try {
    return await directBackendRequest<{ ok: boolean }>(`/devices/${id}${qs}`, { method: "DELETE" })
  } catch {
    return request<{ ok: boolean }>(`/devices/${id}${qs}`, { method: "DELETE" })
  }
}

// ─── Events ──────────────────────────────────────────────────────

export function fetchEvents(params?: { mission_id?: string; from?: string; to?: string }) {
  const search = new URLSearchParams()
  if (params?.mission_id) search.set("mission_id", params.mission_id)
  if (params?.from) search.set("from", params.from)
  if (params?.to) search.set("to", params.to)
  const qs = search.toString()
  return request<import("./types").DetectionEvent[]>(`/events${qs ? `?${qs}` : ""}`)
}

// ─── Logs ────────────────────────────────────────────────────────

export function fetchLogs(params?: { source?: string; level?: string; search?: string }) {
  const qs = new URLSearchParams()
  if (params?.source) qs.set("source", params.source)
  if (params?.level) qs.set("level", params.level)
  if (params?.search) qs.set("search", params.search)
  const q = qs.toString()
  return request<import("./types").LogEntry[]>(`/logs${q ? `?${q}` : ""}`)
}
