"use client"

import { useState, useEffect, useCallback, useRef } from "react"
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
  onDetection: (detections: Record<string, LiveDetection>) => void
  onClose: () => void
}

function parseEventToDetection(ev: DetectionEvent): LiveDetection | null {
  const p = ev.payload ?? {}
  const distance = Number(p.distance ?? p.dist ?? 0)
  if (!distance) return null
  return {
    device_id: ev.device_id ?? "",
    device_name: ev.device_name ?? "",
    tx_id: ev.device_id ?? null,
    zone_id: ev.zone_id ?? null,
    zone_label: String(p.zone ?? ev.zone_label ?? ""),
    side: String(p.side ?? ""),
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
  // Time range: default to last 1 hour
  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 3600 * 1000)
  const [fromTime, setFromTime] = useState(oneHourAgo.toISOString().slice(0, 16))
  const [toTime, setToTime] = useState(now.toISOString().slice(0, 16))
  const [loaded, setLoaded] = useState(false)

  // Playback state
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [currentIdx, setCurrentIdx] = useState(0)
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Fetch range params only when "loaded"
  const fetchParams = loaded ? {
    mission_id: missionId,
    from_ts: new Date(fromTime).toISOString(),
    to_ts: new Date(toTime).toISOString(),
    limit: 2000,
  } : null

  const { data: rawEvents, isLoading } = useEventsRange(fetchParams)

  // Sort events chronologically (API returns DESC)
  const events = (rawEvents ?? []).slice().reverse()

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
    <div className="rounded-lg border border-border/50 bg-card p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-foreground font-mono">TIMELAPSE</h3>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Time range selector */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1">
          <label className="text-[9px] text-muted-foreground font-mono block mb-0.5">FROM</label>
          <input
            type="datetime-local"
            value={fromTime}
            onChange={(e) => { setFromTime(e.target.value); setLoaded(false) }}
            className="w-full h-7 rounded border border-border bg-background px-2 text-[10px] font-mono text-foreground"
          />
        </div>
        <div className="flex-1">
          <label className="text-[9px] text-muted-foreground font-mono block mb-0.5">TO</label>
          <input
            type="datetime-local"
            value={toTime}
            onChange={(e) => { setToTime(e.target.value); setLoaded(false) }}
            className="w-full h-7 rounded border border-border bg-background px-2 text-[10px] font-mono text-foreground"
          />
        </div>
        <div className="pt-3">
          <Button size="sm" className="h-7 text-[10px] px-3" onClick={handleLoad} disabled={isLoading}>
            {isLoading ? "Loading..." : loaded ? "Reload" : "Load"}
          </Button>
        </div>
      </div>

      {/* Playback controls */}
      {loaded && events.length > 0 && (
        <>
          {/* Timeline scrubber */}
          <div className="mb-2">
            <input
              type="range"
              min={0}
              max={Math.max(0, events.length - 1)}
              value={currentIdx}
              onChange={(e) => { setCurrentIdx(parseInt(e.target.value)); setPlaying(false) }}
              className="w-full h-1.5 accent-primary"
            />
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[9px] font-mono text-muted-foreground">
                {events[0]?.timestamp ? new Date(events[0].timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--"}
              </span>
              <span className="text-[10px] font-mono font-semibold text-primary">
                {currentTs ? currentTs.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--"}
              </span>
              <span className="text-[9px] font-mono text-muted-foreground">
                {events[events.length - 1]?.timestamp ? new Date(events[events.length - 1].timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--"}
              </span>
            </div>
          </div>

          {/* Controls row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost" size="sm" className="h-7 w-7 p-0"
                onClick={() => setCurrentIdx(0)}
              >
                <SkipBack className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={playing ? "secondary" : "default"}
                size="sm" className="h-7 w-7 p-0"
                onClick={() => setPlaying(!playing)}
              >
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </Button>
              <Button
                variant="ghost" size="sm" className="h-7 w-7 p-0"
                onClick={() => setCurrentIdx(events.length - 1)}
              >
                <SkipForward className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Speed selector */}
            <div className="flex items-center gap-0.5">
              {speeds.map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold transition-colors ${
                    speed === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>

            {/* Event counter */}
            <span className="text-[9px] font-mono text-muted-foreground">
              {currentIdx + 1} / {events.length}
            </span>
          </div>

          {/* Current event info */}
          {currentEvent && (() => {
            const det = parseEventToDetection(currentEvent)
            return det ? (
              <div className="mt-2 rounded bg-muted/30 px-2 py-1.5 flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-warning shrink-0" />
                <span className="text-[10px] font-mono text-foreground">
                  {det.zone_label || currentEvent.zone_label} [{det.side}]
                </span>
                <span className="text-[10px] font-mono font-semibold text-warning">
                  {det.distance}cm {det.direction}
                </span>
                <span className="text-[9px] text-muted-foreground ml-auto font-mono">
                  {det.device_name}
                </span>
              </div>
            ) : null
          })()}
        </>
      )}

      {loaded && events.length === 0 && !isLoading && (
        <p className="text-[10px] text-muted-foreground text-center py-2 font-mono">
          No detection events in this time range.
        </p>
      )}
    </div>
  )
}
