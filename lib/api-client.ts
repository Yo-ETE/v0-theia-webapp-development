// THEIA API Client
// All requests go to /api/* (Next.js API routes)
// The API routes decide: mock data in preview, proxy to FastAPI in pi mode

const API_BASE = "/api"

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(error.error || `API Error: ${res.status}`)
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

export function updateMission(id: string, data: Partial<import("./types").Mission>) {
  return request<import("./types").Mission>(`/missions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  })
}

// ─── Devices ─────────────────────────────────────────────────────

export function fetchDevices() {
  return request<import("./types").Device[]>("/devices")
}

export function updateDevice(id: string, data: Partial<import("./types").Device>) {
  return request<import("./types").Device>(`/devices/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  })
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
