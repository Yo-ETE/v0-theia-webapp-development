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

    const radiusPxFull = Math.max(8, Math.round(metersToPixels(map, radiusMeters)))

    // ── Performance: downscale if radius is large (zoom 20+) ──
    // At high zoom, radiusPx can be 1000+ px. Working at full res would be
    // O(n * radiusPx^2) per point which freezes the browser.
    // We compute on a smaller buffer and then upscale.
    const MAX_RADIUS_PX = 80
    const scale = radiusPxFull > MAX_RADIUS_PX ? MAX_RADIUS_PX / radiusPxFull : 1
    const sw = Math.max(1, Math.round(w * scale))  // small width
    const sh = Math.max(1, Math.round(h * scale))  // small height
    const radiusPx = Math.round(radiusPxFull * scale)

    // Find max weight for intensity scaling
    let maxW = 1
    for (const pt of points) if (pt.weight > maxW) maxW = pt.weight

    // ── Phase 1: Accumulate intensity in a downscaled Float32 buffer ──
    const intensity = new Float32Array(sw * sh)

    for (const pt of points) {
      const px = map.latLngToContainerPoint([pt.lat, pt.lon])
      const cx = px.x * scale
      const cy = px.y * scale
      if (cx < -radiusPx || cy < -radiusPx || cx > sw + radiusPx || cy > sh + radiusPx) continue

      const strength = pt.weight / maxW

      const x0 = Math.max(0, Math.floor(cx - radiusPx))
      const x1 = Math.min(sw - 1, Math.ceil(cx + radiusPx))
      const y0 = Math.max(0, Math.floor(cy - radiusPx))
      const y1 = Math.min(sh - 1, Math.ceil(cy + radiusPx))
      const rSq = radiusPx * radiusPx

      for (let py = y0; py <= y1; py++) {
        const dy = py - cy
        const dySq = dy * dy
        for (let px2 = x0; px2 <= x1; px2++) {
          const dx = px2 - cx
          const distSq = dx * dx + dySq
          if (distSq > rSq) continue
          const g = Math.exp(-3 * distSq / rSq)
          intensity[py * sw + px2] += g * strength
        }
      }
    }

    // ── Phase 2: Clip to zone polygons (at downscaled resolution) ──
    const offscreen = document.createElement("canvas")
    offscreen.width = sw
    offscreen.height = sh
    const octx = offscreen.getContext("2d")
    if (!octx) return

    if (zonePolygons.length > 0) {
      octx.fillStyle = "#fff"
      octx.beginPath()
      for (const poly of zonePolygons) {
        for (let i = 0; i < poly.length; i++) {
          const pp = map.latLngToContainerPoint([poly[i][0], poly[i][1]])
          if (i === 0) octx.moveTo(pp.x * scale, pp.y * scale)
          else octx.lineTo(pp.x * scale, pp.y * scale)
        }
        octx.closePath()
      }
      octx.fill()
      const maskData = octx.getImageData(0, 0, sw, sh).data
      for (let i = 0; i < sw * sh; i++) {
        if (maskData[i * 4] === 0) intensity[i] = 0
      }
    }

    // ── Phase 3: Normalize intensity and map to thermal palette ──
    let maxI = 0
    for (let i = 0; i < sw * sh; i++) if (intensity[i] > maxI) maxI = intensity[i]
    if (maxI < 0.001) return

    // Create the colorized image at small resolution
    const smallImg = octx.createImageData(sw, sh)
    const out = smallImg.data
    const noiseFloor = maxI * 0.02

    for (let i = 0; i < sw * sh; i++) {
      const v = intensity[i]
      if (v < noiseFloor) continue
      const normalized = (v - noiseFloor) / (maxI - noiseFloor)
      const paletteIdx = Math.min(255, Math.round(25 + normalized * 230))
      const idx = paletteIdx * 4
      const oi = i * 4
      out[oi]     = PALETTE[idx]
      out[oi + 1] = PALETTE[idx + 1]
      out[oi + 2] = PALETTE[idx + 2]
      out[oi + 3] = Math.round(PALETTE[idx + 3] * opacity)
    }

    // ── Phase 4: Upscale to full resolution with smoothing ──
    octx.putImageData(smallImg, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(offscreen, 0, 0, sw, sh, 0, 0, w, h)
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
