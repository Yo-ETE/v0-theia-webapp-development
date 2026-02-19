"use client"

import { useEffect, useState } from "react"
import type { Zone, DetectionEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

interface MapInnerProps {
  centerLat: number
  centerLon: number
  zoom: number
  zones?: Zone[]
  events?: DetectionEvent[]
  className?: string
}

export default function MapInner({
  centerLat: rawLat,
  centerLon: rawLon,
  zoom: rawZoom,
  zones = [],
  events = [],
  className,
}: MapInnerProps) {
  // Safe defaults - Paris if coords missing
  const centerLat = Number.isFinite(rawLat) ? rawLat : 48.8566
  const centerLon = Number.isFinite(rawLon) ? rawLon : 2.3522
  const zoom = Number.isFinite(rawZoom) ? rawZoom : 15
  const [mounted, setMounted] = useState(false)
  const [MapComponents, setMapComponents] = useState<{
    MapContainer: React.ComponentType<Record<string, unknown>>
    TileLayer: React.ComponentType<Record<string, unknown>>
    Polygon: React.ComponentType<Record<string, unknown>>
    CircleMarker: React.ComponentType<Record<string, unknown>>
  } | null>(null)

  useEffect(() => {
    setMounted(true)

    // Load Leaflet CSS via <link> tag (CSS dynamic import not supported in all bundlers)
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      link.crossOrigin = ""
      document.head.appendChild(link)
    }

    // Dynamically import react-leaflet at runtime
    import("react-leaflet")
      .then((rl) => {
        setMapComponents({
          MapContainer: rl.MapContainer as unknown as React.ComponentType<Record<string, unknown>>,
          TileLayer: rl.TileLayer as unknown as React.ComponentType<Record<string, unknown>>,
          Polygon: rl.Polygon as unknown as React.ComponentType<Record<string, unknown>>,
          CircleMarker: rl.CircleMarker as unknown as React.ComponentType<Record<string, unknown>>,
        })
      })
      .catch((err) => {
        console.error("[v0] Failed to load react-leaflet:", err)
      })
  }, [])

  const recentDetections = (events ?? [])
    .filter((e) => e.type === "detection")
    .slice(0, 10)

  if (!mounted || !MapComponents) {
    return (
      <div className={cn("relative rounded-lg overflow-hidden border border-border/50 bg-muted/20", className)}>
        <div className="flex h-full w-full items-center justify-center" style={{ minHeight: "400px" }}>
          <span className="text-xs text-muted-foreground font-mono animate-pulse">
            Loading map...
          </span>
        </div>
      </div>
    )
  }

  const { MapContainer, TileLayer, Polygon, CircleMarker } = MapComponents

  return (
    <div className={cn("relative rounded-lg overflow-hidden border border-border/50", className)}>
      <MapContainer
        center={[centerLat, centerLon]}
        zoom={zoom}
        scrollWheelZoom={true}
        className="h-full w-full"
        style={{ minHeight: "400px", background: "#0d1117" }}
      >
        <TileLayer
          attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'}
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
          />
        ))}

        {recentDetections.map((evt) => {
          const zone = (zones ?? []).find((z) => z.id === evt.zone_id)
          if (!zone || !zone.polygon || zone.polygon.length === 0) return null
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
            />
          )
        })}
      </MapContainer>

      {/* Map overlay info */}
      <div className="absolute bottom-2 left-2 z-[1000] rounded bg-background/80 backdrop-blur px-2 py-1">
        <span className="font-mono text-[10px] text-muted-foreground">
          {(centerLat ?? 0).toFixed(4)}, {(centerLon ?? 0).toFixed(4)} z{zoom ?? 0}
        </span>
      </div>
    </div>
  )
}
