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
  device_id?: string
  sensor_position?: number
}

interface SensorPlacement {
  device_id: string
  device_name: string
  zone_id: string
  side: string
  sensor_position: number // 0..1 along the side
}

interface MapInnerProps {
  centerLat: number
  centerLon: number
  zoom: number
  zones?: Zone[]
  events?: DetectionEvent[]
  liveDetections?: Record<string, LiveDetection>
  sensorPlacements?: SensorPlacement[]
  className?: string
  drawingMode?: boolean
  onPolygonDrawn?: (polygon: [number, number][]) => void
  onZoneClick?: (zoneId: string) => void
}

// ── Geodesic measurement helpers ──────────────────────────────

/** Haversine distance between two lat/lon points, returns meters */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Format distance: < 1m show cm, else show m with 1 decimal */
function fmtDist(meters: number): string {
  if (meters < 1) return `${Math.round(meters * 100)}cm`
  if (meters < 10) return `${meters.toFixed(2)}m`
  return `${meters.toFixed(1)}m`
}

/** Polygon area using Shoelace formula on projected coords (approximate m2) */
function polygonAreaM2(polygon: [number, number][]): number {
  if (polygon.length < 3) return 0
  // Project to meters relative to centroid
  const cLat = polygon.reduce((s, p) => s + p[0], 0) / polygon.length
  const cosLat = Math.cos(cLat * Math.PI / 180)
  const pts = polygon.map(([lat, lon]) => [
    (lat - cLat) * 111320,          // meters north
    (lon - polygon[0][1]) * 111320 * cosLat, // meters east
  ])
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i][0] * pts[j][1]
    area -= pts[j][0] * pts[i][1]
  }
  return Math.abs(area) / 2
}

/** Perimeter of polygon in meters */
function polygonPerimeterM(polygon: [number, number][]): number {
  let total = 0
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length
    total += haversineM(polygon[i][0], polygon[i][1], polygon[j][0], polygon[j][1])
  }
  return total
}

export default function MapInner({
  centerLat: rawLat,
  centerLon: rawLon,
  zoom: rawZoom,
  zones = [],
  liveDetections = {},
  sensorPlacements = [],
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

  // Compute zone centroids
  const zoneCentroids: Record<string, [number, number]> = {}
  for (const zone of zones) {
    if (zone.polygon?.length) {
      const lat = zone.polygon.reduce((s, p) => s + p[0], 0) / zone.polygon.length
      const lon = zone.polygon.reduce((s, p) => s + p[1], 0) / zone.polygon.length
      zoneCentroids[zone.id] = [lat, lon]
    }
  }

  // ── Geometry: sensor placement & detection projection ──
  // All math is done in a local meter-space then converted back to lat/lon.
  // 1 degree latitude  ≈ 111320 m
  // 1 degree longitude ≈ 111320 * cos(lat) m

  const refLat = centerLat
  const M_PER_DEG_LAT = 111320
  const M_PER_DEG_LON = 111320 * Math.cos(refLat * Math.PI / 180)

  /** Convert [lat,lon] to local [x_m, y_m] (east, north) */
  function toMeters(p: [number, number]): [number, number] {
    return [(p[1] - centerLon) * M_PER_DEG_LON, (p[0] - centerLat) * M_PER_DEG_LAT]
  }
  /** Convert local [x_m, y_m] back to [lat,lon] */
  function toLatLon(m: [number, number]): [number, number] {
    return [centerLat + m[1] / M_PER_DEG_LAT, centerLon + m[0] / M_PER_DEG_LON]
  }

  function getSideEdge(zone: Zone, sideKey: string): [[number, number], [number, number]] | null {
    const idx = sideKey.charCodeAt(0) - 65
    if (idx < 0 || idx >= zone.polygon.length) return null
    const nextIdx = (idx + 1) % zone.polygon.length
    return [zone.polygon[idx], zone.polygon[nextIdx]]
  }

  function pointAlongSide(p1: [number, number], p2: [number, number], t: number): [number, number] {
    return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]
  }

  /**
   * Compute the inward-pointing unit normal of a polygon side, in meters.
   * Returns [nx, ny] in meter-space (east, north), length = 1.
   */
  function inwardNormalM(p1: [number, number], p2: [number, number], centroid: [number, number]): [number, number] {
    const a = toMeters(p1)
    const b = toMeters(p2)
    const c = toMeters(centroid)
    // Side direction vector in meters
    const ex = b[0] - a[0]  // east component
    const ey = b[1] - a[1]  // north component
    // Perpendicular (rotate 90 degrees): (-ey, ex) or (ey, -ex)
    let nx = -ey
    let ny = ex
    const len = Math.sqrt(nx * nx + ny * ny)
    if (len === 0) return [0, 0]
    nx /= len
    ny /= len
    // Check if it points toward centroid
    const mx = (a[0] + b[0]) / 2
    const my = (a[1] + b[1]) / 2
    const dot = nx * (c[0] - mx) + ny * (c[1] - my)
    if (dot < 0) { nx = -nx; ny = -ny }
    return [nx, ny]
  }

  // Build sensor markers and detection projections
  type SensorMarkerData = {
    id: string
    sensorPos: [number, number]
    detectionPos: [number, number] | null
    deviceName: string
    side: string
    detection: LiveDetection | null
    zoneColor: string
  }

  const sensorMarkers: SensorMarkerData[] = sensorPlacements.map((sp) => {
    const zone = zones.find((z) => z.id === sp.zone_id)
    if (!zone || !sp.side) return null
    const edge = getSideEdge(zone, sp.side)
    if (!edge) return null
    const centroid = zoneCentroids[zone.id]
    if (!centroid) return null
    const sensorLatLon = pointAlongSide(edge[0], edge[1], sp.sensor_position)
    const normalM = inwardNormalM(edge[0], edge[1], centroid)

    // Check if there's a live detection for this zone
    const det = liveDetections[zone.id]
    let detectionLatLon: [number, number] | null = null
    if (det?.presence && det.distance > 0) {
      // distance is in cm, convert to meters
      const distM = det.distance / 100
      // Project from sensor position along the inward normal by distM meters
      const sensorM = toMeters(sensorLatLon)
      const detM: [number, number] = [
        sensorM[0] + normalM[0] * distM,
        sensorM[1] + normalM[1] * distM,
      ]
      detectionLatLon = toLatLon(detM)
    }
    return {
      id: sp.device_id,
      sensorPos: sensorLatLon,
      detectionPos: detectionLatLon,
      deviceName: sp.device_name,
      side: sp.side,
      detection: det ?? null,
      zoneColor: zone.color,
    }
  }).filter(Boolean) as SensorMarkerData[]

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
                color: zone.color,
                fillColor: zone.color,
                fillOpacity: hasPresence ? 0.08 : 0.12,
                weight: hasPresence ? 2 : 1.5,
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

        {/* ── Side labels with distance on saved zones ── */}
        {(zones ?? []).map((zone) =>
          zone.polygon?.length >= 2
            ? zone.polygon.map((pt, idx) => {
                const nextIdx = (idx + 1) % zone.polygon.length
                const next = zone.polygon[nextIdx]
                const mLat = (pt[0] + next[0]) / 2
                const mLon = (pt[1] + next[1]) / 2
                const key = String.fromCharCode(65 + idx)
                const sideLabel = zone.sides?.[key]
                const dist = haversineM(pt[0], pt[1], next[0], next[1])
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
                        background: "rgba(255,255,255,0.92)", padding: "1px 5px",
                        borderRadius: 3, border: `1px solid ${zone.color}`,
                      }}>
                        {key}{sideLabel ? `: ${sideLabel}` : ""} ({fmtDist(dist)})
                      </span>
                    </Tooltip>
                  </CircleMarker>
                )
              })
            : null
        )}

        {/* ── Zone area label ── */}
        {(zones ?? []).map((zone) => {
          if (!zone.polygon || zone.polygon.length < 3) return null
          const centroid = zoneCentroids[zone.id]
          if (!centroid) return null
          const area = polygonAreaM2(zone.polygon)
          const perim = polygonPerimeterM(zone.polygon)
          return (
            <CircleMarker
              key={`area-${zone.id}`}
              center={centroid}
              radius={0}
              pathOptions={{ opacity: 0, fillOpacity: 0 }}
            >
              <Tooltip permanent direction="bottom" offset={[0, 12]}>
                <span style={{
                  fontSize: 8, fontWeight: 600, color: "#666",
                  background: "rgba(255,255,255,0.88)", padding: "1px 4px",
                  borderRadius: 2,
                }}>
                  {area < 1 ? `${Math.round(area * 10000)}cm2` : `${area.toFixed(1)}m2`} | P: {fmtDist(perim)}
                </span>
              </Tooltip>
            </CircleMarker>
          )
        })}

        {/* ── Sensor position markers (triangles on the side) ── */}
        {sensorMarkers.map((sm) => (
          <CircleMarker
            key={`sensor-${sm.id}`}
            center={sm.sensorPos}
            radius={5}
            pathOptions={{
              color: sm.zoneColor,
              fillColor: sm.zoneColor,
              fillOpacity: 1,
              weight: 2,
            }}
          >
            <Tooltip permanent direction="bottom" offset={[0, 8]}>
              <span style={{
                fontSize: 9, fontWeight: 700, color: sm.zoneColor,
                background: "rgba(255,255,255,0.92)", padding: "1px 4px",
                borderRadius: 3, border: `1px solid ${sm.zoneColor}`,
              }}>
                TX [{sm.side}]
              </span>
            </Tooltip>
          </CircleMarker>
        ))}

        {/* ── Detection projection lines + points ── */}
        {sensorMarkers.filter(sm => sm.detectionPos).map((sm) => (
          <Polyline
            key={`det-line-${sm.id}`}
            positions={[sm.sensorPos, sm.detectionPos!]}
            pathOptions={{
              color: "#f59e0b",
              weight: 2,
              dashArray: "4 3",
              opacity: 0.8,
            }}
          />
        ))}
        {sensorMarkers.filter(sm => sm.detectionPos).map((sm) => (
          <CircleMarker
            key={`det-pt-${sm.id}`}
            center={sm.detectionPos!}
            radius={10}
            pathOptions={{
              color: "#f59e0b",
              fillColor: "#f59e0b",
              fillOpacity: 0.5,
              weight: 3,
              className: "detection-pulse",
            }}
          >
            <Tooltip permanent direction="top" offset={[0, -12]}>
              <div style={{ fontSize: 10, fontWeight: 700, textAlign: "center", lineHeight: 1.3, color: "#f59e0b" }}>
                {sm.detection!.distance}cm
                {sm.detection!.direction === "G" ? " Gauche" : sm.detection!.direction === "D" ? " Droite" : " Centre"}
                <br />
                <span style={{ fontSize: 8, color: "#888" }}>{sm.deviceName} [{sm.side}]</span>
              </div>
            </Tooltip>
          </CircleMarker>
        ))}

        {/* ── Fallback: zone-level detection if no sensor placement ── */}
        {Object.entries(liveDetections).map(([zoneId, det]) => {
          // Skip if there are already specific sensor markers for this zone
          if (sensorMarkers.some(sm => sm.detection && zones.find(z => z.id === zoneId)?.devices.includes(sm.id))) return null
          const centroid = zoneCentroids[zoneId]
          if (!centroid) return null
          const zone = zones.find(z => z.id === zoneId)
          if (!det.presence) return null
          return (
            <CircleMarker
              key={`det-fallback-${zoneId}`}
              center={centroid}
              radius={10}
              pathOptions={{
                color: "#f59e0b", fillColor: "#f59e0b",
                fillOpacity: 0.5, weight: 3,
                className: "detection-pulse",
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -12]}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b" }}>
                  {zone?.label} {det.distance}cm {det.direction === "G" ? "G" : det.direction === "D" ? "D" : "C"}
                </span>
              </Tooltip>
            </CircleMarker>
          )
        })}

        {/* ── Drawing polyline with measurements ── */}
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
              const dist = haversineM(pt[0], pt[1], next[0], next[1])
              return (
                <CircleMarker key={`side-label-${i}`} center={[mLat, mLon]} radius={0} pathOptions={{ opacity: 0, fillOpacity: 0 }}>
                  <Tooltip permanent direction="center">
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: "#0891b2",
                      background: "rgba(255,255,255,0.95)", padding: "1px 6px",
                      borderRadius: 3, border: "1px solid #0891b2",
                    }}>
                      {String.fromCharCode(65 + i)}: {fmtDist(dist)}
                    </span>
                  </Tooltip>
                </CircleMarker>
              )
            })}
            {/* Total area during drawing */}
            {drawPoints.length >= 3 && (() => {
              const area = polygonAreaM2(drawPoints)
              const perim = polygonPerimeterM(drawPoints)
              const cLat = drawPoints.reduce((s, p) => s + p[0], 0) / drawPoints.length
              const cLon = drawPoints.reduce((s, p) => s + p[1], 0) / drawPoints.length
              return (
                <CircleMarker center={[cLat, cLon]} radius={0} pathOptions={{ opacity: 0, fillOpacity: 0 }}>
                  <Tooltip permanent direction="center">
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: "#0891b2",
                      background: "rgba(255,255,255,0.95)", padding: "2px 6px",
                      borderRadius: 3, border: "1px solid #0891b2",
                    }}>
                      {area < 1 ? `${Math.round(area * 10000)}cm2` : `${area.toFixed(1)}m2`} | P: {fmtDist(perim)}
                    </span>
                  </Tooltip>
                </CircleMarker>
              )
            })()}
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
              {drawPoints.length >= 2 && (() => {
                let total = 0
                for (let i = 0; i < drawPoints.length - 1; i++) {
                  total += haversineM(drawPoints[i][0], drawPoints[i][1], drawPoints[i+1][0], drawPoints[i+1][1])
                }
                if (drawPoints.length >= 3) {
                  total += haversineM(drawPoints[drawPoints.length-1][0], drawPoints[drawPoints.length-1][1], drawPoints[0][0], drawPoints[0][1])
                }
                return ` | P: ${fmtDist(total)}`
              })()}
              {drawPoints.length >= 3 && (() => {
                const area = polygonAreaM2(drawPoints)
                return ` | ${area < 1 ? `${Math.round(area * 10000)}cm2` : `${area.toFixed(1)}m2`}`
              })()}
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
