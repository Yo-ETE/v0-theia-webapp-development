"use client"

/**
 * A mission's event history, fetched once and then kept up to date incrementally.
 *
 * The console used to re-download the whole history on every tick -- 415 events / 204KB /
 * 130ms on the hub, growing for as long as the mission runs, and silently truncated at the
 * 10000 cap. Slowing the poll down bought time without changing the shape of the problem.
 * The backend already accepts `from_ts`, so after the first load we only ask for what is new.
 *
 * Cadence is unchanged and still driven by the SSE stream (see the mission console): polling
 * is a safety net for what the stream missed, so it backs off while the stream is healthy.
 *
 * `reset()` exists because events can also DISAPPEAR: purging a mission deletes them
 * server-side, and an accumulator that only ever adds would keep drawing them on the map.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { backendOrigin } from "@/lib/backend"
import { getAuthToken } from "@/lib/auth-context"
import { mergeEvents, newestTimestamp } from "@/lib/event-stream"
import type { DetectionEvent } from "@/lib/types"

async function fetchEvents(params: Record<string, string>): Promise<DetectionEvent[]> {
  const base = backendOrigin()
  const token = getAuthToken()
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${base}/api/events?${qs}`, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (res.status === 401) {
    window.location.href = "/login"
    throw new Error("Session expired")
  }
  if (!res.ok) throw new Error(`Backend: ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export function useMissionEvents(missionId: string | null, opts: { limit: number; refreshInterval: number }) {
  const [events, setEvents] = useState<DetectionEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const eventsRef = useRef<DetectionEvent[]>([])
  const inFlightRef = useRef(false)
  const { limit, refreshInterval } = opts

  // Keep the ref in step so the poll can read the current list without re-subscribing.
  useEffect(() => { eventsRef.current = events }, [events])

  const load = useCallback(async (full: boolean) => {
    if (!missionId || inFlightRef.current) return
    inFlightRef.current = true
    try {
      const cursor = full ? null : newestTimestamp(eventsRef.current)
      const params: Record<string, string> = { mission_id: missionId, limit: String(limit) }
      // Inclusive on purpose: timestamps have one-second resolution, so several events can
      // share the second we already know about. We re-receive them and dedupe.
      if (cursor) params.from_ts = cursor
      const incoming = await fetchEvents(params)
      setEvents((prev) => (full ? incoming.slice(0, limit) : mergeEvents(prev, incoming, limit)))
    } catch {
      // Keep what we have. A failed poll must not blank a live mission map.
    } finally {
      inFlightRef.current = false
      setIsLoading(false)
    }
  }, [missionId, limit])

  /** Drop everything and pull a fresh full history -- after a purge, for instance. */
  const reset = useCallback(async () => {
    setEvents([])
    eventsRef.current = []
    await load(true)
  }, [load])

  // Full load whenever the mission changes.
  useEffect(() => {
    setEvents([])
    eventsRef.current = []
    setIsLoading(true)
    if (missionId) load(true)
  }, [missionId, load])

  // Incremental poll.
  useEffect(() => {
    if (!missionId || refreshInterval <= 0) return
    const id = setInterval(() => {
      // Same rule as SWR: a hidden tab is nobody looking, and the stream fills the gap.
      if (document.visibilityState === "visible") load(false)
    }, refreshInterval)
    return () => clearInterval(id)
  }, [missionId, refreshInterval, load])

  const refresh = useCallback(() => load(false), [load])

  return { events, isLoading, refresh, reset }
}
