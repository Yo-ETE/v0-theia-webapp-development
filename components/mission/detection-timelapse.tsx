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
  if (!distance) return null
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
    presence: true,
    distance,
    speed: Number(p.speed ?? 0),
    angle: Number(p.angle ?? 0),
    direction: String(p.direction ?? p.dir ?? "C"),
    vbatt_tx: p.vbatt_tx ? Number(p.vbatt_tx) : null,
    rssi: ev.rssi,
    sensor_type: String(p.sensor_type ?? "ld2450"),
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

  // Fetch ALL detection events for this mission (same approach as history page)
  // then filter by date range client-side to avoid timezone mismatch issues
  const fetchParams = loaded ? {
    mission_id: missionId,
    event_type: "detection",
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
    }
  }, [events.length])

  // Feed detection at current index to parent
  useEffect(() => {
    if (!events.length || currentIdx >= events.length) {
      onDetection({})
      return
    }
    const ev = events[currentIdx]
    const det = parseEventToDetection(ev)
    if (det && det.zone_id) {
      onDetection({ [det.zone_id]: det })
    } else if (det && det.zone_label) {
      // Fallback: use zone_label as key
      onDetection({ [det.zone_label]: det })
    } else {
      onDetection({})
    }
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
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-4">
        <div>
          <label className="text-[10px] text-muted-foreground font-mono block mb-1">FROM</label>
          <input
            type="datetime-local"
            value={fromTime}
            onChange={(e) => { setFromTime(e.target.value); setLoaded(false) }}
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-xs font-mono text-foreground"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-mono block mb-1">TO</label>
          <input
            type="datetime-local"
            value={toTime}
            onChange={(e) => { setToTime(e.target.value); setLoaded(false) }}
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-xs font-mono text-foreground"
          />
        </div>
        <div className="flex items-end">
          <Button size="sm" className="h-9 text-xs px-4" onClick={handleLoad} disabled={isLoading}>
            {isLoading ? "..." : loaded ? "Reload" : "Load"}
          </Button>
        </div>
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
          <div className="flex items-center gap-3">
            {/* Transport */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost" size="sm" className="h-8 w-8 p-0"
                onClick={() => setCurrentIdx(0)}
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                variant={playing ? "secondary" : "default"}
                size="sm" className="h-9 w-9 p-0"
                onClick={() => setPlaying(!playing)}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost" size="sm" className="h-8 w-8 p-0"
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
                  className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-colors ${
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
              <div className="rounded-md bg-muted/40 px-3 py-2 flex items-center gap-3">
                <div className="h-2.5 w-2.5 rounded-full bg-warning shrink-0" />
                <span className="text-xs font-mono text-foreground font-medium">
                  {det.zone_label || currentEvent.zone_label} [{det.side}]
                </span>
                <span className="text-xs font-mono font-bold text-warning">
                  {det.distance}cm {det.direction}
                </span>
                <span className="text-[10px] text-muted-foreground ml-auto font-mono">
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
