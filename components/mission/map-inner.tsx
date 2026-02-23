"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import type { Zone, DetectionEvent } from "@/lib/types"
import { cn } from "@/lib/utils"
import HeatmapCanvas from "./heatmap-canvas"

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
  [key: string]: unknown
}

interface SensorPlacement {
  device_id: string
  device_name: string
  zone_id: string
  side: string
  sensor_position: number // 0..1 along the side
}

interface SensorPlaceMode {
  zoneId: string
  side: string
  deviceId: string
  deviceName: string
}

interface MapInnerProps {
  centerLat: number
  centerLon: number
  zoom: number
  zones?: Zone[]
  events?: DetectionEvent[]
  liveDetections?: Record<string, LiveDetection>
  sensorPlacements?: SensorPlacement[]
  heatmapMode?: boolean
  className?: string
  drawingMode?: boolean
  onPolygonDrawn?: (polygon: [number, number][]) => void
  onZoneClick?: (zoneId: string) => void
  sensorPlaceMode?: SensorPlaceMode | null
  onSensorPlace?: (zoneId: string, side: string, position: number) => void
  onMapMove?: (lat: number, lon: number, zoom: number) => void
  editingZoneId?: string | null
  onZonePolygonUpdate?: (zoneId: string, polygon: [number, number][]) => void
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
  events = [],
  liveDetections = {},
  sensorPlacements = [],
  heatmapMode = false,
  className,
  drawingMode = false,
  onPolygonDrawn,
  onZoneClick,
  sensorPlaceMode = null,
  onSensorPlace,
  onMapMove,
  editingZoneId = null,
  onZonePolygonUpdate,
}: MapInnerProps) {
  const centerLat = Number.isFinite(rawLat) ? rawLat : 48.8566
  const centerLon = Number.isFinite(rawLon) ? rawLon : 2.3522
  const zoom = Number.isFinite(rawZoom) ? rawZoom : 19

  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [RL, setRL] = useState<Record<string, any> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [leafletL, setLeafletL] = useState<any>(null)
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([])
  const mapRef = useRef<unknown>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [mapInstance, setMapInstance] = useState<any>(null)
  const mapInstanceSet = useRef(false)
  const containerDivRef = useRef<HTMLDivElement>(null)
  const [mapKey, setMapKey] = useState(0)

  // ── Detection state management with fade-out ──
  // green = actively receiving presence events
  // yellow "hold" = no new presence event for STALE_MS, show last known position
  // yellow "fading" = fading out before disappearing
  // gone = fully expired
  const STALE_MS = 5000  // 5s without a new presence event = stale
  const HOLD_MS = 4000   // hold stale position for 4s
  const FADE_MS = 3000   // then fade for 3s

  // Store the last GOOD detection per zone (with distance > 0, presence true)
  const lastGoodRef = useRef<Record<string, LiveDetection>>({})
  // Timestamp of the last RECEIVED event (any event, even presence:false) per zone
  const lastEventTsRef = useRef<Record<string, number>>({})
  // Timestamp of the last GOOD event per zone (presence true + distance > 0)
  const lastPresenceTsRef = useRef<Record<string, number>>({})
  // Serialized version counter to force re-render from the interval timer
  const [tick, setTick] = useState(0)

  // Track incoming events -- update refs SYNCHRONOUSLY during render
  // (not in useEffect which runs AFTER render, causing race conditions)
  const prevLiveRef = useRef<Record<string, LiveDetection>>({})
  if (liveDetections !== prevLiveRef.current) {
    const now = Date.now()
    for (const [zoneId, det] of Object.entries(liveDetections)) {
      lastEventTsRef.current[zoneId] = now
      if (det.presence && det.distance > 0) {
        lastGoodRef.current[zoneId] = det
        lastPresenceTsRef.current[zoneId] = now
      }
    }
    prevLiveRef.current = liveDetections
  }

  // Tick every 500ms to re-evaluate stale/hold/fade transitions
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 500)
    return () => clearInterval(interval)
  }, [])

  // Build effective detections
  type DetState = "live" | "hold" | "fading"
  const now = Date.now()
  const effectiveDetections: Record<string, LiveDetection & { _state: DetState }> = {}

  // 1) Current live detections from SSE -- if SSE says presence:true, it's live NOW
  for (const [zoneId, det] of Object.entries(liveDetections)) {
    if (det.presence && det.distance > 0) {
      effectiveDetections[zoneId] = { ...det, _state: "live" }
    }
  }

  // 2) Stale / hold / fade for zones that WERE live but no longer
  for (const [zoneId, lastPresenceTs] of Object.entries(lastPresenceTsRef.current)) {
    if (effectiveDetections[zoneId]) continue // already live from step 1
    if (lastPresenceTs <= 0) continue
    const lastGood = lastGoodRef.current[zoneId]
    if (!lastGood) continue

    const sinceLast = now - lastPresenceTs

    // If SSE is still active but says presence:false, skip "live" fallback
    const currentDet = liveDetections[zoneId]
    const sseStillActive = currentDet && (now - (lastEventTsRef.current[zoneId] ?? 0)) < 3000
    const explicitlyGone = sseStillActive && !currentDet.presence

    if (sinceLast < STALE_MS && !explicitlyGone) {
      // Brief gap in SSE -- keep showing as live
      effectiveDetections[zoneId] = { ...lastGood, _state: "live" }
    } else if (sinceLast < STALE_MS + HOLD_MS) {
      // Hold at last known position (yellow)
      effectiveDetections[zoneId] = { ...lastGood, _state: "hold" }
    } else if (sinceLast < STALE_MS + HOLD_MS + FADE_MS) {
      // Fading out
      effectiveDetections[zoneId] = { ...lastGood, _state: "fading" }
    }
    // else: fully expired, remove
  }

  // Suppress unused tick warning (it drives re-renders for stale transitions)
  void tick

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
    import("leaflet").then((mod) => setLeafletL(mod.default || mod)).catch(() => {})
    return () => {
      // Cleanup Leaflet map instance on unmount to prevent "already initialized" error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = mapRef.current as any
      if (map) {
        try {
          if (typeof map.remove === "function") map.remove()
        } catch { /* ignore */ }
      }
      mapRef.current = null
      mapInstanceSet.current = false
      setMapInstance(null)
      // Clean _leaflet_id from the container AND all child elements
      const div = containerDivRef.current
      if (div) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (div as any)._leaflet_id
        div.querySelectorAll("*").forEach((el) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((el as any)._leaflet_id) delete (el as any)._leaflet_id
        })
        // Remove all Leaflet-injected children so the div is fully clean
        div.innerHTML = ""
      }
      setMapKey((k) => k + 1)
    }
  }, [])

  // Set map view ONCE on mount -- after that the user controls the position.
  // We use a ref to track whether the initial view has been set.
  const initialViewSet = useRef(false)
  useEffect(() => {
    // Only set view if we haven't done it yet AND coords are not the Paris default
    const isParis = Math.abs(centerLat - 48.8566) < 0.0001 && Math.abs(centerLon - 2.3522) < 0.0001
    if (initialViewSet.current && isParis) return // skip Paris re-centers
    const doSetView = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = mapRef.current as any
      if (map && typeof map.setView === "function") {
        map.setView([centerLat, centerLon], zoom)
        initialViewSet.current = true
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

  // ── Persist map center/zoom on pan/zoom ──
  useEffect(() => {
    if (!onMapMove) return
    const handler = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = mapRef.current as any
      if (!map || typeof map.getCenter !== "function") return
      const c = map.getCenter()
      const z = map.getZoom()
      onMapMove(c.lat, c.lng, z)
    }
    const attach = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = mapRef.current as any
      if (map && typeof map.on === "function") {
        map.on("moveend", handler)
        map.on("zoomend", handler)
        return true
      }
      return false
    }
    if (!attach()) {
      const t = setTimeout(attach, 500)
      return () => clearTimeout(t)
    }
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = mapRef.current as any
      if (map && typeof map.off === "function") {
        map.off("moveend", handler)
        map.off("zoomend", handler)
      }
    }
  }, [onMapMove])

  // ── Sensor placement click handler ──
  useEffect(() => {
    if (!sensorPlaceMode || !onSensorPlace) return
    const zone = zones.find((z) => z.id === sensorPlaceMode.zoneId)
    if (!zone?.polygon?.length) return

    const sideIdx = sensorPlaceMode.side.charCodeAt(0) - 65
    if (sideIdx < 0 || sideIdx >= zone.polygon.length) return
    const pA = zone.polygon[sideIdx]
    const pB = zone.polygon[(sideIdx + 1) % zone.polygon.length]

    const handler = (e: { latlng: { lat: number; lng: number } }) => {
      // Project click onto the side line to get t (0..1)
      const cLat = e.latlng.lat
      const cLon = e.latlng.lng
      const cosRef = Math.cos(cLat * Math.PI / 180)
      // Convert to meters relative to pA
      const ax = 0, ay = 0
      const bx = (pB[1] - pA[1]) * 111320 * cosRef
      const by = (pB[0] - pA[0]) * 111320
      const cx = (cLon - pA[1]) * 111320 * cosRef
      const cy = (cLat - pA[0]) * 111320
      // Project c onto AB
      const abx = bx - ax, aby = by - ay
      const acx = cx - ax, acy = cy - ay
      const abLen2 = abx * abx + aby * aby
      if (abLen2 === 0) return
      let t = (acx * abx + acy * aby) / abLen2
      t = Math.max(0.02, Math.min(0.98, t)) // Clamp slightly off edges
      onSensorPlace(sensorPlaceMode.zoneId, sensorPlaceMode.side, t)
    }

    const attach = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = mapRef.current as any
      if (map && typeof map.on === "function") { map.on("click", handler); return true }
      return false
    }
    if (!attach()) {
      const t = setTimeout(attach, 300)
      return () => clearTimeout(t)
    }
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = mapRef.current as any
      if (map && typeof map.off === "function") map.off("click", handler)
    }
  }, [sensorPlaceMode, onSensorPlace, zones])

  const finishDrawing = useCallback(() => {
  if (drawPoints.length >= 3 && onPolygonDrawn) onPolygonDrawn(drawPoints)
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

  // ── Heatmap: project each detection event to a lat/lon point ──
  // LD2450 sensors have x,y (mm) giving exact 2D position relative to sensor.
  // Depth-only sensors have only distance: we use the inward normal for projection.
  // For triangulation with multiple depth-only sensors, we intersect circles.
  type HeatPoint = { lat: number; lon: number; weight: number }
  const heatPoints: HeatPoint[] = (() => {
    try {
    if (!heatmapMode || !zones.length || events.length === 0) return []

    // Build a lookup: zone_id -> sensor info (position, normal, left vectors in meters)
    type SensorGeo = {
      sensorM: [number, number]
      sensorLL: [number, number]
      normalM: [number, number]
      leftM: [number, number]
    }
    const sensorGeo: Record<string, SensorGeo[]> = {}
    for (const sp of sensorPlacements) {
      const zone = zones.find(z => z.id === sp.zone_id)
      if (!zone) continue
      const edge = getSideEdge(zone, sp.side)
      if (!edge) continue
      const centroid = zoneCentroids[zone.id]
      if (!centroid) continue
      const sLL = pointAlongSide(edge[0], edge[1], sp.sensor_position)
      const nM = inwardNormalM(edge[0], edge[1], centroid)
      const lM: [number, number] = [-nM[1], nM[0]]
      const sM = toMeters(sLL)
      if (!sensorGeo[sp.zone_id]) sensorGeo[sp.zone_id] = []
      sensorGeo[sp.zone_id].push({ sensorM: sM, sensorLL: sLL, normalM: nM, leftM: lM })
    }

    const pts: HeatPoint[] = []
    // Count occurrences at each grid cell for weight accumulation
    const gridCounts: Record<string, number> = {}

    for (const evt of events) {
      const p = evt.payload ?? {}
      const dist = Number(p.distance ?? 0)
      if (dist <= 0) continue
      const zId = evt.zone_id
      if (!zId) continue
      const sensors = sensorGeo[zId]
      if (!sensors || sensors.length === 0) continue

      // Use first sensor for this zone
      const sg = sensors[0]
      const dm = dist / 100 // cm to meters

      // Try 3 methods in priority order:
      // 1) LD2450 x,y -> exact 2D position
      // 2) angle + distance -> polar projection
      // 3) distance only -> project along inward normal
      // NOTE: payload x,y are in cm (TX firmware divides raw mm by 10 for LoRa)
      const x_cm = Number(p.x ?? 0)
      const y_cm = Number(p.y ?? 0)
      const hasXY = (x_cm !== 0 || y_cm !== 0)
      const evtAngle = Number(p.angle ?? 0)
      const hasAngle = evtAngle !== 0

      let ptM: [number, number]
      // rightM = -leftM: points right when facing the inward normal direction
      // LD2450 convention: x > 0 = target is to the RIGHT, angle > 0 = right
      const rM: [number, number] = [-sg.leftM[0], -sg.leftM[1]]

      if (hasXY) {
        // LD2450 x,y in cm: x = lateral (+ = right), y = depth (always positive)
        const xm = x_cm / 100   // cm to meters
        const ym = y_cm / 100   // cm to meters
        // Project: forward by y along normal, sideways by x along rightM
        ptM = [
          sg.sensorM[0] + ym * sg.normalM[0] + xm * rM[0],
          sg.sensorM[1] + ym * sg.normalM[1] + xm * rM[1],
        ]
      } else if (hasAngle) {
        // Angle from atan2(x,y): positive = right, negative = left
        const rad = evtAngle * Math.PI / 180
        const cosA = Math.cos(rad)
        const sinA = Math.sin(rad)
        // Rotate: forward component along normal, lateral along rightM
        const dirX = cosA * sg.normalM[0] + sinA * rM[0]
        const dirY = cosA * sg.normalM[1] + sinA * rM[1]
        ptM = [
          sg.sensorM[0] + dm * dirX,
          sg.sensorM[1] + dm * dirY,
        ]
      } else {
        // Depth-only: project straight along inward normal
        ptM = [
          sg.sensorM[0] + dm * sg.normalM[0],
          sg.sensorM[1] + dm * sg.normalM[1],
        ]
      }

      // Snap to a small grid to accumulate weight at the same location
      const gx = Math.round(ptM[0] * 20) / 20  // 5cm grid
      const gy = Math.round(ptM[1] * 20) / 20
      const gk = `${gx},${gy}`
      gridCounts[gk] = (gridCounts[gk] ?? 0) + 1

      const ll = toLatLon(ptM)
      pts.push({ lat: ll[0], lon: ll[1], weight: 1 })
    }

    // Assign accumulated weight: points at the same grid cell get the cell count as weight
    for (const pt of pts) {
      const ptM = toMeters([pt.lat, pt.lon])
      const gx = Math.round(ptM[0] * 20) / 20
      const gy = Math.round(ptM[1] * 20) / 20
      const gk = `${gx},${gy}`
      pt.weight = gridCounts[gk] ?? 1
    }

    return pts
    } catch (e) { console.warn("[THEIA] heatPoints error:", e); return [] }
  })()

  const sensorMarkers: SensorMarkerData[] = sensorPlacements.map((sp) => {
    const zone = zones.find((z) => z.id === sp.zone_id)
    if (!zone || !sp.side) return null
    const edge = getSideEdge(zone, sp.side)
    if (!edge) return null
    const centroid = zoneCentroids[zone.id]
    if (!centroid) return null
    const sensorLatLon = pointAlongSide(edge[0], edge[1], sp.sensor_position)
    const normalM = inwardNormalM(edge[0], edge[1], centroid)

    // Compute lateral (tangent) direction along the side in meter-space.
    // "Left" of someone facing inward = cross(inward, up) = rotate normal -90 deg.
    // Side tangent from edge[0] to edge[1]:
    const edgeA = toMeters(edge[0])
    const edgeB = toMeters(edge[1])
    const tx = edgeB[0] - edgeA[0]
    const ty = edgeB[1] - edgeA[1]
    const tLen = Math.sqrt(tx * tx + ty * ty)
    // Unit tangent along the side (A -> B direction)
    const tangentM: [number, number] = tLen > 0 ? [tx / tLen, ty / tLen] : [0, 0]
    // Determine which direction "Gauche" is relative to inward-facing.
    // The LD2450 sensor faces inward (normalM direction). Standing behind the sensor
    // looking toward the zone interior:
    // - "Gauche" (left) is to the left of that view
    // - "Droite" (right) is to the right
    // Cross product of (inward normal) x (up) gives the "right" direction in 2D:
    //   right = (normalM[1], -normalM[0]) in (east, north) space
    // So left = (-normalM[1], normalM[0])
    const leftM: [number, number] = [-normalM[1], normalM[0]]

    // Check if there's a live (or stale) detection for this zone
    const det = effectiveDetections[zone.id]
    let detectionLatLon: [number, number] | null = null
    if (det?.presence && det.distance > 0) {
      const distM = det.distance / 100 // cm -> meters
      const sensorM = toMeters(sensorLatLon)

      // Lateral offset based on direction: G = left, D = right, C = center
      // LD2450 has ~60deg FOV per zone, so offset ~30 degrees from center
      // At distance d, lateral offset = d * tan(30deg) ~ d * 0.577
      let lateralM = 0
      if (det.direction === "G" || det.direction === "Gauche") {
        lateralM = distM * 0.5 // shift left by ~half the distance
      } else if (det.direction === "D" || det.direction === "Droite") {
        lateralM = -distM * 0.5 // shift right
      }
      // Centre: lateralM stays 0

      const detM: [number, number] = [
        sensorM[0] + normalM[0] * distM + leftM[0] * lateralM,
        sensorM[1] + normalM[1] * distM + leftM[1] * lateralM,
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

  // Clean stale Leaflet state from container before each render
  // This prevents "already initialized" on HMR / ErrorBoundary retry
  if (containerDivRef.current) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = containerDivRef.current as any
    if (el._leaflet_id && !mapRef.current) {
      delete el._leaflet_id
      el.innerHTML = ""
    }
  }

  return (
    <div key={mapKey} ref={containerDivRef} className={cn("relative rounded-lg overflow-hidden border border-border/50", className)}>
      <MapContainer
        ref={(instance) => {
          mapRef.current = instance
          if (instance && !mapInstanceSet.current) {
            mapInstanceSet.current = true
            setMapInstance(instance)
          }
        }}
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
          const det = effectiveDetections[zone.id]
          const hasPresence = det?._state === "live"
          return (
            <Polygon
              key={zone.id}
              positions={zone.polygon}
              pathOptions={{
                color: heatmapMode ? "#666" : zone.color,
                fillColor: heatmapMode ? "transparent" : zone.color,
                fillOpacity: heatmapMode ? 0 : (hasPresence ? 0.08 : 0.12),
                weight: heatmapMode ? 1 : (hasPresence ? 2 : 1.5),
                dashArray: heatmapMode ? "4 4" : undefined,
              }}
              eventHandlers={onZoneClick ? { click: () => onZoneClick(zone.id) } : undefined}
            >
              {!heatmapMode && (
                <Tooltip permanent direction="center" className="zone-label-tip">
                  <span style={{ fontSize: 11, fontWeight: 600, color: zone.color }}>
                    {zone.label}
                  </span>
                </Tooltip>
              )}
            </Polygon>
          )
        })}

        {/* ── Zone editing overlay ── */}
        {editingZoneId && (() => {
          const zone = (zones ?? []).find(z => z.id === editingZoneId)
          if (!zone || !zone.polygon?.length || !RL || !leafletL) return null
          const RLMarker = RL.Marker

          const vertexIcon = leafletL.divIcon({
            className: "",
            html: '<div style="width:12px;height:12px;background:#f59e0b;border:2px solid white;border-radius:50%;cursor:grab;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>',
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          })
          const midpointIcon = leafletL.divIcon({
            className: "",
            html: '<div style="width:10px;height:10px;background:white;border:2px solid #f59e0b;border-radius:50%;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.2)"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5],
          })

          return (
            <>
              {/* Vertex markers - draggable */}
              {zone.polygon.map((pt, i) => (
                <RLMarker
                  key={`edit-v-${i}`}
                  position={pt}
                  icon={vertexIcon}
                  draggable={true}
                  eventHandlers={{
                    dragend: (e: { target: { getLatLng: () => { lat: number; lng: number } } }) => {
                      const pos = e.target.getLatLng()
                      const newPoly = [...zone.polygon]
                      newPoly[i] = [pos.lat, pos.lng]
                      onZonePolygonUpdate?.(zone.id, newPoly)
                    },
                    contextmenu: (e: { originalEvent: { preventDefault: () => void } }) => {
                      e.originalEvent.preventDefault()
                      if (zone.polygon.length <= 3) return // min 3 points
                      const newPoly = zone.polygon.filter((_, idx) => idx !== i)
                      onZonePolygonUpdate?.(zone.id, newPoly)
                    },
                  }}
                >
                  <Tooltip direction="top" offset={[0, -10]}>
                    <span style={{ fontSize: 9, fontWeight: 600 }}>
                      P{i + 1} | {zone.polygon.length <= 3 ? "min 3 pts" : "clic-droit = suppr"}
                    </span>
                  </Tooltip>
                </RLMarker>
              ))}

              {/* Midpoint markers - click to add vertex */}
              {zone.polygon.map((pt, i) => {
                const next = zone.polygon[(i + 1) % zone.polygon.length]
                const midLat = (pt[0] + next[0]) / 2
                const midLon = (pt[1] + next[1]) / 2
                return (
                  <RLMarker
                    key={`edit-m-${i}`}
                    position={[midLat, midLon]}
                    icon={midpointIcon}
                    eventHandlers={{
                      click: () => {
                        const newPoly = [...zone.polygon]
                        newPoly.splice(i + 1, 0, [midLat, midLon])
                        onZonePolygonUpdate?.(zone.id, newPoly)
                      },
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -8]}>
                      <span style={{ fontSize: 9 }}>+ ajouter point</span>
                    </Tooltip>
                  </RLMarker>
                )
              })}

              {/* Side labels with distances and custom facade names */}
              {zone.polygon.map((pt, i) => {
                const next = zone.polygon[(i + 1) % zone.polygon.length]
                const mLat = (pt[0] + next[0]) / 2
                const mLon = (pt[1] + next[1]) / 2
                const dist = haversineM(pt[0], pt[1], next[0], next[1])
                const sideKey = String.fromCharCode(65 + i)
                const customName = zone.sides?.[sideKey]
                return (
                  <CircleMarker key={`edit-side-${i}`} center={[mLat, mLon]} radius={0} pathOptions={{ opacity: 0, fillOpacity: 0 }}>
                    <Tooltip permanent direction="center">
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: "#f59e0b",
                        background: "rgba(255,255,255,0.95)", padding: "1px 5px",
                        borderRadius: 3, border: "1px solid #f59e0b",
                      }}>
                        {sideKey}{customName ? ` (${customName})` : ""}: {fmtDist(dist)}
                      </span>
                    </Tooltip>
                  </CircleMarker>
                )
              })}

              {/* Outline of editing polygon */}
              <Polyline
                positions={[...zone.polygon, zone.polygon[0]]}
                pathOptions={{ color: "#f59e0b", weight: 2, dashArray: "4 4" }}
              />
            </>
          )
        })()}

        {/* ── Canvas heatmap overlay (rendered outside React tree into Leaflet pane) ── */}

        {/* ── Highlighted side for sensor placement mode ── */}
        {sensorPlaceMode && (() => {
          const zone = zones.find((z) => z.id === sensorPlaceMode.zoneId)
          if (!zone?.polygon?.length) return null
          const idx = sensorPlaceMode.side.charCodeAt(0) - 65
          if (idx < 0 || idx >= zone.polygon.length) return null
          const pA = zone.polygon[idx]
          const pB = zone.polygon[(idx + 1) % zone.polygon.length]
          return (
            <Polyline
              positions={[pA, pB]}
              pathOptions={{
                color: "#22d3ee",
                weight: 6,
                opacity: 0.9,
                dashArray: "8 4",
                className: "sensor-place-side",
              }}
            />
          )
        })()}

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

        {/* ── Zone area label (always visible) ── */}
        {(zones ?? []).map((zone) => {
          if (!zone.polygon || zone.polygon.length < 3) return null
          const centroid = zoneCentroids[zone.id]
          if (!centroid) return null
          const area = polygonAreaM2(zone.polygon)
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
                  {area < 1 ? `${Math.round(area * 10000)}cm2` : `${area.toFixed(1)}m2`}
                </span>
              </Tooltip>
            </CircleMarker>
          )
        })}

        {/* ─��� Sensor position markers (triangles on the side) ── */}
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
        {sensorMarkers.filter(sm => sm.detectionPos).map((sm) => {
          const state = (sm.detection as LiveDetection & { _state?: string })?._state ?? "live"
          const color = state === "live" ? "#22c55e" : "#f59e0b" // green=live, yellow=stale
          const opacity = state === "fading" ? 0.25 : state === "hold" ? 0.6 : 0.8
          return (
            <Polyline
              key={`det-line-${sm.id}`}
              positions={[sm.sensorPos, sm.detectionPos!]}
              pathOptions={{
                color,
                weight: 2,
                dashArray: "4 3",
                opacity,
              }}
            />
          )
        })}
        {sensorMarkers.filter(sm => sm.detectionPos).map((sm) => {
          const state = (sm.detection as LiveDetection & { _state?: string })?._state ?? "live"
          const isLive = state === "live"
          const isFading = state === "fading"
          const color = isLive ? "#22c55e" : "#f59e0b" // green=live, amber=stale
          return (
            <CircleMarker
              key={`det-pt-${sm.id}`}
              center={sm.detectionPos!}
              radius={isLive ? 8 : 6}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: isFading ? 0.15 : isLive ? 0.7 : 0.4,
                weight: 2,
                opacity: isFading ? 0.25 : 0.8,
                className: isLive ? "detection-pulse" : "",
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -10]}>
                <span style={{
                  fontSize: 10, fontWeight: 700, color,
                  opacity: isFading ? 0.35 : 1,
                  background: "rgba(255,255,255,0.92)", padding: "1px 5px",
                  borderRadius: 3, border: `1px solid ${color}55`,
                }}>
                  {sm.detection!.distance}cm {sm.detection!.direction === "G" ? "G" : sm.detection!.direction === "D" ? "D" : "C"}
                  {!isLive && " (last)"}
                </span>
              </Tooltip>
            </CircleMarker>
          )
        })}

        {/* ── Fallback: zone-level detection pulse if no sensor is placed ── */}
        {Object.entries(effectiveDetections).map(([zoneId, det]) => {
          // Skip if sensor markers already cover this zone
          if (sensorMarkers.some(sm => sm.detection && zones.find(z => z.id === zoneId)?.devices.includes(sm.id))) return null
          const centroid = zoneCentroids[zoneId]
          if (!centroid || !det) return null
          const fbColor = det._state === "live" ? "#22c55e" : "#f59e0b"
          const fbFading = det._state === "fading"
          return (
            <CircleMarker
              key={`det-fallback-${zoneId}`}
              center={centroid}
              radius={8}
              pathOptions={{
                color: fbColor, fillColor: fbColor,
                fillOpacity: fbFading ? 0.15 : 0.5, weight: 2,
                opacity: fbFading ? 0.3 : 0.8,
                className: det._state === "live" ? "detection-pulse" : "",
              }}
            />
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

      {/* Canvas-based Gaussian heatmap overlay */}
      <HeatmapCanvas
        map={mapInstance}
        points={heatPoints}
        radiusMeters={2.0}
        opacity={0.7}
        enabled={heatmapMode && heatPoints.length > 0}
        zonePolygons={zones.map(z => z.polygon)}
      />

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
              DRAW {drawPoints.length > 0 ? `-- ${drawPoints.length} pts` : "-- cliquez pour placer les points"}
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
              {drawPoints.length >= 3 && (
                <button onClick={finishDrawing}
                  className="rounded bg-cyan-600 px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-cyan-500 shadow-sm transition-colors">
                  Validate ({drawPoints.length} pts)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Zone editing mode overlay */}
      {editingZoneId && (() => {
        const zone = (zones ?? []).find(z => z.id === editingZoneId)
        if (!zone) return null
        const area = polygonAreaM2(zone.polygon)
        const perim = polygonPerimeterM(zone.polygon)
        return (
          <div className="absolute top-2 left-2 z-[500] rounded bg-amber-950/90 backdrop-blur px-3 py-2 border border-amber-500/40 shadow-lg max-w-xs">
            <p className="text-[11px] font-semibold text-amber-300 font-mono">
              EDIT: {zone.label} ({zone.polygon.length} pts)
            </p>
            <p className="text-[10px] text-amber-200/70 mt-0.5">
              {area < 1 ? `${Math.round(area * 10000)}cm2` : `${area.toFixed(1)}m2`} | P: {fmtDist(perim)}
            </p>
            <p className="text-[9px] text-amber-200/50 mt-1">
              Drag = deplacer | Milieu = ajouter | Clic-droit = supprimer
            </p>
          </div>
        )
      })()}

      {/* Sensor placement mode overlay */}
      {sensorPlaceMode && (
        <div className="absolute top-2 left-2 z-[500] rounded bg-cyan-950/90 backdrop-blur px-3 py-2 border border-cyan-500/40 shadow-lg max-w-xs">
          <p className="text-[11px] font-semibold text-cyan-300 font-mono">
            PLACE {sensorPlaceMode.deviceName}
          </p>
          <p className="text-[10px] text-cyan-200/70 mt-0.5">
            Click on side [{sensorPlaceMode.side}] to position the sensor.
          </p>
        </div>
      )}

      {/* Live detection count overlay */}
      {Object.keys(effectiveDetections).length > 0 && (() => {
        const liveCount = Object.values(effectiveDetections).filter(d => d._state === "live").length
        const staleCount = Object.values(effectiveDetections).filter(d => d._state !== "live").length
        return (
          <div className="absolute top-2 right-2 z-[500] flex gap-1.5">
            {liveCount > 0 && (
              <div className="rounded bg-green-600/90 backdrop-blur px-2.5 py-1.5 shadow-lg">
                <span className="text-[10px] font-mono font-bold text-white">
                  {liveCount} ACTIVE
                </span>
              </div>
            )}
            {staleCount > 0 && (
              <div className="rounded bg-amber-500/80 backdrop-blur px-2.5 py-1.5 shadow-lg">
                <span className="text-[10px] font-mono font-bold text-white">
                  {staleCount} LAST
                </span>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
