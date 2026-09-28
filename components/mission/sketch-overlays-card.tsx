"use client"

import { useState } from "react"
import { Eye, EyeOff, ImagePlus, Move, SlidersHorizontal, Trash2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { MapOverlay } from "@/lib/types"

/**
 * The plans pinned on this floor: show/hide, opacity, pin again, change the détourage,
 * delete. Everything but viewing changes the mission, so it needs `missions_edit`.
 */
export function SketchOverlaysCard({
  overlays,
  canEdit,
  editingId,
  onImport,
  onToggleEdit,
  onUpdate,
  onEditStyle,
  onDelete,
}: {
  overlays: MapOverlay[]
  canEdit: boolean
  editingId: string | null
  onImport: () => void
  onToggleEdit: (id: string) => void
  onUpdate: (id: string, patch: Partial<MapOverlay>) => void
  onEditStyle: (overlay: MapOverlay) => void
  onDelete: (id: string) => void
}) {
  // Two-step delete instead of a browser confirm(), which blocks the page on a phone.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs">Croquis ({overlays.length})</CardTitle>
          {canEdit && (
            <Button variant="outline" size="sm" className="min-h-[44px] text-xs px-3 gap-1.5" onClick={onImport}>
              <ImagePlus className="h-3.5 w-3.5" />
              Importer
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        {overlays.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            Un plan dessine par quelqu&apos;un qui connait les lieux, cale sur la carte. Repere visuel
            uniquement : il n&apos;est jamais utilise pour placer une detection.
          </p>
        ) : overlays.map((o) => {
          const editing = editingId === o.id
          return (
            <div key={o.id} className={cn("rounded border p-2 flex flex-col gap-2", editing ? "border-warning" : "border-border/50")}>
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full shrink-0 border border-border/50"
                  style={{ backgroundColor: o.style.removeBackground ? o.style.inkColor : "transparent" }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{o.label}</p>
                  <p className="text-2xs text-muted-foreground">Non a l&apos;echelle</p>
                </div>
                <Button
                  variant="ghost" size="icon" className="h-10 w-10"
                  disabled={!canEdit}
                  aria-label={o.visible ? "Masquer" : "Afficher"}
                  onClick={() => onUpdate(o.id, { visible: !o.visible })}
                >
                  {o.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </div>
              {canEdit && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-2xs text-muted-foreground w-14 shrink-0">Opacite</span>
                    <input
                      type="range" min={0.2} max={1} step={0.05}
                      value={o.opacity}
                      onChange={(e) => onUpdate(o.id, { opacity: parseFloat(e.target.value) })}
                      className="flex-1 accent-primary"
                      aria-label={`Opacite de ${o.label}`}
                    />
                    <span className="text-2xs font-mono text-muted-foreground w-9 text-right">{Math.round(o.opacity * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <Button
                      variant={editing ? "default" : "outline"} size="sm" className="min-h-[40px] text-xs gap-1.5"
                      onClick={() => onToggleEdit(o.id)}
                    >
                      <Move className="h-3.5 w-3.5" />
                      {editing ? "Terminer le calage" : "Caler"}
                    </Button>
                    <Button variant="outline" size="sm" className="min-h-[40px] text-xs gap-1.5" onClick={() => onEditStyle(o)}>
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      Detourage
                    </Button>
                    {confirmDelete === o.id ? (
                      <Button
                        variant="destructive" size="sm" className="min-h-[40px] text-xs ml-auto"
                        onClick={() => { setConfirmDelete(null); onDelete(o.id) }}
                      >
                        Confirmer
                      </Button>
                    ) : (
                      <Button
                        variant="ghost" size="icon" className="h-10 w-10 ml-auto text-destructive"
                        aria-label={`Supprimer ${o.label}`}
                        onClick={() => setConfirmDelete(o.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
