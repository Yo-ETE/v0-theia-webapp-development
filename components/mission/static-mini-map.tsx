"use client"

import { MapPin } from "lucide-react"
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
 * Shows a 3x3 grid of tiles centered on the given lat/lon.
 */
export function StaticMiniMap({ lat, lon, zoom = 16, className, label }: StaticMiniMapProps) {
  // Convert lat/lon to tile coordinates
  const n = Math.pow(2, zoom)
  const xTile = Math.floor(((lon + 180) / 360) * n)
  const yTile = Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n
  )

  // Calculate pixel offset within the center tile for the marker
  const xPixelFull = ((lon + 180) / 360) * n * 256
  const yPixelFull =
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) *
    n *
    256
  const xOffset = xPixelFull - xTile * 256 + 256 // +256 because center tile is at position (1,1) in the 3x3 grid
  const yOffset = yPixelFull - yTile * 256 + 256

  // Generate 3x3 tile grid
  const tiles: { x: number; y: number; col: number; row: number }[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      tiles.push({ x: xTile + dx, y: yTile + dy, col: dx + 1, row: dy + 1 })
    }
  }

  return (
    <div className={cn("relative rounded-lg overflow-hidden border border-border/50 bg-secondary/20", className)}>
      {/* Tile grid */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="relative"
          style={{
            width: 256 * 3,
            height: 256 * 3,
            // Center the grid so that (xOffset, yOffset) is in the middle of the container
            transform: `translate(calc(50% - ${xOffset}px), calc(50% - ${yOffset}px))`,
          }}
        >
          {tiles.map(({ x, y, col, row }) => (
            <img
              key={`${x}-${y}`}
              src={`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`}
              alt=""
              draggable={false}
              className="absolute select-none"
              style={{
                width: 256,
                height: 256,
                left: col * 256,
                top: row * 256,
                imageRendering: "auto",
              }}
              crossOrigin="anonymous"
            />
          ))}
        </div>
      </div>

      {/* Center marker */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <div className="flex flex-col items-center">
          <MapPin className="h-6 w-6 text-primary drop-shadow-md" style={{ marginBottom: -3 }} />
          <div className="h-1.5 w-1.5 rounded-full bg-primary/50" />
        </div>
      </div>

      {/* Label overlay */}
      {label && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/80 to-transparent px-3 py-2 z-10">
          <p className="text-[10px] font-medium text-foreground truncate">{label}</p>
        </div>
      )}

      {/* Dark overlay for aesthetics */}
      <div className="absolute inset-0 bg-background/10 pointer-events-none z-[5]" />
    </div>
  )
}
