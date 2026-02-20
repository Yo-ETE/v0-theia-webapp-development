"use client"

import useSWR from "swr"

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`API Error: ${r.status}`)
  return r.json()
})

export function useStatus() {
  return useSWR<import("@/lib/types").SystemStatus>("/api/status", fetcher, {
    refreshInterval: 5000,
  })
}

export function useMissions() {
  return useSWR<import("@/lib/types").Mission[]>("/api/missions", fetcher)
}

export function useMission(id: string | null) {
  return useSWR<import("@/lib/types").Mission>(
    id ? `/api/missions/${id}` : null,
    fetcher,
  )
}

export function useDevices() {
  return useSWR<import("@/lib/types").Device[]>("/api/devices", fetcher, { refreshInterval: 5000 })
}

export function useEvents(params?: { mission_id?: string }) {
  const qs = new URLSearchParams()
  if (params?.mission_id) qs.set("mission_id", params.mission_id)
  const q = qs.toString()
  return useSWR<import("@/lib/types").DetectionEvent[]>(
    `/api/events${q ? `?${q}` : ""}`,
    fetcher,
    { refreshInterval: 3000 },
  )
}

export function useEventsRange(params: {
  mission_id: string
  from_ts?: string
  to_ts?: string
  limit?: number
} | null) {
  const qs = new URLSearchParams()
  if (params?.mission_id) qs.set("mission_id", params.mission_id)
  if (params?.from_ts) qs.set("from_ts", params.from_ts)
  if (params?.to_ts) qs.set("to_ts", params.to_ts)
  if (params?.limit) qs.set("limit", String(params.limit))
  const q = qs.toString()
  return useSWR<import("@/lib/types").DetectionEvent[]>(
    params ? `/api/events${q ? `?${q}` : ""}` : null,
    fetcher,
  )
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
