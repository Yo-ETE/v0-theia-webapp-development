"use client"

import useSWR from "swr"
import { getAuthToken } from "@/lib/auth-context"

// Try direct backend first (port 8000), fallback to Next.js route
function getBackendBase(): string | null {
  if (typeof window === "undefined") return null
  return `http://${window.location.hostname}:8000`
}

/** Build headers with Bearer token for backend requests */
function bearerHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const token = getAuthToken()
  if (token) h["Authorization"] = `Bearer ${token}`
  return h
}

const fetcher = async (url: string) => {
  // For /api/* paths, try the FastAPI backend directly first
  const backendBase = getBackendBase()
  if (backendBase && url.startsWith("/api/")) {
    try {
      const directUrl = `${backendBase}${url}`
      const r = await fetch(directUrl, {
        credentials: "include",
        headers: bearerHeaders({ "Content-Type": "application/json" }),
      })
      if (r.ok) return r.json()
      // If 401, don't fallback -- redirect to login
      if (r.status === 401) {
        window.location.href = "/login"
        throw new Error("Session expired")
      }
    } catch (e) {
      // If it's our own 401 redirect, rethrow
      if (e instanceof Error && e.message === "Session expired") throw e
      // Backend unreachable -- fall through to Next.js route
    }
  }
  // Fallback: Next.js API route
  const r = await fetch(url, { credentials: "include" })
  if (!r.ok) throw new Error(`API Error: ${r.status}`)
  return r.json()
}

export function useStatus() {
  return useSWR<import("@/lib/types").SystemStatus>("/api/status", fetcher, {
    refreshInterval: 5000,
    keepPreviousData: true,
    dedupingInterval: 3000,
    errorRetryCount: 3,
  })
}

export function useMissions() {
  return useSWR<import("@/lib/types").Mission[]>("/api/missions", fetcher, { refreshInterval: 15000 })
}

export function useMission(id: string | null) {
  return useSWR<import("@/lib/types").Mission>(
    id ? `/api/missions/${id}` : null,
    fetcher,
  )
}

export function useDevices(opts?: { refreshInterval?: number; includeDisabled?: boolean }) {
  const qs = opts?.includeDisabled ? "?include_disabled=true" : ""
  return useSWR<import("@/lib/types").Device[]>(`/api/devices${qs}`, fetcher, {
    refreshInterval: opts?.refreshInterval ?? 5000,
    revalidateOnMount: true,
    revalidateOnFocus: true,
    dedupingInterval: 2000,
  })
}

export function useEvents(params?: { mission_id?: string; limit?: number; event_type?: string }) {
  const qs = new URLSearchParams()
  if (params?.mission_id) qs.set("mission_id", params.mission_id)
  if (params?.event_type) qs.set("event_type", params.event_type)
  if (params?.limit) qs.set("limit", String(params.limit))
  const q = qs.toString()
  return useSWR<import("@/lib/types").DetectionEvent[]>(
    `/api/events${q ? `?${q}` : ""}`,
    fetcher,
    // Refresh every 5s to pick up new DB events.
    { refreshInterval: 5000, revalidateOnFocus: true },
  )
}

export function useEventsRange(params: {
  mission_id: string
  from_ts?: string
  to_ts?: string
  event_type?: string
  limit?: number
} | null) {
  const qs = new URLSearchParams()
  if (params?.mission_id) qs.set("mission_id", params.mission_id)
  if (params?.from_ts) qs.set("from_ts", params.from_ts)
  if (params?.to_ts) qs.set("to_ts", params.to_ts)
  if (params?.event_type) qs.set("event_type", params.event_type)
  if (params?.limit) qs.set("limit", String(params.limit))
  const q = qs.toString()
  return useSWR<import("@/lib/types").DetectionEvent[]>(
    params ? `/api/events${q ? `?${q}` : ""}` : null,
    fetcher,
  )
}

export interface Notification {
  id: number
  type: string
  severity: string
  device_id: string | null
  device_name: string | null
  message: string
  read: number
  dismissed: number
  created_at: string
}

export function useNotifications() {
  return useSWR<Notification[]>("/api/notifications", fetcher, {
    refreshInterval: 10000,
    revalidateOnFocus: true,
  })
}

export function useNotificationCount() {
  return useSWR<{ count: number }>("/api/notifications/count", fetcher, {
    refreshInterval: 10000,
  })
}

export function useLogs(params?: { source?: string; level?: string; search?: string }) {
  const qs = new URLSearchParams()
  if (params?.source && params.source !== "all") qs.set("source", params.source)
  if (params?.level && params.level !== "all") qs.set("level", params.level)
  if (params?.search) qs.set("search", params.search)
  const q = qs.toString()
  return useSWR<import("@/lib/types").LogEntry[]>(
    `/api/logs${q ? `?${q}` : ""}`,
    fetcher,
  )
}
