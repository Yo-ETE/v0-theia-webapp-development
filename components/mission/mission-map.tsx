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
  liveDetections?: Record<string, {
    presence: boolean
    distance: number
    direction: string
    device_name: string
    side: string
    rssi: number | null
    timestamp: string
  }>
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
