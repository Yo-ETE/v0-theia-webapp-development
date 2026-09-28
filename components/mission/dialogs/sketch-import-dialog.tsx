"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, Loader2 } from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { backendOrigin } from "@/lib/backend"
import type { MapOverlay } from "@/lib/types"
import { DEFAULT_CROP, DEFAULT_STYLE, loadImage, renderSketch, type SketchCrop, type SketchStyle } from "@/lib/sketch-process"

/** Ink colours that stay legible on satellite imagery, OSM and IGN alike. */
const INKS = [
  { value: "#22d3ee", label: "Cyan" },
  { value: "#facc15", label: "Jaune" },
  { value: "#f472b6", label: "Rose" },
  { value: "#ffffff", label: "Blanc" },
  { value: "#ef4444", label: "Rouge" },
]

export const overlayImageUrl = (missionId: string, image: string) =>
  `${backendOrigin()}/api/missions/${missionId}/overlay-images/${image}`

type Uploaded = { image: string; width: number; height: number }

/**
 * Import a plan (a photo of a drawing, or any picture), crop it and extract the ink.
 * Placement on the map happens afterwards, on the map itself, by dragging four corners.
 *
 * With `initial`, re-opens an existing overlay to change its crop or its détourage; its
 * placement is kept.
 */
export function SketchImportDialog({
  open,
  onClose,
  missionId,
  initial,
  defaultLabel,
  onSave,
}: {
  open: boolean
  onClose: () => void
  missionId: string
  initial?: MapOverlay | null
  defaultLabel: string
  onSave: (draft: Pick<MapOverlay, "image" | "width" | "height" | "crop" | "style" | "label">) => void
}) {
  const [uploaded, setUploaded] = useState<Uploaded | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [crop, setCrop] = useState<SketchCrop>(DEFAULT_CROP)
  const [style, setStyle] = useState<SketchStyle>(DEFAULT_STYLE)
  const [label, setLabel] = useState(defaultLabel)
  const fileRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  // Reset every time the dialog opens.
  useEffect(() => {
    if (!open) return
    setError(null)
    setImg(null)
    if (initial) {
      setUploaded({ image: initial.image, width: initial.width, height: initial.height })
      setCrop(initial.crop)
      setStyle(initial.style)
      setLabel(initial.label)
    } else {
      setUploaded(null)
      setCrop(DEFAULT_CROP)
      setStyle(DEFAULT_STYLE)
      setLabel(defaultLabel)
    }
  }, [open, initial, defaultLabel])

  // The server copy, not the local file: the server converts HEIC (iPhone) to JPEG, and a
  // browser that cannot decode HEIC could not process the local file at all.
  useEffect(() => {
    if (!uploaded) return
    let cancelled = false
    loadImage(overlayImageUrl(missionId, uploaded.image))
      .then((i) => { if (!cancelled) setImg(i) })
      .catch((e) => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [uploaded, missionId])

  const upload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const res = await fetch(`${backendOrigin()}/api/missions/${missionId}/overlay-images`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": file.name },
        body: file,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.detail || `Envoi refuse (${res.status})`)
      setUploaded(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible")
    } finally {
      setUploading(false)
    }
  }

  // The uncropped photo, for the crop box. loadImage revokes its blob: URL once decoded, so
  // the <img> needs its own copy.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!img) return
    const canvas = renderSketch(img, DEFAULT_CROP, { ...DEFAULT_STYLE, removeBackground: false }, 1200)
    let url: string | null = null
    canvas.toBlob((blob) => {
      if (!blob) return
      url = URL.createObjectURL(blob)
      setPhotoUrl(url)
    }, "image/jpeg", 0.85)
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [img])

  // ── processed preview, recomputed after the controls settle ───────────────────────────
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!img) return
    const t = setTimeout(() => {
      const canvas = renderSketch(img, crop, style, 900)
      canvas.toBlob((blob) => {
        if (!blob) return
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old)
          return URL.createObjectURL(blob)
        })
      }, "image/png")
    }, 150)
    return () => clearTimeout(t)
  }, [img, crop, style])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  // ── crop: drag the corners of a rectangle over the photo ────────────────────────────────
  const dragCorner = useCallback((corner: "tl" | "tr" | "br" | "bl") => (e: React.PointerEvent) => {
    e.preventDefault()
    const box = previewRef.current?.getBoundingClientRect()
    if (!box) return
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      const fx = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width))
      const fy = Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height))
      setCrop((c) => {
        let x0 = c.x, y0 = c.y, x1 = c.x + c.w, y1 = c.y + c.h
        if (corner === "tl" || corner === "bl") x0 = Math.min(fx, x1 - 0.05)
        if (corner === "tr" || corner === "br") x1 = Math.max(fx, x0 + 0.05)
        if (corner === "tl" || corner === "tr") y0 = Math.min(fy, y1 - 0.05)
        if (corner === "bl" || corner === "br") y1 = Math.max(fy, y0 + 0.05)
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
      })
    }
    const onUp = () => {
      target.removeEventListener("pointermove", onMove)
      target.removeEventListener("pointerup", onUp)
      target.removeEventListener("pointercancel", onUp)
    }
    target.addEventListener("pointermove", onMove)
    target.addEventListener("pointerup", onUp)
    target.addEventListener("pointercancel", onUp)
  }, [])

  const corners: { key: "tl" | "tr" | "br" | "bl"; x: number; y: number }[] = [
    { key: "tl", x: crop.x, y: crop.y },
    { key: "tr", x: crop.x + crop.w, y: crop.y },
    { key: "br", x: crop.x + crop.w, y: crop.y + crop.h },
    { key: "bl", x: crop.x, y: crop.y + crop.h },
  ]

  const canSave = !!uploaded && !!img && label.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl z-[10000] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">{initial ? "Detourage du croquis" : "Importer un croquis"}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Photo d&apos;un plan dessine, ou toute image. Vous le calerez ensuite sur la carte
            en faisant glisser ses quatre coins. Un croquis n&apos;est pas a l&apos;echelle : il sert de
            repere et n&apos;influence jamais le calcul des detections.
          </DialogDescription>
        </DialogHeader>

        {!uploaded ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.heic,.heif"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = "" }}
            />
            <Button className="gap-2 min-h-[48px]" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              {uploading ? "Envoi..." : "Prendre une photo ou choisir une image"}
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        ) : !img ? (
          <div className="flex flex-col items-center gap-2 py-10">
            {error
              ? <p className="text-xs text-destructive">{error}</p>
              : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Recadrage -- faites glisser les coins</Label>
              <p className="text-2xs text-warning">
                Recadrez au ras des murs exterieurs : les quatre coins du recadrage sont ceux que vous
                calerez ensuite sur les angles du batiment.
              </p>
              <div ref={previewRef} className="relative w-full select-none touch-none overflow-hidden rounded border border-border/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {photoUrl
                  ? <img src={photoUrl} alt="" className="block w-full h-auto" draggable={false} />
                  : <div className="h-48 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
                <div
                  className="absolute border-2 border-warning pointer-events-none"
                  style={{
                    left: `${crop.x * 100}%`, top: `${crop.y * 100}%`,
                    width: `${crop.w * 100}%`, height: `${crop.h * 100}%`,
                    boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                  }}
                />
                {corners.map((c) => (
                  <div
                    key={c.key}
                    onPointerDown={dragCorner(c.key)}
                    className="absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center cursor-grab"
                    style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                  >
                    <span className="block h-4 w-4 rounded-full bg-warning border-2 border-background" />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sketch-label" className="text-xs text-muted-foreground">Nom</Label>
                  <Input id="sketch-label" value={label} onChange={(e) => setLabel(e.target.value)} className="text-sm" />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Detourer (papier transparent)</Label>
                  <Switch
                    checked={style.removeBackground}
                    onCheckedChange={(v) => setStyle((s) => ({ ...s, removeBackground: v }))}
                  />
                </div>
                {style.removeBackground && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-2xs text-muted-foreground">
                        <span>Trait appuye</span>
                        <span>Crayon leger</span>
                      </div>
                      <input
                        type="range" min={0} max={1} step={0.05}
                        value={style.sensitivity}
                        onChange={(e) => setStyle((s) => ({ ...s, sensitivity: parseFloat(e.target.value) }))}
                        className="w-full accent-primary"
                        aria-label="Sensibilite du detourage"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      {INKS.map((ink) => (
                        <button
                          key={ink.value}
                          type="button"
                          title={ink.label}
                          aria-label={`Encre ${ink.label}`}
                          onClick={() => setStyle((s) => ({ ...s, inkColor: ink.value }))}
                          className={cn(
                            "h-9 w-9 rounded-full border-2 transition-transform",
                            style.inkColor === ink.value ? "border-foreground scale-110" : "border-border/50",
                          )}
                          style={{ backgroundColor: ink.value }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Apercu sur fond sombre</Label>
                <div
                  className="rounded border border-border/50 p-2 flex items-center justify-center min-h-[160px]"
                  style={{
                    backgroundColor: "#1f2a1f",
                    backgroundImage: "linear-gradient(45deg,#263226 25%,transparent 25%,transparent 75%,#263226 75%),linear-gradient(45deg,#263226 25%,transparent 25%,transparent 75%,#263226 75%)",
                    backgroundSize: "16px 16px",
                    backgroundPosition: "0 0,8px 8px",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {previewUrl && <img src={previewUrl} alt="Apercu du croquis detoure" className="max-h-64 w-auto" />}
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Annuler</Button>
          <Button
            size="sm"
            disabled={!canSave}
            onClick={() => uploaded && onSave({ ...uploaded, crop, style, label: label.trim() })}
          >
            {initial ? "Appliquer" : "Placer sur la carte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
