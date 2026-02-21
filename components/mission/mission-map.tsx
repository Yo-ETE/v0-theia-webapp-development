"use client"

import type { Zone, DetectionEvent } from "@/lib/types"
import { cn } from "@/lib/utils"
import MapInner from "./map-inner"

interface LiveDetection {
  presence: boolean
  distance: number
  direction: string
  device_name: string
  side: string
  rssi: number | null
  timestamp: string
  [key: string]: unknown
}

interface MissionMapProps {
  centerLat: number
  centerLon: number
  zoom: number
  zones: Zone[]
  events?: DetectionEvent[]
  liveDetections?: Record<string, LiveDetection>
  sensorPlacements?: {
    device_id: string
    device_name: string
    zone_id: string
    side: string
    sensor_position: number
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
}

export function MissionMap({ className, ...props }: MissionMapProps) {
  return (
    <div className={cn("relative", className)}>
      <MapInner {...props} className="h-full w-full" />
    </div>
  )
}
