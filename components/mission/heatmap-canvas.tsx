"use client"

import { useEffect, useRef, useCallback } from "react"

// ── Types ──────────────────────────────────────────────────────

interface HeatPoint {
  lat: number
  lon: number
  weight: number // 0..1 (will be accumulated)
}

interface HeatmapCanvasProps {
  /** Leaflet map instance (L.Map) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any
  /** Projected detection points in lat/lon with weight */
  points: HeatPoint[]
  /** Gaussian radius in pixels at current zoom */
  radius?: number
  /** Overall opacity of the overlay */
  opacity?: number
  /** Whether the heatmap is active */
  enabled?: boolean
}

// ── Thermal palette (256 RGBA entries) ──────────────────────────
// transparent -> blue -> cyan -> green -> yellow -> red
function buildPalette(): Uint8ClampedArray {
  const palette = new Uint8ClampedArray(256 * 4)
  const stops: [number, number, number, number, number][] = [
    // [position 0-255, R, G, B, A]
    [0, 0, 0, 0, 0],
    [25, 0, 0, 0, 0],      // fully transparent below threshold
    [50, 15, 20, 120, 80],  // deep blue, subtle
    [80, 30, 80, 200, 140], // blue
    [110, 20, 160, 220, 170], // cyan
    [140, 40, 200, 80, 190],  // green
    [170, 180, 220, 30, 210], // yellow-green
    [200, 240, 200, 0, 230],  // yellow
    [225, 255, 120, 0, 240],  // orange
    [245, 255, 40, 0, 250],   // red
    [255, 200, 0, 0, 255],    // dark red
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, r0, g0, b0, a0] = stops[i]
    const [p1, r1, g1, b1, a1] = stops[i + 1]
    for (let p = p0; p <= p1; p++) {
      const t = (p - p0) / (p1 - p0)
      palette[p * 4 + 0] = Math.round(r0 + (r1 - r0) * t)
      palette[p * 4 + 1] = Math.round(g0 + (g1 - g0) * t)
      palette[p * 4 + 2] = Math.round(b0 + (b1 - b0) * t)
      palette[p * 4 + 3] = Math.round(a0 + (a1 - a0) * t)
    }
  }
  return palette
}

const PALETTE = buildPalette()

// Pre-build a Gaussian brush (grayscale radial gradient) for a given radius
function buildBrush(radius: number): HTMLCanvasElement {
  const size = radius * 2
  const c = document.createElement("canvas")
  c.width = size
  c.height = size
  const ctx = c.getContext("2d")!
  const grad = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius)
  grad.addColorStop(0, "rgba(0,0,0,1)")
  grad.addColorStop(0.4, "rgba(0,0,0,0.6)")
  grad.addColorStop(0.7, "rgba(0,0,0,0.25)")
  grad.addColorStop(1, "rgba(0,0,0,0)")
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  return c
}

export default function HeatmapCanvas({
  map,
  points,
  radius = 40,
  opacity = 0.75,
  enabled = true,
}: HeatmapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const brushRef = useRef<HTMLCanvasElement | null>(null)
  const currentRadius = useRef(0)

  // Create/destroy canvas overlay
  useEffect(() => {
    if (!map || !enabled) return
    const pane = map.getPane("overlayPane")
    if (!pane) return
    const canvas = document.createElement("canvas")
    canvas.style.position = "absolute"
    canvas.style.top = "0"
    canvas.style.left = "0"
    canvas.style.pointerEvents = "none"
    canvas.style.zIndex = "450"  // above tiles, below markers
    pane.appendChild(canvas)
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
        canvas.width = 0
        canvas.height = 0
      }
      return
    }

    const size = map.getSize()
    const w = size.x
    const h = size.y
    canvas.width = w
    canvas.height = h
    // Align canvas with map origin
    const topLeft = map.containerPointToLayerPoint([0, 0])
    canvas.style.transform = `translate(${topLeft.x}px, ${topLeft.y}px)`

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Ensure brush
    if (!brushRef.current || currentRadius.current !== radius) {
      brushRef.current = buildBrush(radius)
      currentRadius.current = radius
    }
    const brush = brushRef.current

    // Pass 1: accumulate Gaussian splats on a grayscale alpha canvas
    ctx.clearRect(0, 0, w, h)
    ctx.globalCompositeOperation = "lighter"

    // Find max weight for normalization
    const maxW = Math.max(0.01, ...points.map(p => p.weight))

    for (const pt of points) {
      const px = map.latLngToContainerPoint([pt.lat, pt.lon])
      const x = px.x - radius
      const y = px.y - radius
      // Skip points entirely outside viewport (with margin)
      if (x > w + radius || y > h + radius || x < -radius * 3 || y < -radius * 3) continue
      const norm = pt.weight / maxW
      ctx.globalAlpha = Math.min(1, norm * 0.85)
      ctx.drawImage(brush, x, y)
    }

    // Pass 2: colorize using thermal palette
    ctx.globalCompositeOperation = "source-over"
    ctx.globalAlpha = 1
    const imageData = ctx.getImageData(0, 0, w, h)
    const pixels = imageData.data
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3]  // accumulated intensity
      if (alpha === 0) continue
      const idx = Math.min(255, alpha) * 4
      pixels[i] = PALETTE[idx]
      pixels[i + 1] = PALETTE[idx + 1]
      pixels[i + 2] = PALETTE[idx + 2]
      pixels[i + 3] = Math.round(PALETTE[idx + 3] * opacity)
    }
    ctx.putImageData(imageData, 0, 0)
  }, [map, points, radius, opacity, enabled])

  // Redraw on map move/zoom
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
  useEffect(() => {
    draw()
  }, [draw])

  return null // pure side-effect component
}
