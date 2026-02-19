"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  ArrowLeft, Radio, MapPin, Clock, Users, BarChart3, Plus,
  Pencil, Play, Pause, CheckCircle, Trash2, Building2, Home,
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
import { MissionMap } from "@/components/mission/mission-map"
import { ErrorBoundary } from "@/components/error-boundary"
import { useMission, useEvents, useDevices } from "@/hooks/use-api"
import { updateMission, updateDevice } from "@/lib/api-client"
import { missionStatusConfig, eventTypeConfig, formatRelative, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Zone } from "@/lib/types"

const ZONE_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"]
const ZONE_TYPES = [
  { value: "facade", label: "Facade / Wall" },
  { value: "perimeter", label: "Perimeter" },
  { value: "interior", label: "Interior" },
  { value: "roof", label: "Roof" },
  { value: "custom", label: "Custom" },
] as const

export default function MissionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: mission, isLoading, mutate } = useMission(id)
  const { data: events } = useEvents({ mission_id: id })
  const { data: allDevices, mutate: mutateDevices } = useDevices()

  const [drawingMode, setDrawingMode] = useState(false)
  const [zoneDialog, setZoneDialog] = useState(false)
  const [pendingPolygon, setPendingPolygon] = useState<[number, number][] | null>(null)
  const [zoneName, setZoneName] = useState("")
  const [zoneType, setZoneType] = useState<string>("facade")
  const [assignDialog, setAssignDialog] = useState<string | null>(null) // zoneId
  const [statusUpdating, setStatusUpdating] = useState(false)

  // ── Zone drawing ──────────────────────────────────────────
  const handlePolygonDrawn = useCallback((polygon: [number, number][]) => {
    setPendingPolygon(polygon)
    setZoneName("")
    setZoneType("facade")
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
    }
    const updated = await updateMission(id, { zones: [...zones, newZone] })
    mutate(updated, false)
    setZoneDialog(false)
    setPendingPolygon(null)
  }, [mission, pendingPolygon, zoneName, zoneType, id, mutate])

  const deleteZone = useCallback(async (zoneId: string) => {
    if (!mission) return
    const zones = (mission.zones ?? []).filter((z) => z.id !== zoneId)
    const updated = await updateMission(id, { zones })
    mutate(updated, false)
  }, [mission, id, mutate])

  // ── Device assignment ─────────────────────────────────────
  const assignDevice = useCallback(async (deviceId: string, zoneId: string) => {
    if (!mission) return
    // Update device: set mission_id and zone
    const zone = (mission.zones ?? []).find((z) => z.id === zoneId)
    await updateDevice(deviceId, {
      mission_id: id,
      zone_id: zoneId,
      zone_label: zone?.label ?? "",
    })
    // Update zone: add device to devices array
    const zones = (mission.zones ?? []).map((z) =>
      z.id === zoneId && !z.devices.includes(deviceId)
        ? { ...z, devices: [...z.devices, deviceId] }
        : z
    )
    const updated = await updateMission(id, {
      zones,
      device_count: (mission.device_count ?? 0) + 1,
    })
    mutate(updated, false)
    mutateDevices()
    setAssignDialog(null)
  }, [mission, id, mutate, mutateDevices])

  // ── Status transitions ────────────────────────────────────
  const changeStatus = useCallback(async (newStatus: string) => {
    if (!mission) return
    setStatusUpdating(true)
    try {
      const patch: Record<string, unknown> = { status: newStatus }
      if (newStatus === "active" && !mission.started_at) {
        patch.started_at = new Date().toISOString()
      }
      if (newStatus === "completed") {
        patch.ended_at = new Date().toISOString()
      }
      const updated = await updateMission(id, patch)
      mutate(updated, false)
    } finally {
      setStatusUpdating(false)
    }
  }, [mission, id, mutate])

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
  const unassigned = allDevices?.filter((d) => !d.mission_id) ?? []

  return (
    <>
      <TopHeader title={mission.name} description={mission.description} />
      <main className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          {/* Breadcrumb + actions */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground">
              <Link href="/missions">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Missions
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild className="text-xs">
                <Link href={`/missions/${id}/sensors`}>
                  <Radio className="mr-1.5 h-3 w-3" />
                  Sensors
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="text-xs">
                <Link href={`/missions/${id}/history`}>
                  <BarChart3 className="mr-1.5 h-3 w-3" />
                  History
                </Link>
              </Button>
            </div>
          </div>

          {/* Mission info bar + status controls */}
          <Card className="border-border/50 bg-card py-3">
            <CardContent className="flex flex-wrap items-center gap-3 px-4">
              <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusCfg.className)}>
                {statusCfg.label}
              </Badge>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {mission.environment === "vertical" ? <Building2 className="h-3 w-3" /> : <Home className="h-3 w-3" />}
                {mission.environment ?? "horizontal"}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {mission.location || "No location"}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                {missionDevices.length} devices
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <BarChart3 className="h-3 w-3" />
                {eventList.length} events
              </span>

              {/* Status action buttons */}
              <div className="flex items-center gap-1.5 ml-auto">
                {mission.status === "draft" && zones.length > 0 && (
                  <Button
                    size="sm"
                    className="h-7 text-[10px] gap-1"
                    onClick={() => changeStatus("active")}
                    disabled={statusUpdating}
                  >
                    <Play className="h-3 w-3" />
                    Activate
                  </Button>
                )}
                {mission.status === "active" && (
                  <>
                    <Button
                      variant="outline" size="sm"
                      className="h-7 text-[10px] gap-1"
                      onClick={() => changeStatus("paused")}
                      disabled={statusUpdating}
                    >
                      <Pause className="h-3 w-3" />
                      Pause
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      className="h-7 text-[10px] gap-1"
                      onClick={() => changeStatus("completed")}
                      disabled={statusUpdating}
                    >
                      <CheckCircle className="h-3 w-3" />
                      Complete
                    </Button>
                  </>
                )}
                {mission.status === "paused" && (
                  <Button
                    size="sm"
                    className="h-7 text-[10px] gap-1"
                    onClick={() => changeStatus("active")}
                    disabled={statusUpdating}
                  >
                    <Play className="h-3 w-3" />
                    Resume
                  </Button>
                )}
                {mission.started_at && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatRelative(mission.started_at)}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Map + Sidebar */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ErrorBoundary>
                <MissionMap
                  centerLat={mission.center_lat ?? 48.8566}
                  centerLon={mission.center_lon ?? 2.3522}
                  zoom={mission.zoom ?? 19}
                  zones={zones}
                  events={eventList}
                  className="h-[450px]"
                  drawingMode={drawingMode}
                  onPolygonDrawn={handlePolygonDrawn}
                  onZoneClick={(zoneId) => setAssignDialog(zoneId)}
                />
              </ErrorBoundary>
            </div>

            <div className="flex flex-col gap-3">
              {/* Zones panel */}
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs">Zones ({zones.length})</CardTitle>
                    <Button
                      variant={drawingMode ? "default" : "outline"}
                      size="sm"
                      className="h-6 text-[10px] px-2 gap-1"
                      onClick={() => setDrawingMode(!drawingMode)}
                    >
                      {drawingMode ? (
                        <>
                          <Pencil className="h-3 w-3 animate-pulse" />
                          Drawing...
                        </>
                      ) : (
                        <>
                          <Plus className="h-3 w-3" />
                          Draw Zone
                        </>
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {zones.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 text-center">
                      Click &quot;Draw Zone&quot; then click on the map to define zone polygons
                    </p>
                  ) : (
                    zones.map((zone) => (
                      <div
                        key={zone.id}
                        className="flex items-center gap-2 rounded border border-border/50 p-2 hover:bg-muted/30 transition-colors group"
                      >
                        <div
                          className="h-3 w-3 rounded-sm shrink-0"
                          style={{ backgroundColor: zone.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">
                            {zone.label}
                          </p>
                          <p className="text-[10px] text-muted-foreground">{zone.type}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {zone.devices.length} TX
                        </span>
                        <button
                          onClick={() => setAssignDialog(zone.id)}
                          className="text-[10px] text-primary hover:text-primary/80 transition-colors opacity-0 group-hover:opacity-100"
                          title="Assign device"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => deleteZone(zone.id)}
                          className="text-[10px] text-destructive hover:text-destructive/80 transition-colors opacity-0 group-hover:opacity-100"
                          title="Delete zone"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Assigned devices summary */}
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs">Assigned Devices ({missionDevices.length})</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1.5">
                  {missionDevices.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">
                      Click a zone or the + button to assign TX devices
                    </p>
                  ) : (
                    missionDevices.map((d) => (
                      <div key={d.id} className="flex items-center gap-2 text-xs">
                        <Radio className="h-3 w-3 text-primary shrink-0" />
                        <span className="font-mono text-foreground">{d.name}</span>
                        <span className="text-[10px] text-muted-foreground truncate">
                          {d.zone_label || "---"}
                        </span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Recent events */}
              <Card className="border-border/50 bg-card flex-1">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs">Recent Events</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                  {eventList.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">No events yet</p>
                  ) : (
                    eventList.slice(0, 8).map((evt) => {
                      const evtCfg = eventTypeConfig[evt.type] ?? eventTypeConfig.system
                      return (
                        <div key={evt.id} className="flex items-center gap-2 rounded border border-border/30 p-2">
                          <Badge variant="outline" className={cn("text-[8px] px-1 py-0 shrink-0", evtCfg.className)}>
                            {evtCfg.label}
                          </Badge>
                          <span className="text-[11px] text-foreground truncate flex-1">
                            {evt.device_name}
                            {evt.zone_label && <span className="text-muted-foreground"> / {evt.zone_label}</span>}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                            {formatTime(evt.timestamp)}
                          </span>
                        </div>
                      )
                    })
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>

      {/* ── Zone creation dialog ── */}
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
                <SelectTrigger className="bg-input/50 border-border text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ZONE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">
              {pendingPolygon?.length ?? 0} polygon points
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setZoneDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={saveZone} disabled={!zoneName.trim()}>Save Zone</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Device assignment dialog ── */}
      <Dialog open={!!assignDialog} onOpenChange={() => setAssignDialog(null)}>
        <DialogContent className="sm:max-w-md z-[10000]">
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
              <p className="text-xs text-muted-foreground py-4 text-center">
                No unassigned devices available
              </p>
            ) : (
              unassigned.map((device) => (
                <button
                  key={device.id}
                  onClick={() => assignDialog && assignDevice(device.id, assignDialog)}
                  className="flex items-center gap-3 rounded border border-border/50 p-3 text-left hover:bg-muted/30 transition-colors"
                >
                  <Radio className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono font-medium text-foreground">{device.name}</p>
                    <p className="text-[10px] text-muted-foreground">{device.hw_id}</p>
                  </div>
                  <Badge variant="outline" className="text-[9px] px-1 py-0">
                    {device.status}
                  </Badge>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
