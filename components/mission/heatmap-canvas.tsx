"use client"

import { useEffect, useRef, useCallback } from "react"

// ── Types ──────────────────────────────────────────────────────

export interface HeatPoint {
  lat: number
  lon: number
  weight: number
}

interface HeatmapCanvasProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any
  points: HeatPoint[]
  /** Gaussian splat radius in METERS on the ground */
  radiusMeters?: number
  opacity?: number
  enabled?: boolean
  /** Zone polygons to clip the heatmap to -- array of [lat,lon][] */
  zonePolygons?: [number, number][][]
}

// ── Thermal palette (256 RGBA entries) ──────────────────────────
// transparent -> blue -> cyan -> green -> yellow -> orange -> red -> dark red
function buildPalette(): Uint8ClampedArray {
  const p = new Uint8ClampedArray(256 * 4)
  const stops: [number, number, number, number, number][] = [
    [0,   0,   0,   0,   0],     // transparent
    [25,  0,   0,   0,   0],     // transparent (noise floor)
    [50,  10,  20,  140, 80],    // deep blue
    [80,  20,  80,  200, 140],   // blue
    [110, 20,  160, 220, 170],   // cyan
    [140, 40,  200, 100, 190],   // green
    [165, 170, 220, 30,  210],   // yellow-green
    [190, 240, 200, 0,   225],   // yellow
    [215, 255, 140, 0,   240],   // orange
    [238, 255, 50,  0,   250],   // red
    [255, 160, 0,   0,   255],   // dark red / maroon
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, r0, g0, b0, a0] = stops[i]
    const [p1, r1, g1, b1, a1] = stops[i + 1]
    for (let j = p0; j <= p1; j++) {
      const t = (j - p0) / Math.max(1, p1 - p0)
      p[j * 4 + 0] = Math.round(r0 + (r1 - r0) * t)
      p[j * 4 + 1] = Math.round(g0 + (g1 - g0) * t)
      p[j * 4 + 2] = Math.round(b0 + (b1 - b0) * t)
      p[j * 4 + 3] = Math.round(a0 + (a1 - a0) * t)
    }
  }
  return p
}

const PALETTE = buildPalette()

export default function HeatmapCanvas({
  map,
  points,
  radiusMeters = 1.5,
  opacity = 0.75,
  enabled = true,
  zonePolygons = [],
}: HeatmapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Create/destroy the canvas element
  useEffect(() => {
    if (!map || !enabled) return
    const container = map.getContainer() as HTMLElement
    if (!container) return
    const canvas = document.createElement("canvas")
    canvas.style.position = "absolute"
    canvas.style.top = "0"
    canvas.style.left = "0"
    canvas.style.width = "100%"
    canvas.style.height = "100%"
    canvas.style.pointerEvents = "none"
    canvas.style.zIndex = "450"
    container.appendChild(canvas)
    canvasRef.current = canvas
    return () => {
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      canvasRef.current = null
    }
  }, [map, enabled])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !map || !enabled || points.length === 0) {
      if (canvas) {
        const ctx = canvas.getContext("2d")
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
      return
    }

    const container = map.getContainer() as HTMLElement
    const w = container.clientWidth
    const h = container.clientHeight
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Compute meters-per-pixel at current zoom using map's built-in method
    const center = map.getCenter()
    const p1 = map.latLngToContainerPoint(center)
    const p2LL = map.containerPointToLatLng({ x: p1.x + 100, y: p1.y })
    const dLon = Math.abs(p2LL.lng - center.lng)
    const metersPerPixel = (dLon * (Math.PI / 180) * 6371000 * Math.cos(center.lat * Math.PI / 180)) / 100
    const radiusPx = Math.max(12, Math.round(radiusMeters / metersPerPixel))

    // Debug first draw
    const debugPts = points.slice(0, 3).map(pt => {
      const px = map.latLngToContainerPoint([pt.lat, pt.lon])
      return { lat: pt.lat.toFixed(6), lon: pt.lon.toFixed(6), px: [Math.round(px.x), Math.round(px.y)], w: pt.weight }
    })
    console.log("[v0] HeatmapCanvas:", { w, h, radiusPx, mpp: metersPerPixel.toFixed(4), pts: points.length, debugPts, zones: zonePolygons.length })

    // ── Build zone clip mask (1 = inside zone, 0 = outside) ──
    let clipMask: Uint8Array | null = null
    if (zonePolygons.length > 0) {
      // Draw zone polygons to a temporary canvas as white-on-black
      const maskCanvas = document.createElement("canvas")
      maskCanvas.width = w
      maskCanvas.height = h
      const mctx = maskCanvas.getContext("2d")!
      mctx.fillStyle = "black"
      mctx.fillRect(0, 0, w, h)
      mctx.fillStyle = "white"
      for (const poly of zonePolygons) {
        mctx.beginPath()
        for (let i = 0; i < poly.length; i++) {
          const px = map.latLngToContainerPoint([poly[i][0], poly[i][1]])
          if (i === 0) mctx.moveTo(px.x, px.y)
          else mctx.lineTo(px.x, px.y)
        }
        mctx.closePath()
        mctx.fill()
      }
      // Read mask
      const maskData = mctx.getImageData(0, 0, w, h).data
      clipMask = new Uint8Array(w * h)
      for (let i = 0; i < w * h; i++) {
        clipMask[i] = maskData[i * 4] > 128 ? 1 : 0  // white = inside
      }
    }

    // ── Pass 1: accumulate Gaussian splats into float intensity buffer ──
    const intensity = new Float32Array(w * h)

    // Find max weight for normalization
    let maxW = 1
    for (const pt of points) { if (pt.weight > maxW) maxW = pt.weight }

    for (const pt of points) {
      const px = map.latLngToContainerPoint([pt.lat, pt.lon])
      const cx = Math.round(px.x)
      const cy = Math.round(px.y)
      // Skip if outside viewport with margin
      if (cx < -radiusPx || cy < -radiusPx || cx > w + radiusPx || cy > h + radiusPx) continue

      const strength = pt.weight / maxW

      // Stamp Gaussian splat
      const x0 = cx - radiusPx
      const y0 = cy - radiusPx
      const size = radiusPx * 2
      for (let by = 0; by < size; by++) {
        const iy = y0 + by
        if (iy < 0 || iy >= h) continue
        const rowOffset = iy * w
        for (let bx = 0; bx < size; bx++) {
          const ix = x0 + bx
          if (ix < 0 || ix >= w) continue
          // Gaussian falloff
          const dx = (bx - radiusPx) / radiusPx
          const dy = (by - radiusPx) / radiusPx
          const r2 = dx * dx + dy * dy
          if (r2 > 1) continue
          const g = Math.exp(-3 * r2) * strength
          intensity[rowOffset + ix] += g
        }
      }
    }

    // ── Pass 2: find max intensity, apply noise floor, colorize ──
    let maxI = 0
    for (let i = 0; i < intensity.length; i++) {
      if (intensity[i] > maxI) maxI = intensity[i]
    }
    if (maxI < 0.001) return  // nothing to draw

    const imageData = ctx.createImageData(w, h)
    const pixels = imageData.data
    const noiseFloor = maxI * 0.05  // ignore anything below 5% of peak

    for (let i = 0; i < intensity.length; i++) {
      const val = intensity[i]
      if (val <= noiseFloor) continue
      // Zone clip check
      if (clipMask && !clipMask[i]) continue

      const norm = Math.min(1, val / maxI)
      const idx = Math.round(norm * 255) * 4
      const pi = i * 4
      pixels[pi]     = PALETTE[idx]
      pixels[pi + 1] = PALETTE[idx + 1]
      pixels[pi + 2] = PALETTE[idx + 2]
      pixels[pi + 3] = Math.round(PALETTE[idx + 3] * opacity)
    }

    ctx.putImageData(imageData, 0, 0)
  }, [map, points, radiusMeters, opacity, enabled, zonePolygons])

  // Redraw on map events
  useEffect(() => {
    if (!map || !enabled) return
    draw()
    map.on("moveend", draw)
    map.on("zoomend", draw)
    map.on("resize", draw)
    return () => {
      map.off("moveend", draw)
      map.off("zoomend", draw)
      map.off("resize", draw)
    }
  }, [map, draw, enabled])

  // Redraw when points change
  useEffect(() => { draw() }, [draw])

  return null
}
