"use client"

import { useEffect, useRef, useState } from "react"
import type { MapOverlay } from "@/lib/types"
import { solveHomography, homographyToMatrix3d, isConvexQuad, type Pt } from "@/lib/homography"
import { loadImage, renderSketch } from "@/lib/sketch-process"

/**
 * Draws image overlays (hand-drawn plans, later drone photos) on the Leaflet map, each
 * warped onto four corners with a CSS matrix3d, and lets one of them be pinned by dragging
 * those corners.
 *
 * The images live in their own pane between the tiles (z 200) and the vectors (z 400): above
 * the basemap, under the zones, sensors and detections -- a reference to read the rest
 * against, never something that hides a detection. They are hidden during the zoom animation
 * and re-projected when it ends, rather than animated: a projective warp cannot be expressed
 * as the scale-and-translate Leaflet animates with.
 */

const PANE = "theia-overlay-pane"

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  L: any
  overlays: MapOverlay[]
  imageUrl: (overlay: MapOverlay) => string
  /** The overlay whose corners are draggable, if any. */
  editingId?: string | null
  /** Called when a drag ends, with the corners to save. Not during the drag: see below. */
  onCornersChange?: (id: string, corners: [number, number][]) => void
}

interface Rendered {
  key: string
  url: string
  w: number
  h: number
}

const renderKey = (o: MapOverlay) => `${o.image}|${JSON.stringify(o.crop)}|${JSON.stringify(o.style)}`

export default function ImageOverlayLayer({ map, L, overlays, imageUrl, editingId, onCornersChange }: Props) {
  // Processed images, by crop+style. Processing is the expensive step; re-projection is not.
  const [rendered, setRendered] = useState<Record<string, Rendered>>({})
  const renderedRef = useRef(rendered)
  renderedRef.current = rendered

  useEffect(() => {
    let cancelled = false
    for (const o of overlays) {
      const key = renderKey(o)
      if (renderedRef.current[o.id]?.key === key) continue
      ;(async () => {
        try {
          const img = await loadImage(imageUrl(o))
          const canvas = renderSketch(img, o.crop, o.style)
          const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"))
          if (!blob || cancelled) return
          const url = URL.createObjectURL(blob)
          setRendered((prev) => {
            const old = prev[o.id]
            if (old) URL.revokeObjectURL(old.url)
            return { ...prev, [o.id]: { key, url, w: canvas.width, h: canvas.height } }
          })
        } catch (e) {
          console.warn("[THEIA] overlay image failed:", o.id, e)
        }
      })()
    }
    return () => { cancelled = true }
  }, [overlays, imageUrl])

  useEffect(() => () => {
    for (const r of Object.values(renderedRef.current)) URL.revokeObjectURL(r.url)
  }, [])

  /*
   * Corners being dragged, not yet saved. The drag previews from here and only the drop is
   * reported to the parent: reporting every move would re-render the page, rebuild the image
   * elements under the finger and fire a save per pixel.
   */
  const liveCorners = useRef<Record<string, [number, number][]>>({})
  const placeRef = useRef<() => void>(() => {})

  // ── the <img> elements, re-projected on every zoom ─────────────────────────────────────
  useEffect(() => {
    if (!map) return
    if (!map.getPane(PANE)) {
      const pane = map.createPane(PANE)
      pane.style.zIndex = "350"
      pane.style.pointerEvents = "none"
    }
    const pane = map.getPane(PANE) as HTMLElement
    const imgs: HTMLImageElement[] = []

    const place = () => {
      for (const el of imgs) {
        const id = el.dataset.overlayId!
        const o = overlays.find((x) => x.id === id)
        const r = rendered[id]
        if (!o || !r) continue
        const corners = liveCorners.current[id] ?? o.corners
        const dst = corners.map(([lat, lon]) => {
          const p = map.latLngToLayerPoint([lat, lon])
          return [p.x, p.y] as Pt
        })
        const H = solveHomography([[0, 0], [r.w, 0], [r.w, r.h], [0, r.h]], dst)
        el.style.display = H ? "" : "none"
        if (H) el.style.transform = homographyToMatrix3d(H)
      }
    }

    for (const o of overlays) {
      const r = rendered[o.id]
      if (!r || o.corners?.length !== 4) continue
      const el = document.createElement("img")
      el.src = r.url
      el.dataset.overlayId = o.id
      el.className = "leaflet-zoom-hide"
      el.draggable = false
      el.alt = ""
      Object.assign(el.style, {
        position: "absolute",
        left: "0",
        top: "0",
        width: `${r.w}px`,
        height: `${r.h}px`,
        maxWidth: "none",
        transformOrigin: "0 0",
        opacity: String(o.opacity),
        pointerEvents: "none",
      })
      pane.appendChild(el)
      imgs.push(el)
    }
    placeRef.current = place
    place()
    map.on("zoomend viewreset", place)
    return () => {
      map.off("zoomend viewreset", place)
      imgs.forEach((el) => el.remove())
      placeRef.current = () => {}
    }
  }, [map, overlays, rendered])

  // ── corner handles for the overlay being pinned ─────────────────────────────────────────
  useEffect(() => {
    if (!map || !L || !editingId) return
    const o = overlays.find((x) => x.id === editingId)
    if (!o || o.corners?.length !== 4) return
    const id = o.id
    liveCorners.current[id] = o.corners.map((c) => [...c] as [number, number])
    const corners = () => liveCorners.current[id]
    const centre = (): [number, number] => [
      corners().reduce((s, c) => s + c[0], 0) / 4,
      corners().reduce((s, c) => s + c[1], 0) / 4,
    ]
    const toPx = (cs: [number, number][]) =>
      cs.map(([lat, lon]) => { const p = map.latLngToLayerPoint([lat, lon]); return [p.x, p.y] as Pt })

    const handle = (html: string) => L.divIcon({
      className: "theia-vertex",
      html: `<div class="theia-vertex-hit" style="cursor:grab">${html}</div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    })

    // Bring all four handles on screen, with room around them for a finger. Without this, on a
    // phone at high zoom the first placement put corners at the very edge of the map or past
    // it -- seen in testing, corner 3 was simply unreachable.
    map.fitBounds(L.latLngBounds(corners()), { padding: [56, 56], maxZoom: map.getMaxZoom?.() ?? 22, animate: false })

    const outline = L.polygon(corners(), {
      color: "#f59e0b", weight: 2, dashArray: "6 4", fill: false, interactive: false,
    }).addTo(map)

    const mover = L.marker(centre(), {
      icon: handle(`<span class="theia-vertex-dot" style="background:#0ea5e9">&#10021;</span>`),
      draggable: true,
      zIndexOffset: 1200,
    }).addTo(map)

    const redraw = () => {
      outline.setLatLngs(corners())
      mover.setLatLng(centre())
      placeRef.current()
    }

    const cornerMarkers = corners().map((c, i) => {
      const m = L.marker(c, {
        icon: handle(`<span class="theia-vertex-dot" style="background:#f59e0b">${i + 1}</span>`),
        draggable: true,
        zIndexOffset: 1100,
      }).addTo(map)
      let lastGood: [number, number] = [...c] as [number, number]
      const move = (final: boolean) => {
        const ll = m.getLatLng()
        const next = corners().map((p) => [...p] as [number, number])
        next[i] = [ll.lat, ll.lng]
        // A crossed quad folds the picture through infinity. Refuse it and snap back on drop.
        if (!isConvexQuad(toPx(next))) {
          if (final) m.setLatLng(lastGood)
          return
        }
        lastGood = next[i]
        liveCorners.current[id] = next
        redraw()
        if (final) onCornersChange?.(id, next)
      }
      m.on("drag", () => move(false))
      m.on("dragend", () => move(true))
      return m
    })

    // Centre handle: moves the whole picture, for the coarse placement before the corners.
    let from = centre()
    mover.on("dragstart", () => { from = centre() })
    const shift = (final: boolean) => {
      const to = mover.getLatLng()
      const dLat = to.lat - from[0]
      const dLon = to.lng - from[1]
      from = [to.lat, to.lng]
      const next = corners().map(([lat, lon]) => [lat + dLat, lon + dLon] as [number, number])
      liveCorners.current[id] = next
      next.forEach((c, i) => cornerMarkers[i].setLatLng(c))
      outline.setLatLngs(next)
      placeRef.current()
      if (final) onCornersChange?.(id, next)
    }
    mover.on("drag", () => shift(false))
    mover.on("dragend", () => shift(true))

    return () => {
      outline.remove()
      mover.remove()
      cornerMarkers.forEach((m: { remove: () => void }) => m.remove())
      delete liveCorners.current[id]
    }
    // Rebuild handles only when WHICH overlay is edited changes -- not when the parent echoes
    // a saved corner back, which would tear a handle out from under the finger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, L, editingId])

  return null
}
