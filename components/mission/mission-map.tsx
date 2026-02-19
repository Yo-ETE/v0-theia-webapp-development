"use client"

import dynamic from "next/dynamic"
import type { Zone, DetectionEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

const MapInner = dynamic(() => import("./map-inner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-lg border border-border/50 bg-muted/30">
      <span className="text-xs text-muted-foreground font-mono animate-pulse">Loading map...</span>
    </div>
  ),
})

interface MissionMapProps {
  centerLat: number
  centerLon: number
  zoom: number
  zones: Zone[]
  events?: DetectionEvent[]
  className?: string
}

export function MissionMap({ className, ...props }: MissionMapProps) {
  return (
    <div className={cn("relative", className)}>
      <MapInner {...props} className="h-full w-full" />
    </div>
  )
}
