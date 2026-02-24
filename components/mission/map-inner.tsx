"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import type { Zone, DetectionEvent } from "@/lib/types"
import { cn } from "@/lib/utils"
import HeatmapCanvas from "./heatmap-canvas"

/** Group polygon edges by outward-normal bearing so colinear walls share the same facade letter */
function groupSidesByBearing(polygon: [number, number][]): string[] {
  const n = polygon.length
  if (n < 3) return polygon.map((_, i) => String.fromCharCode(65 + i))

  // Compute edge bearings
  const edgeBearings: number[] = []
  for (let i = 0; i < n; i++) {
    const [lat1, lon1] = polygon[i]
    const [lat2, lon2] = polygon[(i + 1) % n]
    const dLon = (lon2 - lon1) * Math.PI / 180
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180)
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon)
    let deg = Math.atan2(y, x) * 180 / Math.PI
    deg = ((deg % 360) + 360) % 360
    edgeBearings.push(deg)
  }

  // Polygon winding
  let signedArea = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    signedArea += (polygon[j][1] - polygon[i][1]) * (polygon[j][0] + polygon[i][0])
  }
  const normalOffset = signedArea < 0 ? 90 : -90
  const bearings = edgeBearings.map(b => ((b + normalOffset) % 360 + 360) % 360)

  // Group by similar normal (30 deg tolerance)
  const TOLERANCE = 30
  const groups: number[][] = []
  const assigned = new Set<number>()
  for (let i = 0; i < n; i++) {
    if (assigned.has(i)) continue
    const group = [i]
    assigned.add(i)
    for (let j = i + 1; j < n; j++) {
      if (assigned.has(j)) continue
      let diff = Math.abs(bearings[i] - bearings[j])
      if (diff > 180) diff = 360 - diff
      if (diff <= TOLERANCE) { group.push(j); assigned.add(j) }
    }
    groups.push(group)
  }

  // Map each segment to its group letter
  const segToGroup = new Array<string>(n)
  groups.forEach((group, gi) => {
    const letter = String.fromCharCode(65 + gi)
    for (const idx of group) segToGroup[idx] = letter
  })
  return segToGroup
}

/** Build an arc polygon for FOV visualization (pure function, no hooks) */
function buildFovArc(
  sensorPos: [number, number],
  normalBearingDeg: number,
  fovDeg: number,
  maxRangeM: number
): [number, number][] {
  const halfFov = fovDeg / 2
  const arcPoints: [number, number][] = [sensorPos]
  const STEPS = 24
  for (let s = 0; s <= STEPS; s++) {
    const angleDeg = normalBearingDeg - halfFov + (fovDeg * s / STEPS)
    const angleRad = angleDeg * Math.PI / 180
    const dEast = Math.sin(angleRad) * maxRangeM
    const dNorth = Math.cos(angleRad) * maxRangeM
    const dLat = dNorth / 111320
    const dLon = dEast / (111320 * Math.cos(sensorPos[0] * Math.PI / 180))
    arcPoints.push([sensorPos[0] + dLat, sensorPos[1] + dLon])
  }
  arcPoints.push(sensorPos)
  return arcPoints
}

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
  device_type?: string // e.g. "microwave_tx", "c4001", "gravity_mw"
}

/** Sensor hardware specs for FOV cone visualization */
const SENSOR_SPECS: Record<string, { fovDeg: number; maxRangeM: number; label: string }> = {
  microwave_tx:  { fovDeg: 120, maxRangeM: 6,  label: "LD2450" },
  tx_microwave:  { fovDeg: 120, maxRangeM: 6,  label: "LD2450" },
  c4001:         { fovDeg: 100, maxRangeM: 8,  label: "C4001" },
  gravity_mw:    { fovDeg: 75,  maxRangeM: 6,  label: "Gravity MW V2" },
}
const DEFAULT_SENSOR_SPECS = { fovDeg: 90, maxRangeM: 6, label: "Unknown" }

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
  liveByDevice?: Record<string, LiveDetection>
  sensorPlacements?: SensorPlacement[]
  heatmapMode?: boolean
  estimatePosition?: boolean  // Triangulate position from multiple simultaneous detections
  className?: string
  drawingMode?: boolean
  onPolygonDrawn?: (polygon: [number, number][]) => void
  onZoneClick?: (zoneId: string) => void
  sensorPlaceMode?: SensorPlaceMode | null
  onSensorPlace?: (zoneId: string, side: string, position: number) => void
  onMapMove?: (lat: number, lon: number, zoom: number) => void
  editingZoneId?: string | null
  editingPolygon?: [number, number][] | null
  onZonePolygonUpdate?: (zoneId: string, polygon: [number, number][]) => void
  showFov?: boolean
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
  liveByDevice = {},
  sensorPlacements = [],
  heatmapMode = false,
  estimatePosition = false,
  className,
  drawingMode = false,
  onPolygonDrawn,
  onZoneClick,
  sensorPlaceMode = null,
  onSensorPlace,
  onMapMove,
  editingZoneId = null,
  editingPolygon = null,
  onZonePolygonUpdate,
  showFov = false,
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
  const dragSuppressRef = useRef(false)
  // Edit polygon mode: "move" = drag vertices, "add" = tap edge midpoints, "delete" = tap vertex to remove
  const [editTool, setEditTool] = useState<"move" | "add" | "delete">("move")
  // LOCAL polygon copy for editing -- only this state changes during edit, not the parent's
  const [localPoly, setLocalPoly] = useState<[number, number][] | null>(null)
  const localPolyRef = useRef<[number, number][] | null>(null)
  // Keep ref in sync for use in native Leaflet callbacks
  useEffect(() => { localPolyRef.current = localPoly }, [localPoly])

  // Reset tool and sync local polygon when entering/exiting edit mode
  useEffect(() => {
    setEditTool("move")
    if (editingZoneId) {
      const zone = (zones ?? []).find(z => z.id === editingZoneId)
      if (zone) setLocalPoly([...zone.polygon])
    } else {
      setLocalPoly(null)
    }
  }, [editingZoneId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Also sync if editingPolygon changes from parent (initial load)
  useEffect(() => {
    if (editingPolygon && editingZoneId) {
      setLocalPoly([...editingPolygon])
    }
  }, [editingPolygon, editingZoneId])

  // Refs for edit tool (to use in native Leaflet callbacks without stale closures)
  const editToolRef = useRef<"move" | "add" | "delete">("move")
  useEffect(() => { editToolRef.current = editTool }, [editTool])

  // ── Native Leaflet markers for polygon editing ──
  // This bypasses react-leaflet completely for reliable drag/click handling
  const editMarkersRef = useRef<unknown[]>([])
  const editOutlineRef = useRef<unknown>(null)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any
    const L = leafletL
    if (!map || !L) return

    // Cleanup previous markers
    const cleanup = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editMarkersRef.current.forEach((m: any) => { try { map.removeLayer(m) } catch {} })
      editMarkersRef.current = []
      if (editOutlineRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        try { map.removeLayer(editOutlineRef.current as any) } catch {}
        editOutlineRef.current = null
      }
    }

    cleanup()

    if (!editingZoneId || !localPoly || localPoly.length < 3) return

    const zone = (zones ?? []).find(z => z.id === editingZoneId)
    if (!zone) return

    // Draw dashed outline
    const outline = L.polyline([...localPoly, localPoly[0]], {
      color: "#f59e0b", weight: 2, dashArray: "6 4", interactive: false,
    }).addTo(map)
    editOutlineRef.current = outline

    // Create vertex markers
    localPoly.forEach((pt, i) => {
      const isDelete = editToolRef.current === "delete"
      const isMove = editToolRef.current === "move"
      const bg = isDelete ? "#ef4444" : "#f59e0b"
      const cursor = isMove ? "grab" : "pointer"

      const icon = L.divIcon({
        className: "",
        html: `<div style="width:24px;height:24px;background:${bg};border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:${cursor};"><span style="color:white;font-size:10px;font-weight:800">${i + 1}</span></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      })

      const marker = L.marker(pt, {
        icon,
        draggable: isMove,
        zIndexOffset: 1000,
      }).addTo(map)

      marker.on("dragend", () => {
        const pos = marker.getLatLng()
        setLocalPoly(prev => {
          if (!prev) return prev
          const np = [...prev] as [number, number][]
          np[i] = [pos.lat, pos.lng]
          onZonePolygonUpdate?.(zone.id, np)
          return np
        })
      })

      marker.on("click", () => {
        if (editToolRef.current === "delete") {
          setLocalPoly(prev => {
            if (!prev || prev.length <= 3) return prev
            const np = prev.filter((_, idx) => idx !== i)
            onZonePolygonUpdate?.(zone.id, np)
            return np
          })
        }
      })

      editMarkersRef.current.push(marker)
    })

    // Create midpoint "add" markers (only in add mode)
    if (editToolRef.current === "add") {
      localPoly.forEach((pt, i) => {
        const next = localPoly[(i + 1) % localPoly.length]
        const midLat = (pt[0] + next[0]) / 2
        const midLon = (pt[1] + next[1]) / 2

        const addIcon = L.divIcon({
          className: "",
          html: `<div style="width:22px;height:22px;background:#22c55e;border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:pointer;"><span style="color:white;font-size:14px;font-weight:800;line-height:1">+</span></div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        })

        const midMarker = L.marker([midLat, midLon], {
          icon: addIcon,
          zIndexOffset: 900,
        }).addTo(map)

        midMarker.on("click", () => {
          setLocalPoly(prev => {
            if (!prev) return prev
            const np: [number, number][] = [...prev]
            np.splice(i + 1, 0, [midLat, midLon])
            onZonePolygonUpdate?.(zone.id, np)
            return np
          })
        })

        editMarkersRef.current.push(midMarker)
      })
    }

    // Side distance labels with grouped facade letter
    const editSeg2group = groupSidesByBearing(localPoly)
    localPoly.forEach((pt, i) => {
      const next = localPoly[(i + 1) % localPoly.length]
      const mLat = (pt[0] + next[0]) / 2
      const mLon = (pt[1] + next[1]) / 2
      const dist = haversineM(pt[0], pt[1], next[0], next[1])
      const facadeLetter = editSeg2group[i] ?? String.fromCharCode(65 + i)
      const labelIcon = L.divIcon({
        className: "",
        html: `<div style="font-size:9px;font-weight:700;background:rgba(0,0,0,0.7);padding:1px 5px;border-radius:3px;color:#fbbf24;white-space:nowrap;transform:translate(-50%,-50%);pointer-events:none">${facadeLetter} (${fmtDist(dist)})</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      })
      const labelMarker = L.marker([mLat, mLon], {
        icon: labelIcon,
        interactive: false,
        zIndexOffset: 800,
      }).addTo(map)
      editMarkersRef.current.push(labelMarker)
    })

    return cleanup
  // Re-run when polygon, tool, or editing zone changes
  }, [localPoly, editTool, editingZoneId, leafletL]) // eslint-disable-line react-hooks/exhaustive-deps
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

  // Same refs but keyed by device_id (for multi-TX per zone)
  const lastGoodByDevRef = useRef<Record<string, LiveDetection>>({})
  const lastEventTsByDevRef = useRef<Record<string, number>>({})
  const lastPresenceTsByDevRef = useRef<Record<string, number>>({})

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

  // Track per-device detections
  const prevLiveByDevRef = useRef<Record<string, LiveDetection>>({})
  if (liveByDevice !== prevLiveByDevRef.current) {
    const now = Date.now()
    for (const [devId, det] of Object.entries(liveByDevice)) {
      lastEventTsByDevRef.current[devId] = now
      if (det.presence && det.distance > 0) {
        lastGoodByDevRef.current[devId] = det
        lastPresenceTsByDevRef.current[devId] = now
      }
    }
    prevLiveByDevRef.current = liveByDevice
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

  // Build effective detections by device_id (same hold/fade logic)
  const effectiveByDevice: Record<string, LiveDetection & { _state: DetState }> = {}
  for (const [devId, det] of Object.entries(liveByDevice)) {
    if (det.presence && det.distance > 0) {
      effectiveByDevice[devId] = { ...det, _state: "live" }
    }
  }
  for (const [devId, lastPresenceTs] of Object.entries(lastPresenceTsByDevRef.current)) {
    if (effectiveByDevice[devId]) continue
    if (lastPresenceTs <= 0) continue
    const lastGood = lastGoodByDevRef.current[devId]
    if (!lastGood) continue
    const sinceLast = now - lastPresenceTs
    const currentDet = liveByDevice[devId]
    const sseStillActive = currentDet && (now - (lastEventTsByDevRef.current[devId] ?? 0)) < 3000
    const explicitlyGone = sseStillActive && !currentDet.presence
    if (sinceLast < STALE_MS && !explicitlyGone) {
      effectiveByDevice[devId] = { ...lastGood, _state: "live" }
    } else if (sinceLast < STALE_MS + HOLD_MS) {
      effectiveByDevice[devId] = { ...lastGood, _state: "hold" }
    } else if (sinceLast < STALE_MS + HOLD_MS + FADE_MS) {
      effectiveByDevice[devId] = { ...lastGood, _state: "fading" }
    }
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

  // Disable map drag in draw mode OR zone polygon edit mode
  const shouldLockMap = drawingMode || !!editingZoneId
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any
    if (!map || typeof map.on !== "function") {
      if (shouldLockMap) {
        const t = setTimeout(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const m = mapRef.current as any
          if (m) {
            m.dragging?.disable()
            if (drawingMode) m.touchZoom?.disable()
            m.doubleClickZoom?.disable()
          }
        }, 500)
        return () => clearTimeout(t)
      }
      return
    }
    if (shouldLockMap) {
      map.dragging?.disable()
      // Only disable touchZoom in draw mode (need it for edit mode vertex dragging)
      if (drawingMode) map.touchZoom?.disable()
      map.doubleClickZoom?.disable()
    } else {
      map.dragging?.enable()
      map.touchZoom?.enable()
      map.doubleClickZoom?.enable()
    }
    if (!drawingMode) return
    const handler = (e: { latlng: { lat: number; lng: number } }) => {
      // Skip click if it was triggered right after a vertex drag
      if (dragSuppressRef.current) { dragSuppressRef.current = false; return }
      setDrawPoints((prev) => [...prev, [e.latlng.lat, e.latlng.lng]])
    }
    map.on("click", handler)
    return () => {
      map.off("click", handler)
      map.dragging?.enable()
      map.touchZoom?.enable()
      map.doubleClickZoom?.enable()
    }
  }, [shouldLockMap, drawingMode, mapInstance])

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

    const edge = getSideEdge(zone, sensorPlaceMode.side)
    if (!edge) return
    const pA = edge[0]
    const pB = edge[1]

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
    // Use bearing-based grouping to find the segment(s) that belong to this facade
    const seg2group = zone.polygon.length >= 3 ? groupSidesByBearing(zone.polygon) : []
    // Find the first segment matching this facade group
    const segIdx = seg2group.indexOf(sideKey)
    if (segIdx >= 0) {
      // For multi-segment facades, compute the combined edge (start of first segment to end of last)
      const matchingSegs = seg2group.reduce<number[]>((acc, g, i) => g === sideKey ? [...acc, i] : acc, [])
      if (matchingSegs.length === 1) {
        const nextIdx = (matchingSegs[0] + 1) % zone.polygon.length
        return [zone.polygon[matchingSegs[0]], zone.polygon[nextIdx]]
      }
      // Multiple segments: return start of first to end of last
      const first = matchingSegs[0]
      const last = matchingSegs[matchingSegs.length - 1]
      const endIdx = (last + 1) % zone.polygon.length
      return [zone.polygon[first], zone.polygon[endIdx]]
    }
    // Fallback: direct index mapping
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
  // FOV cone data
  normalBearingDeg: number // bearing of inward normal (degrees from north, clockwise)
  fovDeg: number
  maxRangeM: number
  sensorLabel: string
  }

  // ── Heatmap: project each detection event to a lat/lon point ──
  // LD2450 sensors have x,y (mm) giving exact 2D position relative to sensor.
  // Depth-only sensors have only distance: we use the inward normal for projection.
  // For triangulation with multiple depth-only sensors, we intersect circles.
  type HeatPoint = { lat: number; lon: number; weight: number }
  const heatPoints: HeatPoint[] = (() => {
    try {
    if (!heatmapMode || !zones.length || events.length === 0) return []

    // Build lookups: device_id -> SensorGeo AND zone_id -> SensorGeo[] (fallback)
    type SensorGeo = {
      sensorM: [number, number]
      sensorLL: [number, number]
      normalM: [number, number]
      leftM: [number, number]
    }
    const sensorByDevice: Record<string, SensorGeo> = {}
    const sensorByZone: Record<string, SensorGeo[]> = {}
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
      const geo: SensorGeo = { sensorM: sM, sensorLL: sLL, normalM: nM, leftM: lM }
      sensorByDevice[sp.device_id] = geo
      if (!sensorByZone[sp.zone_id]) sensorByZone[sp.zone_id] = []
      sensorByZone[sp.zone_id].push(geo)
    }

    const pts: HeatPoint[] = []
    const gridCounts: Record<string, number> = {}

    for (const evt of events) {
      const p = evt.payload ?? {}
      const dist = Number(p.distance ?? 0)
      if (dist <= 0) continue

      const zId = evt.zone_id
      if (!zId) continue

      // Match event to correct sensor: by device_id first, then fallback to zone
      const sg = (evt.device_id ? sensorByDevice[evt.device_id] : null)
        ?? sensorByZone[zId]?.[0]
      if (!sg) continue
      const dm = dist / 100 // cm to meters

      // Projection method depends on sensor type:
      // - ld2450: has real x,y (cm) -> exact 2D position
      // - c4001/depth_only: only distance -> project along inward normal
      // - gravity_mw: only distance -> project along inward normal
      // NOTE: LD2450 payload x,y are in cm (TX firmware divides raw mm by 10)
      const sensorType = String(p.sensor_type ?? "ld2450")
      const isDepthOnly = sensorType === "c4001" || sensorType === "gravity_mw" || sensorType === "depth_only"

      const x_cm = Number(p.x ?? 0)
      const y_cm = Number(p.y ?? 0)
      // LD2450 has real lateral (x) data; C4001 sends x=0 always
      const hasRealXY = !isDepthOnly && (x_cm !== 0 || y_cm !== 0)
      const evtAngle = Number(p.angle ?? 0)
      const hasAngle = !isDepthOnly && evtAngle !== 0

      let ptM: [number, number]
      // rightM = -leftM: points right when facing the inward normal direction
      const rM: [number, number] = [-sg.leftM[0], -sg.leftM[1]]

      if (hasRealXY) {
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
        const dirX = cosA * sg.normalM[0] + sinA * rM[0]
        const dirY = cosA * sg.normalM[1] + sinA * rM[1]
        ptM = [
          sg.sensorM[0] + dm * dirX,
          sg.sensorM[1] + dm * dirY,
        ]
      } else {
        // Depth-only (C4001, gravity_mw, or no x/y): project along inward normal
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

    // Per-device detection ONLY -- no zone fallback to prevent TX02 copying TX01
    const det = effectiveByDevice[sp.device_id] || null
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
    // Compute inward normal bearing (degrees from north, clockwise)
    // normalM is [east, north] unit vector -> bearing = atan2(east, north)
    const normalBearingDeg = ((Math.atan2(normalM[0], normalM[1]) * 180 / Math.PI) + 360) % 360

    // Look up sensor specs from device type
    const specs = SENSOR_SPECS[sp.device_type ?? ""] ?? DEFAULT_SENSOR_SPECS

    return {
      id: sp.device_id,
      sensorPos: sensorLatLon,
      detectionPos: detectionLatLon,
      deviceName: sp.device_name,
      side: sp.side,
      detection: det ?? null,
      zoneColor: zone.color,
      normalBearingDeg,
      fovDeg: specs.fovDeg,
      maxRangeM: specs.maxRangeM,
      sensorLabel: specs.label,
    }
  }).filter(Boolean) as SensorMarkerData[]

  // ── Position estimation: weighted average from all simultaneous detections ──
  let estimatedPosition: { lat: number; lon: number; count: number; avgDist: number } | null = null
  if (estimatePosition) {
    const activeMarkers = sensorMarkers.filter(m => m.detectionPos)
    if (activeMarkers.length >= 1) {
      // Weighted by 1/distance (closer sensors have more weight)
      let sumLat = 0, sumLon = 0, sumW = 0, sumDist = 0
      for (const m of activeMarkers) {
        if (!m.detectionPos || !m.detection) continue
        const dist = m.detection.distance || 100
        const w = 1 / Math.max(10, dist)  // cm -> weight (inverse distance)
        sumLat += m.detectionPos[0] * w
        sumLon += m.detectionPos[1] * w
        sumW += w
        sumDist += dist
      }
      if (sumW > 0) {
        estimatedPosition = {
          lat: sumLat / sumW,
          lon: sumLon / sumW,
          count: activeMarkers.length,
          avgDist: Math.round(sumDist / activeMarkers.length),
        }
      }
    }
  }

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
            // Create a custom pane for detection elements well above tooltips (z=650)
            if (!instance.getPane("detection-pane")) {
              const pane = instance.createPane("detection-pane")
              pane.style.zIndex = "700"
            }
            // Create a lower pane for zone side labels (below detection lines)
            if (!instance.getPane("label-pane")) {
              const labelPane = instance.createPane("label-pane")
              labelPane.style.zIndex = "640"
            }
            // Lower the built-in tooltipPane so side label permanent tooltips sit below detection arcs
            // Detection points use detection-pane (z=700) which renders above this
            const tooltipPane = instance.getPane("tooltipPane")
            if (tooltipPane) tooltipPane.style.zIndex = "650"
            // Create a separate pane for detection tooltips (above detection lines)
            if (!instance.getPane("detection-tooltip-pane")) {
              const dtPane = instance.createPane("detection-tooltip-pane")
              dtPane.style.zIndex = "710"
            }
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
          const isBeingEdited = editingZoneId === zone.id
          return (
            <Polygon
              key={zone.id}
              positions={isBeingEdited ? (localPoly ?? zone.polygon) : zone.polygon}
              interactive={!isBeingEdited}
              pathOptions={{
                color: isBeingEdited ? "#f59e0b" : (heatmapMode ? "#666" : zone.color),
                fillColor: isBeingEdited ? "#f59e0b" : (heatmapMode ? "transparent" : zone.color),
                fillOpacity: isBeingEdited ? 0.05 : (heatmapMode ? 0 : (hasPresence ? 0.08 : 0.12)),
                weight: isBeingEdited ? 0 : (heatmapMode ? 1 : (hasPresence ? 2 : 1.5)),
                dashArray: heatmapMode ? "4 4" : undefined,
              }}
              eventHandlers={onZoneClick && !isBeingEdited ? { click: () => onZoneClick(zone.id) } : undefined}
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

        {/* ── FOV detection cones (declarative JSX, no extra hooks) ── */}
        {console.log("[v0] FOV render: showFov=", showFov, "sensorMarkers.length=", sensorMarkers.length, sensorMarkers.map(sm => ({ id: sm.id, pos: sm.sensorPos, bearing: sm.normalBearingDeg, fov: sm.fovDeg, range: sm.maxRangeM, label: sm.sensorLabel })))}
        {showFov && sensorMarkers.map((sm) => {
          const arcPositions = buildFovArc(sm.sensorPos, sm.normalBearingDeg, sm.fovDeg, sm.maxRangeM)
          return (
            <Polygon
              key={`fov-${sm.id}`}
              positions={arcPositions}
              interactive={false}
              pathOptions={{
                color: "rgba(180,210,240,0.2)",
                fillColor: "rgba(180,210,240,0.06)",
                weight: 1,
                dashArray: "4 3",
              }}
            >
              <Tooltip permanent direction="center" className="fov-label-tip">
                <span style={{ fontSize: 8, fontWeight: 600, color: "rgba(180,210,240,0.6)" }}>
                  {sm.sensorLabel} {sm.maxRangeM}m
                </span>
              </Tooltip>
            </Polygon>
          )
        })}

        {/* Zone editing overlay is now handled by native Leaflet markers in useEffect above */}

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

        {/* ── Side labels with distance on saved zones - rotated parallel to edge ── */}
        {(zones ?? []).map((zone) => {
          // Compute bearing-based grouping so colinear segments share the same facade letter
          const seg2group = zone.polygon?.length >= 3 ? groupSidesByBearing(zone.polygon) : []
          return zone.polygon?.length >= 2 && RL && leafletL
            ? zone.polygon.map((pt, idx) => {
                const nextIdx = (idx + 1) % zone.polygon.length
                const next = zone.polygon[nextIdx]
                const mLat = (pt[0] + next[0]) / 2
                const mLon = (pt[1] + next[1]) / 2
                // Use grouped facade letter (e.g. two colinear segments both get "D")
                const groupKey = seg2group[idx] ?? String.fromCharCode(65 + idx)
                const sideLabel = zone.sides?.[groupKey] ?? groupKey
                const displayLabel = sideLabel || groupKey
                const dist = haversineM(pt[0], pt[1], next[0], next[1])
                // Compute screen-space angle of the edge for CSS rotation
                // Geographic bearing: 0=north(up), 90=east(right), 180=south(down)
                // CSS rotate: 0=horizontal(right), 90=down, -90=up
                // Conversion: cssAngle = geoBearing - 90
                const dLon = (next[1] - pt[1]) * Math.PI / 180
                const y = Math.sin(dLon) * Math.cos(next[0] * Math.PI / 180)
                const x = Math.cos(pt[0] * Math.PI / 180) * Math.sin(next[0] * Math.PI / 180) -
                          Math.sin(pt[0] * Math.PI / 180) * Math.cos(next[0] * Math.PI / 180) * Math.cos(dLon)
                const geoBearing = Math.atan2(y, x) * 180 / Math.PI
                let angleDeg = geoBearing - 90
                // Keep text readable (not upside down): normalize to -90..+90
                if (angleDeg > 90) angleDeg -= 180
                if (angleDeg < -90) angleDeg += 180
                const text = `${displayLabel} (${fmtDist(dist)})`
                const SideMarker = RL.Marker
                const icon = leafletL.divIcon({
                  className: "",
                  html: `<div style="
                    transform: translate(-50%, -50%) rotate(${angleDeg.toFixed(1)}deg);
                    white-space: nowrap;
                    font-size: 9px;
                    font-weight: 700;
                    color: ${zone.color};
                    background: rgba(255,255,255,0.92);
                    padding: 1px 5px;
                    border-radius: 3px;
                    border: 1px solid ${zone.color};
                    text-align: center;
                    pointer-events: none;
                    width: fit-content;
                  ">${text}</div>`,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0],
                })
                return (
                  <SideMarker
                    key={`side-${zone.id}-${idx}`}
                    position={[mLat, mLon]}
                    icon={icon}
                    pane="label-pane"
                    interactive={false}
                  />
                )
              })
            : null
        })}

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
              pane="label-pane"
              pathOptions={{ opacity: 0, fillOpacity: 0 }}
            >
              <Tooltip permanent direction="bottom" offset={[0, 12]} >
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
            pane="label-pane"
            pathOptions={{
              color: sm.zoneColor,
              fillColor: sm.zoneColor,
              fillOpacity: 1,
              weight: 2,
            }}
          >
            <Tooltip permanent direction="bottom" offset={[0, 8]} >
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
        {/* When estimatePosition is on, show dashed lines to individual sensors but use a single averaged marker */}
        {sensorMarkers.filter(sm => sm.detectionPos).map((sm) => {
          const state = (sm.detection as LiveDetection & { _state?: string })?._state ?? "live"
          const color = state === "live" ? "#22c55e" : "#f59e0b"
          const opacity = state === "fading" ? 0.25 : state === "hold" ? 0.6 : 0.8
          return (
            <Polyline
              key={`det-line-${sm.id}`}
              pane="detection-pane"
              positions={estimatePosition && estimatedPosition
                ? [sm.sensorPos, [estimatedPosition.lat, estimatedPosition.lon]]
                : [sm.sensorPos, sm.detectionPos!]}
              pathOptions={{
                color: estimatePosition ? "#3b82f6" : color,
                weight: 2,
                dashArray: "4 3",
                opacity: estimatePosition ? 0.5 : opacity,
              }}
            />
          )
        })}

        {/* Estimated position mode: single averaged marker */}
        {estimatePosition && estimatedPosition && (
          <CircleMarker
            key="estimated-pos"
            pane="detection-pane"
            center={[estimatedPosition.lat, estimatedPosition.lon]}
            radius={10}
            pathOptions={{
              color: "#3b82f6",
              fillColor: "#3b82f6",
              fillOpacity: 0.7,
              weight: 3,
              opacity: 0.9,
              className: "detection-pulse",
            }}
          >
            <Tooltip permanent direction="top" offset={[0, -12]}>
              <span style={{
                fontSize: 10, fontWeight: 700, color: "#3b82f6",
                background: "rgba(255,255,255,0.95)", padding: "2px 6px",
                borderRadius: 3, border: "1px solid #3b82f655",
              }}>
                {`~${estimatedPosition.avgDist}cm (${estimatedPosition.count} TX)`}
              </span>
            </Tooltip>
          </CircleMarker>
        )}

        {/* Individual sensor detection points (hidden when estimatePosition is on) */}
        {!estimatePosition && sensorMarkers.filter(sm => sm.detectionPos).map((sm) => {
          const state = (sm.detection as LiveDetection & { _state?: string })?._state ?? "live"
          const isLive = state === "live"
          const isFading = state === "fading"
          const color = isLive ? "#22c55e" : "#f59e0b"
          return (
            <CircleMarker
              key={`det-pt-${sm.id}`}
              pane="detection-pane"
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

        {/* Drawing vertices - draggable */}
        {drawPoints.map((pt, i) => {
          if (!RL || !leafletL) return null
          const DragMarker = RL.Marker
          const drawVertexIcon = leafletL.divIcon({
            className: "",
            html: `<div style="width:18px;height:18px;background:#0891b2;border:2px solid white;border-radius:50%;cursor:grab;box-shadow:0 1px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:8px;font-weight:700">${i + 1}</div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          })
          return (
            <DragMarker
              key={`vertex-${i}`}
              position={pt}
              icon={drawVertexIcon}
              draggable={true}
              eventHandlers={{
                dragend: (e: { target: { getLatLng: () => { lat: number; lng: number } } }) => {
                  dragSuppressRef.current = true
                  const pos = e.target.getLatLng()
                  setDrawPoints((prev) => {
                    const next = [...prev]
                    next[i] = [pos.lat, pos.lng]
                    return next
                  })
                  // Reset suppress after a short delay in case click never fires
                  setTimeout(() => { dragSuppressRef.current = false }, 300)
                },
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -12]}>
                <span style={{ fontSize: 9, fontWeight: 600, color: "#0891b2" }}>P{i + 1}</span>
              </Tooltip>
            </DragMarker>
          )
        })}
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

      {/* Edit polygon toolbar - bottom center, above coords */}
      {editingZoneId && !drawingMode && localPoly && (() => {
        const area = polygonAreaM2(localPoly)
        const tools: { id: "move" | "add" | "delete"; label: string; icon: string; color: string }[] = [
          { id: "move", label: "Deplacer", icon: "M7 10l5-5 5 5M7 14l5 5 5-5", color: "#f59e0b" },
          { id: "add", label: "Ajouter", icon: "M12 5v14M5 12h14", color: "#22c55e" },
          { id: "delete", label: "Supprimer", icon: "M18 6L6 18M6 6l12 12", color: "#ef4444" },
        ]
        return (
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[500] flex flex-col items-center gap-1.5">
            <div className="rounded-xl bg-card/95 backdrop-blur border border-amber-500/30 shadow-lg px-1.5 py-1 flex items-center gap-0.5">
              {tools.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setEditTool(t.id)}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all min-h-[34px]",
                    editTool === t.id
                      ? "text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground bg-transparent"
                  )}
                  style={editTool === t.id ? { background: t.color } : {}}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={t.icon} />
                  </svg>
                  {t.label}
                </button>
              ))}
              <div className="w-px h-5 bg-border/50 mx-0.5" />
              <span className="text-[9px] font-mono text-amber-500/80 px-1">{localPoly.length}pts {area.toFixed(1)}m2</span>
            </div>
          </div>
        )
      })()}

      {/* Drawing toolbar */}
      {drawingMode && (
        <div className="absolute top-2 left-2 right-2 z-[500] flex flex-col gap-2">
          <div className="rounded-lg bg-card/95 backdrop-blur px-3 py-2 border border-cyan-600/40 shadow-lg">
            <span className="text-xs font-mono text-cyan-700 font-semibold">
              DRAW {drawPoints.length > 0 ? `-- ${drawPoints.length} pts` : "-- touchez pour placer les points"}
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
            <div className="flex items-center gap-2">
              <button onClick={undoLastPoint}
                className="rounded-lg bg-card/95 backdrop-blur px-4 py-2.5 text-xs font-medium text-foreground active:bg-muted border border-border shadow-sm transition-colors min-h-[44px]">
                Undo
              </button>
              <button onClick={cancelDrawing}
                className="rounded-lg bg-card/95 backdrop-blur px-4 py-2.5 text-xs font-medium text-destructive active:bg-destructive/10 border border-border shadow-sm transition-colors min-h-[44px]">
                Cancel
              </button>
              {drawPoints.length >= 3 && (
                <button onClick={finishDrawing}
                  className="rounded-lg bg-cyan-600 px-5 py-2.5 text-xs font-semibold text-white active:bg-cyan-500 shadow-lg transition-colors min-h-[44px] flex-1">
                  Validate ({drawPoints.length} pts)
                </button>
              )}
            </div>
          )}
        </div>
      )}

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
