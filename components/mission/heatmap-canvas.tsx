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
    [0,   0,   0,   0,   0],
    [20,  0,   0,   0,   0],     // noise floor: transparent
    [45,  10,  20,  140, 120],   // deep blue
    [75,  20,  80,  200, 160],   // blue
    [100, 20,  160, 220, 180],   // cyan
    [125, 40,  200, 100, 200],   // green
    [150, 170, 220, 30,  215],   // yellow-green
    [175, 240, 200, 0,   230],   // yellow
    [200, 255, 140, 0,   240],   // orange
    [230, 255, 50,  0,   250],   // red
    [255, 160, 0,   0,   255],   // dark red
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

/**
 * Compute how many pixels correspond to `meters` at the current map zoom & center.
 */
function metersToPixels(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any,
  meters: number,
): number {
  const center = map.getCenter()
  const lat = center.lat
  // At any zoom, Leaflet uses: pixelsPerDeg = 256 * 2^zoom / 360 (for longitude)
  // Meters per degree longitude = 111320 * cos(lat)
  // So pixelsPerMeter = pixelsPerDeg / metersPerDeg
  const zoom = map.getZoom()
  const metersPerDegLon = 111320 * Math.cos(lat * Math.PI / 180)
  const pixelsPerDegLon = (256 * Math.pow(2, zoom)) / 360
  const pixelsPerMeter = pixelsPerDegLon / metersPerDegLon
  return meters * pixelsPerMeter
}

export default function HeatmapCanvas({
  map,
  points,
  radiusMeters = 1.5,
  opacity = 0.75,
  enabled = true,
  zonePolygons = [],
}: HeatmapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Create / destroy the canvas element on the map container
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
    if (!canvas || !map) return
    const container = map.getContainer() as HTMLElement
    const w = container.clientWidth
    const h = container.clientHeight
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    if (!enabled || points.length === 0) return

    const radiusPx = Math.max(8, Math.round(metersToPixels(map, radiusMeters)))

    // ── Phase 1: Draw gray-scale intensity on an offscreen canvas ──
    // Use radialGradient circles (GPU-accelerated) with additive blending
    const offscreen = document.createElement("canvas")
    offscreen.width = w
    offscreen.height = h
    const octx = offscreen.getContext("2d")
    if (!octx) return

    // Clip to zone polygons so we only draw inside zones
    if (zonePolygons.length > 0) {
      octx.beginPath()
      for (const poly of zonePolygons) {
        for (let i = 0; i < poly.length; i++) {
          const px = map.latLngToContainerPoint([poly[i][0], poly[i][1]])
          if (i === 0) octx.moveTo(px.x, px.y)
          else octx.lineTo(px.x, px.y)
        }
        octx.closePath()
      }
      octx.clip()
    }

    // Find max weight for intensity scaling
    let maxW = 1
    for (const pt of points) if (pt.weight > maxW) maxW = pt.weight

    // Draw each point as a radialGradient circle (white center -> transparent edge)
    // Using "lighter" composite: overlapping splats accumulate brightness
    octx.globalCompositeOperation = "lighter"
    for (const pt of points) {
      const px = map.latLngToContainerPoint([pt.lat, pt.lon])
      const cx = px.x
      const cy = px.y
      // Skip off-screen points
      if (cx < -radiusPx || cy < -radiusPx || cx > w + radiusPx || cy > h + radiusPx) continue

      const strength = Math.min(1, pt.weight / maxW)
      // Use intensity 0.3-1.0 based on weight (avoid pure black for low-weight points)
      const alpha = 0.3 + 0.7 * strength

      const gradient = octx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx)
      gradient.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(2)})`)
      gradient.addColorStop(0.4, `rgba(255,255,255,${(alpha * 0.6).toFixed(2)})`)
      gradient.addColorStop(1, "rgba(255,255,255,0)")
      octx.fillStyle = gradient
      octx.fillRect(cx - radiusPx, cy - radiusPx, radiusPx * 2, radiusPx * 2)
    }

    // ── Phase 2: Read grayscale intensity and map through thermal palette ──
    const offData = octx.getImageData(0, 0, w, h)
    const offPx = offData.data
    const imageData = ctx.createImageData(w, h)
    const out = imageData.data

    for (let i = 0; i < w * h; i++) {
      // The red channel captures the accumulated brightness (all channels are equal for white)
      const gray = offPx[i * 4]  // 0-255
      if (gray < 5) continue  // skip near-zero (noise floor)

      const idx = gray * 4
      const oi = i * 4
      out[oi]     = PALETTE[idx]
      out[oi + 1] = PALETTE[idx + 1]
      out[oi + 2] = PALETTE[idx + 2]
      out[oi + 3] = Math.round(PALETTE[idx + 3] * opacity)
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

  // Redraw whenever points change
  useEffect(() => { draw() }, [draw])

  return null
}
