"use client"

import { useState, useCallback, useMemo } from "react"
import type { Floor, Device, DetectionEvent } from "@/lib/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Building2, Plus, Trash2, Signal, Activity, ChevronUp, ChevronDown,
  Radio, Layers,
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
  [key: string]: unknown
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
  const [assignDialog, setAssignDialog] = useState<number | null>(null) // floor level
  const [selectedDevice, setSelectedDevice] = useState("")

  // Compute live detection state per floor
  const liveByFloor = useMemo(() => {
    const map: Record<number, { count: number; latest: LiveDetection | null }> = {}
    for (const det of liveDetections) {
      const dev = devices.find(d => d.id === det.device_id || d.name === det.device_name)
      if (!dev || dev.floor == null) continue
      const prev = map[dev.floor]
      if (!prev) {
        map[dev.floor] = { count: det.presence ? 1 : 0, latest: det }
      } else {
        if (det.presence) prev.count++
        prev.latest = det
      }
    }
    return map
  }, [liveDetections, devices])

  // Recent events per floor
  const eventsByFloor = useMemo(() => {
    const map: Record<number, DetectionEvent[]> = {}
    for (const evt of events) {
      const dev = devices.find(d => d.id === evt.device_id)
      if (!dev || dev.floor == null) continue
      if (!map[dev.floor]) map[dev.floor] = []
      map[dev.floor].push(evt)
    }
    return map
  }, [events, devices])

  // Available (unassigned) devices
  const availableDevices = useMemo(() =>
    allDevices.filter(d => !d.mission_id || d.mission_id === missionId)
      .filter(d => !floors.some(f => f.devices.includes(d.id))),
    [allDevices, missionId, floors]
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
    // Unassign devices on this floor first
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
    // Update floors list
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

  // Sort floors: for buildings, highest floor first; for sections, alphabetical order
  const sortedFloors = useMemo(() =>
    [...floors].sort((a, b) => mode === "floor" ? b.level - a.level : a.level - b.level),
    [floors, mode]
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {mode === "floor"
            ? <Building2 className="h-4 w-4 text-primary" />
            : <Layers className="h-4 w-4 text-primary" />}
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
          <CardContent className="flex flex-col items-center justify-center py-8 gap-2">
            {mode === "floor"
              ? <Building2 className="h-8 w-8 text-muted-foreground/40" />
              : <Layers className="h-8 w-8 text-muted-foreground/40" />}
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              {mode === "floor"
                ? "Ajoutez des etages pour configurer la surveillance verticale. Chaque etage peut avoir un ou plusieurs TX."
                : "Ajoutez des troncons pour configurer la surveillance souterraine. Chaque troncon peut avoir un ou plusieurs TX."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Floor/Section cards */}
      <div className="flex flex-col gap-2">
        {sortedFloors.map((floor) => {
          const color = FLOOR_COLORS[Math.abs(floor.level) % FLOOR_COLORS.length]
          const floorDevices = devices.filter(d => floor.devices.includes(d.id))
          const live = liveByFloor[floor.level]
          const floorEvents = eventsByFloor[floor.level] ?? []
          const hasLive = live && live.count > 0

          return (
            <Card
              key={floor.level}
              className={cn(
                "border-border/50 bg-card transition-all",
                hasLive && "ring-1 ring-success/50"
              )}
            >
              <CardHeader className="pb-2 pt-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-4 w-4 rounded-sm flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                      style={{ backgroundColor: color }}
                    >
                      {floor.level}
                    </div>
                    <CardTitle className="text-xs">{floor.label}</CardTitle>
                    {hasLive && (
                      <Badge variant="outline" className="h-4 text-[9px] px-1.5 border-success/50 text-success gap-1">
                        <Activity className="h-2.5 w-2.5 animate-pulse" />
                        {live.count} detection{live.count > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
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
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-0">
                {/* Devices on this floor */}
                {floorDevices.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground italic">Aucun TX assigne</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {floorDevices.map((dev) => {
                      const isOnline = dev.status === "online"
                      const devLive = liveDetections.find(
                        d => d.device_id === dev.id || d.device_name === dev.name
                      )
                      return (
                        <div
                          key={dev.id}
                          className={cn(
                            "flex items-center justify-between rounded-md px-2 py-1.5 text-[10px]",
                            "border border-border/40 bg-secondary/20",
                            devLive?.presence && "border-success/40 bg-success/5"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Signal className={cn(
                              "h-3 w-3",
                              isOnline ? "text-success" : "text-muted-foreground"
                            )} />
                            <span className="font-mono font-medium text-foreground">{dev.name}</span>
                            {dev.rssi != null && (
                              <span className="text-muted-foreground">{dev.rssi}dBm</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {devLive?.presence && (
                              <span className="text-success font-semibold">
                                {typeof devLive.distance === "number" ? `${devLive.distance.toFixed(1)}m` : "DETECT"}
                              </span>
                            )}
                            <button
                              onClick={() => unassignFromFloor(dev.id, floor.level)}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              title="Retirer"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Recent events summary */}
                {floorEvents.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border/30">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">
                      {floorEvents.length} detection{floorEvents.length > 1 ? "s" : ""} recente{floorEvents.length > 1 ? "s" : ""}
                    </p>
                    <div className="flex flex-col gap-0.5">
                      {floorEvents.slice(0, 3).map((evt) => (
                        <div key={evt.id} className="flex items-center justify-between text-[9px]">
                          <span className="font-mono text-muted-foreground">{evt.device_name}</span>
                          <span className="text-muted-foreground">
                            {new Date(evt.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

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
                    return (
                      <Badge
                        key={level}
                        variant="outline"
                        className="text-[9px] border-success/40 text-success gap-1"
                      >
                        <Radio className="h-2.5 w-2.5" />
                        {floor?.label ?? `Lvl ${level}`}: {data.count}
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
                return f ? `Assigner un device a "${f.label}"` : ""
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {availableDevices.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                Aucun device disponible. Assignez d'abord des devices a cette mission depuis l'onglet Sensors.
              </p>
            ) : (
              <Select value={selectedDevice} onValueChange={setSelectedDevice}>
                <SelectTrigger className="bg-input/50 border-border text-sm">
                  <SelectValue placeholder="Choisir un TX..." />
                </SelectTrigger>
                <SelectContent>
                  {availableDevices.map(dev => (
                    <SelectItem key={dev.id} value={dev.id}>
                      <span className="font-mono">{dev.name}</span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        {dev.status === "online" ? "online" : "offline"}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
