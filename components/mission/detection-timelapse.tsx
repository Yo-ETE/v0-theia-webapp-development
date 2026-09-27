"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Play, Pause, SkipBack, SkipForward, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useEventsRange } from "@/hooks/use-api"
import { formatTime } from "@/lib/format"
import type { DetectionEvent, LiveDetection } from "@/lib/types"

/** 
 * Parse a timestamp string from the database as UTC.
 * The backend does NOT store timestamps in UTC.
 *
 * events.timestamp is written by SQLite as datetime('now','localtime'), so it is already the
 * hub's wall-clock time. Parsing it as UTC added two hours in summer: asking the replay for
 * 17:00-20:00 returned 125 events instead of 26, because it was really showing 15:00-18:00.
 * Silently, and with the timeline labelled with the shifted times, so nothing looked wrong --
 * you would review the wrong stretch of an operation and never know.
 *
 * Parsed as local time, which is what it is. Range filtering compares the strings directly
 * (see below): same format, same clock, no conversion to get wrong.
 */
function parseLocal(ts: string): Date {
  if (!ts) return new Date(NaN)
  // Strip any timezone marker the API may add; the value itself is local either way.
  const cleaned = ts.replace("Z", "").replace(/[+-]\d{2}:\d{2}$/, "").replace(" ", "T")
  return new Date(cleaned)
}

// LiveDetection is imported from @/lib/types

interface DetectionTimelapseProps {
  missionId: string
  /** "YYYY-MM-DDTHH:mm", the mission's own span when the caller knows it. */
  defaultFrom?: string
  defaultTo?: string
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
    sensor_position: ev.sensor_position != null ? Number(ev.sensor_position) : undefined,
    orientation: ev.orientation ?? null,
    timestamp: ev.timestamp,
    mission_id: ev.mission_id,
  }
}

// Activity histogram: group events by time slots
function buildActivityHistogram(events: DetectionEvent[], slots: number = 48): { slot: number; count: number; label: string; pct: number }[] {
  if (!events.length) return []
  
  // Get time range (UTC)
  const timestamps = events.map(e => parseLocal(e.timestamp).getTime()).filter(t => !isNaN(t))
  if (!timestamps.length) return []
  
  const minTs = Math.min(...timestamps)
  const maxTs = Math.max(...timestamps)
  const range = maxTs - minTs || 1
  const slotDuration = range / slots
  
  // Count events per slot
  const counts = new Array(slots).fill(0)
  timestamps.forEach(ts => {
    const idx = Math.min(slots - 1, Math.floor((ts - minTs) / slotDuration))
    counts[idx]++
  })
  
  const maxCount = Math.max(...counts, 1)
  
  return counts.map((count, i) => {
    const slotTs = new Date(minTs + i * slotDuration)
    return {
      slot: i,
      count,
      label: slotTs.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
      pct: (count / maxCount) * 100,
    }
  })
}

export function DetectionTimelapse({ missionId, onDetection, onClose, defaultFrom, defaultTo }: DetectionTimelapseProps) {
  const toLocalDatetime = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  /*
   * Default to the mission's own span, not to the last hour. A mission that ran four days ago
   * opened on an empty hour with nothing to say why -- the replay looked broken when it was
   * simply pointed at a window containing no detections. Falls back to the last hour only
   * when the caller has nothing better to offer.
   */
  const now = new Date()
  const fallbackFrom = new Date(now.getTime() - 3600 * 1000)
  const [fromTime, setFromTime] = useState(defaultFrom ?? toLocalDatetime(fallbackFrom))
  const [toTime, setToTime] = useState(defaultTo ?? toLocalDatetime(now))
  const [loaded, setLoaded] = useState(false)

  // Playback state
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [currentIdx, setCurrentIdx] = useState(0)
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Rolling window: keep last detection per device within WINDOW_MS of current event
  const WINDOW_MS = 5000
  const lastDetByDeviceRef = useRef<Record<string, { det: LiveDetection; ts: number }>>({})
  const skipNextEffectRef = useRef(false)

  // Fetch ALL detection events for this mission (same approach as history page)
  // then filter by date range client-side to avoid timezone mismatch issues
  const fetchParams = loaded ? {
    mission_id: missionId,
    limit: 10000,
  } : null

  const { data: rawEvents, isLoading } = useEventsRange(fetchParams)

  // Filter by date range client-side using proper timezone-aware comparison
  // fromTime/toTime are in local Paris time, DB timestamps are in UTC
  const events = useMemo(() => {
    if (!rawEvents) return []
    // Convert local datetime-local input to UTC timestamp for comparison
    // datetime-local input is in browser local time (Paris)
    // "YYYY-MM-DDTHH:mm" from the input, "YYYY-MM-DD HH:MM:SS" from the database: same clock,
    // same ordering, so comparing the strings is exact and cannot drift with a timezone.
    const fromStr = fromTime.replace("T", " ") + ":00"
    const toStr = toTime.replace("T", " ") + ":59"
    return rawEvents
      .filter(e => {
        if (!e.timestamp) return false
        const ts = e.timestamp.replace("T", " ").replace("Z", "")
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
    // Skip this effect when triggered by manual navigation (rewind/scrub/skip)
    if (skipNextEffectRef.current) {
      skipNextEffectRef.current = false
      return
    }
    if (!events.length || currentIdx >= events.length) {
      lastDetByDeviceRef.current = {}
      onDetection({})
      return
    }
    const ev = events[currentIdx]
    const det = parseEventToDetection(ev)
    const currentTsMs = parseLocal(ev.timestamp).getTime()

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
  const currentTs = currentEvent?.timestamp ? parseLocal(currentEvent.timestamp) : null

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
        <h3 className="text-sm font-semibold text-foreground font-mono tracking-wide">REJEU</h3>
        {onClose && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Time range selector */}
      <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-end">
        <div className="flex-1 min-w-0">
          <label className="text-xs text-muted-foreground font-mono block mb-1">DEBUT</label>
          <input
            type="datetime-local"
            value={fromTime}
            onChange={(e) => { setFromTime(e.target.value); setLoaded(false) }}
            className="w-full h-10 rounded-md border border-border bg-background px-2 text-[16px] sm:text-xs font-mono text-foreground"
          />
        </div>
        <div className="flex-1 min-w-0">
          <label className="text-xs text-muted-foreground font-mono block mb-1">FIN</label>
          <input
            type="datetime-local"
            value={toTime}
            onChange={(e) => { setToTime(e.target.value); setLoaded(false) }}
            className="w-full h-10 rounded-md border border-border bg-background px-2 text-[16px] sm:text-xs font-mono text-foreground"
          />
        </div>
        <Button size="sm" className="h-10 text-xs px-4 shrink-0 w-full sm:w-auto" onClick={handleLoad} disabled={isLoading}>
          {isLoading ? "..." : loaded ? "Recharger" : "Charger"}
        </Button>
      </div>

      {/* Playback controls */}
      {loaded && events.length > 0 && (
        <div className="space-y-3">
          {/* Activity histogram */}
          {(() => {
            const histogram = buildActivityHistogram(events, 48)
            if (!histogram.length) return null
            const currentSlot = Math.floor((currentIdx / events.length) * histogram.length)
            return (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono text-muted-foreground">ACTIVITE</span>
                  <span className="text-xs font-mono text-muted-foreground">
                    {events.length} detections
                  </span>
                </div>
                <div className="flex items-end gap-[1px] h-8 bg-muted/20 rounded overflow-hidden">
                  {histogram.map((h, i) => (
                    <div
                      key={i}
                      className={`flex-1 transition-colors ${i === currentSlot ? "bg-primary" : h.count > 0 ? "bg-primary/40" : "bg-muted/30"}`}
                      style={{ height: `${Math.max(h.count > 0 ? 10 : 0, h.pct)}%` }}
                      title={`${h.label}: ${h.count} detections`}
                    />
                  ))}
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-2xs font-mono text-muted-foreground">{histogram[0]?.label}</span>
                  <span className="text-2xs font-mono text-muted-foreground">{histogram[histogram.length - 1]?.label}</span>
                </div>
              </div>
            )
          })()}

          {/* Timeline scrubber */}
          <div>
            <input
              type="range"
              min={0}
              max={Math.max(0, events.length - 1)}
              value={currentIdx}
              onChange={(e) => { lastDetByDeviceRef.current = {}; onDetection({}); skipNextEffectRef.current = true; setCurrentIdx(parseInt(e.target.value)); setPlaying(false) }}
              className="w-full h-2 accent-primary"
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs font-mono text-muted-foreground">
                {events[0]?.timestamp ? formatTime(events[0].timestamp) : "--"}
              </span>
              <span className="text-xs font-mono font-bold text-primary">
                {currentTs ? currentTs.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--"}
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                {events[events.length - 1]?.timestamp ? formatTime(events[events.length - 1].timestamp) : "--"}
              </span>
            </div>
          </div>

          {/* Controls + speed + counter */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Transport */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost" size="sm" className="h-10 w-10 sm:h-8 sm:w-8 p-0"
                onClick={() => { lastDetByDeviceRef.current = {}; onDetection({}); skipNextEffectRef.current = true; setCurrentIdx(0); setPlaying(false) }}
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
                onClick={() => { lastDetByDeviceRef.current = {}; onDetection({}); skipNextEffectRef.current = true; setCurrentIdx(events.length - 1) }}
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
                  className={`min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0 px-2 py-1 rounded-md text-xs font-mono font-bold transition-colors ${
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
                <span className="text-xs text-muted-foreground ml-auto font-mono shrink-0">
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
