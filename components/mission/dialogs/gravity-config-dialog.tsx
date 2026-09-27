"use client"

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { GravityConfig, GravityConfigTarget } from "./types"

/**
 * Presets named after what the node is shooting through.
 *
 * A Gravity MW's datasheet range assumes open air, which is never the case on a mission. These
 * are field values, not specifications: what the node actually reaches through that material.
 */
const PRESETS: { label: string; config: GravityConfig }[] = [
  { label: "Libre", config: { effectiveRange: 12, effectiveFov: 72 } },
  { label: "PVC", config: { effectiveRange: 6, effectiveFov: 50 } },
  { label: "Porte bois", config: { effectiveRange: 8, effectiveFov: 45 } },
  { label: "Bois 5cm", config: { effectiveRange: 7, effectiveFov: 30 } },
  { label: "Parpaing", config: { effectiveRange: 3, effectiveFov: 72 } },
]

/** Tunes a just-placed Gravity MW's reach before the assignment is written. */
export function GravityConfigDialog({
  target,
  onChange,
  onCancel,
  onConfirm,
}: {
  target: GravityConfigTarget | null
  onChange: (next: GravityConfigTarget) => void
  onCancel: () => void
  onConfirm: (target: GravityConfigTarget) => void
}) {
  const setConfig = (patch: Partial<GravityConfig>) => {
    if (target) onChange({ ...target, config: { ...target.config, ...patch } })
  }

  return (
    <Dialog open={!!target} onOpenChange={onCancel}>
      <DialogContent className="sm:max-w-md z-[10000]">
        <DialogHeader>
          <DialogTitle className="text-sm">Configurer {target?.deviceName}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Ajustez la portee et le FOV selon l&apos;environnement (murs, materiaux).
          </DialogDescription>
        </DialogHeader>
        {target && (
          <div className="flex flex-col gap-4 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Portee effective</label>
                <span className="text-xs font-mono text-muted-foreground">{target.config.effectiveRange}m</span>
              </div>
              <input
                type="range"
                min="2"
                max="12"
                step="0.5"
                value={target.config.effectiveRange}
                onChange={(e) => setConfig({ effectiveRange: parseFloat(e.target.value) })}
                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <div className="flex justify-between text-2xs text-muted-foreground">
                <span>2m (parpaing)</span>
                <span>6m (PVC)</span>
                <span>12m (libre)</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">FOV effectif</label>
                <span className="text-xs font-mono text-muted-foreground">{target.config.effectiveFov}°</span>
              </div>
              <input
                type="range"
                min="20"
                max="72"
                step="2"
                value={target.config.effectiveFov}
                onChange={(e) => setConfig({ effectiveFov: parseFloat(e.target.value) })}
                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <div className="flex justify-between text-2xs text-muted-foreground">
                <span>20° (bois epais)</span>
                <span>50° (porte)</span>
                <span>72° (libre)</span>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Presets</label>
              <div className="flex flex-wrap gap-1">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => onChange({ ...target, config: preset.config })}
                    className="text-xs px-2 py-1 rounded border border-border/50 hover:bg-muted/50 transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>Annuler</Button>
          <Button size="sm" onClick={() => target && onConfirm(target)}>Valider</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
