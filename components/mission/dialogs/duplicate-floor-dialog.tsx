"use client"

import { Copy } from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FLOOR_LABELS } from "@/lib/mission-constants"

const floorName = (level: number) => FLOOR_LABELS[level] ?? `Niveau ${level}`

/** Confirms copying a storey's zones onto another storey. Sensors are deliberately not copied. */
export function DuplicateFloorDialog({
  sourceFloor,
  targetFloor,
  zoneCount,
  onCancel,
  onConfirm,
}: {
  sourceFloor: number
  targetFloor: number
  zoneCount: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="sm:max-w-sm z-[10000]">
        <DialogHeader>
          <DialogTitle className="text-sm">Dupliquer les zones</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Copier toutes les zones de {floorName(sourceFloor)} vers {floorName(targetFloor)}.
          </DialogDescription>
        </DialogHeader>
        <div className="text-xs text-muted-foreground py-2">
          <p>{zoneCount} zone(s) seront copiees. Les capteurs ne seront pas copies.</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>Annuler</Button>
          <Button size="sm" onClick={onConfirm}>
            <Copy className="h-3.5 w-3.5 mr-1" />
            Dupliquer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
