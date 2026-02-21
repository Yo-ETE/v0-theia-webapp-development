"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  ArrowLeft, Radio, MapPin, Clock, Users, BarChart3, Plus,
  Pencil, Play, Pause, CheckCircle, Trash2, Building2, Home,
  Activity, Eye, EyeOff, Zap, Timer, Download, Signal, Battery, Wifi, Unlink,
  Flame,
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
import { FloorManager } from "@/components/mission/floor-manager"
import { DetectionTimelapse } from "@/components/mission/detection-timelapse"
import { ErrorBoundary } from "@/components/error-boundary"
import { useMission, useEvents, useDevices } from "@/hooks/use-api"
import { useSSE } from "@/hooks/use-sse"
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

export default function MissionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: mission, isLoading, mutate } = useMission(id)
  const { data: events, mutate: mutateEvents } = useEvents({ mission_id: id, event_type: "detection", limit: 500 })
  const { data: allDevices, mutate: mutateDevices } = useDevices()

  const [drawingMode, setDrawingMode] = useState(false)
  const [zoneDialog, setZoneDialog] = useState(false)
  const [pendingPolygon, setPendingPolygon] = useState<[number, number][] | null>(null)
  const [zoneName, setZoneName] = useState("")
  const [zoneType, setZoneType] = useState<string>("facade")
  const [sideLabels, setSideLabels] = useState<Record<string, string>>({})
  const [editZoneDialog, setEditZoneDialog] = useState<string | null>(null) // zone id being edited
  const [editZoneName, setEditZoneName] = useState("")
  const [editZoneType, setEditZoneType] = useState<string>("facade")
  const [editSideLabels, setEditSideLabels] = useState<Record<string, string>>({})
  const [assignDialog, setAssignDialog] = useState<string | null>(null)
  const [assignStep, setAssignStep] = useState<{ deviceId: string; deviceName: string; side?: string } | null>(null)
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
  const [timelapseMode, setTimelapseMode] = useState(false)
  const [heatmapMode, setHeatmapMode] = useState(false)
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [replayDetections, setReplayDetections] = useState<Record<string, any>>({})

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleReplayDetection = useCallback((dets: Record<string, any>) => {
    setReplayDetections(dets)
  }, [])

  // ── Live SSE detections ──
  const [liveDetections, setLiveDetections] = useState<LiveDetection[]>([])
  const [liveByZone, setLiveByZone] = useState<Record<string, LiveDetection>>({})
  const feedRef = useRef<HTMLDivElement>(null)

  // SSE handler: accumulate live detections for this mission
  const handleSSE = useCallback((event: { type: string; data: Record<string, unknown> }) => {
    if (event.type !== "detection") return
    const d = event.data as unknown as LiveDetection
    if (d.mission_id !== id) return

    // Only add to feed if it's a real presence event
    if (d.presence && d.distance > 0) {
      setLiveDetections(prev => {
        const next = [d, ...prev]
        return next.slice(0, 50)
      })
    }

    // Always update liveByZone so map-inner sees the latest state
    // (including presence: false to trigger stale transition)
    if (d.zone_id) {
      setLiveByZone(prev => ({ ...prev, [d.zone_id!]: d }))
    }
  }, [id])

  useSSE(handleSSE)

  // ── Zone drawing ──
  const handlePolygonDrawn = useCallback((polygon: [number, number][]) => {
    setPendingPolygon(polygon)
    setZoneName("")
    setZoneType("facade")
    const labels: Record<string, string> = {}
    for (let i = 0; i < polygon.length; i++) {
      labels[String.fromCharCode(65 + i)] = ""
    }
    setSideLabels(labels)
    setZoneDialog(true)
    setDrawingMode(false)
  }, [])

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
      sides: sideLabels,
    }
    const updated = await updateMission(id, { zones: [...zones, newZone] })
    mutate(updated, false)
    setZoneDialog(false)
    setPendingPolygon(null)
  }, [mission, pendingPolygon, zoneName, zoneType, sideLabels, id, mutate])

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
  const assignDevice = useCallback(async (deviceId: string, zoneId: string, side?: string, sensorPos?: number) => {
    if (!mission) return
    const zone = (mission.zones ?? []).find((z) => z.id === zoneId)
    try {
      await updateDevice(deviceId, {
        mission_id: id,
        zone_id: zoneId,
        zone_label: zone?.label ?? "",
        side: side ?? "",
        sensor_position: sensorPos ?? 0.5,
      } as Partial<import("@/lib/types").Device>)
    } catch (err) {
      console.warn("[THEIA] Failed to update device during assign:", err)
    }
    const zones = (mission.zones ?? []).map((z) =>
      z.id === zoneId && !z.devices.includes(deviceId)
        ? { ...z, devices: [...z.devices, deviceId] }
        : z
    )
    try {
      const updated = await updateMission(id, { zones, device_count: (mission.device_count ?? 0) + 1 })
      mutate(updated, false)
    } catch (err) {
      console.warn("[THEIA] Failed to update mission during assign:", err)
    }
    mutateDevices()
    setAssignDialog(null)
    setAssignStep(null)
    setSensorPlaceMode(null)
  }, [mission, id, mutate, mutateDevices])

  // ── Handle click-to-place sensor on the map side ──
  const handleSensorPlace = useCallback((zoneId: string, side: string, position: number) => {
    if (!sensorPlaceMode) return
    assignDevice(sensorPlaceMode.deviceId, zoneId, side, position)
  }, [sensorPlaceMode, assignDevice])

  // ── Remove device from mission ──
  const unassignDevice = useCallback(async (deviceId: string) => {
    if (!mission) return

    // Optimistic: immediately remove from device list & zones in UI
    mutateDevices(
      (prev) => prev?.map((d) =>
        d.id === deviceId ? { ...d, mission_id: "", zone_id: "", zone_label: "", side: "" } : d
      ),
      false,
    )
    const updatedZones = (mission.zones ?? []).map((z) => ({
      ...z,
      devices: z.devices.filter((did) => did !== deviceId),
    }))
    mutate(
      { ...mission, zones: updatedZones, device_count: Math.max(0, (mission.device_count ?? 1) - 1) },
      false,
    )

    // Persist device unassignment
    try {
      await updateDevice(deviceId, {
        mission_id: "",
        zone_id: "",
        zone_label: "",
        side: "",
        sensor_position: 0.5,
      } as Partial<import("@/lib/types").Device>)
    } catch (err) {
      console.warn("[THEIA] Failed to update device:", err)
    }
    // Persist zone update
    try {
      await updateMission(id, { zones: updatedZones, device_count: Math.max(0, (mission.device_count ?? 1) - 1) })
    } catch (err) {
      console.warn("[THEIA] Failed to update mission zones:", err)
    }
    // Re-fetch both to sync
    mutate()
    mutateDevices()
  }, [mission, id, mutate, mutateDevices])

  // ── Zone polygon editing ──
  const updateZonePolygon = useCallback(async (zoneId: string, newPolygon: [number, number][]) => {
    if (!mission) return
    const updatedZones = (mission.zones ?? []).map((z) => {
      if (z.id !== zoneId) return z
      // Sync sides map: add keys for new points, keep existing labels
      const sides: Record<string, string> = { ...(z.sides ?? {}) }
      for (let i = 0; i < newPolygon.length; i++) {
        const key = String.fromCharCode(65 + i)
        if (!(key in sides)) sides[key] = ""
      }
      // Remove keys beyond polygon length
      for (const key of Object.keys(sides)) {
        if (key.charCodeAt(0) - 65 >= newPolygon.length) delete sides[key]
      }
      return { ...z, polygon: newPolygon, sides }
    })
    // Optimistic update
    mutate({ ...mission, zones: updatedZones }, false)
    try {
      await updateMission(id, { zones: updatedZones })
    } catch (err) {
      console.warn("[THEIA] Failed to update zone polygon:", err)
      mutate() // rollback
    }
  }, [mission, id, mutate])

  // ── Zone properties edit ──
  const openEditZone = useCallback((zoneId: string) => {
    const zone = (mission?.zones ?? []).find((z) => z.id === zoneId)
    if (!zone) return
    setEditZoneName(zone.label)
    setEditZoneType(zone.type)
    // Build side labels map with all sides (A, B, C, ...)
    const labels: Record<string, string> = {}
    for (let i = 0; i < zone.polygon.length; i++) {
      const key = String.fromCharCode(65 + i)
      labels[key] = zone.sides?.[key] || ""
    }
    setEditSideLabels(labels)
    setEditZoneDialog(zoneId)
  }, [mission])

  const saveEditZone = useCallback(async () => {
    if (!mission || !editZoneDialog || !editZoneName.trim()) return
    const zones = (mission.zones ?? []).map((z) =>
      z.id === editZoneDialog
        ? {
            ...z,
            label: editZoneName.trim(),
            name: editZoneName.trim().toLowerCase().replace(/\s+/g, "-"),
            type: editZoneType as Zone["type"],
            sides: editSideLabels,
          }
        : z
    )
    try {
      const updated = await updateMission(id, { zones })
      mutate(updated, false)
    } catch (err) {
      console.warn("[THEIA] Failed to update zone:", err)
    }
    setEditZoneDialog(null)
  }, [mission, editZoneDialog, editZoneName, editZoneType, editSideLabels, id, mutate])

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
      await updateDevice(deviceId, {
        mission_id: id,
        floor,
        zone_id: "",
        zone_label: "",
        side: "",
        sensor_position: 0.5,
      } as Partial<import("@/lib/types").Device>)
      mutateDevices()
    } catch (err) {
      console.warn("[THEIA] Failed to assign device to floor:", err)
    }
  }, [id, mutateDevices])

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
  const eventList = events ?? []
  const missionDevices = allDevices?.filter((d) => d.mission_id === id) ?? []
  // Devices available to assign: not currently assigned to THIS mission's zones
  const unassigned = allDevices?.filter((d) => {
    // Already assigned to this mission with a zone
    if (d.mission_id === id && d.zone_id) return false
    return true
  }) ?? []

  // ── Floor mode (etages / garage) ──
  const env = mission?.environment ?? "habitation"
  const isFloorMode = env === "vertical" || env === "etages" || env === "garage"
  const floorMode: "floor" | "section" = (env === "garage") ? "section" : "floor"
  const missionFloors = mission?.floors ?? []

  // Build sensor placements for map
  const sensorPlacements = missionDevices
    .filter((d) => d.zone_id && d.side)
    .map((d) => ({
      device_id: d.id,
      device_name: d.name,
      zone_id: d.zone_id!,
      side: d.side!,
      sensor_position: Number(d.sensor_position) || 0.5,
    }))

  // Map detections: ONLY from SSE (real-time). Never from DB -- DB events are history.
  const effectiveLiveByZone: Record<string, LiveDetection> = timelapseMode
    ? { ...replayDetections }
    : { ...liveByZone }

  // Detection Feed: ONLY SSE live detections from this session.
  // DB events are shown in the History panel, not here.
  const displayDetections: LiveDetection[] = liveDetections

  return (
    <>
      <TopHeader title={mission.name} description={mission.description} />
      <main className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          {/* Breadcrumb + tab triggers */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground">
              <Link href="/missions"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />Missions</Link>
            </Button>
            <Tabs value={activeTab} onValueChange={(val) => {
              setActiveTab(val)
              const entering = val === "timelapse"
              setTimelapseMode(entering)
              if (!entering) setReplayDetections({})
              if (val !== "history") setHeatmapMode(false)
            }}>
              <TabsList className="h-8">
                <TabsTrigger value="live" className="text-xs gap-1.5 px-3">
                  <Zap className="h-3 w-3" />Live
                </TabsTrigger>
                <TabsTrigger value="history" className="text-xs gap-1.5 px-3">
                  <BarChart3 className="h-3 w-3" />History
                </TabsTrigger>
                <TabsTrigger value="sensors" className="text-xs gap-1.5 px-3">
                  <Radio className="h-3 w-3" />Sensors
                </TabsTrigger>
                <TabsTrigger value="timelapse" className="text-xs gap-1.5 px-3">
                  <Timer className="h-3 w-3" />Timelapse
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Mission info bar */}
          <Card className="border-border/50 bg-card py-3">
            <CardContent className="flex flex-wrap items-center gap-3 px-4">
              <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusCfg.className)}>
                {statusCfg.label}
              </Badge>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {env === "etages" || env === "vertical" ? <Building2 className="h-3 w-3" /> : env === "garage" ? <Building2 className="h-3 w-3" /> : <Home className="h-3 w-3" />}
                {env === "habitation" || env === "horizontal" ? "Habitation" : env === "garage" ? "Garage / Souterrain" : env === "etages" || env === "vertical" ? "Etages" : env}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />{mission.location || "No location"}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3 w-3" />{missionDevices.length} devices
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <BarChart3 className="h-3 w-3" />{eventList.length} events
              </span>
              {liveDetections.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-success font-mono">
                  <Activity className="h-3 w-3 animate-pulse" />LIVE
                </span>
              )}
              <div className="flex items-center gap-1.5 ml-auto">
                {mission.status === "draft" && (isFloorMode ? missionFloors.length > 0 : zones.length > 0) && (
                  <Button size="sm" className="h-7 text-[10px] gap-1" onClick={() => changeStatus("active")} disabled={statusUpdating}>
                    <Play className="h-3 w-3" />Activate
                  </Button>
                )}
                {mission.status === "active" && (
                  <>
                    <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => changeStatus("paused")} disabled={statusUpdating}>
                      <Pause className="h-3 w-3" />Pause
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => changeStatus("completed")} disabled={statusUpdating}>
                      <CheckCircle className="h-3 w-3" />Complete
                    </Button>
                  </>
                )}
                {mission.status === "paused" && (
                  <Button size="sm" className="h-7 text-[10px] gap-1" onClick={() => changeStatus("active")} disabled={statusUpdating}>
                    <Play className="h-3 w-3" />Resume
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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              {isFloorMode ? (
                /* ── Vertical / Underground: FloorManager ── */
                <Card className="border-border/50 bg-card">
                  <CardContent className="p-4">
                    <FloorManager
                      missionId={id}
                      mode={floorMode}
                      floors={missionFloors}
                      devices={missionDevices}
                      allDevices={allDevices ?? []}
                      events={eventList}
                      liveDetections={liveDetections}
                      onFloorsChange={handleFloorsChange}
                      onDeviceAssign={handleFloorDeviceAssign}
                      onDeviceUnassign={handleFloorDeviceUnassign}
                    />
                  </CardContent>
                </Card>
              ) : (
                /* ── Horizontal: Map ── */
                <>
                  <ErrorBoundary>
                    <MissionMap
                      key={mission.id}
                      centerLat={mission.center_lat}
                      centerLon={mission.center_lon}
                      zoom={mission.zoom ?? 19}
                      zones={zones}
                      events={eventList}
                      liveDetections={effectiveLiveByZone}
                      sensorPlacements={sensorPlacements}
                      heatmapMode={heatmapMode}
                      className="h-[500px]"
                      drawingMode={drawingMode}
                      onPolygonDrawn={handlePolygonDrawn}
                      onZoneClick={(zoneId) => !sensorPlaceMode && setAssignDialog(zoneId)}
                      sensorPlaceMode={sensorPlaceMode}
                      onSensorPlace={handleSensorPlace}
                      onMapMove={handleMapMove}
                      editingZoneId={editingZoneId}
                      onZonePolygonUpdate={updateZonePolygon}
                    />
                  </ErrorBoundary>

                  {/* Timelapse panel */}
                  {timelapseMode && (
                    <div className="mt-3">
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
              {/* Zones panel -- only for horizontal/map missions */}
              {!isFloorMode && (
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs">Zones ({zones.length})</CardTitle>
                    <div className="flex items-center gap-1">
                      <Button
                        variant={drawingMode ? "default" : "outline"} size="sm"
                        className="h-6 text-[10px] px-2 gap-1"
                        onClick={() => setDrawingMode(!drawingMode)}
                      >
                        {drawingMode
                          ? <><Pencil className="h-3 w-3 animate-pulse" />Drawing...</>
                          : <><Plus className="h-3 w-3" />Draw Zone</>}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
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
                            {zone.sides && Object.entries(zone.sides).filter(([, v]) => v).length > 0 && (
                              <span className="text-[9px] font-mono text-primary">
                                [{Object.entries(zone.sides).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(" ")}]
                              </span>
                            )}
                          </div>
                          {zoneDetection && (
                            <div className="flex items-center gap-2 mt-0.5">
                              {zoneDetection.presence ? (
                                <span className="text-[9px] font-mono text-warning font-semibold flex items-center gap-0.5">
                                  <Eye className="h-2.5 w-2.5" />
                                  {zoneDetection.distance}cm {zoneDetection.direction}
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
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground font-mono">{zone.devices.length} TX</span>
                        <button onClick={() => openEditZone(zone.id)}
                          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                          title="Edit zone name & sides"><MapPin className="h-3 w-3" /></button>
                        <button onClick={() => setEditingZoneId(editingZoneId === zone.id ? null : zone.id)}
                          className={cn("text-[10px] transition-colors", editingZoneId === zone.id ? "text-warning opacity-100" : "text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100")}
                          title="Edit zone polygon"><Pencil className="h-3 w-3" /></button>
                        <button onClick={() => setAssignDialog(zone.id)}
                          className="text-[10px] text-primary hover:text-primary/80 transition-colors opacity-0 group-hover:opacity-100"
                          title="Assign device"><Plus className="h-3 w-3" /></button>
                        <button onClick={() => deleteZone(zone.id)}
                          className="text-[10px] text-destructive hover:text-destructive/80 transition-colors opacity-0 group-hover:opacity-100"
                          title="Delete zone"><Trash2 className="h-3 w-3" /></button>
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
                    const detRaw = effectiveLiveByZone[d.zone_id ?? ""]
                    const det = (detRaw?.presence && detRaw?.distance > 0) ? detRaw : null
                    return (
                      <div key={d.id} className="flex items-center gap-2 text-xs group">
                        <Radio className={cn("h-3 w-3 shrink-0", det ? "text-warning" : "text-primary")} />
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-foreground">{d.name}</span>
                          <span className="text-[10px] text-muted-foreground ml-1.5 truncate">
                            {d.zone_label || "---"}
                            {d.side && <span className="text-primary ml-0.5">[{d.side}]</span>}
                            {d.sensor_position != null && d.sensor_position !== 0.5 && (
                              <span className="text-muted-foreground/50 ml-0.5">@{Math.round((d.sensor_position ?? 0.5) * 100)}%</span>
                            )}
                          </span>
                        </div>
                        {det && (
                          <span className={cn("text-[9px] font-mono font-semibold shrink-0",
                            det.presence ? "text-warning" : "text-success")}>
                            {det.presence ? `${det.distance}cm` : "RAS"}
                          </span>
                        )}
                        <button
                          onClick={() => unassignDevice(d.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80 shrink-0"
                          title="Remove from mission"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
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
                      {liveDetections.length > 0 && (
                        <span className="text-[9px] font-mono text-success animate-pulse">LIVE</span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent ref={feedRef} className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                    {displayDetections.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2 text-center">No detections yet</p>
                    ) : displayDetections.map((det, i) => (
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
                              {det.zone_label || "Unknown"}
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
                            <span className="text-[9px] font-mono text-muted-foreground">
                              {det.distance}cm
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
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* ── Inline History Panel (below map) ── */}
          {activeTab === "history" && (
            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Events ({eventList.length})</CardTitle>
                  <div className="flex items-center gap-2">
                  <Button
                    variant={heatmapMode ? "default" : "outline"} size="sm"
                    disabled={eventList.length === 0}
                    onClick={() => setHeatmapMode(!heatmapMode)}
                  >
                    <Flame className="mr-1.5 h-3.5 w-3.5" />Heatmap
                  </Button>
                  <Button
                    variant="destructive" size="sm"
                    disabled={eventList.length === 0}
                    onClick={async () => {
                      if (!confirm("Purger tous les events de cette mission ?")) return
                      // Call both proxy and backend directly to ensure deletion
                      const backendUrl = window.location.protocol + "//" + window.location.hostname + ":8000"
                      await Promise.allSettled([
                        fetch(`/api/events?mission_id=${id}`, { method: "DELETE" }),
                        fetch(`${backendUrl}/api/events?mission_id=${id}`, { method: "DELETE" }),
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
                {eventList.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No events recorded for this mission</p>
                ) : (
                  <div className="max-h-[500px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50">
                          <TableHead className="text-[10px]">Time</TableHead>
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
                              <TableCell className="font-mono text-xs text-foreground">{evt.device_name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{evt.zone_label ?? "---"}</TableCell>
                              <TableCell className="font-mono text-[11px] text-foreground">{p.distance ? `${p.distance}cm` : "---"}</TableCell>
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
                                {device.zone_label ? (
                                  <span>{device.zone_label}{device.side && <span className="ml-1 text-primary font-mono">[{device.side}]</span>}</span>
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
                  )}
                </CardContent>
              </Card>

              {/* Available Devices */}
              {allDevices && allDevices.filter(d => d.mission_id !== id).length > 0 && (
                <Card className="border-border/50 bg-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Wifi className="h-4 w-4 text-muted-foreground" />
                      Available Devices ({allDevices.filter(d => d.mission_id !== id).length})
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
                        {allDevices.filter(d => d.mission_id !== id).map((device) => {
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
                                    // Clean device from any old assignment
                                    await updateDevice(device.id, {
                                      mission_id: id,
                                      zone_id: "",
                                      zone_label: "",
                                      side: "",
                                      sensor_position: 0.5,
                                    } as Partial<import("@/lib/types").Device>)
                                    const updated = await updateMission(id, { device_count: (mission.device_count ?? 0) + 1 })
                                    mutate(updated, false)
                                    mutateDevices()
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
              <Label className="text-xs text-muted-foreground">Zone Name</Label>
              <Input
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
                <SelectContent>
                  {ZONE_TYPES.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {pendingPolygon && pendingPolygon.length >= 2 && (
              <div className="flex flex-col gap-2">
                <Label className="text-xs text-muted-foreground">Side Labels ({pendingPolygon.length} sides)</Label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.keys(sideLabels).map((key) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-cyan-600 w-4 shrink-0">{key}</span>
                      <Input
                        placeholder={`Side ${key}`}
                        value={sideLabels[key]}
                        onChange={(e) => setSideLabels((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="bg-input/50 border-border text-xs h-7"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground font-mono">
              {pendingPolygon?.length ?? 0} points - {Object.values(sideLabels).filter(Boolean).length} sides labeled
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
              <Label className="text-xs text-muted-foreground">Zone Name</Label>
              <Input
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
                <SelectContent>
                  {ZONE_TYPES.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {Object.keys(editSideLabels).length > 0 && (
              <div className="flex flex-col gap-2">
                <Label className="text-xs text-muted-foreground">
                  Side / Facade Labels ({Object.keys(editSideLabels).length} sides)
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Nommez chaque cote du polygone (ex: Facade Nord, Mur Garage, Entree...).
                  Ces noms apparaissent sur la carte et dans les detections.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.keys(editSideLabels).sort().map((key) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-cyan-600 w-4 shrink-0">{key}</span>
                      <Input
                        placeholder={`Side ${key}`}
                        value={editSideLabels[key]}
                        onChange={(e) => setEditSideLabels((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="bg-input/50 border-border text-xs h-7"
                      />
                    </div>
                  ))}
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
                  return (
                    <button
                      key={device.id}
                      onClick={() => {
                        if (hasSides) setAssignStep({ deviceId: device.id, deviceName: device.name })
                        else if (assignDialog) assignDevice(device.id, assignDialog)
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
                        <Badge variant="outline" className="text-[9px] px-1 py-0">
                          {device.last_seen ? "online" : device.status ?? "unknown"}
                        </Badge>
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          ) : !assignStep.side ? (
            /* Step 2a: Pick which side */
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
                        // Close dialog and activate click-to-place mode on map
                        const zoneId = assignDialog!
                        setSensorPlaceMode({
                          zoneId,
                          side: key,
                          deviceId: assignStep.deviceId,
                          deviceName: assignStep.deviceName,
                        })
                        setAssignDialog(null)
                        setAssignStep(null)
                      }}
                      className="flex items-center gap-3 rounded border border-border/50 p-3 text-left hover:bg-muted/30 transition-colors"
                    >
                      <span className="text-sm font-mono font-bold text-cyan-500 w-6 text-center">{key}</span>
                      <span className="text-xs text-foreground">{label}</span>
                    </button>
                  ))
                })()}
                <button
                  onClick={() => assignDialog && assignDevice(assignStep.deviceId, assignDialog)}
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
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
