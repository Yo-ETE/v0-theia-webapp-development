"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import type { Zone, DetectionEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

interface MapInnerProps {
  centerLat: number
  centerLon: number
  zoom: number
  zones?: Zone[]
  events?: DetectionEvent[]
  className?: string
  /** When true, enables polygon drawing mode */
  drawingMode?: boolean
  /** Callback when a polygon is drawn */
  onPolygonDrawn?: (polygon: [number, number][]) => void
  /** Callback when a zone is clicked */
  onZoneClick?: (zoneId: string) => void
}

export default function MapInner({
  centerLat: rawLat,
  centerLon: rawLon,
  zoom: rawZoom,
  zones = [],
  events = [],
  className,
  drawingMode = false,
  onPolygonDrawn,
  onZoneClick,
}: MapInnerProps) {
  const centerLat = Number.isFinite(rawLat) ? rawLat : 48.8566
  const centerLon = Number.isFinite(rawLon) ? rawLon : 2.3522
  const zoom = Number.isFinite(rawZoom) ? rawZoom : 15

  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [RL, setRL] = useState<Record<string, any> | null>(null)
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([])
  const mapRef = useRef<unknown>(null)

  useEffect(() => {
    setMounted(true)
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      link.crossOrigin = ""
      document.head.appendChild(link)
    }
    import("react-leaflet")
      .then((mod) => setRL(mod))
      .catch(() => {})
  }, [])

  // Keep map view synced when center/zoom changes
  // Also retries once after mount because mapRef may not be ready on first render
  const prevCenter = useRef({ lat: centerLat, lon: centerLon, z: zoom })
  useEffect(() => {
    const setView = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = mapRef.current as any
      if (map && map.setView) {
        map.setView([centerLat, centerLon], zoom)
        prevCenter.current = { lat: centerLat, lon: centerLon, z: zoom }
      }
    }
    setView()
    // Retry after short delay if map wasn't ready
    const timer = setTimeout(setView, 300)
    return () => clearTimeout(timer)
  }, [centerLat, centerLon, zoom])

  // Map click handler for drawing -- attaches a click listener directly
  // to avoid hooks-in-callback issues with useMapEvents
  useEffect(() => {
    if (!drawingMode) return
    const handler = (e: { latlng: { lat: number; lng: number } }) => {
      setDrawPoints((prev) => [...prev, [e.latlng.lat, e.latlng.lng]])
    }
    const attach = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = mapRef.current as any
      if (map?.on) {
        map.on("click", handler)
        return true
      }
      return false
    }
    if (!attach()) {
      // Retry after map init
      const t = setTimeout(attach, 500)
      return () => clearTimeout(t)
    }
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = mapRef.current as any
      map?.off?.("click", handler)
    }
  }, [drawingMode])

  const finishDrawing = useCallback(() => {
    if (drawPoints.length >= 3 && onPolygonDrawn) {
      onPolygonDrawn(drawPoints)
    }
    setDrawPoints([])
  }, [drawPoints, onPolygonDrawn])

  const cancelDrawing = useCallback(() => {
    setDrawPoints([])
  }, [])

  const undoLastPoint = useCallback(() => {
    setDrawPoints((prev) => prev.slice(0, -1))
  }, [])

  const recentDetections = (events ?? [])
    .filter((e) => e.type === "detection")
    .slice(0, 10)

  if (!mounted || !RL) {
    return (
      <div className={cn("relative rounded-lg overflow-hidden border border-border/50 bg-muted/20", className)}>
        <div className="flex h-full w-full items-center justify-center" style={{ minHeight: "300px" }}>
          <span className="text-xs text-muted-foreground font-mono animate-pulse">Loading map...</span>
        </div>
      </div>
    )
  }

  const { MapContainer, TileLayer, Polygon, CircleMarker, Polyline } = RL

  return (
    <div className={cn("relative rounded-lg overflow-hidden border border-border/50", className)}>
      <MapContainer
        ref={mapRef}
        center={[centerLat, centerLon]}
        zoom={zoom}
        maxZoom={22}
        scrollWheelZoom={true}
        className="h-full w-full"
        style={{ minHeight: "300px", background: "#0d1117" }}
      >
        <TileLayer
          attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'}
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          maxZoom={22}
          maxNativeZoom={20}
        />

        {/* Existing zones */}
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
            eventHandlers={
              onZoneClick
                ? { click: () => onZoneClick(zone.id) }
                : undefined
            }
          />
        ))}

        {/* Drawing-in-progress polyline */}
        {drawPoints.length > 0 && (
          <Polyline
            positions={drawPoints}
            pathOptions={{ color: "#22d3ee", weight: 2, dashArray: "6 4" }}
          />
        )}

        {/* Drawing points markers */}
        {drawPoints.map((pt, i) => (
          <CircleMarker
            key={`draw-${i}`}
            center={pt}
            radius={4}
            pathOptions={{ color: "#22d3ee", fillColor: "#22d3ee", fillOpacity: 1, weight: 1 }}
          />
        ))}

        {/* Detection events */}
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
              pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.8, weight: 2 }}
            />
          )
        })}
      </MapContainer>

      {/* Coords overlay */}
      <div className="absolute bottom-2 left-2 z-[1000] rounded bg-background/80 backdrop-blur px-2 py-1">
        <span className="font-mono text-[10px] text-muted-foreground">
          {(centerLat ?? 0).toFixed(4)}, {(centerLon ?? 0).toFixed(4)} z{zoom ?? 0}
        </span>
      </div>

      {/* Drawing toolbar */}
      {drawingMode && (
        <div className="absolute top-2 left-2 z-[1000] flex items-center gap-1.5">
          <div className="rounded bg-background/90 backdrop-blur px-2 py-1 border border-cyan-500/40">
            <span className="text-[10px] font-mono text-cyan-400">
              DRAW MODE {drawPoints.length > 0 ? `(${drawPoints.length} pts)` : "-- click map to add points"}
            </span>
          </div>
          {drawPoints.length > 0 && (
            <>
              <button
                onClick={undoLastPoint}
                className="rounded bg-background/90 backdrop-blur px-2 py-1 text-[10px] font-mono text-muted-foreground hover:text-foreground border border-border/50 transition-colors"
              >
                Undo
              </button>
              <button
                onClick={cancelDrawing}
                className="rounded bg-background/90 backdrop-blur px-2 py-1 text-[10px] font-mono text-destructive hover:text-destructive/80 border border-border/50 transition-colors"
              >
                Cancel
              </button>
              {drawPoints.length >= 3 && (
                <button
                  onClick={finishDrawing}
                  className="rounded bg-cyan-600/90 backdrop-blur px-2.5 py-1 text-[10px] font-mono text-white hover:bg-cyan-500/90 border border-cyan-500/40 transition-colors"
                >
                  Finish ({drawPoints.length} pts)
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
