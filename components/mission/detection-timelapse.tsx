"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Play, Pause, SkipBack, SkipForward, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useEventsRange } from "@/hooks/use-api"
import type { DetectionEvent } from "@/lib/types"

interface LiveDetection {
  device_id: string
  device_name: string
  tx_id: string | null
  zone_id: string | null
  zone_label: string
  side: string
  presence: boolean
  distance: number
  speed: number
  angle: number
  direction: string
  vbatt_tx: number | null
  rssi: number | null
  sensor_type?: string
  floor?: number | null
  sensor_position?: number | null
  orientation?: string | null
  timestamp: string
  mission_id?: string
}

interface DetectionTimelapseProps {
  missionId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDetection: (detections: Record<string, any>) => void
  onClose?: () => void
}

function parseEventToDetection(ev: DetectionEvent): LiveDetection | null {
  const p = ev.payload ?? {}
  const distance = Number(p.distance ?? p.dist ?? 0)
  // Check presence: can be boolean true, string "1", or number 1
  const hasPresence = p.presence === true || p.presence === 1 || p.presence === "1" || p.presence === "true"
  // Skip events with no distance AND no presence flag (non-detection events)
  if (distance === 0 && !hasPresence) return null
  // zone_id and side come from the event row directly (new schema)
  // or fall back to payload / device join fields
  const zoneId = ev.zone_id || (p.zone_id as string) || null
  const side = ev.side || (p.side as string) || ""
  return {
    device_id: ev.device_id ?? "",
    device_name: ev.device_name ?? "",
    tx_id: ev.device_id ?? null,
    zone_id: zoneId,
    zone_label: ev.zone_label || String(p.zone ?? ""),
    side,
    presence: hasPresence || distance > 0,
    distance,
    speed: Number(p.speed ?? 0),
    angle: Number(p.angle ?? 0),
    direction: String(p.direction ?? p.dir ?? "C"),
    vbatt_tx: p.vbatt_tx ? Number(p.vbatt_tx) : null,
    rssi: ev.rssi,
    sensor_type: String(p.sensor_type ?? "ld2450"),
    // Prefer event-level fields (stored at recording time) over payload fields
    floor: ev.floor != null ? Number(ev.floor) : (p.floor != null ? Number(p.floor) : null),
    sensor_position: ev.sensor_position != null ? Number(ev.sensor_position) : null,
    orientation: ev.orientation ?? null,
    timestamp: ev.timestamp,
    mission_id: ev.mission_id,
  }
}

export function DetectionTimelapse({ missionId, onDetection, onClose }: DetectionTimelapseProps) {
  // Time range: default to last 1 hour (local time for datetime-local inputs)
  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 3600 * 1000)
  const toLocalDatetime = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const [fromTime, setFromTime] = useState(toLocalDatetime(oneHourAgo))
  const [toTime, setToTime] = useState(toLocalDatetime(now))
  const [loaded, setLoaded] = useState(false)

  // Playback state
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [currentIdx, setCurrentIdx] = useState(0)
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Rolling window: keep last detection per device within WINDOW_MS of current event
  const WINDOW_MS = 5000
  const lastDetByDeviceRef = useRef<Record<string, { det: LiveDetection; ts: number }>>({})

  // Fetch ALL detection events for this mission (same approach as history page)
  // then filter by date range client-side to avoid timezone mismatch issues
  const fetchParams = loaded ? {
    mission_id: missionId,
    limit: 10000,
  } : null

  const { data: rawEvents, isLoading } = useEventsRange(fetchParams)

  // Filter by date range client-side (comparing timestamps as strings)
  // and sort chronologically (API returns DESC)
  const events = useMemo(() => {
    if (!rawEvents) return []
    const fromStr = fromTime.replace("T", " ")
    const toStr = toTime.replace("T", " ") + ":59"
    return rawEvents
      .filter(e => {
        const ts = e.timestamp ?? ""
        return ts >= fromStr && ts <= toStr
      })
      .slice()
      .reverse()
  }, [rawEvents, fromTime, toTime])

  // When events load, reset playback
  useEffect(() => {
    if (events.length > 0) {
      setCurrentIdx(0)
      setPlaying(false)
      lastDetByDeviceRef.current = {}
    }
  }, [events.length])

  // Feed detection at current index to parent using rolling window
  // Keeps recent detections from ALL devices within WINDOW_MS of current event
  useEffect(() => {
    if (!events.length || currentIdx >= events.length) {
      lastDetByDeviceRef.current = {}
      onDetection({})
      return
    }
    const ev = events[currentIdx]
    const det = parseEventToDetection(ev)
    const currentTsMs = new Date(ev.timestamp).getTime()

    // Update rolling window with current detection
    if (det) {
      const devKey = det.device_id || det.device_name
      if (devKey) {
        lastDetByDeviceRef.current[devKey] = { det, ts: currentTsMs }
      }
    }

    // Expire old entries outside the window
    for (const [devKey, entry] of Object.entries(lastDetByDeviceRef.current)) {
      if (currentTsMs - entry.ts > WINDOW_MS) {
        delete lastDetByDeviceRef.current[devKey]
      }
    }

    // Build combined detections keyed by device_id so ALL active devices are present
    // The parent's handleReplayDetection will resolve zone_ids
    const combined: Record<string, LiveDetection> = {}
    for (const [devKey, entry] of Object.entries(lastDetByDeviceRef.current)) {
      combined[devKey] = entry.det
    }
    onDetection(combined)
  }, [currentIdx, events, onDetection])

  // Playback timer
  useEffect(() => {
    if (playRef.current) clearInterval(playRef.current)
    if (!playing || !events.length) return

    // Calculate interval: events have real timestamps, we replay at speed multiplier
    const baseInterval = 200 // ms between event advances at 1x
    const interval = Math.max(20, baseInterval / speed)

    playRef.current = setInterval(() => {
      setCurrentIdx((prev) => {
        if (prev >= events.length - 1) {
          setPlaying(false)
          return prev
        }
        return prev + 1
      })
    }, interval)

    return () => { if (playRef.current) clearInterval(playRef.current) }
  }, [playing, speed, events.length])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      onDetection({})
      if (playRef.current) clearInterval(playRef.current)
    }
  }, [onDetection])

  const currentEvent = events[currentIdx]
  const currentTs = currentEvent?.timestamp ? new Date(currentEvent.timestamp) : null

  const handleLoad = useCallback(() => {
    setLoaded(true)
    setCurrentIdx(0)
    setPlaying(false)
  }, [])

  const speeds = [1, 2, 5, 10, 20]

  return (
    <div className="rounded-lg border border-border/50 bg-card p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground font-mono tracking-wide">TIMELAPSE</h3>
        {onClose && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Time range selector */}
      <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-end">
        <div className="flex-1 min-w-0">
          <label className="text-[10px] text-muted-foreground font-mono block mb-1">FROM</label>
          <input
            type="datetime-local"
            value={fromTime}
            onChange={(e) => { setFromTime(e.target.value); setLoaded(false) }}
            className="w-full h-10 rounded-md border border-border bg-background px-2 text-[16px] sm:text-xs font-mono text-foreground"
          />
        </div>
        <div className="flex-1 min-w-0">
          <label className="text-[10px] text-muted-foreground font-mono block mb-1">TO</label>
          <input
            type="datetime-local"
            value={toTime}
            onChange={(e) => { setToTime(e.target.value); setLoaded(false) }}
            className="w-full h-10 rounded-md border border-border bg-background px-2 text-[16px] sm:text-xs font-mono text-foreground"
          />
        </div>
        <Button size="sm" className="h-10 text-xs px-4 shrink-0 w-full sm:w-auto" onClick={handleLoad} disabled={isLoading}>
          {isLoading ? "..." : loaded ? "Reload" : "Load"}
        </Button>
      </div>

      {/* Playback controls */}
      {loaded && events.length > 0 && (
        <div className="space-y-3">
          {/* Timeline scrubber */}
          <div>
            <input
              type="range"
              min={0}
              max={Math.max(0, events.length - 1)}
              value={currentIdx}
              onChange={(e) => { setCurrentIdx(parseInt(e.target.value)); setPlaying(false) }}
              className="w-full h-2 accent-primary"
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] font-mono text-muted-foreground">
                {events[0]?.timestamp ? new Date(events[0].timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--"}
              </span>
              <span className="text-xs font-mono font-bold text-primary">
                {currentTs ? currentTs.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--"}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">
                {events[events.length - 1]?.timestamp ? new Date(events[events.length - 1].timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--"}
              </span>
            </div>
          </div>

          {/* Controls + speed + counter */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Transport */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost" size="sm" className="h-10 w-10 sm:h-8 sm:w-8 p-0"
                onClick={() => setCurrentIdx(0)}
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                variant={playing ? "secondary" : "default"}
                size="sm" className="h-11 w-11 sm:h-9 sm:w-9 p-0"
                onClick={() => setPlaying(!playing)}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost" size="sm" className="h-10 w-10 sm:h-8 sm:w-8 p-0"
                onClick={() => setCurrentIdx(events.length - 1)}
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>

            {/* Speed pills */}
            <div className="flex items-center gap-1">
              {speeds.map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0 px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors ${
                    speed === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>

            {/* Counter */}
            <span className="text-xs font-mono text-muted-foreground ml-auto tabular-nums">
              {currentIdx + 1} / {events.length}
            </span>
          </div>

          {/* Current event info */}
          {currentEvent && (() => {
            const det = parseEventToDetection(currentEvent)
            return det ? (
              <div className="rounded-md bg-muted/40 px-3 py-2 flex flex-wrap items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-warning shrink-0" />
                <span className="text-xs font-mono text-foreground font-medium">
                  {det.zone_label || currentEvent.zone_label} [{det.side}]
                </span>
                <span className="text-xs font-mono font-bold text-warning">
                  {det.distance}cm {det.direction}
                </span>
                <span className="text-[10px] text-muted-foreground ml-auto font-mono shrink-0">
                  {det.device_name}
                </span>
              </div>
            ) : null
          })()}
        </div>
      )}

      {loaded && events.length === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground text-center py-4 font-mono">
          No detection events in this time range.
        </p>
      )}
    </div>
  )
}
