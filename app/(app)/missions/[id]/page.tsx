"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  ArrowLeft, Radio, MapPin, Clock, Users, BarChart3, Plus,
  Pencil, Play, Pause, CheckCircle, Trash2, Building2, Home,
  Activity, Eye, EyeOff, Zap, Timer, Download, Signal, Battery, Wifi, Unlink,
  Flame, Crosshair, ArrowDownLeft, ArrowUpRight, Bell, BellOff,
  Maximize2, Minimize2, FileImage, Ruler, Palette, RotateCw,
  Volume2, VolumeX,
} from "lucide-react"
import { TopHeader } from "@/components/top-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MissionMap } from "@/components/mission/mission-map"
import { NotificationConfig } from "@/components/mission/notification-config"
import { PlanEditor } from "@/components/mission/plan-editor"
import { StaticMiniMap } from "@/components/mission/static-mini-map"
import { FloorManager } from "@/components/mission/floor-manager"
import { DetectionTimelapse } from "@/components/mission/detection-timelapse"
import { ErrorBoundary } from "@/components/error-boundary"
import { useMission, useEvents, useDevices } from "@/hooks/use-api"
import { useVisualConfig, VISUAL_DEFAULTS, type VisualConfigKey } from "@/hooks/use-visual-config"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { useSSE } from "@/hooks/use-sse"
import { useNotificationSound } from "@/hooks/use-notification-sound"
import { updateMission, updateDevice } from "@/lib/api-client"
import { missionStatusConfig, eventTypeConfig, deviceStatusConfig, formatRelative, formatTime, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Zone, Floor, DetectionEvent } from "@/lib/types"

const ZONE_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"]
const ZONE_TYPES = [
  { value: "facade", label: "Facade / Wall" },
  { value: "perimeter", label: "Perimeter" },
  { value: "interior", label: "Interior" },
  { value: "roof", label: "Roof" },
  { value: "floor", label: "Floor / Etage" },
  { value: "section", label: "Section / Troncon" },
  { value: "custom", label: "Custom" },
] as const

// ── Live detection type from SSE ──
interface LiveDetection {
  device_id: string
  device_name: string
  tx_id: string | null
  mission_id: string
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
}

/** Haversine distance between two lat/lon points in meters */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Compute distance in meters along a polygon edge for a device side + sensor_position */
function getSideDistanceM(polygon: [number, number][], side: string, sensorPos: number, groupSides: (p: [number, number][]) => { segmentToGroup: Record<number, string> }): string {
  if (!polygon || polygon.length < 3 || !side) return ""
  const { segmentToGroup } = groupSides(polygon)
  // Find the first polygon edge matching this side letter
  for (let i = 0; i < polygon.length; i++) {
    const groupKey = segmentToGroup[i] ?? String.fromCharCode(65 + i)
    if (groupKey === side) {
      const j = (i + 1) % polygon.length
      const isPixel = polygon.some(([a, b]: [number, number]) => Math.abs(a) > 200 || Math.abs(b) > 200)
      if (isPixel) {
        const pct = Math.round(sensorPos * 100)
        return `${pct}%`
      }
      const edgeLen = haversineM(polygon[i][0], polygon[i][1], polygon[j][0], polygon[j][1])
      const dist = edgeLen * sensorPos
      return dist < 1 ? `${Math.round(dist * 100)}cm` : `${dist.toFixed(1)}m`
    }
  }
  return ""
}

export default function MissionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: mission, isLoading, mutate } = useMission(id)
  const { data: events, mutate: mutateEvents } = useEvents({ mission_id: id, limit: 10000 })
  const { data: allDevices, mutate: mutateDevices } = useDevices({ refreshInterval: 10000 })

  // Force fresh device list on mount (in case devices were unassigned on another page)
  useEffect(() => { mutateDevices() }, [mutateDevices])

  // Detection sound
  const { soundEnabled, toggleSound, playDetection } = useNotificationSound()

  const [drawingMode, setDrawingMode] = useState(false)
  const [calibrationMode, setCalibrationMode] = useState(false)
  const [feedDeviceFilter, setFeedDeviceFilter] = useState<string>("all")
  const [zoneDialog, setZoneDialog] = useState(false)
  const [pendingPolygon, setPendingPolygon] = useState<[number, number][] | null>(null)
  const [zoneName, setZoneName] = useState("")
  const [zoneType, setZoneType] = useState<string>("facade")
  const [sideLabels, setSideLabels] = useState<Record<string, string>>({})
  const [sideGrouping, setSideGrouping] = useState<string[]>([])
  const [editZoneDialog, setEditZoneDialog] = useState<string | null>(null) // zone id being edited
  const [editZoneName, setEditZoneName] = useState("")
  const [editZoneType, setEditZoneType] = useState<string>("facade")
  const [editSideLabels, setEditSideLabels] = useState<Record<string, string>>({})
  const [assignDialog, setAssignDialog] = useState<string | null>(null)
  const [assignStep, setAssignStep] = useState<{ 
    deviceId: string; 
    deviceName: string; 
    side?: string;
    deviceType?: string;
    // Gravity MW specific config
    gravityConfig?: {
      effectiveRange: number; // meters
      effectiveFov: number; // degrees
    };
  } | null>(null)
  const [sensorPlaceMode, setSensorPlaceMode] = useState<{
    zoneId: string
    side: string
    deviceId: string
    deviceName: string
  } | null>(null)
  const [statusUpdating, setStatusUpdating] = useState(false)
  // ── Save map center/zoom on pan (debounced) ──
  const mapMoveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleMapMove = useCallback((lat: number, lon: number, zoom: number) => {
    if (mapMoveTimer.current) clearTimeout(mapMoveTimer.current)
    mapMoveTimer.current = setTimeout(() => {
      updateMission(id, { center_lat: lat, center_lon: lon, zoom }).catch(() => {})
    }, 1500) // debounce 1.5s after last move
  }, [id])

  const [activeTab, setActiveTab] = useState("live")
  const [showNotifConfig, setShowNotifConfig] = useState(false)
  const [timelapseMode, setTimelapseMode] = useState(false)
  const [heatmapMode, setHeatmapMode] = useState(false)
  const [estimatePosition, setEstimatePosition] = useState(false)
  const visualConfigOverrides = mission?.visual_config as Record<string, string> | null ?? null
    const { config: visualConfig, raw: visualRaw, updateConfig: updateVisualConfig, resetAll: resetVisualConfig, hasMissionOverrides } = useVisualConfig({
      missionOverrides: visualConfigOverrides,
      missionId: id,
      onMissionMutate: (patch?: Record<string, unknown>) => {
          if (patch && mission) {
            mutate({ ...mission, ...patch }, false)
          } else {
            mutate()
          }
        },
    })
  const [showFov, setShowFov] = useState(false)
  // Sync FOV default from visual config on first load
  useEffect(() => { setShowFov(visualConfig.fov_default_visible) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [fullMapMode, setFullMapMode] = useState(false)
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  const [editingPolygon, setEditingPolygon] = useState<[number, number][] | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [replayDetections, setReplayDetections] = useState<Record<string, any>>({})

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleReplayDetection = useCallback((dets: Record<string, any>) => {
    // Timelapse sends detections keyed by device_id (rolling window of all active devices).
    const env = mission?.environment ?? "habitation"
    const plan = env === "plan"
    const floorMode = env === "vertical" || env === "etages" || env === "garage"

    // Floor mode + Plan mode: pass through by device_id
    // (FloorManager resolves device->floor, PlanEditor resolves device->sensor placement)
    if (floorMode || plan) {
      setReplayDetections(dets)
      return
    }

    // Zone mode (map): resolve to zone_id keys for zone highlighting on the map.
    const zones = mission?.zones ?? []
    const resolved: Record<string, any> = {}
    for (const [, det] of Object.entries(dets)) {
      if (!det) continue
      const zoneId = det.zone_id
      const zoneLabel = det.zone_label
      let resolvedZoneId: string | null = null

      if (zoneId && zones.find(z => z.id === zoneId)) {
        resolvedZoneId = zoneId
      } else if (zoneLabel) {
        const byName = zones.find(z => z.name === zoneLabel)
        if (byName) resolvedZoneId = byName.id
      }
      if (!resolvedZoneId && zones.length === 1) {
        resolvedZoneId = zones[0].id
      }

      if (resolvedZoneId) {
        const devId = det.device_id || det.device_name || "unknown"
        resolved[`${resolvedZoneId}::${devId}`] = { ...det, zone_id: resolvedZoneId }
      }
    }
    setReplayDetections(resolved)
  }, [mission?.zones, mission?.environment])

  // ── Live SSE detections ──
  const [liveDetections, setLiveDetections] = useState<LiveDetection[]>([])
  const [liveByZone, setLiveByZone] = useState<Record<string, LiveDetection>>({})
  // Also track by device_id for multi-TX per zone support
  const [liveByDevice, setLiveByDevice] = useState<Record<string, LiveDetection>>({})
  const feedRef = useRef<HTMLDivElement>(null)

  // Keep a ref of muted device IDs so SSE handler can filter without re-creating
  const mutedIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    mutedIdsRef.current = new Set(
      (allDevices ?? []).filter(d => d.muted).map(d => d.id)
    )
  }, [allDevices])

  // SSE handler: accumulate live detections for this mission
  const sseCountRef = useRef(0)
  const handleSSE = useCallback((event: { type: string; data: Record<string, unknown> }) => {
    if (event.type !== "detection") return
    const d = event.data as unknown as LiveDetection
    if (d.mission_id !== id) return

    // Skip muted devices -- no feed, no map markers, no state update
    if (d.device_id && mutedIdsRef.current.has(d.device_id)) return

    // Only add to feed if it's a real presence event
    // Allow distance 0 for presence-only sensors (C4001, gravity_mw)
    if (d.presence && (d.distance > 0 || d.sensor_type === "c4001" || d.sensor_type === "gravity_mw")) {
      setLiveDetections(prev => {
        const next = [d, ...prev]
        return next.slice(0, 50)
      })
      // Play detection sound (throttled to 1x / 2s)
      playDetection()
      // Periodically refresh DB events list so history tab stays in sync
      sseCountRef.current += 1
      if (sseCountRef.current % 10 === 0) {
        mutateEvents()
      }
    }

    // Always update liveByZone so map-inner sees the latest state
    // (including presence: false to trigger stale transition)
    if (d.zone_id) {
      setLiveByZone(prev => ({ ...prev, [d.zone_id!]: d }))
    }
    // Also track by device_id for multi-TX per zone
    if (d.device_id) {
      setLiveByDevice(prev => ({ ...prev, [d.device_id]: d }))
    }
  }, [id, mutateEvents, playDetection])

  useSSE(handleSSE)

  // Merge DB events into the detection feed whenever events change.
  // This ensures the feed survives page navigation (DB events are persistent).
  const lastEventCountRef = useRef(0)
  useEffect(() => {
    if (!events || events.length === 0) return
    // Only re-seed if events changed (avoid overwriting live SSE data with stale DB data)
    if (events.length === lastEventCountRef.current) return
    lastEventCountRef.current = events.length

  // Filter out events before detection_reset_at (normalize timestamp format for comparison)
  const ra = mission?.detection_reset_at ?? null
  const normTs = (ts: string) => {
    const isUTC = ts.includes("Z") || (ts.includes("T") && !ts.includes(" "))
    if (isUTC) {
      const d = new Date(ts)
      if (!isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, "0")
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      }
    }
    return ts.replace("T", " ").replace("Z", "").replace(/\.\d+$/, "").split("+")[0]
  }
  const raNorm = ra ? normTs(ra) : null
  const filteredEvents = raNorm ? events.filter((e: Record<string, unknown>) => !e.timestamp || normTs(e.timestamp as string) > raNorm) : events

    const dbDetections: LiveDetection[] = filteredEvents.slice(0, 30).map((e: Record<string, unknown>) => {
      const p = (typeof e.payload === "string" ? (() => { try { return JSON.parse(e.payload as string) } catch { return {} } })() : (e.payload ?? {})) as Record<string, unknown>
      return {
        device_id: e.device_id as string ?? "",
        device_name: (p.device_name ?? e.device_name ?? e.device_id ?? "") as string,
        tx_id: (p.tx_id ?? e.tx_id ?? "") as string,
        sensor_type: (p.sensor_type ?? "ld2450") as string,
        serial_port: "",
        mission_id: (e.mission_id ?? "") as string,
        zone: (e.zone_name ?? "") as string,
        zone_id: (e.zone_id ?? "") as string,
        zone_label: (p.zone_label ?? e.zone_label ?? "") as string,
        side: (e.side ?? "") as string,
        presence: true,
        distance: Number(p.distance ?? 0),
        speed: Number(p.speed ?? 0),
        angle: Number(p.angle ?? 0),
        direction: (p.direction ?? "C") as string,
        rssi: Number(e.rssi ?? -120),
        timestamp: (e.timestamp ?? new Date().toISOString()) as string,
      } as LiveDetection
    })
    // Merge: keep existing live SSE detections on top, add DB ones below
    setLiveDetections(prev => {
      // If we have live SSE data, keep it and append DB events not already present
      if (prev.length > 0) {
        const existingTs = new Set(prev.map(d => d.timestamp))
        const newFromDb = dbDetections.filter(d => !existingTs.has(d.timestamp))
        return [...prev, ...newFromDb].slice(0, 50)
      }
      return dbDetections
    })
  }, [events])

  // ── Bearing grouping: segments facing the same direction share the same face label ──
  // Uses FULL 0-360 bearing so north-facing (0) and south-facing (180) are DIFFERENT faces.
  // Returns e.g. { A: [0,3], B: [1,4], C: [2,5] } meaning polygon edges 0&3 are "A", etc.
  const groupSidesByBearing = useCallback((polygon: [number, number][]) => {
    if (polygon.length < 3) {
      const labels: Record<string, string> = {}
      for (let i = 0; i < polygon.length; i++) labels[String.fromCharCode(65 + i)] = ""
      return { labels, segmentToGroup: polygon.map((_,i) => String.fromCharCode(65 + i)) }
    }
    // Compute the OUTWARD NORMAL bearing (0-360) for each edge.
    // The outward normal tells us which direction the wall faces (not which way it runs).
    // For a CW polygon, outward normal is +90 from edge direction.
    // For a CCW polygon, outward normal is -90 from edge direction.

    // Detect if coordinates are pixel-based (>200) or lat/lon (-90..90)
    const isPixelCoords = polygon.some(([a, b]) => Math.abs(a) > 200 || Math.abs(b) > 200)

    // First compute edge bearings
    const edgeBearings: number[] = []
    for (let i = 0; i < polygon.length; i++) {
      const [y1, x1] = polygon[i]
      const [y2, x2] = polygon[(i + 1) % polygon.length]
      let deg: number
      if (isPixelCoords) {
        // Simple atan2 for pixel coordinates
        deg = Math.atan2(x2 - x1, y2 - y1) * 180 / Math.PI
      } else {
        // Haversine bearing for lat/lon
        const dLon = (x2 - x1) * Math.PI / 180
        const yy = Math.sin(dLon) * Math.cos(y2 * Math.PI / 180)
        const xx = Math.cos(y1 * Math.PI / 180) * Math.sin(y2 * Math.PI / 180) -
                  Math.sin(y1 * Math.PI / 180) * Math.cos(y2 * Math.PI / 180) * Math.cos(dLon)
        deg = Math.atan2(yy, xx) * 180 / Math.PI
      }
      deg = ((deg % 360) + 360) % 360
      edgeBearings.push(deg)
    }

    // Determine polygon winding (signed area). Positive = CCW in lat/lng.
    let signedArea = 0
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length
      signedArea += (polygon[j][1] - polygon[i][1]) * (polygon[j][0] + polygon[i][0])
    }
    // Shoelace with (lng,lat): signedArea < 0 means CW on screen → outward normal = bearing + 90
    // signedArea > 0 means CCW on screen → outward normal = bearing - 90
    const normalOffset = signedArea < 0 ? 90 : -90

    // Compute outward normal bearings
    const bearings: number[] = edgeBearings.map(b => ((b + normalOffset) % 360 + 360) % 360)

    // Group edges whose outward normals point in similar directions (within tolerance)
    const TOLERANCE = 30
    const groups: number[][] = []
    const assigned = new Set<number>()
    for (let i = 0; i < bearings.length; i++) {
      if (assigned.has(i)) continue
      const group = [i]
      assigned.add(i)
      for (let j = i + 1; j < bearings.length; j++) {
        if (assigned.has(j)) continue
        // Angular difference on a circle (0-360)
        let diff = Math.abs(bearings[i] - bearings[j])
        if (diff > 180) diff = 360 - diff
        if (diff <= TOLERANCE) {
          group.push(j)
          assigned.add(j)
        }
      }
      groups.push(group)
    }
    // Assign labels A, B, C... to each group
    const segmentToGroup: string[] = new Array(polygon.length)
    const labels: Record<string, string> = {}
    groups.forEach((group, gi) => {
      const letter = String.fromCharCode(65 + gi)
      labels[letter] = ""
      for (const idx of group) segmentToGroup[idx] = letter
    })
    return { labels, segmentToGroup }
  }, [])

  // ── Zone drawing ──
  const handlePolygonDrawn = useCallback((polygon: [number, number][]) => {
    setPendingPolygon(polygon)
    setZoneName("")
    setZoneType("facade")
    const { labels, segmentToGroup } = groupSidesByBearing(polygon)
    setSideLabels(labels)
    setSideGrouping(segmentToGroup)
    setZoneDialog(true)
    setDrawingMode(false)
  }, [groupSidesByBearing])

  // Calibration done: save plan_scale to mission
  const handleCalibrationDone = useCallback(async (pxPerMeter: number) => {
    if (!mission) return
    try {
      await fetch(`/api/missions/${mission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_scale: pxPerMeter }),
      })
      mutate()
      setCalibrationMode(false)
    } catch (e) {
      console.error("Failed to save calibration:", e)
    }
  }, [mission, mutate])

  const saveZone = useCallback(async () => {
    if (!mission || !pendingPolygon || !zoneName.trim()) return
    const zones = mission.zones ?? []
    const newZone: Zone = {
      id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      mission_id: id,
      name: zoneName.trim().toLowerCase().replace(/\s+/g, "-"),
      label: zoneName.trim(),
      type: zoneType as Zone["type"],
      polygon: pendingPolygon,
      color: ZONE_COLORS[zones.length % ZONE_COLORS.length],
      devices: [],
      // Build sides map: key = segment letter (A,B,C...), value = display label
      // Segments in the same bearing group share the same label.
      // If user gave a custom name (e.g. "Nord"), use it. Otherwise use the group letter.
      sides: (() => {
        const s: Record<string, string> = {}
        for (let i = 0; i < pendingPolygon.length; i++) {
          const groupKey = sideGrouping[i] ?? String.fromCharCode(65 + i)
          const customName = sideLabels[groupKey] ?? ""
          // Store custom name if set, otherwise store the group letter
          // so parallel segments show the same label on the map
          s[String.fromCharCode(65 + i)] = customName || groupKey
        }
        return s
      })(),
    }
    const updated = await updateMission(id, { zones: [...zones, newZone] })
    mutate(updated, false)
    setZoneDialog(false)
    setPendingPolygon(null)
  }, [mission, pendingPolygon, zoneName, zoneType, sideLabels, sideGrouping, id, mutate])

  const deleteZone = useCallback(async (zoneId: string) => {
    if (!mission) return
    const devicesInZone = (allDevices ?? []).filter((d) => d.mission_id === id && d.zone_id === zoneId)
    for (const dev of devicesInZone) {
      try {
        await updateDevice(dev.id, {
          zone_id: "", zone_label: "", side: "", sensor_position: 0.5,
        } as Partial<import("@/lib/types").Device>)
      } catch (err) {
        console.warn("[THEIA] Failed to unassign device from zone:", err)
      }
    }
    const zones = (mission.zones ?? []).filter((z) => z.id !== zoneId)
    try {
      const updated = await updateMission(id, { zones })
      mutate(updated, false)
    } catch (err) {
      console.warn("[THEIA] Failed to update mission:", err)
    }
    if (devicesInZone.length > 0) mutateDevices()
  }, [mission, id, allDevices, mutate, mutateDevices])

  // ── Device assignment ──
  const assignDevice = useCallback(async (
    deviceId: string, 
    zoneId: string, 
    side?: string, 
    sensorPos?: number,
    gravityConfig?: { effectiveRange: number; effectiveFov: number }
  ) => {
    if (!mission) return
    const zone = (mission.zones ?? []).find((z) => z.id === zoneId)
    try {
      const result = await updateDevice(deviceId, {
        mission_id: id,
        zone_id: zoneId,
        zone_label: zone?.label ?? "",
        side: side ?? "",
        sensor_position: sensorPos ?? 0.5,
      } as Partial<import("@/lib/types").Device>)
      // Verify the PATCH actually set the correct mission_id
      if (result && (result as Record<string, unknown>).mission_id !== id) {
        console.error("[THEIA] assignDevice: mission_id not set correctly!", result)
      }
    } catch (err) {
      console.warn("[THEIA] Failed to update device during assign:", err)
    }
    const zones = (mission.zones ?? []).map((z) =>
      z.id === zoneId && !z.devices.includes(deviceId)
        ? { ...z, devices: [...z.devices, deviceId] }
        : z
    )
    // Persist device placement in mission history (for replay after unassignment)
    const existingPlacements = mission.device_placements ?? {}
    const deviceObj = (allDevices ?? []).find(d => d.id === deviceId)
    const updatedPlacements = {
      ...existingPlacements,
      [deviceId]: {
        zone_id: zoneId,
        side: side ?? "",
        sensor_position: sensorPos ?? 0.5,
        orientation: deviceObj?.orientation ?? "inward",
        device_name: deviceObj?.name ?? deviceId,
        device_type: deviceObj?.device_type ?? "",
        // Gravity MW specific config (only set if provided)
        ...(gravityConfig && {
          effective_range: gravityConfig.effectiveRange,
          effective_fov: gravityConfig.effectiveFov,
        }),
      },
    }
    try {
      const updated = await updateMission(id, { zones, device_placements: updatedPlacements })
      mutate(updated, false)
    } catch (err) {
      console.warn("[THEIA] Failed to update mission during assign:", err)
    }
    mutateDevices()
    setAssignDialog(null)
    setAssignStep(null)
    setSensorPlaceMode(null)
  }, [mission, id, mutate, mutateDevices, allDevices])

  // ── Handle click-to-place sensor on the map side ──
  const handleSensorPlace = useCallback((zoneId: string, side: string, position: number) => {
    if (!sensorPlaceMode) return
    assignDevice(sensorPlaceMode.deviceId, zoneId, side, position)
  }, [sensorPlaceMode, assignDevice])

  // ── Remove device from mission ──
  const [unassigning, setUnassigning] = useState<string | null>(null)
  const unassignDevice = useCallback(async (deviceId: string) => {
    if (!mission || unassigning) return
    setUnassigning(deviceId)

    const updatedZones = (mission.zones ?? []).map((z) => ({
      ...z,
      devices: z.devices.filter((did) => did !== deviceId),
    }))
    const updatedFloors = (mission.floors ?? []).map((f) => ({
      ...f,
      devices: (f.devices ?? []).filter((did: string) => did !== deviceId),
      // Preserve device in history for timelapse replay after unassignment
      device_history: (f.devices ?? []).includes(deviceId)
        ? [...new Set([...(f.device_history || []), deviceId])]
        : (f.device_history || []),
    }))
    const newDeviceCount = Math.max(0, (mission.device_count ?? 1) - 1)

    // Optimistic UI: update both caches immediately, disable revalidation
    const optimisticDevices = (prev: import("@/lib/types").Device[] | undefined) =>
      prev?.map((d) =>
        d.id === deviceId ? { ...d, mission_id: "", zone_id: "", zone_label: "", side: "", floor: undefined } : d
      )
    mutateDevices(optimisticDevices, { revalidate: false })
    mutate(
      { ...mission, zones: updatedZones, floors: updatedFloors, device_count: newDeviceCount },
      { revalidate: false },
    )

    // Persist both device clear + mission zone update, then revalidate
    try {
      const [devRes] = await Promise.all([
        updateDevice(deviceId, {
          mission_id: "",
          zone_id: "",
          zone_label: "",
          side: "",
          floor: null,
          sensor_position: 0.5,
        } as Partial<import("@/lib/types").Device>),
        updateMission(id, { zones: updatedZones, floors: updatedFloors }),
      ])
      // Verify the PATCH actually cleared mission_id
      if (devRes && (devRes as Record<string, unknown>).mission_id) {
        console.error("[THEIA] PATCH did not clear mission_id! Response:", devRes)
      }
      // Backend PATCH succeeded -- revalidate SWR caches immediately
      await Promise.all([mutate(), mutateDevices()])
      setUnassigning(null)
    } catch (err) {
      console.error("[THEIA] Failed to unassign device:", err)
      // PATCH failed -- revert optimistic update by refetching real state
      await Promise.all([mutate(), mutateDevices()])
      setUnassigning(null)
      setErrorMsg(`Erreur suppression TX: ${(err as Error).message}`)
    }
  }, [mission, id, mutate, mutateDevices, unassigning])

  // ── Zone polygon editing (local state only, saved on exit) ──
  const updateZonePolygon = useCallback((_zoneId: string, newPolygon: [number, number][]) => {
    setEditingPolygon(newPolygon)
  }, [])

  // Start editing: copy polygon to local state
  const startEditingZone = useCallback((zoneId: string | null) => {
    if (zoneId) {
      const zone = (mission?.zones ?? []).find(z => z.id === zoneId)
      if (zone) setEditingPolygon([...zone.polygon])
    }
    setEditingZoneId(zoneId)
  }, [mission])

  // Save polygon on exit
  const stopEditingZone = useCallback(async () => {
    if (!mission || !editingZoneId || !editingPolygon) {
      setEditingZoneId(null)
      setEditingPolygon(null)
      return
    }
    const updatedZones = (mission.zones ?? []).map((z) => {
      if (z.id !== editingZoneId) return z
      // Re-compute facade grouping for the new polygon shape
      const { labels: newGroupLabels, segmentToGroup: newSeg2group } = groupSidesByBearing(editingPolygon)
      // Transfer custom side names: if old group "A" had name "Facade Nord",
      // find which new group has the same bearing direction and keep the name
      const newSides: Record<string, string> = { ...newGroupLabels }
      for (const [oldKey, oldName] of Object.entries(z.sides ?? {})) {
        if (oldName && newSides[oldKey] !== undefined) {
          newSides[oldKey] = oldName
        }
      }
      return { ...z, polygon: editingPolygon, sides: newSides }
    })
    mutate({ ...mission, zones: updatedZones }, false)
    try {
      await updateMission(id, { zones: updatedZones })
    } catch (err) {
      console.warn("[THEIA] Failed to save zone polygon:", err)
      mutate()
    }
    setEditingZoneId(null)
    setEditingPolygon(null)
  }, [mission, editingZoneId, editingPolygon, id, mutate])

  // ── Zone properties edit ──
  const openEditZone = useCallback((zoneId: string) => {
    const zone = (mission?.zones ?? []).find((z) => z.id === zoneId)
    if (!zone) return
    setEditZoneName(zone.label)
    setEditZoneType(zone.type)
    // Compute grouping for the existing polygon
    const { labels: groupLabels, segmentToGroup } = groupSidesByBearing(zone.polygon)
    // Build group-level labels from existing side values
    // If any segment in a group has a custom name, use it for the whole group
    const groupNames: Record<string, string> = { ...groupLabels }
    for (let i = 0; i < zone.polygon.length; i++) {
      const segKey = String.fromCharCode(65 + i)
      const groupKey = segmentToGroup[i]
      const existingName = zone.sides?.[segKey] || ""
      // Use the existing name if it's a real custom name (not just a letter)
      if (existingName && existingName.length > 1) {
        groupNames[groupKey] = existingName
      }
    }
    setEditSideLabels(groupNames)
    setSideGrouping(segmentToGroup)
    setEditZoneDialog(zoneId)
  }, [mission, groupSidesByBearing])

  const saveEditZone = useCallback(async () => {
    if (!mission || !editZoneDialog || !editZoneName.trim()) return
    const zones = (mission.zones ?? []).map((z) => {
      if (z.id !== editZoneDialog) return z
      // Build per-segment sides map from grouped labels
      const sides: Record<string, string> = {}
      for (let i = 0; i < z.polygon.length; i++) {
        const groupKey = sideGrouping[i] ?? String.fromCharCode(65 + i)
        const customName = editSideLabels[groupKey] ?? ""
        sides[String.fromCharCode(65 + i)] = customName || groupKey
      }
      return {
        ...z,
        label: editZoneName.trim(),
        name: editZoneName.trim().toLowerCase().replace(/\s+/g, "-"),
        type: editZoneType as Zone["type"],
        sides,
      }
    })
    try {
      const updated = await updateMission(id, { zones })
      mutate(updated, false)
    } catch (err) {
      console.warn("[THEIA] Failed to update zone:", err)
    }
    setEditZoneDialog(null)
  }, [mission, editZoneDialog, editZoneName, editZoneType, editSideLabels, sideGrouping, id, mutate])

  // ── Status transitions ──
  const changeStatus = useCallback(async (newStatus: string) => {
    if (!mission) return
    setStatusUpdating(true)
    try {
      const patch: Record<string, unknown> = { status: newStatus }
      if (newStatus === "active" && !mission.started_at) patch.started_at = new Date().toISOString()
      if (newStatus === "completed") patch.ended_at = new Date().toISOString()
      const updated = await updateMission(id, patch)
      mutate(updated, false)
    } finally {
      setStatusUpdating(false)
    }
  }, [mission, id, mutate])

  // ── Floor mode callbacks (must be above early return) ──
  const handleFloorsChange = useCallback(async (updatedFloors: Floor[]) => {
    if (!mission) return
    try {
      const updated = await updateMission(id, { floors: updatedFloors })
      mutate(updated, false)
    } catch (err) {
      console.warn("[THEIA] Failed to update floors:", err)
    }
  }, [mission, id, mutate])

  const handleFloorDeviceAssign = useCallback(async (deviceId: string, floor: number) => {
    try {
      // Derive zone_label from the floor label for detection feed display
      const floorObj = (mission?.floors ?? []).find((f: Floor) => f.level === floor)
      const label = floorObj?.label ?? `Etage ${floor}`
      await updateDevice(deviceId, {
        mission_id: id,
        floor,
        zone_id: "",
        zone_label: label,
        side: "",
        sensor_position: 0.5,
      } as Partial<import("@/lib/types").Device>)
      mutateDevices()
    } catch (err) {
      console.warn("[THEIA] Failed to assign device to floor:", err)
    }
  }, [id, mission?.floors, mutateDevices])

  const handleFloorDeviceUnassign = useCallback(async (deviceId: string) => {
    try {
      await updateDevice(deviceId, {
        mission_id: "",
        floor: null,
        zone_id: "",
        zone_label: "",
        side: "",
        sensor_position: 0.5,
      } as Partial<import("@/lib/types").Device>)
      mutateDevices()
    } catch (err) {
      console.warn("[THEIA] Failed to unassign device:", err)
    }
  }, [mutateDevices])

  // MUST be declared before any early return to respect Rules of Hooks
  const [planImageTs, setPlanImageTs] = useState(() => Date.now())
  const [planDeleted, setPlanDeleted] = useState(false)

  if (isLoading || !mission) {
    return (
      <>
        <TopHeader title="Mission" description="Loading..." />
        <main className="flex-1 p-4">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 rounded bg-muted" />
            <div className="h-[400px] rounded bg-muted" />
          </div>
        </main>
      </>
    )
  }

  const statusCfg = missionStatusConfig[mission.status] ?? missionStatusConfig.draft
  const zones = mission.zones ?? []
  // eventList = ALL recorded events (history tab). Reset only affects the live feed, not history.
  const eventList = events ?? []

  // ── Environment / mode detection ──
  const env = mission?.environment ?? "habitation"
  const isFloorMode = env === "vertical" || env === "etages" || env === "garage"
  const isPlanMode = env === "plan"

  // Devices assigned to this mission:
  // - floor mode: all with mission_id match (floors tracked in mission.floors[].devices[])
  // - habitation/plan: must have zone_id or floor set
  const missionDevices = allDevices?.filter((d) => {
    if (!d.enabled || d.mission_id !== id || d.id === unassigning) return false
    if (isFloorMode) return true
    return !!(d.zone_id || d.floor != null)
  }) ?? []

  // Available to assign: enabled devices not in this mission
  const unassigned = allDevices?.filter((d) => {
    if (!d.enabled) return false
    // Only show truly free devices (no mission) -- not devices assigned to other missions
    if (d.mission_id) return false
    return true
  }) ?? []
  // Use direct backend URL for plan image (avoids Next.js proxy multipart/binary issues)
  const backendBase =
    typeof window !== "undefined"
      ? `http://${window.location.hostname}:8000`
      : ""
  
  const hasPlan = Boolean(mission?.plan_image) && !planDeleted
  
  const planImageUrl =
    isPlanMode && hasPlan
      ? `${backendBase}/api/missions/${id}/plan-image/file?t=${planImageTs}`
      : null
  
  // 👇 ON GARDE ÇA
  const floorMode: "floor" | "section" =
    (env === "garage") ? "section" : "floor"
  
  const missionFloors = mission?.floors ?? []

  // Filter muted device IDs
  const mutedIds = new Set(missionDevices.filter(d => d.muted).map(d => d.id))

  // Build sensor placements for map (exclude muted)
  // If devices are currently assigned, use live data; otherwise reconstruct from events
  const livePlacements = missionDevices
    .filter((d) => d.zone_id && d.side && !mutedIds.has(d.id))
    .map((d) => ({
      device_id: d.id,
      device_name: d.name,
      zone_id: d.zone_id!,
      side: d.side!,
      sensor_position: Number(d.sensor_position) || 0.5,
      device_type: d.type ?? "",
      orientation: (d.orientation as "inward" | "outward") ?? "inward",
    }))
  // Reconstruct placements from historical events (preserves positions at time of recording)
  // Falls back to mission.device_placements (persisted at assignment time) for old events
  const savedPlacements = mission?.device_placements ?? {}
  const historicalPlacements = (() => {
    if (!events || events.length === 0) return []
    const seen = new Map<string, (typeof livePlacements)[0]>()
    for (const e of events) {
      const did = e.device_id ?? ""
      if (!did || seen.has(did)) continue
      // Fallback: use mission-level saved placement for zone_id/side/sensor_position/orientation
      const saved = savedPlacements[did]
      const zoneId = e.zone_id || saved?.zone_id
      const side = e.side || saved?.side
      if (!zoneId || !side) continue
      seen.set(did, {
        device_id: did,
        device_name: e.device_name ?? saved?.device_name ?? did,
        zone_id: zoneId,
        side: side,
        sensor_position: e.sensor_position ?? saved?.sensor_position ?? 0.5,
        device_type: "",
        orientation: (e.orientation ?? saved?.orientation ?? "inward") as "inward" | "outward",
      })
    }
    // Also add devices from saved placements that have no events (assigned but no detection yet)
    for (const [did, p] of Object.entries(savedPlacements)) {
      if (!seen.has(did) && p.zone_id && p.side) {
        seen.set(did, {
          device_id: did,
          device_name: p.device_name ?? did,
          zone_id: p.zone_id,
          side: p.side,
          sensor_position: p.sensor_position ?? 0.5,
          device_type: "",
          orientation: (p.orientation as "inward" | "outward") ?? "inward",
        })
      }
    }
    return Array.from(seen.values())
  })()
  // Use live placements for live mode; for timelapse, prefer historical (preserves original TX positions)
  const sensorPlacements = timelapseMode && historicalPlacements.length > 0
    ? historicalPlacements
    : (livePlacements.length > 0 ? livePlacements : historicalPlacements)

  // Map detections: ONLY from SSE (real-time). Never from DB -- DB events are history.
  // Filter out muted devices from zone-level AND device-level aggregation
  const filteredLiveByZone = Object.fromEntries(
    Object.entries(liveByZone).filter(([, det]) => !mutedIds.has(det.device_id))
  )
  const filteredLiveByDevice = Object.fromEntries(
    Object.entries(liveByDevice).filter(([devId]) => !mutedIds.has(devId))
  )
  const effectiveLiveByZone: Record<string, LiveDetection> = timelapseMode
  ? { ...replayDetections }
  : { ...filteredLiveByZone }
  // Detection Feed: combine DB events (persisted) + SSE live detections (this session).
  // DB events populate the feed on page load so it doesn't appear empty after navigation.
  const dbDetections: LiveDetection[] = (events ?? []).map((e: DetectionEvent) => {
    const p = (typeof e.payload === "object" && e.payload) ? e.payload : {}
    return {
      device_id: e.device_id ?? "",
      device_name: e.device_name ?? "",
      tx_id: (p.tx_id as string) ?? "",
      mission_id: e.mission_id ?? "",
      zone_id: e.zone_id ?? "",
      zone_label: e.zone_label ?? "",
      side: e.side ?? "",
      rssi: e.rssi ?? -120,
      distance: Number(p.distance ?? 0),
      speed: Number(p.speed ?? 0),
      angle: Number(p.angle ?? 0),
      presence: true,
      direction: (p.direction as string) ?? "C",
      vbatt_tx: p.vbatt_tx != null ? Number(p.vbatt_tx) : null,
      sensor_type: (p.sensor_type as string) ?? undefined,
      timestamp: e.timestamp ?? "",
    }
  })
  // Merge: SSE events first (newest), then DB events not already in SSE list
  // Filter out detections from muted devices
  const mutedDeviceIds = new Set(missionDevices.filter(d => d.muted).map(d => d.id))
  const sseTimestamps = new Set(liveDetections.map(d => d.timestamp))
  const displayDetections: LiveDetection[] = [
    ...liveDetections,
    ...dbDetections.filter(d => !sseTimestamps.has(d.timestamp)),
  ].filter(d => !mutedDeviceIds.has(d.device_id))
   .filter(d => feedDeviceFilter === "all" || d.device_id === feedDeviceFilter)
   .slice(0, 50)

  return (
    <>
      <TopHeader title={mission.name} description={mission.description} />
      <main className="flex-1 overflow-auto p-4" style={{ touchAction: "manipulation" }}>
        {errorMsg && (
          <div className="mb-3 flex items-center justify-between rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <span>{errorMsg}</span>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-destructive" onClick={() => setErrorMsg(null)}>X</Button>
          </div>
        )}
        <div className="flex flex-col gap-4">
          {/* Breadcrumb + tab triggers */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground active:text-foreground min-h-[44px] min-w-[44px]">
                <Link href="/missions"><ArrowLeft className="mr-1.5 h-4 w-4" />Missions</Link>
              </Button>
              <Button
                variant={soundEnabled ? "secondary" : "ghost"}
                size="sm"
                className={cn(
                  "min-h-[44px] min-w-[44px]",
                  soundEnabled ? "text-primary" : "text-muted-foreground"
                )}
                onClick={toggleSound}
                title={soundEnabled ? "Desactiver le son des detections" : "Activer le son des detections"}
              >
                {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>
              <Button
                variant={showNotifConfig ? "secondary" : "ghost"}
                size="sm"
                className="min-h-[44px] min-w-[44px] text-muted-foreground"
                onClick={() => setShowNotifConfig(v => !v)}
                title="Configurer les notifications push"
              >
                <Bell className="h-4 w-4" />
              </Button>
            </div>
            <Tabs value={activeTab} onValueChange={(val) => {
              setActiveTab(val)
              const entering = val === "timelapse"
              setTimelapseMode(entering)
              if (!entering) setReplayDetections({})
              if (val !== "history") setHeatmapMode(false)
            }}>
              <TabsList className="h-9 w-full">
                <TabsTrigger value="live" className="text-xs gap-1 px-2 min-h-[36px] flex-1">
                  <Zap className="h-3.5 w-3.5" /><span className="hidden sm:inline">Live</span>
                </TabsTrigger>
                <TabsTrigger value="history" className="text-xs gap-1 px-2 min-h-[36px] flex-1">
                  <BarChart3 className="h-3.5 w-3.5" /><span className="hidden sm:inline">History</span>
                </TabsTrigger>
                <TabsTrigger value="sensors" className="text-xs gap-1 px-2 min-h-[36px] flex-1">
                  <Radio className="h-3.5 w-3.5" /><span className="hidden sm:inline">Sensors</span>
                </TabsTrigger>
                <TabsTrigger value="timelapse" className="text-xs gap-1 px-2 min-h-[36px] flex-1">
                  <Timer className="h-3.5 w-3.5" /><span className="hidden sm:inline">Timelapse</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Notification config panel (collapsible) */}
          {showNotifConfig && mission && (
            <NotificationConfig
              missionId={mission.id}
              missionName={mission.name}
              zones={(mission.zones || []).map((z: { id: string; label?: string; name?: string }) => ({ id: z.id, label: z.label || z.name || z.id }))}
              initialConfig={mission.notification_config}
              onSaved={() => mutate()}
            />
          )}

          {/* Mission info bar */}
          <Card className="border-border/50 bg-card py-3">
            <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4">
              <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusCfg.className)}>
                {statusCfg.label}
              </Badge>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {env === "plan" ? <FileImage className="h-3 w-3" /> : env === "etages" || env === "vertical" ? <Building2 className="h-3 w-3" /> : env === "garage" ? <Building2 className="h-3 w-3" /> : <Home className="h-3 w-3" />}
                {env === "plan" ? "Sur Plan" : env === "habitation" || env === "horizontal" ? "Habitation" : env === "garage" ? "Garage / Souterrain" : env === "etages" || env === "vertical" ? "Etages" : env}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />{mission.location || "No location"}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Radio className="h-3 w-3" />{missionDevices.length} TX
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <BarChart3 className="h-3 w-3" />{Math.max(eventList.length, mission.event_count ?? 0)} events
              </span>
              {mission.status === "active" && (
                <span className="flex items-center gap-1 text-xs text-red-500 font-mono">
                  <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />REC
                </span>
              )}
              {mission.status === "paused" && (
                <span className="flex items-center gap-1 text-xs text-orange-400 font-mono">
                  <Pause className="h-3 w-3" />PAUSED
                </span>
              )}
              {liveDetections.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-success font-mono">
                  <Activity className="h-3 w-3 animate-pulse" />LIVE
                </span>
              )}
              <div className="flex items-center gap-1.5 ml-auto">
                {mission.status === "draft" && (isFloorMode ? missionFloors.length > 0 : (isPlanMode ? !!planImageUrl : zones.length > 0)) && (
                  <Button size="sm" className="h-7 text-[10px] gap-1" onClick={() => changeStatus("active")} disabled={statusUpdating}>
                    <Play className="h-3 w-3" />Activate
                  </Button>
                )}
                {mission.status === "active" && (
                  <>
                    <Button variant="outline" size="sm" className="min-h-[36px] text-[10px] gap-1 px-3" onClick={() => changeStatus("paused")} disabled={statusUpdating}>
                      <Pause className="h-3.5 w-3.5" />Pause
                    </Button>
                    <Button variant="outline" size="sm" className="min-h-[36px] text-[10px] gap-1 px-3" onClick={() => changeStatus("completed")} disabled={statusUpdating}>
                      <CheckCircle className="h-3.5 w-3.5" />Complete
                    </Button>
                  </>
                )}
                {mission.status === "paused" && (
                  <Button size="sm" className="min-h-[36px] text-[10px] gap-1 px-3" onClick={() => changeStatus("active")} disabled={statusUpdating}>
                    <Play className="h-3.5 w-3.5" />Resume
                  </Button>
                )}
                {mission.started_at && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="h-3 w-3" />{formatRelative(mission.started_at)}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Map / FloorManager + Sidebar */}
          {fullMapMode ? (
            /* ── FULLSCREEN VISUALIZER MODE ── */
            <div className="flex flex-col gap-3">
              {/* Compact header bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {sensorPlacements.length > 0 && (
                    <Button
                      variant={showFov ? "default" : "outline"}
                      size="sm"
                      className="min-h-[36px] text-[10px] px-2.5 gap-1"
                      onClick={() => setShowFov(!showFov)}
                    >
                      {showFov ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      FOV
                    </Button>
                  )}
                  {!isPlanMode && !isFloorMode && (missionDevices.length >= 2 || (timelapseMode && sensorPlacements.length >= 2)) && (
                    <Button
                      variant={estimatePosition ? "default" : "outline"}
                      size="sm"
                      className="min-h-[36px] text-[10px] px-2.5 gap-1"
                      onClick={() => setEstimatePosition(!estimatePosition)}
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                      Position
                    </Button>
                  )}
                  {liveDetections.length > 0 && (
                    <span className="text-[9px] font-mono text-success animate-pulse ml-1">LIVE</span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[36px] text-[10px] px-2.5 gap-1"
                  onClick={() => setFullMapMode(false)}
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                  Reduire
                </Button>
              </div>

          {/* Sensor placement banner */}
          {sensorPlaceMode && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-3 py-2 mb-2">
              <p className="text-xs text-cyan-300">
                Cliquer sur une facade pour placer <span className="font-semibold">{sensorPlaceMode.deviceName}</span>
              </p>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-cyan-400" onClick={() => setSensorPlaceMode(null)}>Annuler</Button>
            </div>
          )}
          {isPlanMode ? (
            /* Fullscreen PlanEditor */
            <PlanEditor
              imageUrl={planImageUrl}
              imageWidth={mission?.plan_width ?? undefined}
              imageHeight={mission?.plan_height ?? undefined}
              zones={zones}
              sensorPlacements={sensorPlacements}
              liveByDevice={filteredLiveByDevice}
              drawingMode={drawingMode}
              sensorPlaceMode={sensorPlaceMode}
              onZoneCreated={handlePolygonDrawn}
              onSensorPlace={(zoneId, side, t) => {
                handleSensorPlace(zoneId, side, t)
              }}
              onZonePolygonUpdate={updateZonePolygon}
  showFov={showFov}
  calibrationMode={calibrationMode}
  onCalibrationDone={handleCalibrationDone}
  planScale={mission?.plan_scale ?? null}
  visualConfig={visualConfig}
  className="rounded-lg overflow-hidden border border-border/50 h-[calc(100vh-310px)]"
            />
          ) : (
          /* Full-height map */
          <ErrorBoundary>
          <MissionMap
            key={`full-${mission.id}`}
                  centerLat={mission.center_lat}
                  centerLon={mission.center_lon}
                  zoom={mission.zoom ?? 19}
                  zones={zones}
                  events={eventList}
                  liveDetections={effectiveLiveByZone}
                  liveByDevice={filteredLiveByDevice}
                  sensorPlacements={sensorPlacements}
                  heatmapMode={heatmapMode}
                  estimatePosition={estimatePosition}
                  className="h-[calc(100vh-310px)]"
                  drawingMode={false}
                  onPolygonDrawn={() => {}}
                  onZoneClick={() => {}}
                  sensorPlaceMode={false}
                  onSensorPlace={() => {}}
                  onMapMove={handleMapMove}
                  editingZoneId={null}
                  editingPolygon={null}
                  onZonePolygonUpdate={() => {}}
                  showFov={showFov}
                  replayMode={false}
                  visualConfig={visualConfig}
                />
              </ErrorBoundary>
          )}

              {/* Compact TX summary bar */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {missionDevices.filter(d => !d.muted).map((d) => {
                  const det = liveByDevice[d.id]
                  const hasPresence = det?.presence && det?.distance > 0
                  const vbatt = det?.vbatt_tx ?? d.battery
                  const rssi = det?.rssi ?? d.rssi
                  return (
                    <div
                      key={d.id}
                      className={cn(
                        "flex items-center gap-3 rounded-md border px-3 py-2 transition-colors",
                        hasPresence
                          ? "border-warning/50 bg-warning/5"
                          : "border-border/50 bg-card"
                      )}
                    >
                      <div className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        hasPresence ? "bg-warning animate-pulse"
                        : det ? "bg-success" : "bg-muted-foreground/30"
                      )} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-foreground font-mono">{d.dev_eui || d.name}</span>
                          {d.zone_label && (
                            <span className="text-[9px] text-muted-foreground truncate">{d.zone_label} [{d.side}]</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {hasPresence ? (
                            <span className="text-[10px] font-mono text-warning font-semibold">
                              {det!.sensor_type === "gravity_mw" 
                                ? "PRESENCE"
                                : `${det!.distance}cm ${det!.direction}`
                              }
                            </span>
                          ) : det ? (
                            <span className="text-[9px] font-mono text-success">RAS</span>
                          ) : (
                            <span className="text-[9px] font-mono text-muted-foreground/50">--</span>
                          )}
                          {rssi != null && (
                            <span className="text-[9px] font-mono text-muted-foreground flex items-center gap-0.5">
                              <Signal className="h-2.5 w-2.5" />{rssi}dBm
                            </span>
                          )}
                          {vbatt != null && vbatt > 0 && (
                            <span className="text-[9px] font-mono text-muted-foreground flex items-center gap-0.5">
                              <Battery className="h-2.5 w-2.5" />{Number(vbatt).toFixed(2)}V
                            </span>
                          )}
                        </div>
                      </div>
                      {det?.timestamp && (
                        <span className="text-[8px] font-mono text-muted-foreground shrink-0">
                          {formatTime(det.timestamp)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              {isFloorMode ? (
                /* ── Etages / Garage: mini-map + FloorManager ── */
                <div className="flex flex-col gap-3">
                  {/* Static mini-map for location context (no Leaflet) */}
                  <StaticMiniMap
                    lat={mission.center_lat}
                    lon={mission.center_lon}
                    zoom={Math.min(mission.zoom ?? 17, 17)}
                    label={mission.name}
                    className="h-[160px]"
                  />

                  <Card className="border-border/50 bg-card">
                    <CardContent className="p-4">
                      <FloorManager
                        missionId={id}
                        mode={floorMode}
                        floors={missionFloors}
                        devices={missionDevices}
                        allDevices={allDevices ?? []}
                        events={eventList}
                        liveDetections={timelapseMode
                          ? Object.values(replayDetections).map((d: Record<string, unknown>) => ({
                              presence: true,
                              distance: Number(d.distance ?? 0),
                              direction: String(d.direction ?? "C"),
                              device_name: String(d.device_name ?? ""),
                              device_id: String(d.device_id ?? ""),
                              side: String(d.side ?? ""),
                              rssi: d.rssi != null ? Number(d.rssi) : null,
                              timestamp: String(d.timestamp ?? ""),
                              angle: Number(d.angle ?? 0),
                              speed: Number(d.speed ?? 0),
                              floor: d.floor != null ? Number(d.floor) : null,
                              zone_label: String(d.zone_label ?? ""),
                              sensor_type: String(d.sensor_type ?? "ld2450"),
                            }))
                          : liveDetections
                        }
                        onFloorsChange={handleFloorsChange}
                        onDeviceAssign={handleFloorDeviceAssign}
                        onDeviceUnassign={handleFloorDeviceUnassign}
                        onResetDetections={async () => {
                          setLiveDetections([])
                          setLiveByZone({})
                          setLiveByDevice({})
                          setReplayDetections({})
                          // Persist reset timestamp so events stay hidden on reload
                          try {
                            await fetch(`/api/missions/${id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ detection_reset_at: (() => { const d = new Date(); const pad = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; })() }),
                            })
                            mutate()
                          } catch {}
                        }}
                      />
                    </CardContent>
                  </Card>

                  {/* Timelapse panel for floor mode */}
                  {timelapseMode && (
                    <div className="space-y-2">
                      <DetectionTimelapse
                        missionId={id}
                        onDetection={handleReplayDetection}
                      />
                    </div>
                  )}
                </div>
              ) : isPlanMode ? (
                /* ── Plan mode: PlanEditor ── */
                <div className="flex flex-col gap-3">
                  {/* Static mini-map for location context */}
                  <StaticMiniMap
                    lat={mission.center_lat}
                    lon={mission.center_lon}
                    zoom={Math.min(mission.zoom ?? 17, 17)}
                    label={mission.name}
                    className="h-[140px]"
                  />
                  {/* Sensor placement banner */}
                  {sensorPlaceMode && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-3 py-2">
                      <p className="text-xs text-cyan-300">
                        Cliquer sur une facade pour placer <span className="font-semibold">{sensorPlaceMode.deviceName}</span>
                      </p>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-cyan-400" onClick={() => setSensorPlaceMode(null)}>Annuler</Button>
                    </div>
                  )}
                  {/* Upload / re-upload / delete plan image */}
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    <p className="text-xs text-amber-300">
                      {mission?.plan_image ? "Remplacer ou supprimer le plan" : "Aucun plan importe pour cette mission"}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <label className="cursor-pointer">
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            try {
                              const backendBase = typeof window !== "undefined" ? `http://${window.location.hostname}:8000` : ""
                              const _t = localStorage.getItem("theia_token")
                              const res = await fetch(`${backendBase}/api/missions/${id}/plan-image`, {
                                method: "POST",
                                credentials: "include",
                                headers: {
                                  "Content-Type": file.type || "application/octet-stream",
                                  "X-Filename": file.name,
                                  ...(_t ? { Authorization: `Bearer ${_t}` } : {}),
                                },
                                body: file,
                              })
                              if (res.ok) { setPlanDeleted(false); setPlanImageTs(Date.now()); mutate() }
                              else { const t = await res.text(); alert(`Erreur upload: ${t}`) }
                            } catch (err) {
                              console.error("Upload error:", err)
                              alert("Erreur upload: " + (err instanceof Error ? err.message : "inconnue"))
                            }
                          }}
                        />
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                          <FileImage className="h-3 w-3" />
                          {mission?.plan_image ? "Remplacer" : "Importer"}
                        </span>
                      </label>
                      {mission?.plan_image && (
                        <button
                          className="inline-flex items-center gap-1 rounded-md bg-destructive/20 border border-destructive/30 px-2.5 py-1.5 text-[10px] text-destructive hover:bg-destructive/30 transition-colors cursor-pointer"
                          onClick={async () => {
                            if (!confirm("Supprimer le plan de cette mission ?")) return
                            try {
                              setPlanDeleted(true)          // ✅ bloque PlanEditor tout de suite
                              setPlanImageTs(Date.now())    // bust cache
                              // optimistic: mission.plan_image -> false immédiatement
                              mutate({ ...mission, plan_image: false }, false)
                            
                              const backendBase = typeof window !== "undefined"
                                ? `http://${window.location.hostname}:8000`
                                : ""
                              const _t = localStorage.getItem("theia_token")
                            
                              const res = await fetch(`${backendBase}/api/missions/${id}/plan-image`, {
                                method: "DELETE",
                                credentials: "include",
                                headers: _t ? { Authorization: `Bearer ${_t}` } : {},
                              })
                              if (!res.ok) throw new Error(await res.text())
                            
                              // revalidate mission proprement
                              mutate()
                            } catch (err) {
                              console.error("Delete plan error:", err)
                              setPlanDeleted(false) // rollback UI
                              mutate()              // resync
                              alert("Erreur suppression: " + (err instanceof Error ? err.message : "inconnue"))
                            }
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                          Supprimer
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="relative">
                    <Button
                      variant="outline"
                      size="sm"
                      className="absolute top-2 right-2 z-[1000] min-h-[32px] text-[10px] px-2 gap-1 bg-background/80 backdrop-blur-sm"
                      onClick={() => setFullMapMode(true)}
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </Button>
                    <PlanEditor
                      imageUrl={planImageUrl}
                      imageWidth={mission?.plan_width ?? undefined}
                      imageHeight={mission?.plan_height ?? undefined}
                      zones={zones}
                      sensorPlacements={sensorPlacements}
                      liveByDevice={timelapseMode
                        ? Object.fromEntries(
                            Object.entries(replayDetections)
                              .map(([key, det]) => [det.device_id || key, det])
                          )
                        : filteredLiveByDevice
                      }
                      drawingMode={drawingMode}
                      sensorPlaceMode={sensorPlaceMode}
                      onZoneCreated={handlePolygonDrawn}
                      onSensorPlace={(zoneId, side, t) => {
                        handleSensorPlace(zoneId, side, t)
                      }}
                      onZonePolygonUpdate={updateZonePolygon}
                      showFov={showFov}
                      calibrationMode={calibrationMode}
                      onCalibrationDone={handleCalibrationDone}
                      planScale={mission?.plan_scale ?? null}
                      visualConfig={visualConfig}
                      className="rounded-lg overflow-hidden border border-border/50"
                    />
                  </div>
                  {/* Timelapse panel for plan mode */}
                  {timelapseMode && (
                    <div className="space-y-2">
                      <DetectionTimelapse
                        missionId={id}
                        onDetection={handleReplayDetection}
                      />
                    </div>
                  )}
                </div>
              ) : (
                /* ── Horizontal: Map ── */
            <>
          {/* Sensor placement banner (normal map) */}
          {sensorPlaceMode && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-3 py-2 mb-2">
              <p className="text-xs text-cyan-300">
                Cliquer sur une facade pour placer <span className="font-semibold">{sensorPlaceMode.deviceName}</span>
              </p>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-cyan-400" onClick={() => setSensorPlaceMode(null)}>Annuler</Button>
            </div>
          )}
          <div className="relative">
          <Button
            variant="outline"
            size="sm"
            className="absolute top-2 right-2 z-[1000] min-h-[32px] text-[10px] px-2 gap-1 bg-background/80 backdrop-blur-sm"
            onClick={() => setFullMapMode(true)}
          >
          <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <ErrorBoundary>
          <MissionMap
            key={mission.id}
                      centerLat={mission.center_lat}
                      centerLon={mission.center_lon}
                      zoom={mission.zoom ?? 19}
                      zones={zones}
                      events={eventList}
  liveDetections={effectiveLiveByZone}
                  liveByDevice={timelapseMode
                    ? Object.fromEntries(
                        Object.entries(replayDetections)
                          .map(([key, det]) => [det.device_id || key.split("::")[1] || key, det])
                      )
                    : filteredLiveByDevice
                  }
  sensorPlacements={sensorPlacements}
  heatmapMode={heatmapMode}
  estimatePosition={estimatePosition}
  className="h-[55vh] sm:h-[500px]"
                      drawingMode={drawingMode}
                      onPolygonDrawn={handlePolygonDrawn}
                      onZoneClick={(zoneId) => !sensorPlaceMode && setAssignDialog(zoneId)}
                      sensorPlaceMode={sensorPlaceMode}
                      onSensorPlace={handleSensorPlace}
                      onMapMove={handleMapMove}
                      editingZoneId={editingZoneId}
                      editingPolygon={editingPolygon}
                      onZonePolygonUpdate={updateZonePolygon}
                      showFov={showFov}
                      replayMode={timelapseMode}
                      visualConfig={visualConfig}
                    />
                  </ErrorBoundary>
                  </div>

                  {/* Timelapse panel */}
                  {timelapseMode && (
                    <div className="mt-3 space-y-2">
                      {/* FOV/Position toggles for timelapse replay */}
                      <div className="flex items-center gap-2">
                        {sensorPlacements.length > 0 && (
                          <Button
                            variant={showFov ? "default" : "outline"}
                            size="sm"
                            className="min-h-[36px] text-[10px] px-2.5 gap-1"
                            onClick={() => setShowFov(!showFov)}
                          >
                            {showFov ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            FOV
                          </Button>
                        )}
                  {!isFloorMode && (missionDevices.length >= 2 || (timelapseMode && sensorPlacements.length >= 2)) && (
                  <Button
                    variant={estimatePosition ? "default" : "outline"}
                    size="sm"
                    className="min-h-[36px] text-[10px] px-2.5 gap-1"
                    onClick={() => setEstimatePosition(!estimatePosition)}
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                    Position
                  </Button>
                  )}
                  </div>
                      <DetectionTimelapse
                        missionId={id}
                        onDetection={handleReplayDetection}
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-col gap-3">
              {/* Zones panel -- for horizontal/map and plan missions */}
              {(!isFloorMode) && (
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs">Zones ({zones.length})</CardTitle>
                    <div className="flex items-center gap-1">
                      {isPlanMode && (
                        <Button
                          variant={calibrationMode ? "default" : "outline"} size="sm"
                          className="min-h-[44px] text-xs px-3 gap-1.5"
                          onClick={() => { setCalibrationMode(!calibrationMode); setDrawingMode(false) }}
                        >
                          <Ruler className="h-3.5 w-3.5" />
                          {calibrationMode ? "Calibration..." : "Calibrer"}
                        </Button>
                      )}
                      <Button
                        variant={drawingMode ? "default" : "outline"} size="sm"
                        className="min-h-[44px] text-xs px-3 gap-1.5"
                        onClick={() => { setDrawingMode(!drawingMode); setCalibrationMode(false) }}
                      >
                        {drawingMode
                          ? <><Pencil className="h-3.5 w-3.5 animate-pulse" />Drawing...</>
                          : <><Plus className="h-3.5 w-3.5" />Draw Zone</>}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {/* Calibration status (plan mode only) */}
                  {isPlanMode && (
                    <div className="flex items-center gap-2 text-[10px]">
                      <Ruler className="h-3 w-3 text-muted-foreground shrink-0" />
                      {mission?.plan_scale ? (
                        <span className="text-success">
                          Echelle: {mission.plan_scale.toFixed(1)} px/m ({(100 / mission.plan_scale).toFixed(2)} m/100px)
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Non calibre -- utilisez le bouton Calibrer</span>
                      )}
                    </div>
                  )}
                  {zones.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 text-center">
                      Cliquez &quot;Draw Zone&quot; puis placez les points un par un sur la carte.
                      Minimum 3 points. Toute forme est possible (L, T, etc.)
                    </p>
                  ) : zones.map((zone) => {
                    const zoneDetRaw = effectiveLiveByZone[zone.id]
                    // Only treat as active if presence + valid distance
                    const zoneDetection = (zoneDetRaw?.presence && zoneDetRaw?.distance > 0) ? zoneDetRaw : null
                    return (
                      <div
                        key={zone.id}
                        className={cn(
                          "flex items-center gap-2 rounded border p-2 transition-colors group",
                          zoneDetection
                            ? "border-warning/50 bg-warning/5"
                            : "border-border/50 hover:bg-muted/30"
                        )}
                      >
                        <div className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: zone.color }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{zone.label}</p>
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-[10px] text-muted-foreground">{zone.type}</span>
                            {zone.polygon?.length >= 3 && (() => {
                              // Show grouped facade letters from bearing analysis (A, B, C, D)
                              const { labels: gl } = groupSidesByBearing(zone.polygon)
                              const faces = Object.keys(gl).sort()
                              return <span className="text-[9px] font-mono text-primary">[{faces.join(" ")}]</span>
                            })()}
                          </div>
                          {/* Fixed-height detection row to prevent layout shift */}
                          <div className="h-4 flex items-center gap-2 mt-0.5">
                            {zoneDetection ? (
                              <>
                                {zoneDetection.presence ? (
                                  <span className="text-[9px] font-mono text-warning font-semibold flex items-center gap-0.5">
                                    <Eye className="h-2.5 w-2.5" />
                                    {zoneDetection.sensor_type === "gravity_mw" 
                                      ? "PRESENCE"
                                      : `${zoneDetection.distance}cm ${zoneDetection.direction}`
                                    }
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-mono text-success flex items-center gap-0.5">
                                    <EyeOff className="h-2.5 w-2.5" />RAS
                                  </span>
                                )}
                                {zoneDetection.rssi != null && (
                                  <span className="text-[9px] font-mono text-muted-foreground">
                                    {zoneDetection.rssi}dBm
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-[9px] font-mono text-muted-foreground/50">--</span>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground font-mono">{missionDevices.filter(d => d.zone_id === zone.id).length} TX</span>
                        <div className="flex items-center shrink-0">
                          <button onClick={() => openEditZone(zone.id)}
                            className="text-muted-foreground hover:text-foreground active:text-foreground transition-colors p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                            title="Edit zone name & sides"><MapPin className="h-4 w-4" /></button>
                          <button onClick={() => editingZoneId === zone.id ? stopEditingZone() : startEditingZone(zone.id)}
                            className={cn("transition-colors p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer", editingZoneId === zone.id ? "text-warning" : "text-muted-foreground hover:text-foreground active:text-foreground")}
                            title="Edit zone polygon"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => setAssignDialog(zone.id)}
                            className="text-primary hover:text-primary/80 active:text-primary/70 transition-colors p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                            title="Assign device"><Plus className="h-4 w-4" /></button>
                          <button onClick={() => deleteZone(zone.id)}
                            className="text-destructive hover:text-destructive/80 active:text-destructive/70 transition-colors p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                            title="Delete zone"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
              )}

              {/* Assigned devices */}
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs">Assigned Devices ({missionDevices.length})</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1.5">
                  {missionDevices.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">
                      Click a zone or the + button to assign TX devices
                    </p>
                  ) : missionDevices.map((d) => {
                    // Only show this device's own detection -- no zone-level fallback
                    // (zone fallback would show another device's data when this one is offline)
                    const detRaw = liveByDevice[d.id]
                    const det = (detRaw?.presence && detRaw?.distance > 0) ? detRaw : null
                    const isMuted = !!(d.muted)
                    // Live RSSI/battery from SSE, fallback to DB values
                    const liveData = liveByDevice[d.id]
                    const rssiVal = liveData?.rssi ?? d.rssi
                    const battVal = liveData?.vbatt_tx ?? d.battery
                    // Compute distance along wall
                    const zone = mission?.zones?.find(z => z.id === d.zone_id)
                    const wallDist = zone && d.side ? getSideDistanceM(zone.polygon, d.side, d.sensor_position ?? 0.5, groupSidesByBearing) : ""
                    // Status color
                    const statusColor = d.status === "online" ? "text-success" : d.status === "idle" ? "text-warning" : "text-muted-foreground"
                    return (
                      <div key={d.id} className={cn("flex flex-col gap-1 text-xs rounded-md px-1 py-1.5 transition-opacity", isMuted && "opacity-40")}>
                        {/* Row 1: info */}
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={cn("h-2 w-2 rounded-full shrink-0", d.status === "online" ? "bg-emerald-500" : d.status === "idle" ? "bg-amber-500" : "bg-muted-foreground/30")} title={d.status ?? "unknown"} />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-1">
                              <span className={cn("font-mono text-foreground", isMuted && "line-through")}>{d.name}</span>
                              <span className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {{ microwave_tx: "LD2450", tx_microwave: "LD2450", c4001: "C4001", gravity_mw: "MW V2" }[d.type ?? ""] ?? "TX"}
                              </span>
                              {det && (
                                <span className={cn("text-[9px] font-mono font-semibold", det.presence ? "text-warning" : "text-success")}>
                                  {det.presence 
                                    ? (det.sensor_type === "gravity_mw" ? "PRESENCE" : `${det.distance}cm`)
                                    : "RAS"
                                  }
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0 text-[10px] text-muted-foreground">
                              <span>
                                {d.zone_label || (d.floor != null ? `Etage ${d.floor}` : "---")}
                                {d.side && <span className="text-primary ml-0.5">[{d.side}]</span>}
                                {wallDist && <span className="ml-0.5">{wallDist}</span>}
                              </span>
                              {rssiVal != null && rssiVal !== 0 && (
                                <span className={cn("font-mono", (rssiVal as number) >= -70 ? "text-emerald-500" : (rssiVal as number) >= -85 ? "text-amber-500" : "text-red-500")}>
                                  {Math.round(rssiVal as number)}dBm
                                </span>
                              )}
                              {battVal != null && (battVal as number) > 0 && (
                                <span className="font-mono">
                                  {(battVal as number).toFixed(2)}V
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* Row 2: action buttons -- wraps on narrow screens */}
                        <div className="flex items-center gap-1 pl-4">
                          {/* Orientation toggle */}
                          <button
                            onClick={async (e) => {
                              e.stopPropagation()
                              const newOrientation = (d.orientation ?? "inward") === "inward" ? "outward" : "inward"
                              await updateDevice(d.id, { orientation: newOrientation })
                              mutateDevices()
                              mutate()
                            }}
                            className={cn(
                              "shrink-0 p-1 min-h-[36px] min-w-[36px] flex items-center justify-center rounded transition-colors cursor-pointer",
                              (d.orientation ?? "inward") === "inward"
                                ? "text-primary hover:bg-primary/10"
                                : "text-orange-400 hover:bg-orange-400/10"
                            )}
                            title={`Detection: ${(d.orientation ?? "inward") === "inward" ? "interieur" : "exterieur"}`}
                          >
                            {(d.orientation ?? "inward") === "inward" ? (
                              <ArrowDownLeft className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {/* Mute toggle */}
                          <button
                            onClick={async (e) => {
                              e.stopPropagation()
                              await updateDevice(d.id, { muted: !isMuted })
                              mutateDevices()
                              mutate()
                            }}
                            className={cn(
                              "shrink-0 p-1 min-h-[36px] min-w-[36px] flex items-center justify-center rounded transition-colors cursor-pointer",
                              isMuted ? "text-amber-500 hover:bg-amber-500/10" : "text-muted-foreground/40 hover:bg-muted"
                            )}
                            title={isMuted ? "Reactiver les detections" : "Mettre en sourdine"}
                          >
                            {isMuted ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
                          </button>
                          {/* Move to different facade */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSensorPlaceMode({
                                zoneId: d.zone_id!,
                                side: d.side!,
                                deviceId: d.id,
                                deviceName: d.name,
                              })
                            }}
                            className="text-primary/60 hover:text-primary active:text-primary transition-colors shrink-0 p-1 min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
                            title="Deplacer sur une autre facade"
                        >
                          <MapPin className="h-3.5 w-3.5" />
                        </button>
                          {/* Unassign */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              unassignDevice(d.id)
                            }}
                            className="text-destructive/60 hover:text-destructive active:text-destructive transition-colors shrink-0 p-1 min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
                            title="Retirer de la mission"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>

              {/* Live detection feed -- only visible on Live tab */}
              {activeTab === "live" && (
                <Card className="border-border/50 bg-card flex-1">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs flex items-center gap-1.5">
                        <Zap className="h-3 w-3 text-warning" />
                        Detection Feed
                      </CardTitle>
                      <div className="flex items-center gap-2 flex-wrap">
                        {missionDevices.length > 1 && (
                          <select
                            value={feedDeviceFilter}
                            onChange={e => setFeedDeviceFilter(e.target.value)}
                            className="h-7 rounded border border-border bg-background px-1.5 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="all">Tous ({missionDevices.length})</option>
                            {missionDevices.map(d => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        )}
                        {sensorPlacements.length > 0 && (
                          <Button
                            variant={showFov ? "default" : "outline"}
                            size="sm"
                            className="min-h-[36px] text-[10px] px-2.5 gap-1"
                            onClick={() => setShowFov(!showFov)}
                            title="Afficher couverture theorique des capteurs"
                          >
                            {showFov ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            FOV
                          </Button>
                        )}
                        {!isFloorMode && (missionDevices.length >= 2 || (timelapseMode && sensorPlacements.length >= 2)) && (
                          <Button
                            variant={estimatePosition ? "default" : "outline"}
                            size="sm"
                            className="min-h-[36px] text-[10px] px-2.5 gap-1"
                            onClick={() => setEstimatePosition(!estimatePosition)}
                            title="Estimate position from multiple sensors"
                          >
                            <Crosshair className="h-3.5 w-3.5" />
                            Position
                          </Button>
                        )}
                        {/* Visual config popover (only for map/plan modes, not floor/parking) */}
                        {!isFloorMode && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant={hasMissionOverrides ? "default" : "outline"}
                                size="sm"
                                className="min-h-[36px] text-[10px] px-2.5 gap-1"
                                title="Apparence visuelle"
                              >
                                <Palette className="h-3.5 w-3.5" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-80 max-h-[70vh] overflow-y-auto p-3">
                              <VisualConfigPopover
                                raw={visualRaw}
                                updateConfig={updateVisualConfig}
                                resetAll={resetVisualConfig}
                                hasMissionOverrides={hasMissionOverrides}
                              />
                            </PopoverContent>
                          </Popover>
                        )}
                        {liveDetections.length > 0 && (
                          <span className="text-[9px] font-mono text-success animate-pulse">LIVE</span>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent ref={feedRef} className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                    {displayDetections.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2 text-center">No detections yet</p>
                    ) : displayDetections.map((det, i) => {
                      // Check if this presence-only detection is triangulated with a distance-based detection
                      const isTriangulated = det.sensor_type === "gravity_mw" && det.presence && displayDetections.some((other, j) => {
                        if (i === j || other.sensor_type === "gravity_mw" || !other.presence || other.distance <= 0) return false
                        const detTs = new Date(det.timestamp).getTime()
                        const otherTs = new Date(other.timestamp).getTime()
                        return Math.abs(detTs - otherTs) <= 1000 // Within 1 second
                      })
                      return (
                      <div
                        key={`det-${det.timestamp}-${i}`}
                        className={cn(
                          "flex items-start gap-2 rounded border p-2 transition-all",
                          det.presence
                            ? "border-warning/30 bg-warning/5"
                            : "border-border/30 bg-transparent"
                        )}
                      >
                        <div className={cn(
                          "mt-0.5 h-2 w-2 rounded-full shrink-0",
                          det.presence ? "bg-warning animate-pulse" : "bg-success"
                        )} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-semibold text-foreground">
                              {det.zone_label || det.device_name || "Unknown"}
                            </span>
                            {det.side && (
                              <span className="text-[9px] font-mono font-bold text-primary">
                                [{det.side}]
                              </span>
                            )}
                            <span className="text-[9px] text-muted-foreground font-mono ml-auto shrink-0">
                              {formatTime(det.timestamp)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {det.presence ? (
                              <Badge variant="outline" className="text-[8px] px-1 py-0 border-warning/30 bg-warning/10 text-warning">
                                PRESENCE
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[8px] px-1 py-0 border-success/30 bg-success/10 text-success">
                                RAS
                              </Badge>
                            )}
                            {isTriangulated && (
                              <Badge variant="outline" className="text-[8px] px-1 py-0 border-primary/50 bg-primary/10 text-primary">
                                TRIANGULE
                              </Badge>
                            )}
                            <span className="text-[9px] font-mono text-muted-foreground">
                              {det.sensor_type === "gravity_mw" 
                                ? (det.distance === 1 ? "Presence" : "---")
                                : `${det.distance}cm`
                              }
                            </span>
                            {det.speed > 0 && (
                              <span className="text-[9px] font-mono text-muted-foreground">
                                {det.speed}cm/s
                              </span>
                            )}
                            <span className="text-[9px] font-mono text-muted-foreground">
                              {det.direction === "G" ? "Gauche" : det.direction === "D" ? "Droite" : "Centre"}
                            </span>
                            {det.rssi != null && (
                              <span className="text-[9px] font-mono text-muted-foreground">
                                {det.rssi}dBm
                              </span>
                            )}
                            {det.vbatt_tx != null && (
                              <span className="text-[9px] font-mono text-muted-foreground">
                                {det.vbatt_tx.toFixed(2)}V
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] text-muted-foreground/60">{det.device_name}</span>
                        </div>
                      </div>
                    )})}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
          )}

          {/* ── Inline History Panel (below map) ── */}
          {activeTab === "history" && (
            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Events ({eventList.length})</CardTitle>
                  <div className="flex items-center gap-2">
                  {!isFloorMode && (
                  <Button
                    variant={heatmapMode ? "default" : "outline"} size="sm"
                    disabled={eventList.length === 0}
                    onClick={() => setHeatmapMode(!heatmapMode)}
                  >
                    <Flame className="mr-1.5 h-3.5 w-3.5" />Heatmap
                  </Button>
                  )}
                  <Button
                    variant="destructive" size="sm"
                    disabled={eventList.length === 0}
                    onClick={async () => {
                      if (!confirm("Purger tous les events de cette mission ?")) return
                      // Call both proxy and backend directly to ensure deletion
                      const backendUrl = window.location.protocol + "//" + window.location.hostname + ":8000"
                      const _t = localStorage.getItem("theia_token")
                      const _ah = _t ? { Authorization: `Bearer ${_t}` } : {}
                      await Promise.allSettled([
                        fetch(`/api/events?mission_id=${id}`, { method: "DELETE", credentials: "include", headers: _ah }),
                        fetch(`${backendUrl}/api/events?mission_id=${id}`, { method: "DELETE", credentials: "include", headers: _ah }),
                      ])
                      // Clear SWR cache, do NOT revalidate (backend may insert stale events)
                      await mutateEvents([], false)
                    }}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />Purger
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={eventList.length === 0}
                    onClick={() => {
                      const csv = [
                        "timestamp,type,device,zone,rssi,snr,payload",
                        ...eventList.map((e) =>
                          [e.timestamp, e.type, e.device_name, e.zone_label ?? "", e.rssi ?? "", e.snr ?? "", JSON.stringify(e.payload)].join(",")
                        ),
                      ].join("\n")
                      const blob = new Blob([csv], { type: "text/csv" })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement("a")
                      a.href = url
                      a.download = `${mission.name}-history.csv`
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />Export CSV
                  </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Zone statistics + distance distribution when heatmap is active */}
                {heatmapMode && eventList.length > 0 && (() => {
                  const BANDS = [20, 40, 60, 80, 100, 150, 250, 600]
                  const BAND_LABELS = ["0-20", "20-40", "40-60", "60-80", "80-100", "100-150", "150-250", "250+"]
                  const zoneStats: Record<string, { count: number; totalDist: number; devices: Set<string>; label: string; bands: number[]; dirG: number; dirC: number; dirD: number }> = {}
                  for (const evt of eventList) {
                    // Use zone_id if available, otherwise fallback to zone_label or device_id (for floor mode)
                    const zId = evt.zone_id || evt.zone_label || evt.device_id
                    if (!zId) continue
                    const p = evt.payload ?? {}
                    const dist = Number(p.distance ?? 0)
                    const angle = Number(p.angle ?? 0)
                    const dirPos = angle < -15 ? "G" : angle > 15 ? "D" : "C"
                    if (!zoneStats[zId]) zoneStats[zId] = { count: 0, totalDist: 0, devices: new Set(), label: evt.zone_label || evt.device_name || zId, bands: BANDS.map(() => 0), dirG: 0, dirC: 0, dirD: 0 }
                    zoneStats[zId].count++
                    zoneStats[zId].totalDist += dist
                    if (dirPos === "G") zoneStats[zId].dirG++
                    else if (dirPos === "D") zoneStats[zId].dirD++
                    else zoneStats[zId].dirC++
                    if (evt.device_id) zoneStats[zId].devices.add(evt.device_id)
                    for (let i = 0; i < BANDS.length; i++) {
                      if (dist <= BANDS[i]) { zoneStats[zId].bands[i]++; break }
                    }
                  }
                  const sorted = Object.entries(zoneStats).sort((a, b) => b[1].count - a[1].count)
                  return (
                    <div className="mb-4 space-y-3">
                      {sorted.map(([zId, s]) => {
                        const maxBand = Math.max(1, ...s.bands)
                        return (
                          <div key={zId} className="rounded-lg border border-border/50 bg-card p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold text-foreground">{s.label}</span>
                              <span className="font-mono text-sm font-bold text-foreground">{s.count} det.</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground mb-2">
                              {Math.round(s.totalDist / s.count)}cm avg | {s.devices.size} TX
                            </div>
                            {/* Direction distribution (G / C / D) */}
                            {(s.dirG > 0 || s.dirD > 0) && (
                              <div className="mb-2">
                                <div className="flex items-center gap-1 mb-1">
                                  <span className="text-[8px] text-muted-foreground">Position:</span>
                                  <span className="text-[9px] font-mono text-blue-400">G:{s.dirG}</span>
                                  <span className="text-[9px] font-mono text-success">C:{s.dirC}</span>
                                  <span className="text-[9px] font-mono text-orange-400">D:{s.dirD}</span>
                                </div>
                                <div className="flex h-1.5 gap-px rounded-sm overflow-hidden">
                                  {s.dirG > 0 && <div className="bg-blue-400 rounded-sm" style={{ flex: s.dirG }} />}
                                  {s.dirC > 0 && <div className="bg-success rounded-sm" style={{ flex: s.dirC }} />}
                                  {s.dirD > 0 && <div className="bg-orange-400 rounded-sm" style={{ flex: s.dirD }} />}
                                </div>
                              </div>
                            )}
                            {/* Distance distribution bar chart */}
                            <div className="flex items-end gap-0.5 h-10">
                              {s.bands.map((cnt, i) => {
                                if (cnt === 0 && maxBand > 1) return <div key={i} className="flex-1 flex flex-col items-center" />
                                const h = Math.max(4, (cnt / maxBand) * 100)
                                const t = cnt / maxBand
                                const color = t < 0.33 ? "#22c55e" : t < 0.66 ? "#eab308" : "#ef4444"
                                return (
                                  <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5">
                                    {cnt > 0 && <span className="text-[8px] text-muted-foreground font-mono">{cnt}</span>}
                                    <div
                                      className="w-full rounded-t-sm"
                                      style={{ height: `${h}%`, backgroundColor: color, opacity: 0.8, minHeight: cnt > 0 ? 3 : 0 }}
                                    />
                                  </div>
                                )
                              })}
                            </div>
                            <div className="flex gap-0.5 mt-0.5">
                              {BAND_LABELS.map((lbl, i) => (
                                <div key={i} className="flex-1 text-center text-[7px] text-muted-foreground/60">{lbl}</div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
                {eventList.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No events recorded for this mission. Press REC and walk past the sensors.</p>
                ) : (
                  <div className="max-h-[500px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50">
                          <TableHead className="text-[10px]">Time</TableHead>
                          <TableHead className="text-[10px]">Type</TableHead>
                          <TableHead className="text-[10px]">Device</TableHead>
                          <TableHead className="text-[10px]">Zone</TableHead>
                          <TableHead className="text-[10px]">Distance</TableHead>
                          <TableHead className="text-[10px]">Direction</TableHead>
                          <TableHead className="text-[10px]">Speed</TableHead>
                          <TableHead className="text-[10px]">RSSI</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {eventList.map((evt) => {
                          const p = evt.payload ?? {}
                          const dir = String(p.direction ?? "C")
                          return (
                            <TableRow key={evt.id} className="border-border/30">
                              <TableCell className="font-mono text-[11px] text-muted-foreground">{formatDateTime(evt.timestamp)}</TableCell>
                              <TableCell className="font-mono text-[10px] text-muted-foreground">{evt.type ?? "detection"}</TableCell>
                              <TableCell className="font-mono text-xs text-foreground">{evt.device_name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{evt.zone_label ?? "---"}</TableCell>
                              <TableCell className="font-mono text-[11px] text-foreground">
                                {p.sensor_type === "gravity_mw" 
                                  ? (p.distance === 1 ? "Presence" : "---")
                                  : (p.distance ? `${p.distance}cm` : "---")
                                }
                              </TableCell>
                              <TableCell className="font-mono text-[11px] text-foreground">
                                {dir === "G" ? "Gauche" : dir === "D" ? "Droite" : "Centre"}
                              </TableCell>
                              <TableCell className="font-mono text-[11px] text-muted-foreground">{Number(p.speed) > 0 ? `${p.speed}cm/s` : "---"}</TableCell>
                              <TableCell className="font-mono text-[11px] text-foreground">{evt.rssi !== null ? `${evt.rssi}dBm` : "---"}</TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Inline Sensors Panel (below map) ── */}
          {activeTab === "sensors" && (
            <div className="flex flex-col gap-4">
              {/* Assigned Devices */}
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Radio className="h-4 w-4 text-primary" />
                    Assigned Devices ({missionDevices.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {missionDevices.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">No devices assigned to this mission yet</p>
                  ) : (
                    <div className="overflow-x-auto -mx-4 px-4">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50">
                          <TableHead className="text-[10px]">Name</TableHead>
                          <TableHead className="text-[10px]">TX ID</TableHead>
                          <TableHead className="text-[10px]">Status</TableHead>
                          <TableHead className="text-[10px]">Zone / Side</TableHead>
                          <TableHead className="text-[10px]">RSSI</TableHead>
                          <TableHead className="text-[10px]">Battery</TableHead>
                          <TableHead className="text-[10px]">Last Seen</TableHead>
                          <TableHead className="text-[10px]">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {missionDevices.map((device) => {
                          const sCfg = deviceStatusConfig[device.status] ?? deviceStatusConfig.unknown
                          return (
                            <TableRow key={device.id} className="border-border/30">
                              <TableCell className="font-mono text-xs font-medium text-foreground">{device.name}</TableCell>
                              <TableCell className="font-mono text-[11px] text-muted-foreground">{device.dev_eui || device.hw_id || "---"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={cn("text-[9px] px-1 py-0", sCfg.className)}>
                                  <span className={cn("mr-1 h-1.5 w-1.5 rounded-full inline-block", sCfg.dot)} />
                                  {sCfg.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {device.zone_label || device.floor != null ? (
                                  <span>{device.zone_label || `Etage ${device.floor}`}{device.side && <span className="ml-1 text-primary font-mono">[{device.side}]</span>}</span>
                                ) : "---"}
                              </TableCell>
                              <TableCell>
                                {device.rssi !== null ? (
                                  <span className={cn("font-mono text-xs", device.rssi >= -70 ? "text-success" : device.rssi >= -85 ? "text-warning" : "text-destructive")}>
                                    {device.rssi} dBm
                                  </span>
                                ) : <span className="text-xs text-muted-foreground">---</span>}
                              </TableCell>
                              <TableCell>
                                {device.battery !== null ? (
                                  <div className="flex items-center gap-1">
                                    <Battery className={cn("h-3 w-3", device.battery > 50 ? "text-success" : device.battery > 20 ? "text-warning" : "text-destructive")} />
                                    <span className="font-mono text-xs text-foreground">{device.battery}%</span>
                                  </div>
                                ) : <span className="text-xs text-muted-foreground">---</span>}
                              </TableCell>
                              <TableCell className="text-[11px] text-muted-foreground">{device.last_seen ? formatRelative(device.last_seen) : "Never"}</TableCell>
                              <TableCell>
                                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-destructive hover:text-destructive/80" onClick={() => unassignDevice(device.id)}>
                                  <Unlink className="mr-1 h-3 w-3" />Remove
                                </Button>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Available Devices */}
              {allDevices && allDevices.filter(d => d.enabled && d.mission_id !== id).length > 0 && (
                <Card className="border-border/50 bg-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Wifi className="h-4 w-4 text-muted-foreground" />
                      Available Devices ({allDevices.filter(d => d.enabled && d.mission_id !== id).length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50">
                          <TableHead className="text-[10px]">Name</TableHead>
                          <TableHead className="text-[10px]">TX ID</TableHead>
                          <TableHead className="text-[10px]">Type</TableHead>
                          <TableHead className="text-[10px]">Status</TableHead>
                          <TableHead className="text-[10px]">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {allDevices.filter(d => d.enabled && d.mission_id !== id).map((device) => {
                          const sCfg = deviceStatusConfig[device.status] ?? deviceStatusConfig.unknown
                          const isElsewhere = !!device.mission_id
                          return (
                            <TableRow key={device.id} className="border-border/30">
                              <TableCell className="font-mono text-xs font-medium text-foreground">{device.name}</TableCell>
                              <TableCell className="font-mono text-[11px] text-muted-foreground">{device.dev_eui || device.hw_id || "---"}</TableCell>
                              <TableCell className="text-[11px] text-muted-foreground">
                                {device.type || "TX"}
                                {isElsewhere && <Badge variant="outline" className="ml-1 text-[8px] px-1 py-0 text-warning border-warning/30">other mission</Badge>}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={cn("text-[9px] px-1 py-0", sCfg.className)}>{sCfg.label}</Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={async () => {
                                    await updateDevice(device.id, {
                                      mission_id: id,
                                      zone_id: "",
                                      zone_label: "",
                                      side: "",
                                      sensor_position: 0.5,
                                    } as Partial<import("@/lib/types").Device>)
                                    mutate()
                                    mutateDevices()
                                    setTimeout(() => mutateDevices(), 2000)
                                  }}>
                                    <Signal className="mr-1 h-3 w-3" />{isElsewhere ? "Reassign" : "Assign"}
                                  </Button>
                                  {isElsewhere && (
                                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-destructive hover:text-destructive/80" onClick={() => unassignDevice(device.id)}>
                                      <Unlink className="mr-1 h-3 w-3" />Remove
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Zone creation dialog */}
      <Dialog open={zoneDialog} onOpenChange={setZoneDialog}>
        <DialogContent className="sm:max-w-md z-[10000]">
          <DialogHeader>
            <DialogTitle className="text-sm">New Zone</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Name and classify the drawn zone. It will appear on the map.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="zone-name" className="text-xs text-muted-foreground">Zone Name</Label>
              <Input
                id="zone-name"
                name="zone-name"
                placeholder="e.g. Facade Nord"
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
                className="bg-input/50 border-border text-sm"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-muted-foreground">Zone Type</Label>
              <Select value={zoneType} onValueChange={setZoneType}>
                <SelectTrigger className="bg-input/50 border-border text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="z-[10001]" position="popper" sideOffset={4}>
                  {ZONE_TYPES.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {pendingPolygon && pendingPolygon.length >= 2 && (
              <div className="flex flex-col gap-3">
                <Label className="text-xs text-muted-foreground">
                  Faces ({Object.keys(sideLabels).length} faces - {pendingPolygon.length} segments)
                </Label>
                <div className="flex flex-col gap-2">
                  {Object.keys(sideLabels).map((groupKey) => {
                    // Find which polygon segments belong to this group
                    const segmentIndices = sideGrouping
                      .map((g, i) => g === groupKey ? i : -1)
                      .filter(i => i >= 0)
                    const segmentLetters = segmentIndices.map(i => String.fromCharCode(65 + i))
                    return (
                      <div key={groupKey} className="flex items-center gap-2">
                        <div className="flex flex-col items-center shrink-0 w-10">
                          <span className="text-xs font-mono font-bold text-cyan-600">{groupKey}</span>
                          <span className="text-[9px] text-muted-foreground font-mono">
                            {segmentLetters.length > 1
                              ? segmentLetters.join(",")
                              : `seg ${segmentLetters[0]}`}
                          </span>
                        </div>
                        <Input
                          id={`side-label-${groupKey}`}
                          name={`side-label-${groupKey}`}
                          placeholder={`Face ${groupKey}${segmentLetters.length > 1 ? ` (${segmentLetters.join("+")} parallels)` : ""}`}
                          value={sideLabels[groupKey]}
                          onChange={(e) => setSideLabels((prev) => ({ ...prev, [groupKey]: e.target.value }))}
                          className="bg-input/50 border-border text-xs h-9"
                        />
                      </div>
                    )
                  })}
                </div>
                <p className="text-[9px] text-muted-foreground">
                  Les segments paralleles sont regroupes automatiquement sous la meme face.
                </p>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground font-mono">
              {pendingPolygon?.length ?? 0} points - {Object.keys(sideLabels).length} faces - {Object.values(sideLabels).filter(Boolean).length} labeled
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setZoneDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={saveZone} disabled={!zoneName.trim()}>Save Zone</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Zone edit dialog */}
      <Dialog open={!!editZoneDialog} onOpenChange={() => setEditZoneDialog(null)}>
        <DialogContent className="sm:max-w-md z-[10000]">
          <DialogHeader>
            <DialogTitle className="text-sm">Edit Zone</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Modify zone name, type, and facade/side labels.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-zone-name" className="text-xs text-muted-foreground">Zone Name</Label>
              <Input
                id="edit-zone-name"
                name="edit-zone-name"
                placeholder="e.g. Facade Nord"
                value={editZoneName}
                onChange={(e) => setEditZoneName(e.target.value)}
                className="bg-input/50 border-border text-sm"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-muted-foreground">Zone Type</Label>
<Select value={editZoneType} onValueChange={setEditZoneType}>
  <SelectTrigger className="bg-input/50 border-border text-sm"><SelectValue /></SelectTrigger>
  <SelectContent className="z-[10001]" position="popper" sideOffset={4}>
  {ZONE_TYPES.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}
  </SelectContent>
  </Select>
            </div>
            {Object.keys(editSideLabels).length > 0 && (
              <div className="flex flex-col gap-3">
                <Label className="text-xs text-muted-foreground">
                  Faces ({Object.keys(editSideLabels).length} faces)
                </Label>
                <p className="text-[9px] text-muted-foreground">
                  Les segments paralleles sont regroupes par face automatiquement.
                </p>
                <div className="flex flex-col gap-2">
                  {Object.keys(editSideLabels).sort().map((groupKey) => {
                    const segmentIndices = sideGrouping
                      .map((g, i) => g === groupKey ? i : -1)
                      .filter(i => i >= 0)
                    const segmentLetters = segmentIndices.map(i => String.fromCharCode(65 + i))
                    return (
                      <div key={groupKey} className="flex items-center gap-2">
                        <div className="flex flex-col items-center shrink-0 w-10">
                          <span className="text-xs font-mono font-bold text-cyan-600">{groupKey}</span>
                          <span className="text-[9px] text-muted-foreground font-mono">
                            {segmentLetters.length > 1 ? segmentLetters.join(",") : `seg ${segmentLetters[0] ?? groupKey}`}
                          </span>
                        </div>
                        <Input
                          id={`edit-side-label-${groupKey}`}
                          name={`edit-side-label-${groupKey}`}
                          placeholder={`Face ${groupKey}${segmentLetters.length > 1 ? ` (${segmentLetters.join("+")} parallel)` : ""}`}
                          value={editSideLabels[groupKey]}
                          onChange={(e) => setEditSideLabels((prev) => ({ ...prev, [groupKey]: e.target.value }))}
                          className="bg-input/50 border-border text-xs h-9"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditZoneDialog(null)}>Cancel</Button>
            <Button size="sm" onClick={saveEditZone} disabled={!editZoneName.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Device assignment dialog */}
      <Dialog open={!!assignDialog} onOpenChange={() => { setAssignDialog(null); setAssignStep(null) }}>
        <DialogContent className="sm:max-w-md z-[10000]">
          {!assignStep ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm">
                  Assign TX to {zones.find((z) => z.id === assignDialog)?.label ?? "Zone"}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Select an unassigned device to place on this zone.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2 py-2 max-h-64 overflow-y-auto">
                {unassigned.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">No unassigned devices available</p>
                ) : unassigned.map((device) => {
                  const assignZone = zones.find((z) => z.id === assignDialog)
                  const hasSides = assignZone?.sides && Object.values(assignZone.sides).some(Boolean)
                  const isElsewhere = device.mission_id && device.mission_id !== id
                  const isGravityMW = device.type === "gravity_mw"
                  return (
                    <button
                      key={device.id}
                      onClick={() => {
                        // For gravity_mw without sides, go directly to config step
                        if (isGravityMW && !hasSides) {
                          setAssignStep({ 
                            deviceId: device.id, 
                            deviceName: device.name,
                            deviceType: device.type,
                            side: "", // Set side to empty string to skip side selection
                            gravityConfig: { effectiveRange: 12, effectiveFov: 72 },
                          })
                        } else if (hasSides || isGravityMW) {
                          // Has sides to choose, or is gravity_mw with sides
                          setAssignStep({ 
                            deviceId: device.id, 
                            deviceName: device.name,
                            deviceType: device.type,
                            gravityConfig: isGravityMW ? { effectiveRange: 12, effectiveFov: 72 } : undefined,
                          })
                        } else if (assignDialog) {
                          assignDevice(device.id, assignDialog)
                        }
                      }}
                      className="flex items-center gap-3 rounded border border-border/50 p-3 text-left hover:bg-muted/30 transition-colors"
                    >
                      <Radio className="h-4 w-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono font-medium text-foreground">{device.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {device.dev_eui || device.serial_port || device.hw_id || "no port"}
                          {isElsewhere && (
                            <span className="text-warning ml-1">(other mission)</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {device.battery && (
                          <span className="text-[9px] text-muted-foreground font-mono">{device.battery}V</span>
                        )}
                        <Badge 
                          variant={device.status === "online" ? "default" : "outline"} 
                          className={cn("text-[9px] px-1 py-0", device.status === "online" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : device.status === "offline" ? "text-muted-foreground" : "")}
                        >
                          {device.status ?? "unknown"}
                        </Badge>
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          ) : assignStep.side === undefined ? (
            /* Step 2a: Pick which side (only if side is undefined, not empty string) */
            <>
              <DialogHeader>
                <DialogTitle className="text-sm">Side: {assignStep.deviceName}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Select which facade/side this TX covers.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2 py-2">
                {(() => {
                  const assignZone = zones.find((z) => z.id === assignDialog)
                  const sides = assignZone?.sides ?? {}
                  return Object.entries(sides).filter(([, label]) => Boolean(label)).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => {
                        // For gravity_mw, go to config step instead of sensor place mode
                        if (assignStep?.deviceType === "gravity_mw") {
                          // Update side and stay in dialog - this triggers the config step condition
                          setAssignStep({ 
                            ...assignStep, 
                            side: key,
                            gravityConfig: assignStep.gravityConfig ?? { effectiveRange: 12, effectiveFov: 72 }
                          })
                        } else {
                          // Store side and go to sensor placement mode
                          const zoneId = assignDialog!
                          setSensorPlaceMode({
                            zoneId,
                            side: key,
                            deviceId: assignStep!.deviceId,
                            deviceName: assignStep!.deviceName,
                          })
                          setAssignDialog(null)
                          setAssignStep(null)
                        }
                      }}
                      className="flex items-center gap-3 rounded border border-border/50 p-3 text-left hover:bg-muted/30 transition-colors"
                    >
                      <span className="text-sm font-mono font-bold text-cyan-500 w-6 text-center">{key}</span>
                      <span className="text-xs text-foreground">{label}</span>
                    </button>
                  ))
                })()}
                <button
                  onClick={() => {
                    if (assignStep?.deviceType === "gravity_mw") {
                      // For gravity_mw without side, go to config step
                      setAssignStep({ ...assignStep!, side: "" })
                    } else if (assignDialog) {
                      assignDevice(assignStep!.deviceId, assignDialog)
                    }
                  }}
                  className="flex items-center gap-3 rounded border border-dashed border-border/30 p-3 text-left hover:bg-muted/20 transition-colors"
                >
                  <span className="text-sm font-mono text-muted-foreground w-6 text-center">-</span>
                  <span className="text-xs text-muted-foreground">No specific side</span>
                </button>
              </div>
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setAssignStep(null)}>Back</Button>
              </DialogFooter>
            </>
          ) : assignStep?.deviceType === "gravity_mw" && assignStep.side !== undefined ? (
            /* Step 3: Gravity MW config */
            <>
              <DialogHeader>
                <DialogTitle className="text-sm">Configure Gravity MW: {assignStep.deviceName}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Adjust detection range and FOV based on environment (walls, materials).
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-4">
                {/* Effective Range */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium">Portee effective</label>
                    <span className="text-xs font-mono text-muted-foreground">{assignStep.gravityConfig?.effectiveRange ?? 12}m</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="12"
                    step="0.5"
                    value={assignStep.gravityConfig?.effectiveRange ?? 12}
                    onChange={(e) => setAssignStep({
                      ...assignStep,
                      gravityConfig: {
                        ...assignStep.gravityConfig!,
                        effectiveRange: parseFloat(e.target.value),
                      },
                    })}
                    className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <div className="flex justify-between text-[9px] text-muted-foreground">
                    <span>2m (parpaing)</span>
                    <span>6m (PVC)</span>
                    <span>12m (libre)</span>
                  </div>
                </div>
                {/* Effective FOV */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium">FOV effectif</label>
                    <span className="text-xs font-mono text-muted-foreground">{assignStep.gravityConfig?.effectiveFov ?? 72}°</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="72"
                    step="2"
                    value={assignStep.gravityConfig?.effectiveFov ?? 72}
                    onChange={(e) => setAssignStep({
                      ...assignStep,
                      gravityConfig: {
                        ...assignStep.gravityConfig!,
                        effectiveFov: parseFloat(e.target.value),
                      },
                    })}
                    className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <div className="flex justify-between text-[9px] text-muted-foreground">
                    <span>20° (bois epais)</span>
                    <span>50° (porte)</span>
                    <span>72° (libre)</span>
                  </div>
                </div>
                {/* Presets */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Presets</label>
                  <div className="flex flex-wrap gap-1">
                    {[
                      { label: "Libre", range: 12, fov: 72 },
                      { label: "PVC", range: 6, fov: 50 },
                      { label: "Porte bois", range: 8, fov: 45 },
                      { label: "Bois 5cm", range: 7, fov: 30 },
                      { label: "Parpaing", range: 3, fov: 72 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => setAssignStep({
                          ...assignStep,
                          gravityConfig: { effectiveRange: preset.range, effectiveFov: preset.fov },
                        })}
                        className="text-[10px] px-2 py-1 rounded border border-border/50 hover:bg-muted/50 transition-colors"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAssignStep({ ...assignStep, side: undefined })}>
                  Back
                </Button>
                <Button 
                  size="sm" 
                  onClick={() => {
                    if (assignDialog) {
                      assignDevice(
                        assignStep.deviceId, 
                        assignDialog, 
                        assignStep.side || undefined, 
                        undefined,
                        assignStep.gravityConfig
                      )
                    }
                  }}
                >
                  Assigner
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}


// ── Visual Config Popover (per-mission) ──────────────────────

const VC_COLOR_ROWS: { key: VisualConfigKey; label: string }[] = [
  { key: "zone_fill_color",      label: "Zone (remplissage)" },
  { key: "detection_dot_live",   label: "Detection (live)" },
  { key: "detection_dot_hold",   label: "Detection (maintien)" },
  { key: "detection_line_color", label: "Ligne detection" },
  { key: "fov_overlay_color",    label: "FOV capteur" },
  { key: "sensor_dot_idle",      label: "Capteur (inactif)" },
  { key: "estimated_pos_color",  label: "Position estimee" },
]

const VC_OPACITY_ROWS: { key: VisualConfigKey; label: string }[] = [
  { key: "zone_fill_opacity",    label: "Opacite zone" },
  { key: "zone_stroke_opacity",  label: "Contour zone" },
  { key: "fov_fill_opacity",     label: "Opacite FOV" },
]

function VisualConfigPopover({
  raw,
  updateConfig,
  resetAll,
  hasMissionOverrides,
}: {
  raw: Record<string, string>
  updateConfig: (key: VisualConfigKey, value: string) => void
  resetAll: () => void
  hasMissionOverrides: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">Apparence</p>
        <button
          onClick={resetAll}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          title={hasMissionOverrides ? "Revenir aux parametres globaux" : "Reinitialiser les valeurs par defaut"}
        >
          <RotateCw className="h-3 w-3" />
          {hasMissionOverrides ? "Global" : "Defaut"}
        </button>
      </div>

      {/* Colors */}
      <div className="grid grid-cols-1 gap-1.5">
        {VC_COLOR_ROWS.map(({ key, label }) => {
          const val = (raw[key] ?? VISUAL_DEFAULTS[key]) as string
          const isCustom = val !== VISUAL_DEFAULTS[key]
          return (
            <div key={key} className="flex items-center gap-2">
              <label className="relative cursor-pointer shrink-0">
                <span
                  className="block h-5 w-5 rounded border border-border/50"
                  style={{ backgroundColor: val }}
                />
                <input
                  type="color"
                  value={val}
                  onChange={(e) => updateConfig(key, e.target.value)}
                  onBlur={(e) => updateConfig(key, e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
              <span className="text-[10px] text-muted-foreground truncate flex-1">{label}</span>
              {isCustom && (
                <button
                  onClick={() => updateConfig(key, VISUAL_DEFAULTS[key])}
                  className="text-[9px] text-muted-foreground/60 hover:text-foreground transition-colors shrink-0"
                  title="Reinitialiser"
                >
                  <RotateCw className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Opacities */}
      <div className="flex flex-col gap-1.5 pt-1 border-t border-border/30">
        {VC_OPACITY_ROWS.map(({ key, label }) => {
          const val = parseFloat(raw[key] ?? VISUAL_DEFAULTS[key])
          const isCustom = (raw[key] ?? VISUAL_DEFAULTS[key]) !== VISUAL_DEFAULTS[key]
          return (
            <div key={key} className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(val * 100)}
                onChange={(e) => updateConfig(key, String(parseInt(e.target.value) / 100))}
                className="w-20 accent-primary h-1"
              />
              <span className="text-[10px] text-muted-foreground truncate flex-1">{label}</span>
              <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{Math.round(val * 100)}%</span>
              {isCustom && (
                <button
                  onClick={() => updateConfig(key, VISUAL_DEFAULTS[key])}
                  className="text-[9px] text-muted-foreground/60 hover:text-foreground transition-colors shrink-0"
                  title="Reinitialiser"
                >
                  <RotateCw className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* FOV toggle */}
      <div className="flex items-center justify-between pt-1 border-t border-border/30">
        <span className="text-[10px] text-muted-foreground">FOV visible par defaut</span>
        <Switch
          checked={(raw.fov_default_visible ?? VISUAL_DEFAULTS.fov_default_visible) === "true"}
          onCheckedChange={(v) => updateConfig("fov_default_visible", v ? "true" : "false")}
          className="scale-75"
        />
      </div>
    </div>
  )
}
