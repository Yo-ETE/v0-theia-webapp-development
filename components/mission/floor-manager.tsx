"use client"

import { useState, useCallback, useMemo } from "react"
import type { Floor, Device, DetectionEvent } from "@/lib/types"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  Building2, Plus, Trash2, Signal, Activity, ChevronUp, ChevronDown,
  Radio, Warehouse, X,
} from "lucide-react"

// ── Terminology helper ──
type FloorMode = "floor" | "section"

function modeLabel(mode: FloorMode, plural = false) {
  if (mode === "floor") return plural ? "Etages" : "Etage"
  return plural ? "Troncons" : "Troncon"
}

interface LiveDetection {
  presence: boolean
  distance: number
  direction: string
  device_name: string
  side: string
  rssi: number | null
  timestamp: string
  device_id?: string
  angle?: number
  speed?: number
  [key: string]: unknown
}

// Convert LD2450 angle to position label (Left / Centre / Right)
// Angle: negative = left, 0 = center, positive = right (from sensor POV)
function angleToPosition(angle: number | undefined): "G" | "C" | "D" {
  if (angle == null) return "C"
  if (angle < -15) return "G"   // Gauche
  if (angle > 15) return "D"    // Droite
  return "C"                     // Centre
}

function positionLabel(pos: "G" | "C" | "D"): string {
  switch (pos) {
    case "G": return "Gauche"
    case "C": return "Centre"
    case "D": return "Droite"
  }
}

interface FloorManagerProps {
  missionId: string
  mode: FloorMode
  floors: Floor[]
  devices: Device[]
  allDevices: Device[]
  events: DetectionEvent[]
  liveDetections: LiveDetection[]
  onFloorsChange: (floors: Floor[]) => void
  onDeviceAssign: (deviceId: string, floor: number) => void
  onDeviceUnassign: (deviceId: string) => void
}

// ── Color palette per floor ──
const FLOOR_COLORS = [
  "#06b6d4", "#8b5cf6", "#f59e0b", "#ef4444", "#22c55e",
  "#ec4899", "#3b82f6", "#14b8a6", "#f97316", "#a855f7",
]

export function FloorManager({
  missionId,
  mode,
  floors,
  devices,
  allDevices,
  events,
  liveDetections,
  onFloorsChange,
  onDeviceAssign,
  onDeviceUnassign,
}: FloorManagerProps) {
  const [addDialog, setAddDialog] = useState(false)
  const [addLabel, setAddLabel] = useState("")
  const [addLevel, setAddLevel] = useState(floors.length)
  const [assignDialog, setAssignDialog] = useState<number | null>(null)
  const [selectedDevice, setSelectedDevice] = useState("")

  // Build device_id -> floor level map from two sources:
  // 1. Currently assigned devices (devices prop)
  // 2. Mission floor config (floors[].devices[]) -- persists even after unassignment
  const deviceFloorMap = useMemo(() => {
    const map = new Map<string, number>()
    // From floors config (fallback for unassigned devices)
    for (const f of floors) {
      for (const did of f.devices) {
        map.set(did, f.level)
      }
    }
    // From live devices (override with current assignment)
    for (const d of devices) {
      if (d.floor != null) map.set(d.id, d.floor)
    }
    return map
  }, [floors, devices])

  // Compute live detection state per floor (with direction/angle tracking)
  const liveByFloor = useMemo(() => {
    if (liveDetections.length > 0) {
      console.log("[v0] liveByFloor: liveDetections count=", liveDetections.length, "deviceFloorMap size=", deviceFloorMap.size, "floors=", floors.map(f => ({level: f.level, devices: f.devices})), "devices=", devices.map(d => ({id: d.id, floor: d.floor})))
      console.log("[v0] liveByFloor: first det=", JSON.stringify(liveDetections[0]))
    }
    const map: Record<number, {
      count: number
      latest: LiveDetection | null
      detections: { det: LiveDetection; position: "G" | "C" | "D" }[]
    }> = {}
    for (const det of liveDetections) {
      // Resolve device to floor: try deviceFloorMap (covers both assigned + historical)
      const did = det.device_id || ""
      const dname = det.device_name || ""
      let floorLevel = deviceFloorMap.get(did)
      if (floorLevel == null && dname) {
        // Try by name match in devices
        const dev = devices.find(d => d.name === dname)
        if (dev?.floor != null) floorLevel = dev.floor
      }
      // Last resort: floor stored in the detection/event payload itself
      if (floorLevel == null && det.floor != null) {
        floorLevel = Number(det.floor)
      }
      if (floorLevel == null) {
        console.log("[v0] liveByFloor: SKIPPED det, no floor found. did=", did, "dname=", dname, "det.floor=", det.floor, "deviceFloorMap.has=", deviceFloorMap.has(did))
        continue
      }
      const pos = angleToPosition(det.angle != null ? Number(det.angle) : undefined)
      const prev = map[floorLevel]
      if (!prev) {
        map[floorLevel] = {
          count: det.presence ? 1 : 0,
          latest: det,
          detections: det.presence ? [{ det, position: pos }] : [],
        }
      } else {
        if (det.presence) {
          prev.count++
          prev.detections.push({ det, position: pos })
        }
        prev.latest = det
      }
    }
    return map
  }, [liveDetections, deviceFloorMap, devices])

  // Recent events per floor (uses deviceFloorMap for unassigned devices too)
  const eventsByFloor = useMemo(() => {
    const map: Record<number, DetectionEvent[]> = {}
    for (const evt of events) {
      let fl = deviceFloorMap.get(evt.device_id ?? "")
      // Fallback: floor stored in event payload
      if (fl == null) {
        const p = evt.payload as Record<string, unknown> | undefined
        if (p && p.floor != null) fl = Number(p.floor)
      }
      if (fl == null) continue
      if (!map[fl]) map[fl] = []
      map[fl].push(evt)
    }
    return map
  }, [events, deviceFloorMap])

  // Available (unassigned) devices -- any device not already assigned to a floor in this mission
  const assignedDeviceIds = useMemo(() => {
    const set = new Set<string>()
    for (const f of floors) {
      for (const did of f.devices) set.add(did)
    }
    return set
  }, [floors])

  const availableDevices = useMemo(() =>
    allDevices.filter(d => !assignedDeviceIds.has(d.id)),
    [allDevices, assignedDeviceIds]
  )

  const addFloor = useCallback(() => {
    if (!addLabel.trim()) return
    const newFloor: Floor = {
      level: addLevel,
      label: addLabel.trim(),
      devices: [],
    }
    onFloorsChange([...floors, newFloor].sort((a, b) => a.level - b.level))
    setAddDialog(false)
    setAddLabel("")
    setAddLevel(floors.length)
  }, [addLabel, addLevel, floors, onFloorsChange])

  const removeFloor = useCallback((level: number) => {
    const floor = floors.find(f => f.level === level)
    if (floor) {
      for (const devId of floor.devices) {
        onDeviceUnassign(devId)
      }
    }
    onFloorsChange(floors.filter(f => f.level !== level))
  }, [floors, onFloorsChange, onDeviceUnassign])

  const assignToFloor = useCallback(() => {
    if (assignDialog == null || !selectedDevice) return
    onDeviceAssign(selectedDevice, assignDialog)
    const updated = floors.map(f =>
      f.level === assignDialog
        ? { ...f, devices: [...f.devices, selectedDevice] }
        : f
    )
    onFloorsChange(updated)
    setAssignDialog(null)
    setSelectedDevice("")
  }, [assignDialog, selectedDevice, floors, onFloorsChange, onDeviceAssign])

  const unassignFromFloor = useCallback((deviceId: string, level: number) => {
    onDeviceUnassign(deviceId)
    const updated = floors.map(f =>
      f.level === level
        ? { ...f, devices: f.devices.filter(id => id !== deviceId) }
        : f
    )
    onFloorsChange(updated)
  }, [floors, onFloorsChange, onDeviceUnassign])

  const openAddDialog = useCallback(() => {
    const nextLevel = floors.length > 0
      ? Math.max(...floors.map(f => f.level)) + 1
      : 0
    setAddLevel(nextLevel)
    setAddLabel(mode === "floor"
      ? `Etage ${nextLevel}`
      : `Troncon ${String.fromCharCode(65 + floors.length)}`)
    setAddDialog(true)
  }, [floors, mode])

  // Sort floors: for buildings, highest floor first; for sections, order by level
  const sortedFloors = useMemo(() =>
    [...floors].sort((a, b) => mode === "floor" ? b.level - a.level : a.level - b.level),
    [floors, mode]
  )

  // ── Render a single floor/section card ──
  function renderFloorCard(floor: Floor) {
    const color = FLOOR_COLORS[Math.abs(floor.level) % FLOOR_COLORS.length]
    const floorDevices = devices.filter(d => floor.devices.includes(d.id))
    const live = liveByFloor[floor.level]
    const floorEvents = eventsByFloor[floor.level] ?? []
    const hasLive = live && live.count > 0

    return (
      <div
        key={floor.level}
        className={cn(
          "rounded-lg border transition-all flex flex-col",
          mode === "section" ? "min-w-[200px] flex-1" : "w-full",
          hasLive ? "border-success/50 bg-success/5" : "border-border/50 bg-card"
        )}
      >
        {/* Header bar with color accent */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/30"
          style={{ borderTopColor: color, borderTopWidth: 3 }}>
          <div className="flex items-center gap-2">
            <div
              className="h-5 w-5 rounded flex items-center justify-center text-[10px] font-bold text-white shrink-0"
              style={{ backgroundColor: color }}
            >
              {floor.level}
            </div>
            <span className="text-xs font-semibold text-foreground">{floor.label}</span>
            {hasLive && (
              <Badge variant="outline" className="h-4 text-[8px] px-1 border-success/50 text-success gap-0.5">
                <Activity className="h-2 w-2 animate-pulse" />
                {live.count}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost" size="sm"
              className="h-5 w-5 p-0 text-primary hover:text-primary/80"
              onClick={() => { setAssignDialog(floor.level); setSelectedDevice("") }}
              title="Assigner un TX"
            >
              <Plus className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost" size="sm"
              className="h-5 w-5 p-0 text-destructive hover:text-destructive/80"
              onClick={() => removeFloor(floor.level)}
              title="Supprimer"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="px-3 py-2 flex-1 flex flex-col gap-1.5">
          {floorDevices.length === 0 ? (
            <button
              onClick={() => { setAssignDialog(floor.level); setSelectedDevice("") }}
              className="flex items-center justify-center gap-1.5 py-3 text-[10px] text-muted-foreground hover:text-primary transition-colors border border-dashed border-border/50 rounded"
            >
              <Plus className="h-3 w-3" />
              Assigner un TX
            </button>
          ) : (
            floorDevices.map((dev) => {
              const isOnline = dev.status === "online"
              const devLive = liveDetections.find(
                d => d.device_id === dev.id || d.device_name === dev.name
              )
              return (
                <div
                  key={dev.id}
                  className={cn(
                    "flex items-center justify-between rounded px-2 py-1 text-[10px]",
                    "border border-border/40 bg-secondary/20",
                    devLive?.presence && "border-success/40 bg-success/5"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Signal className={cn(
                      "h-3 w-3",
                      isOnline ? "text-success" : "text-muted-foreground"
                    )} />
                    <span className="font-mono font-medium text-foreground">{dev.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {devLive?.presence && (
                      <>
                        <span className="text-success font-semibold text-[9px]">
                          {typeof devLive.distance === "number" ? `${devLive.distance.toFixed(1)}m` : "DETECT"}
                        </span>
                        <span className={cn(
                          "text-[8px] font-mono px-1 py-0.5 rounded",
                          angleToPosition(devLive.angle != null ? Number(devLive.angle) : undefined) === "G"
                            ? "bg-blue-500/20 text-blue-400"
                            : angleToPosition(devLive.angle != null ? Number(devLive.angle) : undefined) === "D"
                            ? "bg-orange-500/20 text-orange-400"
                            : "bg-muted text-muted-foreground"
                        )}>
                          {positionLabel(angleToPosition(devLive.angle != null ? Number(devLive.angle) : undefined))}
                        </span>
                      </>
                    )}
                    <button
                      onClick={() => unassignFromFloor(dev.id, floor.level)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      title="Retirer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )
            })
          )}

          {/* Event count */}
          {floorEvents.length > 0 && (
            <p className="text-[9px] text-muted-foreground mt-auto pt-1 border-t border-border/20">
              {floorEvents.length} detection{floorEvents.length > 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {mode === "floor"
            ? <Building2 className="h-4 w-4 text-primary" />
            : <Warehouse className="h-4 w-4 text-primary" />}
          <h3 className="text-sm font-semibold text-foreground">
            {modeLabel(mode, true)} ({floors.length})
          </h3>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={openAddDialog}>
          <Plus className="h-3 w-3" />
          {mode === "floor" ? "Ajouter Etage" : "Ajouter Troncon"}
        </Button>
      </div>

      {/* Empty state */}
      {floors.length === 0 && (
        <Card className="border-border/50 bg-card">
          <CardContent className="flex flex-col items-center justify-center py-10 gap-3">
            {mode === "floor"
              ? <Building2 className="h-10 w-10 text-muted-foreground/30" />
              : <Warehouse className="h-10 w-10 text-muted-foreground/30" />}
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              {mode === "floor"
                ? "Ajoutez des etages pour configurer la surveillance verticale. Chaque etage peut avoir un ou plusieurs TX."
                : "Ajoutez des troncons pour configurer la surveillance souterraine. Chaque troncon peut avoir un ou plusieurs TX."}
            </p>
            <Button variant="outline" size="sm" className="text-xs gap-1" onClick={openAddDialog}>
              <Plus className="h-3 w-3" />
              {mode === "floor" ? "Creer le premier etage" : "Creer le premier troncon"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Visual layout ── */}
      {floors.length > 0 && (
        <>
          {/* Visual representation */}
          <div className="relative rounded-lg border border-border/50 bg-secondary/10 p-4 overflow-x-auto">
            {mode === "floor" ? (
              /* ─��� Vertical: building visualization ── */
              <div className="flex flex-col items-center gap-0">
                {/* Roof */}
                <div className="w-48 h-2 bg-muted-foreground/20 rounded-t-lg" />
                {sortedFloors.map((floor, idx) => {
                  const color = FLOOR_COLORS[Math.abs(floor.level) % FLOOR_COLORS.length]
                  const live = liveByFloor[floor.level]
                  const hasLive = live && live.count > 0
                  const floorDevices = devices.filter(d => floor.devices.includes(d.id))

                  return (
                    <div
                      key={floor.level}
                      className={cn(
                        "w-56 border-x-2 border-b flex items-center gap-2 px-3 py-2 transition-all cursor-pointer hover:bg-primary/5 relative",
                        hasLive ? "bg-success/10 border-success/30" : "bg-card border-border/40",
                        idx === 0 && "border-t-0"
                      )}
                      style={{ borderLeftColor: color, borderRightColor: color }}
                      onClick={() => { setAssignDialog(floor.level); setSelectedDevice("") }}
                    >
                      {/* Detection glow effect */}
                      {hasLive && (
                        <div className="absolute inset-0 bg-success/5 animate-pulse pointer-events-none rounded-sm" />
                      )}
                      <div
                        className="h-5 w-5 rounded-sm flex items-center justify-center text-[9px] font-bold text-white shrink-0 relative z-10"
                        style={{ backgroundColor: color }}
                      >
                        {floor.level}
                      </div>
                      <div className="flex-1 min-w-0 relative z-10">
                        <p className="text-[10px] font-medium text-foreground truncate">{floor.label}</p>
                        <p className="text-[8px] text-muted-foreground">
                          {floorDevices.length} TX
                          {hasLive && live.latest && typeof live.latest.distance === "number"
                            ? ` | ${live.latest.distance.toFixed(1)}m`
                            : ""}
                        </p>
                      </div>
                      {hasLive && (
                        <div className="flex items-center gap-1 relative z-10">
                          <span className="text-[9px] font-bold text-success">{live.count}</span>
                          <Activity className="h-3 w-3 text-success animate-pulse shrink-0" />
                        </div>
                      )}
                      {/* Direction bar: G | C | D */}
                      {hasLive && live.detections.length > 0 && (
                        <div className="absolute bottom-0.5 left-3 right-3 flex h-1 gap-px rounded-sm overflow-hidden z-10">
                          {["G", "C", "D"].map((pos) => {
                            const count = live.detections.filter(d => d.position === pos).length
                            return (
                              <div
                                key={pos}
                                className={cn(
                                  "flex-1 rounded-sm transition-all",
                                  count > 0
                                    ? pos === "G" ? "bg-blue-400" : pos === "D" ? "bg-orange-400" : "bg-success"
                                    : "bg-border/30"
                                )}
                                title={`${positionLabel(pos as "G"|"C"|"D")}: ${count}`}
                              />
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
                {/* Foundation */}
                <div className="w-56 h-2 bg-muted-foreground/30 rounded-b" />
              </div>
            ) : (
              /* ── Horizontal: garage/tunnel visualization ── */
              <div className="flex items-end gap-0">
                {sortedFloors.map((floor) => {
                  const color = FLOOR_COLORS[Math.abs(floor.level) % FLOOR_COLORS.length]
                  const live = liveByFloor[floor.level]
                  const hasLive = live && live.count > 0
                  const floorDevices = devices.filter(d => floor.devices.includes(d.id))

                  return (
                    <div
                      key={floor.level}
                      className={cn(
                        "flex-1 min-w-[100px] max-w-[180px] border-t-3 border-r flex flex-col items-center gap-1 px-3 py-3 transition-all cursor-pointer hover:bg-primary/5 relative",
                        hasLive ? "bg-success/10 border-success/30" : "bg-card border-border/40",
                      )}
                      style={{ borderTopColor: color }}
                      onClick={() => { setAssignDialog(floor.level); setSelectedDevice("") }}
                    >
                      {hasLive && (
                        <div className="absolute inset-0 bg-success/5 animate-pulse pointer-events-none" />
                      )}
                      <div
                        className="h-6 w-6 rounded flex items-center justify-center text-[10px] font-bold text-white shrink-0 relative z-10"
                        style={{ backgroundColor: color }}
                      >
                        {floor.level}
                      </div>
                      <p className="text-[10px] font-medium text-foreground text-center truncate w-full relative z-10">{floor.label}</p>
                      <p className="text-[8px] text-muted-foreground relative z-10">{floorDevices.length} TX</p>
                      {hasLive && (
                        <div className="flex items-center gap-1 relative z-10">
                          <span className="text-[9px] font-bold text-success">{live.count}</span>
                          <Activity className="h-3 w-3 text-success animate-pulse" />
                        </div>
                      )}
                      {hasLive && live.latest && typeof live.latest.distance === "number" && (
                        <p className="text-[8px] font-mono text-success relative z-10">{live.latest.distance.toFixed(1)}m</p>
                      )}
                      {/* Direction bar: G | C | D */}
                      {hasLive && live.detections.length > 0 && (
                        <div className="flex h-1 gap-px w-full rounded-sm overflow-hidden relative z-10 mt-1">
                          {(["G", "C", "D"] as const).map((pos) => {
                            const count = live.detections.filter(d => d.position === pos).length
                            return (
                              <div
                                key={pos}
                                className={cn(
                                  "flex-1 rounded-sm transition-all",
                                  count > 0
                                    ? pos === "G" ? "bg-blue-400" : pos === "D" ? "bg-orange-400" : "bg-success"
                                    : "bg-border/30"
                                )}
                                title={`${positionLabel(pos)}: ${count}`}
                              />
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Floor/Section detail cards */}
          <div className={cn(
            mode === "section"
              ? "flex gap-2 overflow-x-auto pb-1"
              : "flex flex-col gap-2"
          )}>
            {sortedFloors.map(renderFloorCard)}
          </div>
        </>
      )}

      {/* Live summary bar */}
      {Object.keys(liveByFloor).length > 0 && (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="px-4 py-2 flex items-center gap-3">
            <Activity className="h-4 w-4 text-success animate-pulse" />
            <div className="flex-1">
              <p className="text-xs font-medium text-success">Detections en cours</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {Object.entries(liveByFloor)
                  .filter(([, v]) => v.count > 0)
                  .map(([level, data]) => {
                    const floor = floors.find(f => f.level === Number(level))
                    const gCount = data.detections.filter(d => d.position === "G").length
                    const cCount = data.detections.filter(d => d.position === "C").length
                    const dCount = data.detections.filter(d => d.position === "D").length
                    return (
                      <Badge
                        key={level}
                        variant="outline"
                        className="text-[9px] border-success/40 text-success gap-1"
                      >
                        <Radio className="h-2.5 w-2.5" />
                        {floor?.label ?? `Lvl ${level}`}: {data.count}
                        {data.detections.length > 0 && (
                          <span className="ml-1 text-[8px] opacity-80">
                            {gCount > 0 && <span className="text-blue-400">G:{gCount}</span>}
                            {gCount > 0 && (cCount > 0 || dCount > 0) && " "}
                            {cCount > 0 && <span className="text-success">C:{cCount}</span>}
                            {cCount > 0 && dCount > 0 && " "}
                            {dCount > 0 && <span className="text-orange-400">D:{dCount}</span>}
                          </span>
                        )}
                      </Badge>
                    )
                  })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add floor/section dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="sm:max-w-sm z-[10000]">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {mode === "floor" ? "Ajouter un Etage" : "Ajouter un Troncon"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {mode === "floor"
                ? "Indiquez le numero et le nom de l'etage."
                : "Indiquez le numero et le nom du troncon."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex gap-3">
              <div className="flex flex-col gap-1.5 w-20">
                <Label className="text-[10px] text-muted-foreground">Numero</Label>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                    onClick={() => setAddLevel(addLevel - 1)}>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                  <span className="text-sm font-mono w-8 text-center">{addLevel}</span>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                    onClick={() => setAddLevel(addLevel + 1)}>
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <Label className="text-[10px] text-muted-foreground">Nom</Label>
                <Input
                  value={addLabel}
                  onChange={e => setAddLabel(e.target.value)}
                  placeholder={mode === "floor" ? "ex: Etage 2" : "ex: Troncon B"}
                  className="bg-input/50 border-border text-sm h-8"
                  autoFocus
                  onKeyDown={e => e.key === "Enter" && addFloor()}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setAddDialog(false)}>Annuler</Button>
            <Button size="sm" onClick={addFloor} disabled={!addLabel.trim()}>Ajouter</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign device dialog */}
      <Dialog open={assignDialog != null} onOpenChange={() => setAssignDialog(null)}>
        <DialogContent className="sm:max-w-sm z-[10000]">
          <DialogHeader>
            <DialogTitle className="text-sm">Assigner un TX</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {(() => {
                const f = floors.find(fl => fl.level === assignDialog)
                return f ? `Assigner un device au "${f.label}"` : ""
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {availableDevices.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                Aucun device disponible. Tous les TX sont deja assignes.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {availableDevices.map(dev => (
                  <button
                    key={dev.id}
                    onClick={() => setSelectedDevice(dev.id)}
                    className={cn(
                      "flex items-center justify-between rounded-md px-3 py-2 text-xs transition-all border",
                      selectedDevice === dev.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/40 bg-card hover:border-border text-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Signal className={cn("h-3 w-3", dev.status === "online" ? "text-success" : "text-muted-foreground")} />
                      <span className="font-mono font-medium">{dev.name}</span>
                    </div>
                    <span className={cn(
                      "text-[10px]",
                      dev.status === "online" ? "text-success" : "text-muted-foreground"
                    )}>
                      {dev.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setAssignDialog(null)}>Annuler</Button>
            <Button size="sm" onClick={assignToFloor} disabled={!selectedDevice}>Assigner</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
