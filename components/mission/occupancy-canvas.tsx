"use client"

import { useEffect, useRef, useCallback } from "react"
import { probabilityAt, cellCenter, type OccupancyGrid } from "@/lib/occupancy-grid"

interface OccupancyCanvasProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any
  grid: OccupancyGrid | null
  /** meter-space -> lat/lon, supplied by the map component that owns the projection */
  toLatLon: (m: [number, number]) => [number, number]
  opacity?: number
  enabled?: boolean
  /** cells this close to 0.5 are left transparent: unknown is not a finding */
  unknownBand?: number
}

/**
 * Draws an occupancy grid over the map.
 *
 * Deliberately three-state, unlike the heatmap: red-ish for probably occupied, blue-ish for
 * actively cleared, and nothing at all for unknown. Painting "unknown" in a cold colour would
 * read as "cleared" to an operator, which is the one misreading that could get someone hurt --
 * a room nobody has looked into must look different from a room a sensor swept and found empty.
 */
export default function OccupancyCanvas({
  map,
  grid,
  toLatLon,
  opacity = 0.65,
  enabled = true,
  unknownBand = 0.06,
}: OccupancyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

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
    canvas.style.zIndex = "449" // just under the heatmap layer
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
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    if (!enabled || !grid) return

    ctx.globalAlpha = opacity
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const p = probabilityAt(grid, col, row)
        if (Math.abs(p - 0.5) < unknownBand) continue // unknown: draw nothing

        // Cell corners projected individually: at this zoom the meters->pixels scale is not
        // uniform enough across the map to just scale one cell size.
        const [cx, cy] = cellCenter(grid, col, row)
        const half = grid.res / 2
        const [latA, lonA] = toLatLon([cx - half, cy - half])
        const [latB, lonB] = toLatLon([cx + half, cy + half])
        const ptA = map.latLngToContainerPoint([latA, lonA])
        const ptB = map.latLngToContainerPoint([latB, lonB])
        const x = Math.min(ptA.x, ptB.x)
        const y = Math.min(ptA.y, ptB.y)
        const cw = Math.abs(ptB.x - ptA.x)
        const ch = Math.abs(ptB.y - ptA.y)
        if (x + cw < 0 || y + ch < 0 || x > w || y > h) continue // offscreen

        if (p > 0.5) {
          const t = Math.min(1, (p - 0.5) / 0.45) // 0..1 over the occupied range
          ctx.fillStyle = `rgba(${Math.round(200 + 55 * t)}, ${Math.round(120 - 110 * t)}, 40, ${0.25 + 0.65 * t})`
        } else {
          const t = Math.min(1, (0.5 - p) / 0.45)
          ctx.fillStyle = `rgba(40, ${Math.round(120 + 60 * t)}, ${Math.round(200 + 55 * t)}, ${0.12 + 0.3 * t})`
        }
        ctx.fillRect(x, y, Math.max(1, cw), Math.max(1, ch))
      }
    }
    ctx.globalAlpha = 1
  }, [map, grid, toLatLon, opacity, enabled, unknownBand])

  useEffect(() => {
    if (!map || !enabled) return
    map.on("moveend", draw)
    map.on("zoomend", draw)
    map.on("resize", draw)
    return () => {
      map.off("moveend", draw)
      map.off("zoomend", draw)
      map.off("resize", draw)
    }
  }, [map, draw, enabled])

  useEffect(() => { draw() }, [draw])

  return null
}
