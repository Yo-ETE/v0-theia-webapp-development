"use client"

import { Radio } from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { groupSidesByBearing } from "@/lib/facade-utils"
import type { Device, Zone } from "@/lib/types"
import type { AssignStep, SensorPlaceMode } from "./types"

/** A Gravity MW starts from its open-air figures and gets narrowed down in the config dialog. */
const GRAVITY_DEFAULTS = { effectiveRange: 12, effectiveFov: 72 }

/**
 * Puts a node on a zone, in up to three steps: pick the node, pick the face, then place it on
 * the map (or, for a Gravity MW, tune its reach -- both of which happen outside this dialog).
 *
 * The step the wizard is on is held by the page rather than here, because closing the dialog to
 * click the map is part of the flow: the placement continues after this component unmounts.
 */
export function DeviceAssignDialog({
  open,
  zone,
  zoneId,
  unassigned,
  missionId,
  step,
  onStepChange,
  onClose,
  onAssignWithoutSide,
  onPlaceSensor,
}: {
  open: boolean
  zone: Zone | undefined
  zoneId: string | null
  unassigned: Device[]
  missionId: string
  step: AssignStep | null
  onStepChange: (step: AssignStep | null) => void
  onClose: () => void
  onAssignWithoutSide: (deviceId: string) => void
  onPlaceSensor: (mode: SensorPlaceMode) => void
}) {
  const hasSides = Boolean(zone?.sides && Object.values(zone.sides).some(Boolean))

  /** Which faces the operator can choose from, derived the same way the map labels them. */
  const faceChoices = (): { key: string; label: string }[] | null => {
    const polygon = zone?.polygon
    if (!polygon || !Array.isArray(polygon) || polygon.length < 2) return null
    // A facade is drawn as two points, so it has exactly one face.
    if (polygon.length === 2) return [{ key: "A", label: "Façade A (ligne)" }]
    const { segmentToGroup } = groupSidesByBearing(polygon as [number, number][])
    if (!Array.isArray(segmentToGroup) || segmentToGroup.length === 0) return null
    return [...new Set(segmentToGroup)].map((key) => ({ key, label: `Façade ${key}` }))
  }

  const pickFace = (side: string) => {
    if (!zoneId || !step) return
    onPlaceSensor({
      zoneId,
      side,
      deviceId: step.deviceId,
      deviceName: step.deviceName,
      deviceType: step.deviceType,
    })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md z-[10000]">
        {!step ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-sm">
                Affecter un TX a {zone?.label ?? "la zone"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Choisissez un noeud non affecte a placer sur cette zone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 py-2 max-h-64 overflow-y-auto">
              {unassigned.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Aucun noeud disponible</p>
              ) : unassigned.map((device) => {
                const isElsewhere = device.mission_id && device.mission_id !== missionId
                const isGravityMW = device.type === "gravity_mw"
                return (
                  <button
                    key={device.id}
                    onClick={() => {
                      if (isGravityMW && !hasSides) {
                        // No face to choose: skip straight to the reach configuration. The
                        // empty string records "no specific side" and is not the same as
                        // undefined, which would reopen the face picker.
                        onStepChange({
                          deviceId: device.id,
                          deviceName: device.name,
                          deviceType: device.type,
                          side: "",
                          gravityConfig: GRAVITY_DEFAULTS,
                        })
                      } else if (hasSides || isGravityMW) {
                        onStepChange({
                          deviceId: device.id,
                          deviceName: device.name,
                          deviceType: device.type,
                          gravityConfig: isGravityMW ? GRAVITY_DEFAULTS : undefined,
                        })
                      } else {
                        onAssignWithoutSide(device.id)
                      }
                    }}
                    className="flex items-center gap-3 rounded border border-border/50 p-3 text-left hover:bg-muted/30 transition-colors"
                  >
                    <Radio className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono font-medium text-foreground">{device.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {device.dev_eui || device.serial_port || device.hw_id || "aucun port"}
                        {isElsewhere && <span className="text-warning ml-1">(autre mission)</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {device.battery && (
                        <span className="text-2xs text-muted-foreground font-mono">{device.battery}V</span>
                      )}
                      <Badge
                        variant={device.status === "online" ? "default" : "outline"}
                        className={cn(
                          "text-2xs px-1 py-0",
                          device.status === "online"
                            ? "bg-success/20 text-success border-success/30"
                            : device.status === "offline" ? "text-muted-foreground" : "",
                        )}
                      >
                        {device.status ?? "unknown"}
                      </Badge>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        ) : step.side === undefined ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-sm">Face : {step.deviceName}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Choisissez la facade que ce TX couvre.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 py-2">
              {faceChoices()?.map((face) => (
                <button
                  key={face.key}
                  onClick={() => pickFace(face.key)}
                  className="flex items-center gap-3 rounded border border-border/50 p-3 text-left hover:bg-muted/30 transition-colors"
                >
                  <span className="text-sm font-mono font-bold text-info w-6 text-center">{face.key}</span>
                  <span className="text-xs text-foreground">{face.label}</span>
                </button>
              ))}
              <button
                onClick={() => {
                  if (step.deviceType === "gravity_mw") {
                    onStepChange({ ...step, side: "" })
                  } else {
                    onAssignWithoutSide(step.deviceId)
                  }
                }}
                className="flex items-center gap-3 rounded border border-dashed border-border/30 p-3 text-left hover:bg-muted/20 transition-colors"
              >
                <span className="text-sm font-mono text-muted-foreground w-6 text-center">-</span>
                <span className="text-xs text-muted-foreground">Aucune face precise</span>
              </button>
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => onStepChange(null)}>Retour</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
