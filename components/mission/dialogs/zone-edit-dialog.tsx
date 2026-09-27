"use client"

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ZONE_TYPES } from "@/lib/mission-constants"
import { SideLabelEditor } from "./side-label-editor"

/** Renames an existing zone and its faces. The polygon itself is edited on the map, not here. */
export function ZoneEditDialog({
  open,
  onClose,
  name,
  onNameChange,
  type,
  onTypeChange,
  sideLabels,
  onSideLabelsChange,
  sideGrouping,
  onSave,
}: {
  open: boolean
  onClose: () => void
  name: string
  onNameChange: (name: string) => void
  type: string
  onTypeChange: (type: string) => void
  sideLabels: Record<string, string>
  onSideLabelsChange: (next: Record<string, string>) => void
  sideGrouping: string[]
  onSave: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md z-[10000]">
        <DialogHeader>
          <DialogTitle className="text-sm">Modifier la zone</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Changez le nom, le type et le nom des faces.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-zone-name" className="text-xs text-muted-foreground">Nom de la zone</Label>
            <Input
              id="edit-zone-name"
              name="edit-zone-name"
              placeholder="ex. Facade Nord"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className="bg-input/50 border-border text-sm"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">Type de zone</Label>
            <Select value={type} onValueChange={onTypeChange}>
              <SelectTrigger className="bg-input/50 border-border text-sm"><SelectValue /></SelectTrigger>
              <SelectContent className="z-[10001]" position="popper" sideOffset={4}>
                {ZONE_TYPES.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <SideLabelEditor
            labels={sideLabels}
            onChange={onSideLabelsChange}
            sideGrouping={sideGrouping}
            idPrefix="edit-side-label"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" onClick={onSave} disabled={!name.trim()}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
