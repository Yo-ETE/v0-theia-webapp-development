"use client"

import { useEffect } from "react"
import { MapContainer, TileLayer, Polygon, Tooltip, CircleMarker, useMap } from "react-leaflet"
import type { Zone, DetectionEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

// Import Leaflet CSS via side-effect (only runs client-side thanks to dynamic ssr:false)
import "leaflet/dist/leaflet.css"

interface MapInnerProps {
  centerLat: number
  centerLon: number
  zoom: number
  zones?: Zone[]
  events?: DetectionEvent[]
  className?: string
}

function SetView({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, zoom)
  }, [map, center, zoom])
  return null
}

export default function MapInner({
  centerLat,
  centerLon,
  zoom,
  zones = [],
  events = [],
  className,
}: MapInnerProps) {
  const recentDetections = (events ?? [])
    .filter((e) => e.type === "detection")
    .slice(0, 10)

  return (
    <div className={cn("relative rounded-lg overflow-hidden border border-border/50", className)}>
      <MapContainer
        center={[centerLat, centerLon]}
        zoom={zoom}
        scrollWheelZoom={true}
        className="h-full w-full"
        style={{ minHeight: "400px", background: "#0d1117" }}
      >
        <SetView center={[centerLat, centerLon]} zoom={zoom} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        {(zones ?? []).map((zone) => (
          <Polygon
            key={zone.id}
            positions={zone.polygon}
            pathOptions={{
              color: zone.color,
              fillColor: zone.color,
              fillOpacity: 0.15,
              weight: 2,
            }}
          >
            <Tooltip permanent direction="center" className="zone-tooltip">
              <span className="text-[10px] font-mono">{zone.label}</span>
            </Tooltip>
          </Polygon>
        ))}

        {recentDetections.map((evt) => {
          const zone = (zones ?? []).find((z) => z.id === evt.zone_id)
          if (!zone || zone.polygon.length === 0) return null
          // Place marker at centroid of zone
          const lat = zone.polygon.reduce((s, p) => s + p[0], 0) / zone.polygon.length
          const lon = zone.polygon.reduce((s, p) => s + p[1], 0) / zone.polygon.length
          return (
            <CircleMarker
              key={evt.id}
              center={[lat, lon]}
              radius={6}
              pathOptions={{
                color: "#f59e0b",
                fillColor: "#f59e0b",
                fillOpacity: 0.8,
                weight: 2,
              }}
            >
              <Tooltip>
                <span className="text-[10px] font-mono">
                  {evt.device_name} - {evt.zone_label}
                </span>
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>

      {/* Map overlay info */}
      <div className="absolute bottom-2 left-2 z-[1000] rounded bg-background/80 backdrop-blur px-2 py-1">
        <span className="font-mono text-[10px] text-muted-foreground">
          {centerLat.toFixed(4)}, {centerLon.toFixed(4)} z{zoom}
        </span>
      </div>
    </div>
  )
}
