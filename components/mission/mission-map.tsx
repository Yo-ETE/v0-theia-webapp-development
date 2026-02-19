"use client"

import dynamic from "next/dynamic"
import type { Zone, DetectionEvent } from "@/lib/types"

const MapInner = dynamic(() => import("./map-inner"), { ssr: false })

interface MissionMapProps {
  centerLat: number
  centerLon: number
  zoom: number
  zones: Zone[]
  events?: DetectionEvent[]
  className?: string
}

export function MissionMap(props: MissionMapProps) {
  return <MapInner {...props} />
}
