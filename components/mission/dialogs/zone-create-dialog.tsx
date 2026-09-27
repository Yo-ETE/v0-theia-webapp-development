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
import { ZONE_TYPES, FLOOR_LABELS } from "@/lib/mission-constants"
import { cn } from "@/lib/utils"
import { SideLabelEditor } from "./side-label-editor"

/** Names, classifies and files a freshly drawn zone before it is saved. */
export function ZoneCreateDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  type,
  onTypeChange,
  sideLabels,
  onSideLabelsChange,
  sideGrouping,
  polygon,
  floorLevels,
  selectedFloor,
  onSelectFloor,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onNameChange: (name: string) => void
  type: string
  onTypeChange: (type: string) => void
  sideLabels: Record<string, string>
  onSideLabelsChange: (next: Record<string, string>) => void
  sideGrouping: string[]
  polygon: [number, number][] | null
  floorLevels: number[]
  selectedFloor: number
  onSelectFloor: (level: number) => void
  onSave: () => void
}) {
  // The floors that already exist, plus the next one up: a zone is often the first thing
  // drawn on a new storey, so the level has to be offerable before any zone is on it.
  const levelChoices = [...floorLevels, Math.max(...floorLevels, -1) + 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a - b)

  const labelled = Object.values(sideLabels).filter(Boolean).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md z-[10000]">
        <DialogHeader>
          <DialogTitle className="text-sm">Nouvelle zone</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Nommez et classez la zone tracee. Elle apparaitra sur la carte.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="zone-name" className="text-xs text-muted-foreground">Nom de la zone</Label>
            <Input
              id="zone-name"
              name="zone-name"
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
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">Etage</Label>
            <div className="flex items-center gap-1">
              {levelChoices.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => onSelectFloor(level)}
                  className={cn(
                    "px-3 py-1.5 text-xs rounded border transition-colors",
                    selectedFloor === level
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/50 text-muted-foreground border-border hover:bg-muted",
                  )}
                >
                  {FLOOR_LABELS[level] ?? `Niveau ${level}`}
                </button>
              ))}
            </div>
          </div>
          {polygon && polygon.length >= 2 && (
            <SideLabelEditor
              labels={sideLabels}
              onChange={onSideLabelsChange}
              sideGrouping={sideGrouping}
              idPrefix="side-label"
              segmentCount={polygon.length}
            />
          )}
          <p className="text-xs text-muted-foreground font-mono">
            {polygon?.length ?? 0} points - {Object.keys(sideLabels).length} faces - {labelled} nommees
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button size="sm" onClick={onSave} disabled={!name.trim()}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
