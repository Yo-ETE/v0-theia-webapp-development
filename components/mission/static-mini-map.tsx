"use client"

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
 * No Leaflet, no "already initialized" errors.
 * Uses CSS transform to center the exact lat/lon pixel in the container.
 */
export function StaticMiniMap({ lat, lon, zoom = 16, className, label }: StaticMiniMapProps) {
  // ── Tile math ──
  const n = Math.pow(2, zoom)
  const xFrac = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n

  const xCenter = Math.floor(xFrac)
  const yCenter = Math.floor(yFrac)

  // Pixel offset of lat/lon within the center tile
  const xPixelOffset = (xFrac - xCenter) * 256
  const yPixelOffset = (yFrac - yCenter) * 256

  // Grid: 5x5 tiles around center tile
  const GRID = 5
  const HALF = 2
  const gridW = GRID * 256
  const gridH = GRID * 256

  // The target pixel in the grid (center tile is at position HALF,HALF)
  const targetPxX = HALF * 256 + xPixelOffset
  const targetPxY = HALF * 256 + yPixelOffset

  const tiles: { x: number; y: number; gx: number; gy: number }[] = []
  for (let dy = -HALF; dy <= HALF; dy++) {
    for (let dx = -HALF; dx <= HALF; dx++) {
      tiles.push({ x: xCenter + dx, y: yCenter + dy, gx: dx + HALF, gy: dy + HALF })
    }
  }

  return (
    <div className={cn("relative rounded-lg overflow-hidden border border-border/50 bg-secondary/20", className)}>
      {/* 
        Position the grid so that (targetPxX, targetPxY) lands at the center of the parent.
        left/top: 50% gives us the parent's center. 
        translate(-targetPxX, -targetPxY) shifts the grid so the target pixel is at that center.
      */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: gridW,
          height: gridH,
          left: "50%",
          top: "50%",
          transform: `translate(-${targetPxX}px, -${targetPxY}px)`,
        }}
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

      {/* Label overlay */}
      {label && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/80 to-transparent px-3 py-2 z-10">
          <p className="text-[10px] font-medium text-foreground truncate">{label}</p>
        </div>
      )}
    </div>
  )
}
