"use client"

import { useRef, useEffect, useState } from "react"
import { cn } from "@/lib/utils"

interface StaticMiniMapProps {
  lat: number
  lon: number
  zoom?: number
  className?: string
  label?: string
}

/**
 * Lightweight static map using OSM tile images.
 * Avoids Leaflet entirely -- no "already initialized" errors.
 * Renders a 5x5 grid of tiles, then scrolls the container so the exact
 * lat/lon pixel sits at the visible center.
 */
export function StaticMiniMap({ lat, lon, zoom = 16, className, label }: StaticMiniMapProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  // ── Tile math ──
  const n = Math.pow(2, zoom)
  // Fractional tile coordinates
  const xFrac = ((lon + 180) / 360) * n
  const yFrac =
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n

  // Integer tile at center
  const xCenter = Math.floor(xFrac)
  const yCenter = Math.floor(yFrac)

  // Pixel position of the point within the full 5x5 grid (tile 0,0 at grid position -2,-2)
  const GRID = 5
  const HALF = Math.floor(GRID / 2) // 2
  const pxInGrid = (xFrac - xCenter + HALF) * 256
  const pyInGrid = (yFrac - yCenter + HALF) * 256

  // Generate grid tiles
  const tiles: { x: number; y: number; gx: number; gy: number }[] = []
  for (let dy = -HALF; dy <= HALF; dy++) {
    for (let dx = -HALF; dx <= HALF; dx++) {
      tiles.push({ x: xCenter + dx, y: yCenter + dy, gx: dx + HALF, gy: dy + HALF })
    }
  }

  // Scroll to center the target point once container is mounted
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const cw = el.clientWidth
    const ch = el.clientHeight
    el.scrollLeft = pxInGrid - cw / 2
    el.scrollTop = pyInGrid - ch / 2
    setReady(true)
  }, [pxInGrid, pyInGrid, zoom])

  return (
    <div className={cn("relative rounded-lg overflow-hidden border border-border/50 bg-secondary/20", className)}>
      {/* Scrollable tile container -- scrollbars hidden, non-interactive */}
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-hidden"
        style={{ opacity: ready ? 1 : 0, transition: "opacity 0.2s" }}
      >
        <div
          className="relative"
          style={{ width: GRID * 256, height: GRID * 256 }}
        >
          {tiles.map(({ x, y, gx, gy }) => (
            <img
              key={`${zoom}-${x}-${y}`}
              src={`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`}
              alt=""
              draggable={false}
              className="absolute select-none"
              style={{ width: 256, height: 256, left: gx * 256, top: gy * 256 }}
              crossOrigin="anonymous"
            />
          ))}
        </div>
      </div>

      {/* Label overlay */}
      {label && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/80 to-transparent px-3 py-2 z-10">
          <p className="text-[10px] font-medium text-foreground truncate">{label}</p>
        </div>
      )}
    </div>
  )
}
