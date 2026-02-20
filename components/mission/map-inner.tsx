"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import type { Zone, DetectionEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

interface LiveDetection {
  presence: boolean
  distance: number
  direction: string
  device_name: string
  side: string
  rssi: number | null
  timestamp: string
}

interface MapInnerProps {
  centerLat: number
  centerLon: number
  zoom: number
  zones?: Zone[]
  events?: DetectionEvent[]
  liveDetections?: Record<string, LiveDetection>
  className?: string
  drawingMode?: boolean
  onPolygonDrawn?: (polygon: [number, number][]) => void
  onZoneClick?: (zoneId: string) => void
}

export default function MapInner({
  centerLat: rawLat,
  centerLon: rawLon,
  zoom: rawZoom,
  zones = [],
  liveDetections = {},
  className,
  drawingMode = false,
  onPolygonDrawn,
  onZoneClick,
}: MapInnerProps) {
  const centerLat = Number.isFinite(rawLat) ? rawLat : 48.8566
  const centerLon = Number.isFinite(rawLon) ? rawLon : 2.3522
  const zoom = Number.isFinite(rawZoom) ? rawZoom : 19

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
    import("react-leaflet").then((mod) => setRL(mod)).catch(() => {})
  }, [])

  // Keep map view synced
  useEffect(() => {
    const doSetView = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = mapRef.current as any
      if (map && typeof map.setView === "function") {
        map.setView([centerLat, centerLon], zoom)
      }
    }
    doSetView()
    const timer = setTimeout(doSetView, 300)
    return () => clearTimeout(timer)
  }, [centerLat, centerLon, zoom])

  // Drawing click handler
  useEffect(() => {
    if (!drawingMode) return
    const handler = (e: { latlng: { lat: number; lng: number } }) => {
      setDrawPoints((prev) => [...prev, [e.latlng.lat, e.latlng.lng]])
    }
    const attach = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = mapRef.current as any
      if (map && typeof map.on === "function") { map.on("click", handler); return true }
      return false
    }
    if (!attach()) {
      const t = setTimeout(attach, 500)
      return () => clearTimeout(t)
    }
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = mapRef.current as any
      if (map && typeof map.off === "function") map.off("click", handler)
    }
  }, [drawingMode])

  useEffect(() => { if (drawingMode) setDrawPoints([]) }, [drawingMode])

  const finishDrawing = useCallback(() => {
    if (drawPoints.length >= 2 && onPolygonDrawn) onPolygonDrawn(drawPoints)
    setDrawPoints([])
  }, [drawPoints, onPolygonDrawn])

  const cancelDrawing = useCallback(() => setDrawPoints([]), [])
  const undoLastPoint = useCallback(() => setDrawPoints((p) => p.slice(0, -1)), [])

  if (!mounted || !RL) {
    return (
      <div className={cn("relative rounded-lg overflow-hidden border border-border/50 bg-muted/20", className)}>
        <div className="flex h-full w-full items-center justify-center" style={{ minHeight: "300px" }}>
          <span className="text-xs text-muted-foreground font-mono animate-pulse">Loading map...</span>
        </div>
      </div>
    )
  }

  const { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, Tooltip } = RL

  // Compute zone centroids for detection markers
  const zoneCentroids: Record<string, [number, number]> = {}
  for (const zone of zones) {
    if (zone.polygon?.length) {
      const lat = zone.polygon.reduce((s, p) => s + p[0], 0) / zone.polygon.length
      const lon = zone.polygon.reduce((s, p) => s + p[1], 0) / zone.polygon.length
      zoneCentroids[zone.id] = [lat, lon]
    }
  }

  return (
    <div className={cn("relative rounded-lg overflow-hidden border border-border/50", className)}>
      <MapContainer
        ref={mapRef}
        center={[centerLat, centerLon]}
        zoom={zoom}
        maxZoom={22}
        scrollWheelZoom={true}
        className="h-full w-full"
        style={{ minHeight: "300px" }}
      >
        <TileLayer
          attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'}
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={22}
          maxNativeZoom={19}
        />

        {/* ── Saved zones ── */}
        {(zones ?? []).map((zone) => {
          const det = liveDetections[zone.id]
          const hasPresence = det?.presence
          return (
            <Polygon
              key={zone.id}
              positions={zone.polygon}
              pathOptions={{
                color: hasPresence ? "#f59e0b" : zone.color,
                fillColor: hasPresence ? "#f59e0b" : zone.color,
                fillOpacity: hasPresence ? 0.35 : 0.15,
                weight: hasPresence ? 3 : 2,
              }}
              eventHandlers={onZoneClick ? { click: () => onZoneClick(zone.id) } : undefined}
            >
              <Tooltip permanent direction="center" className="zone-label-tip">
                <span style={{ fontSize: 11, fontWeight: 600, color: hasPresence ? "#f59e0b" : zone.color }}>
                  {zone.label}
                  {hasPresence && ` - ${det.distance}cm ${det.direction}`}
                </span>
              </Tooltip>
            </Polygon>
          )
        })}

        {/* ── Side labels on saved zones ── */}
        {(zones ?? []).map((zone) =>
          zone.sides && zone.polygon?.length >= 2
            ? Object.entries(zone.sides)
                .filter(([, label]) => Boolean(label))
                .map(([key, label]) => {
                  const idx = key.charCodeAt(0) - 65
                  if (idx < 0 || idx >= zone.polygon.length) return null
                  const nextIdx = (idx + 1) % zone.polygon.length
                  const pt = zone.polygon[idx]
                  const next = zone.polygon[nextIdx]
                  const mLat = (pt[0] + next[0]) / 2
                  const mLon = (pt[1] + next[1]) / 2
                  return (
                    <CircleMarker
                      key={`side-${zone.id}-${key}`}
                      center={[mLat, mLon]}
                      radius={0}
                      pathOptions={{ opacity: 0, fillOpacity: 0 }}
                    >
                      <Tooltip permanent direction="center">
                        <span style={{
                          fontSize: 9, fontWeight: 700, color: zone.color,
                          background: "rgba(255,255,255,0.85)", padding: "1px 4px",
                          borderRadius: 3, border: `1px solid ${zone.color}`,
                        }}>
                          {key}: {label}
                        </span>
                      </Tooltip>
                    </CircleMarker>
                  )
                })
            : null
        )}

        {/* ── Live detection pulsing markers at zone centroids ── */}
        {Object.entries(liveDetections).map(([zoneId, det]) => {
          const centroid = zoneCentroids[zoneId]
          if (!centroid) return null
          const zone = zones.find(z => z.id === zoneId)
          return (
            <CircleMarker
              key={`det-${zoneId}`}
              center={centroid}
              radius={det.presence ? 12 : 6}
              pathOptions={{
                color: det.presence ? "#f59e0b" : "#22c55e",
                fillColor: det.presence ? "#f59e0b" : "#22c55e",
                fillOpacity: det.presence ? 0.6 : 0.3,
                weight: det.presence ? 3 : 1,
                className: det.presence ? "detection-pulse" : "",
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -14]}>
                <div style={{ fontSize: 10, fontWeight: 600, textAlign: "center", lineHeight: 1.3 }}>
                  {det.presence ? (
                    <span style={{ color: "#f59e0b" }}>
                      DETECTION {det.distance}cm<br />
                      {det.direction === "G" ? "Gauche" : det.direction === "D" ? "Droite" : "Centre"}
                      {det.side && ` [${det.side}]`}
                    </span>
                  ) : (
                    <span style={{ color: "#22c55e" }}>
                      {zone?.label ?? "Zone"} - RAS
                    </span>
                  )}
                </div>
              </Tooltip>
            </CircleMarker>
          )
        })}

        {/* ── Drawing polyline ── */}
        {drawPoints.length > 0 && (
          <>
            <Polyline
              positions={drawPoints.length >= 3 ? [...drawPoints, drawPoints[0]] : drawPoints}
              pathOptions={{ color: "#0891b2", weight: 2, dashArray: "6 4" }}
            />
            {drawPoints.map((pt, i) => {
              const nextIdx = (i + 1) % drawPoints.length
              if (i === drawPoints.length - 1 && drawPoints.length < 3) return null
              const next = drawPoints[nextIdx]
              const mLat = (pt[0] + next[0]) / 2
              const mLon = (pt[1] + next[1]) / 2
              return (
                <CircleMarker key={`side-label-${i}`} center={[mLat, mLon]} radius={0} pathOptions={{ opacity: 0, fillOpacity: 0 }}>
                  <Tooltip permanent direction="center">
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: "#0891b2",
                      background: "rgba(255,255,255,0.9)", padding: "1px 5px",
                      borderRadius: 3, border: "1px solid #0891b2",
                    }}>{String.fromCharCode(65 + i)}</span>
                  </Tooltip>
                </CircleMarker>
              )
            })}
          </>
        )}

        {/* Drawing vertices */}
        {drawPoints.map((pt, i) => (
          <CircleMarker
            key={`vertex-${i}`} center={pt} radius={5}
            pathOptions={{ color: "#0891b2", fillColor: "#0891b2", fillOpacity: 1, weight: 1 }}
          >
            <Tooltip permanent direction="top" offset={[0, -8]}>
              <span style={{ fontSize: 9, fontWeight: 600, color: "#0891b2" }}>P{i + 1}</span>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Coords overlay */}
      <div className="absolute bottom-2 left-2 z-[500] rounded bg-card/90 backdrop-blur px-2 py-1 shadow-sm">
        <span className="font-mono text-[10px] text-foreground/70">
          {centerLat.toFixed(5)}, {centerLon.toFixed(5)} z{zoom}
        </span>
      </div>

      {/* Drawing toolbar */}
      {drawingMode && (
        <div className="absolute top-2 left-2 z-[500] flex items-center gap-1.5 flex-wrap">
          <div className="rounded bg-card/95 backdrop-blur px-2.5 py-1.5 border border-cyan-600/40 shadow-lg">
            <span className="text-[10px] font-mono text-cyan-700 font-semibold">
              DRAW {drawPoints.length > 0 ? `-- ${drawPoints.length} pts` : "-- click map"}
            </span>
          </div>
          {drawPoints.length > 0 && (
            <div className="flex items-center gap-1">
              <button onClick={undoLastPoint}
                className="rounded bg-card/95 backdrop-blur px-2 py-1 text-[10px] font-medium text-foreground hover:bg-muted border border-border shadow-sm transition-colors">
                Undo
              </button>
              <button onClick={cancelDrawing}
                className="rounded bg-card/95 backdrop-blur px-2 py-1 text-[10px] font-medium text-destructive hover:bg-destructive/10 border border-border shadow-sm transition-colors">
                Cancel
              </button>
              {drawPoints.length >= 2 && (
                <button onClick={finishDrawing}
                  className="rounded bg-cyan-600 px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-cyan-500 shadow-sm transition-colors">
                  Validate ({drawPoints.length} pts)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Live detection count overlay */}
      {Object.values(liveDetections).some(d => d.presence) && (
        <div className="absolute top-2 right-2 z-[500] rounded bg-warning/90 backdrop-blur px-2.5 py-1.5 shadow-lg">
          <span className="text-[10px] font-mono font-bold text-warning-foreground">
            {Object.values(liveDetections).filter(d => d.presence).length} DETECTION(S) ACTIVE(S)
          </span>
        </div>
      )}
    </div>
  )
}
