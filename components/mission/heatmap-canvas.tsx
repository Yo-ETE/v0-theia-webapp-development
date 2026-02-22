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
  /** Base radius in METERS on the ground (e.g. 1.5 = 1.5m splat) */
  radiusMeters?: number
  opacity?: number
  enabled?: boolean
}

// ── Thermal palette (256 RGBA entries) ──────────────────────────
// transparent -> blue -> cyan -> green -> yellow -> orange -> red
function buildPalette(): Uint8ClampedArray {
  const p = new Uint8ClampedArray(256 * 4)
  const stops: [number, number, number, number, number][] = [
    [0,   0,   0,   0,   0],
    [20,  0,   0,   0,   0],      // fully transparent below noise floor
    [40,  10,  20,  120, 60],     // deep blue
    [70,  20,  60,  180, 120],    // blue
    [100, 20,  140, 210, 160],    // cyan
    [130, 30,  190, 90,  180],    // green
    [160, 160, 210, 30,  200],    // yellow-green
    [185, 230, 190, 0,   220],    // yellow
    [210, 250, 130, 0,   235],    // orange
    [235, 255, 50,  0,   248],    // red
    [255, 180, 0,   0,   255],    // dark red / maroon
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

// Pre-build a radial Gaussian brush (grayscale alpha) at a given pixel radius
function buildBrush(radius: number): HTMLCanvasElement {
  const size = radius * 2
  const c = document.createElement("canvas")
  c.width = size
  c.height = size
  const ctx = c.getContext("2d")!
  const grad = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius)
  // Smooth Gaussian-like falloff
  grad.addColorStop(0,    "rgba(0,0,0,1)")
  grad.addColorStop(0.15, "rgba(0,0,0,0.8)")
  grad.addColorStop(0.35, "rgba(0,0,0,0.5)")
  grad.addColorStop(0.6,  "rgba(0,0,0,0.2)")
  grad.addColorStop(0.85, "rgba(0,0,0,0.05)")
  grad.addColorStop(1,    "rgba(0,0,0,0)")
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  return c
}

export default function HeatmapCanvas({
  map,
  points,
  radiusMeters = 1.2,
  opacity = 0.72,
  enabled = true,
}: HeatmapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const brushCache = useRef<{ radius: number; brush: HTMLCanvasElement } | null>(null)

  // Create/destroy the canvas element in the map container (not a pane)
  useEffect(() => {
    if (!map || !enabled) return
    // Place canvas as a sibling of the map's container div for correct positioning
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
      if (canvas) { canvas.width = 0; canvas.height = 0 }
      return
    }

    // Match canvas pixel size to container
    const container = map.getContainer() as HTMLElement
    const w = container.clientWidth
    const h = container.clientHeight
    canvas.width = w
    canvas.height = h

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Convert radius in meters to pixels at current zoom
    // Use a reference point (center of map) to compute meters-per-pixel
    const center = map.getCenter()
    const p1 = map.latLngToContainerPoint(center)
    // Shift by 100px east to measure scale
    const p2LatLng = map.containerPointToLatLng({ x: p1.x + 100, y: p1.y })
    const dLon = Math.abs(p2LatLng.lng - center.lng)
    const metersPer100px = dLon * (Math.PI / 180) * 6371000 * Math.cos(center.lat * Math.PI / 180)
    const metersPerPixel = metersPer100px / 100
    const radiusPx = Math.max(8, Math.round(radiusMeters / metersPerPixel))

    // Get or rebuild brush
    if (!brushCache.current || brushCache.current.radius !== radiusPx) {
      brushCache.current = { radius: radiusPx, brush: buildBrush(radiusPx) }
    }
    const brush = brushCache.current.brush

    // ── Pass 1: accumulate Gaussian splats as grayscale alpha ──
    ctx.clearRect(0, 0, w, h)

    // Find max weight for normalization
    let maxW = 1
    for (const pt of points) {
      if (pt.weight > maxW) maxW = pt.weight
    }

    // Use a separate offscreen canvas for accumulation to avoid
    // issues with additive blending overflowing
    const offscreen = document.createElement("canvas")
    offscreen.width = w
    offscreen.height = h
    const offCtx = offscreen.getContext("2d")!
    offCtx.clearRect(0, 0, w, h)

    // Accumulate by drawing each brush stamp with proper alpha
    // We draw to a Float32 intensity buffer manually for precision
    const intensity = new Float32Array(w * h)

    for (const pt of points) {
      const px = map.latLngToContainerPoint([pt.lat, pt.lon])
      const cx = Math.round(px.x)
      const cy = Math.round(px.y)
      // Skip if way outside viewport
      if (cx < -radiusPx * 2 || cy < -radiusPx * 2 || cx > w + radiusPx * 2 || cy > h + radiusPx * 2) continue

      const strength = pt.weight / maxW

      // Stamp the Gaussian into the intensity buffer
      const x0 = cx - radiusPx
      const y0 = cy - radiusPx
      const brushSize = radiusPx * 2
      for (let by = 0; by < brushSize; by++) {
        const iy = y0 + by
        if (iy < 0 || iy >= h) continue
        for (let bx = 0; bx < brushSize; bx++) {
          const ix = x0 + bx
          if (ix < 0 || ix >= w) continue
          // Gaussian falloff from center
          const dx = (bx - radiusPx) / radiusPx
          const dy = (by - radiusPx) / radiusPx
          const r2 = dx * dx + dy * dy
          if (r2 > 1) continue
          // Gaussian: exp(-3*r^2) gives nice smooth falloff
          const g = Math.exp(-3 * r2) * strength
          intensity[iy * w + ix] += g
        }
      }
    }

    // Find max intensity for normalization
    let maxI = 0.001
    for (let i = 0; i < intensity.length; i++) {
      if (intensity[i] > maxI) maxI = intensity[i]
    }

    // ── Pass 2: colorize using thermal palette ──
    const imageData = ctx.createImageData(w, h)
    const pixels = imageData.data
    for (let i = 0; i < intensity.length; i++) {
      if (intensity[i] <= 0) continue
      const norm = Math.min(1, intensity[i] / maxI)
      const idx = Math.round(norm * 255) * 4
      const pi = i * 4
      pixels[pi]     = PALETTE[idx]
      pixels[pi + 1] = PALETTE[idx + 1]
      pixels[pi + 2] = PALETTE[idx + 2]
      pixels[pi + 3] = Math.round(PALETTE[idx + 3] * opacity)
    }

    ctx.putImageData(imageData, 0, 0)
  }, [map, points, radiusMeters, opacity, enabled])

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
