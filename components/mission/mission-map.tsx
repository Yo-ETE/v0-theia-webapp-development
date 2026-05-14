"use client"

import type { Zone, DetectionEvent, LiveDetection } from "@/lib/types"
import type { VisualConfig } from "@/hooks/use-visual-config"
import { cn } from "@/lib/utils"
import MapInner from "./map-inner"

// LiveDetection is imported from @/lib/types

interface MissionMapProps {
  centerLat: number
  centerLon: number
  zoom: number
  zones: Zone[]
  events?: DetectionEvent[]
  liveDetections?: Record<string, LiveDetection>
  liveByDevice?: Record<string, LiveDetection>
  sensorPlacements?: {
    device_id: string
    device_name: string
    zone_id: string
    side: string
    sensor_position: number
    device_type?: string
  }[]
  heatmapMode?: boolean
  className?: string
  drawingMode?: boolean
  onPolygonDrawn?: (polygon: [number, number][]) => void
  onZoneClick?: (zoneId: string) => void
  sensorPlaceMode?: {
    zoneId: string
    side: string
    deviceId: string
    deviceName: string
  } | null
  onSensorPlace?: (zoneId: string, side: string, position: number) => void
  onMapMove?: (lat: number, lon: number, zoom: number) => void
  editingZoneId?: string | null
  editingPolygon?: [number, number][] | null
  onZonePolygonUpdate?: (zoneId: string, polygon: [number, number][]) => void
  estimatePosition?: boolean
  showFov?: boolean
  replayMode?: boolean
  visualConfig?: VisualConfig | null
}

export function MissionMap({ className, ...props }: MissionMapProps) {
  return (
    <div className={cn("relative", className)}>
      <MapInner {...props} className="h-full w-full" />
    </div>
  )
}
