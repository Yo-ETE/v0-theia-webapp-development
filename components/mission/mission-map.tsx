"use client"

import type { Zone, DetectionEvent } from "@/lib/types"
import { cn } from "@/lib/utils"
import MapInner from "./map-inner"

interface MissionMapProps {
  centerLat: number
  centerLon: number
  zoom: number
  zones: Zone[]
  events?: DetectionEvent[]
  className?: string
  drawingMode?: boolean
  onPolygonDrawn?: (polygon: [number, number][]) => void
  onZoneClick?: (zoneId: string) => void
}

export function MissionMap({ className, ...props }: MissionMapProps) {
  return (
    <div className={cn("relative", className)}>
      <MapInner {...props} className="h-full w-full" />
    </div>
  )
}
