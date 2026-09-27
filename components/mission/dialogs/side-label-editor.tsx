"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Names the faces of a zone.
 *
 * A polygon has one segment per pair of points, but a wall is often drawn as several
 * near-parallel segments, so segments are grouped into faces before they get here and the
 * operator names faces, not segments. The segment letters under each face key are what makes
 * the grouping visible -- without them, "face B" on screen and "segment B" on the map look
 * like the same thing when they are not.
 *
 * Both zone dialogs render this. They used to hold near-identical copies that had already
 * drifted apart in small ways (one sorted its keys, the other did not).
 */
export function SideLabelEditor({
  labels,
  onChange,
  sideGrouping,
  idPrefix,
  segmentCount,
}: {
  labels: Record<string, string>
  onChange: (next: Record<string, string>) => void
  /** Per polygon segment, the face it belongs to. Index is the segment number. */
  sideGrouping: string[]
  /** Distinguishes the create and edit dialogs' form fields on the page. */
  idPrefix: string
  /** When given, shown next to the face count -- the create dialog reports both. */
  segmentCount?: number
}) {
  const keys = Object.keys(labels).sort()
  if (keys.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <Label className="text-xs text-muted-foreground">
        Faces ({keys.length} faces{segmentCount !== undefined ? ` - ${segmentCount} segments` : ""})
      </Label>
      <div className="flex flex-col gap-2">
        {keys.map((groupKey) => {
          const segmentLetters = sideGrouping
            .map((g, i) => (g === groupKey ? String.fromCharCode(65 + i) : null))
            .filter((l): l is string => l !== null)
          return (
            <div key={groupKey} className="flex items-center gap-2">
              <div className="flex flex-col items-center shrink-0 w-10">
                <span className="text-xs font-mono font-bold text-info">{groupKey}</span>
                <span className="text-2xs text-muted-foreground font-mono">
                  {segmentLetters.length > 1 ? segmentLetters.join(",") : `seg ${segmentLetters[0] ?? groupKey}`}
                </span>
              </div>
              <Input
                id={`${idPrefix}-${groupKey}`}
                name={`${idPrefix}-${groupKey}`}
                placeholder={`Face ${groupKey}${segmentLetters.length > 1 ? ` (${segmentLetters.join("+")} paralleles)` : ""}`}
                value={labels[groupKey]}
                onChange={(e) => onChange({ ...labels, [groupKey]: e.target.value })}
                className="bg-input/50 border-border text-xs h-9"
              />
            </div>
          )
        })}
      </div>
      <p className="text-2xs text-muted-foreground">
        Les segments paralleles sont regroupes automatiquement sous la meme face.
      </p>
    </div>
  )
}
