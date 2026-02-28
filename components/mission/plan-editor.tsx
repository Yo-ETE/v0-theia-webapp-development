"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import type { Zone, DetectionEvent } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useVisualConfig } from "@/hooks/use-visual-config"

// ── Types ────────────────────────────────────────────────────

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
  sensor_position: number
  device_type?: string
  orientation?: "inward" | "outward"
}

interface SensorPlaceMode {
  zoneId: string
  side: string
  deviceId: string
  deviceName: string
}

/** Sensor hardware specs for FOV cone visualization */
const SENSOR_SPECS: Record<string, { fovDeg: number; maxRangeM: number; label: string }> = {
  microwave_tx:  { fovDeg: 120, maxRangeM: 6,  label: "LD2450" },
  tx_microwave:  { fovDeg: 120, maxRangeM: 6,  label: "LD2450" },
  c4001:         { fovDeg: 100, maxRangeM: 8,  label: "C4001" },
  gravity_mw:    { fovDeg: 75,  maxRangeM: 6,  label: "Gravity MW V2" },
}
const DEFAULT_SENSOR_SPECS = { fovDeg: 90, maxRangeM: 6, label: "Unknown" }

interface PlanEditorProps {
  /** Accepts both "planImage" and "imageUrl" for convenience */
  planImage?: string
  imageUrl?: string
  imageWidth?: number
  imageHeight?: number
  zones?: Zone[]
  sensorPlacements?: SensorPlacement[]
  liveByDevice?: Record<string, LiveDetection>
  className?: string
  drawingMode?: boolean
  /** Called with raw polygon coordinates when a zone is drawn */
  onPolygonDrawn?: (polygon: [number, number][]) => void
  /** Alias: same as onPolygonDrawn, called with (polygon) */
  onZoneCreated?: (polygon: [number, number][]) => void
  onZoneClick?: (zoneId: string) => void
  sensorPlaceMode?: SensorPlaceMode | null
  onSensorPlace?: (zoneId: string, side: string, position: number) => void
  editingZoneId?: string | null
  editingPolygon?: [number, number][] | null
  onZonePolygonUpdate?: (zoneId: string, polygon: [number, number][]) => void
  showFov?: boolean
  replayMode?: boolean
  /** Calibration mode: user clicks 2 points to set scale */
  calibrationMode?: boolean
  onCalibrationDone?: (scalePixelsPerMeter: number) => void
  /** Calibrated scale in image-pixels per metre */
  planScale?: number | null
}

/** Group polygon edges by bearing -- simplified for pixel coords */
function groupSidesByBearing(polygon: [number, number][]): Record<number, string> {
  const sides: Record<number, string> = {}
  if (!polygon || polygon.length < 3) return sides
  // Simple: assign letters A, B, C, D... to each edge
  for (let i = 0; i < polygon.length; i++) {
    sides[i] = String.fromCharCode(65 + i)
  }
  return sides
}

/** Get a point along a polygon edge at parameter t (0..1) */
function getPointOnEdge(polygon: [number, number][], sideIdx: number, t: number): [number, number] | null {
  if (!polygon || sideIdx < 0 || sideIdx >= polygon.length) return null
  const a = polygon[sideIdx]
  const b = polygon[(sideIdx + 1) % polygon.length]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** Side index from side letter */
function sideLetterToIdx(side: string): number {
  return side.charCodeAt(0) - 65
}

export function PlanEditor({
  planImage,
  imageUrl,
  imageWidth: propW,
  imageHeight: propH,
  zones = [],
  sensorPlacements = [],
  liveByDevice = {},
  className,
  drawingMode = false,
  onPolygonDrawn,
  onZoneCreated,
  onZoneClick,
  sensorPlaceMode,
  onSensorPlace,
  editingZoneId,
  editingPolygon,
  onZonePolygonUpdate,
  showFov = false,
  calibrationMode = false,
  onCalibrationDone,
  planScale,
}: PlanEditorProps) {
  const { config: vc } = useVisualConfig()
  const resolvedImage = planImage || imageUrl || ""
  const handlePolygonDone = onPolygonDrawn ?? onZoneCreated
  const containerRef = useRef<HTMLDivElement>(null)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [editPoly, setEditPoly] = useState<[number, number][] | null>(null)

  // Track container size for scaling
  const [containerW, setContainerW] = useState(0)
  const scale = containerW > 0 && imgSize.w > 0 ? containerW / imgSize.w : 1
  const displayH = imgSize.h * scale

  // Calibration state
  const [calPoints, setCalPoints] = useState<[number, number][]>([])
  const [calDistInput, setCalDistInput] = useState("")
  const calInputRef = useRef<HTMLInputElement>(null)

  // Reset calibration points when mode toggles off
  useEffect(() => {
    if (!calibrationMode) { setCalPoints([]); setCalDistInput("") }
  }, [calibrationMode])

  const [imgError, setImgError] = useState(false)
  const [imgLoading, setImgLoading] = useState(true)
  const retryCountRef = useRef(0)
  const maxRetries = 6

  // Load image dimensions -- with automatic retry on failure
  useEffect(() => {
    if (!resolvedImage) {
      setImgLoading(false)
      setImgError(true)
      return
    }
    retryCountRef.current = 0
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    function tryLoad() {
      if (cancelled) return
      setImgLoading(true)
      setImgError(false)
      const img = new window.Image()
      img.crossOrigin = "anonymous"
      img.onload = () => {
        if (cancelled) return
        setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
        setImgLoading(false)
        retryCountRef.current = 0
      }
      img.onerror = () => {
        if (cancelled) return
        retryCountRef.current++
        if (retryCountRef.current < maxRetries) {
          // Retry with increasing delay (1s, 2s, 3s, ...)
          retryTimer = setTimeout(tryLoad, retryCountRef.current * 1000)
        } else {
          console.error("[v0] PlanEditor: failed to load image after retries:", resolvedImage)
          setImgError(true)
          setImgLoading(false)
        }
      }
      // Add cache-busting param on retries
      const sep = resolvedImage.includes("?") ? "&" : "?"
      img.src = retryCountRef.current > 0
        ? `${resolvedImage}${sep}_r=${retryCountRef.current}`
        : resolvedImage
    }

    tryLoad()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [resolvedImage])

  // Observe container width
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setContainerW(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Sync editingPolygon prop to local state
  useEffect(() => {
    setEditPoly(editingPolygon ?? null)
  }, [editingPolygon])

  // Convert container pixel coords to image coords
  const toImgCoords = useCallback((clientX: number, clientY: number): [number, number] => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return [0, 0]
    const x = (clientX - rect.left) / scale
    const y = (clientY - rect.top) / scale
    return [y, x] // [row, col] same format as [lat, lon] in map-inner
  }, [scale])

  // Convert image coords [row, col] to SVG display coords
  const toSvg = useCallback((pt: [number, number]): [number, number] => {
    return [pt[1] * scale, pt[0] * scale] // [x, y]
  }, [scale])

  // Drawing mode click handler
  const handleClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!drawingMode || !handlePolygonDone) return
    e.preventDefault()
    const clientX = "touches" in e ? e.changedTouches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.changedTouches[0].clientY : e.clientY
    const pt = toImgCoords(clientX, clientY)
    setDrawPoints(prev => [...prev, pt])
  }, [drawingMode, handlePolygonDone, toImgCoords])
  
  // Double click / double tap to finish drawing
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!drawingMode || !handlePolygonDone || drawPoints.length < 3) return
    e.preventDefault()
    handlePolygonDone(drawPoints)
    setDrawPoints([])
  }, [drawingMode, handlePolygonDone, drawPoints])

  // Sensor placement click -- find closest edge
  const handlePlaceClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!sensorPlaceMode || !onSensorPlace) return
    e.preventDefault()
    const clientX = "touches" in e ? e.changedTouches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.changedTouches[0].clientY : e.clientY
    const [row, col] = toImgCoords(clientX, clientY)

    let bestZoneId = ""
    let bestSide = ""
    let bestT = 0.5
    let bestDist = Infinity

    for (const zone of zones) {
      if (!zone.polygon?.length || zone.polygon.length < 3) continue
      for (let i = 0; i < zone.polygon.length; i++) {
        const a = zone.polygon[i]
        const b = zone.polygon[(i + 1) % zone.polygon.length]
        const side = String.fromCharCode(65 + i)

        const ax = a[1], ay = a[0]
        const bx = b[1], by = b[0]
        const dx = bx - ax, dy = by - ay
        const len2 = dx * dx + dy * dy
        if (len2 === 0) continue
        let t = ((col - ax) * dx + (row - ay) * dy) / len2
        t = Math.max(0, Math.min(1, t))
        const px = ax + t * dx
        const py = ay + t * dy
        const dist = Math.sqrt((col - px) ** 2 + (row - py) ** 2)

        if (dist < bestDist) {
          bestDist = dist
          bestZoneId = zone.id
          bestSide = side
          bestT = Math.max(0.02, Math.min(0.98, t))
        }
      }
    }

    // Accept if within ~50px of an edge on the image
    if (bestZoneId && bestDist < 50) {
      onSensorPlace(bestZoneId, bestSide, bestT)
    }
  }, [sensorPlaceMode, onSensorPlace, zones, toImgCoords])

  // Vertex drag for zone editing
  const handleVertexDragStart = useCallback((idx: number, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragIdx(idx)
  }, [])

  useEffect(() => {
    if (dragIdx === null || !editPoly || !editingZoneId || !onZonePolygonUpdate) return

    const handleMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault()
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY
      const pt = toImgCoords(clientX, clientY)
      setEditPoly(prev => {
        if (!prev) return prev
        const next = [...prev] as [number, number][]
        next[dragIdx] = pt
        return next
      })
    }

    const handleUp = () => {
      if (editPoly && editingZoneId) {
        onZonePolygonUpdate(editingZoneId, editPoly)
      }
      setDragIdx(null)
    }

    window.addEventListener("mousemove", handleMove)
    window.addEventListener("mouseup", handleUp)
    window.addEventListener("touchmove", handleMove, { passive: false })
    window.addEventListener("touchend", handleUp)
    return () => {
      window.removeEventListener("mousemove", handleMove)
      window.removeEventListener("mouseup", handleUp)
      window.removeEventListener("touchmove", handleMove)
      window.removeEventListener("touchend", handleUp)
    }
  }, [dragIdx, editPoly, editingZoneId, onZonePolygonUpdate, toImgCoords])

  // Build sensor positions on the SVG (with detection point projected along edge normal)
  const sensorMarkers = useMemo(() => {
    return sensorPlacements.map(sp => {
      const zone = zones.find(z => z.id === sp.zone_id)
      if (!zone?.polygon?.length) return null
      const idx = sideLetterToIdx(sp.side)
      const pt = getPointOnEdge(zone.polygon, idx, sp.sensor_position)
      if (!pt) return null
      const [sx, sy] = toSvg(pt)
      const det = liveByDevice[sp.device_id]
      const isPresence = det?.presence && det?.distance > 0

      // Compute detection point: project along edge normal by distance
      let detSx: number | null = null
      let detSy: number | null = null
      if (isPresence && det && planScale) {
        const a = zone.polygon[idx]
        const b = zone.polygon[(idx + 1) % zone.polygon.length]
        // Edge vector (in image row/col)
        const dCol = b[1] - a[1]
        const dRow = b[0] - a[0]
        // Normal perpendicular (inward)
        let nx = -dRow, ny = dCol
        const len = Math.sqrt(nx * nx + ny * ny)
        if (len > 0) { nx /= len; ny /= len }
        // Check if normal points toward centroid (inward)
        const cx = zone.polygon.reduce((s, p) => s + p[1], 0) / zone.polygon.length
        const cy = zone.polygon.reduce((s, p) => s + p[0], 0) / zone.polygon.length
        const midCol = (a[1] + b[1]) / 2
        const midRow = (a[0] + b[0]) / 2
        if (nx * (cx - midCol) + ny * (cy - midRow) < 0) { nx = -nx; ny = -ny }
        if (sp.orientation === "outward") { nx = -nx; ny = -ny }
        // Distance in image pixels
        const distPx = (det.distance / 100) * planScale // cm -> m -> px
        // Lateral offset for direction
        let latNx = -ny, latNy = nx // perpendicular to normal
        let lateralPx = 0
        if (det.direction === "G" || det.direction === "Gauche") lateralPx = distPx * 0.5
        else if (det.direction === "D" || det.direction === "Droite") lateralPx = -distPx * 0.5
        // Detection point in image coords
        const detImgCol = pt[1] + nx * distPx + latNx * lateralPx
        const detImgRow = pt[0] + ny * distPx + latNy * lateralPx
        const [dsx, dsy] = toSvg([detImgRow, detImgCol])
        detSx = dsx
        detSy = dsy
      }

      return { ...sp, sx, sy, det, isPresence, detSx, detSy }
    }).filter(Boolean) as (SensorPlacement & { sx: number; sy: number; det?: LiveDetection; isPresence?: boolean; detSx?: number | null; detSy?: number | null })[]
  }, [sensorPlacements, zones, liveByDevice, toSvg, planScale])

  // Calibration click handler
  const handleCalClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!calibrationMode || calPoints.length >= 2) return
    e.preventDefault()
    const clientX = "touches" in e ? e.changedTouches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.changedTouches[0].clientY : e.clientY
    const pt = toImgCoords(clientX, clientY)
    setCalPoints(prev => {
      const next = [...prev, pt]
      if (next.length === 2) {
        // Focus the distance input after 2nd point
        setTimeout(() => calInputRef.current?.focus(), 100)
      }
      return next
    })
  }, [calibrationMode, calPoints, toImgCoords])

  // Validate calibration
  const handleCalValidate = useCallback(() => {
    if (calPoints.length !== 2) return
    const dist = parseFloat(calDistInput)
    if (!dist || dist <= 0) return
    // Distance in image pixels between the 2 points
    const [r1, c1] = calPoints[0]
    const [r2, c2] = calPoints[1]
    const pxDist = Math.sqrt((c2 - c1) ** 2 + (r2 - r1) ** 2)
    if (pxDist < 1) return
    const pxPerMeter = pxDist / dist
    onCalibrationDone?.(pxPerMeter)
    setCalPoints([])
    setCalDistInput("")
  }, [calPoints, calDistInput, onCalibrationDone])

  // Compute edge normal (inward-pointing) for a sensor on a polygon edge
  const getEdgeNormal = useCallback((polygon: [number, number][], sideIdx: number, orientation: "inward" | "outward"): number => {
    const a = polygon[sideIdx]
    const b = polygon[(sideIdx + 1) % polygon.length]
    // Edge vector in image coords: (dCol, dRow)
    const dCol = b[1] - a[1]
    const dRow = b[0] - a[0]
    // Normal perpendicular to edge (rotated 90deg CW = inward for CW polygon)
    let nx = -dRow
    let ny = dCol
    // Check if normal points toward polygon centroid (inward)
    const cx = polygon.reduce((s, p) => s + p[1], 0) / polygon.length
    const cy = polygon.reduce((s, p) => s + p[0], 0) / polygon.length
    const midCol = (a[1] + b[1]) / 2
    const midRow = (a[0] + b[0]) / 2
    const toCx = cx - midCol
    const toCy = cy - midRow
    const dot = nx * toCx + ny * toCy
    if (dot < 0) { nx = -nx; ny = -ny } // flip to point inward
    if (orientation === "outward") { nx = -nx; ny = -ny }
    // Return angle in degrees (0=right, 90=down in SVG coords)
    return Math.atan2(ny, nx) * 180 / Math.PI
  }, [])

  // Build FOV arc path in SVG coords
  const buildFovPath = useCallback((cx: number, cy: number, angleDeg: number, fovDeg: number, radiusPx: number): string => {
    const halfFov = fovDeg / 2
    const STEPS = 24
    const pts: string[] = [`${cx},${cy}`]
    for (let s = 0; s <= STEPS; s++) {
      const a = (angleDeg - halfFov + (fovDeg * s / STEPS)) * Math.PI / 180
      pts.push(`${cx + Math.cos(a) * radiusPx},${cy + Math.sin(a) * radiusPx}`)
    }
    pts.push(`${cx},${cy}`)
    return pts.join(" ")
  }, [])

  // Main click dispatcher
  const handleMainClick = useCallback((e: React.MouseEvent) => {
    if (calibrationMode) {
      handleCalClick(e)
    } else if (sensorPlaceMode) {
      handlePlaceClick(e)
    } else if (drawingMode) {
      handleClick(e)
    }
  }, [calibrationMode, handleCalClick, sensorPlaceMode, handlePlaceClick, drawingMode, handleClick])

  const handleMainTouch = useCallback((e: React.TouchEvent) => {
    if (calibrationMode) {
      handleCalClick(e)
    } else if (sensorPlaceMode) {
      handlePlaceClick(e)
    } else if (drawingMode) {
      handleClick(e)
    }
  }, [calibrationMode, handleCalClick, sensorPlaceMode, handlePlaceClick, drawingMode, handleClick])

  const activeZones = editingZoneId && editPoly
    ? zones.map(z => z.id === editingZoneId ? { ...z, polygon: editPoly } : z)
    : zones

  // Loading / error states (no image URL yet, or still loading)
  if (!resolvedImage || imgLoading) {
    return (
      <div ref={containerRef} className={cn("flex items-center justify-center rounded-lg bg-muted/10 min-h-[300px]", className)}>
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <p className="text-xs">Chargement du plan...</p>
        </div>
      </div>
    )
  }

  if (imgError) {
    return (
      <div ref={containerRef} className={cn("flex items-center justify-center rounded-lg bg-muted/10 min-h-[300px] border-2 border-dashed border-border/50", className)}>
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <p className="text-sm font-medium">Image du plan introuvable</p>
          <p className="text-xs">Importez un plan via le bouton ci-dessous</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn("relative select-none overflow-hidden rounded-lg bg-muted/10", className)}
      style={{ height: displayH || "auto" }}
    >
      {/* Background image */}
      <img
        src={resolvedImage}
        alt="Plan"
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        draggable={false}
      />

      {/* SVG overlay */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={`0 0 ${containerW} ${displayH}`}
        onClick={handleMainClick}
        onTouchEnd={handleMainTouch}
        onDoubleClick={handleDoubleClick}
        style={{ touchAction: drawingMode || sensorPlaceMode || calibrationMode ? "none" : "auto" }}
      >
        {/* Zone polygons */}
        {activeZones.map(zone => {
          if (!zone.polygon?.length || zone.polygon.length < 3) return null
          const pts = zone.polygon.map(p => toSvg(p))
          const polyStr = pts.map(p => `${p[0]},${p[1]}`).join(" ")
          const sides = groupSidesByBearing(zone.polygon)

          // If user set a custom zone_fill_color (different from default), use it for ALL zones
          const isCustomZoneColor = vc.zone_fill_color !== "#3b82f6"
          const zoneColor = isCustomZoneColor ? vc.zone_fill_color : (zone.color || vc.zone_fill_color)

          return (
            <g key={zone.id} onClick={(e) => { e.stopPropagation(); onZoneClick?.(zone.id) }} className="cursor-pointer">
              {/* Fill */}
              <polygon
                points={polyStr}
                fill={zoneColor}
                fillOpacity={vc.zone_fill_opacity}
                stroke={zoneColor}
                strokeWidth={2}
                strokeOpacity={vc.zone_stroke_opacity}
              />
              {/* Side labels */}
              {zone.polygon.map((pt, i) => {
                const nextPt = zone.polygon[(i + 1) % zone.polygon.length]
                const mid = toSvg([(pt[0] + nextPt[0]) / 2, (pt[1] + nextPt[1]) / 2] as [number, number])
                const label = sides[i] ?? String.fromCharCode(65 + i)
                return (
                  <text
                    key={`side-${zone.id}-${i}`}
                    x={mid[0]}
                    y={mid[1]}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="text-[10px] font-mono font-bold pointer-events-none"
                    style={{ fill: "#ffffff", paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 4 }}
                  >
                    {label}
                  </text>
                )
              })}
              {/* Zone name */}
              {(() => {
                const cx = zone.polygon.reduce((s, p) => s + p[1], 0) / zone.polygon.length
                const cy = zone.polygon.reduce((s, p) => s + p[0], 0) / zone.polygon.length
                const [sx, sy] = toSvg([cy, cx] as [number, number])
                return (
                  <text
                    x={sx}
                    y={sy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="text-[12px] font-bold pointer-events-none"
                    style={{ fill: zoneColor, paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 5 }}
                  >
                    {zone.name || zone.label}
                  </text>
                )
              })()}
              {/* Vertex handles when editing */}
              {editingZoneId === zone.id && zone.polygon.map((pt, i) => {
                const [sx, sy] = toSvg(pt)
                return (
                  <circle
                    key={`vertex-${i}`}
                    cx={sx}
                    cy={sy}
                    r={8}
                    className="fill-primary stroke-background cursor-grab active:cursor-grabbing"
                    strokeWidth={2}
                    onMouseDown={(e) => handleVertexDragStart(i, e)}
                    onTouchStart={(e) => handleVertexDragStart(i, e)}
                  />
                )
              })}
            </g>
          )
        })}

        {/* Highlighted edges in placement mode */}
        {sensorPlaceMode && activeZones.map(zone => {
          if (!zone.polygon?.length || zone.polygon.length < 3) return null
          return zone.polygon.map((pt, i) => {
            const nextPt = zone.polygon[(i + 1) % zone.polygon.length]
            const [x1, y1] = toSvg(pt)
            const [x2, y2] = toSvg(nextPt)
            return (
              <line
                key={`place-${zone.id}-${i}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={vc.fov_overlay_color}
                strokeWidth={4}
                strokeOpacity={0.7}
                strokeDasharray="8 4"
                className="pointer-events-none"
              />
            )
          })
        })}

        {/* Sensor markers */}
        {sensorMarkers.map(m => (
          <g key={m.device_id}>
            {/* Dashed line from sensor to detection point */}
            {m.isPresence && m.detSx != null && m.detSy != null && (
              <line
                x1={m.sx} y1={m.sy} x2={m.detSx} y2={m.detSy}
                stroke={vc.detection_line_color} strokeWidth={2} strokeDasharray="4 3" strokeOpacity={0.8}
              />
            )}
            {/* Detection point: pulsing circle */}
            {m.isPresence && m.detSx != null && m.detSy != null && (
              <g>
                <circle cx={m.detSx} cy={m.detSy} r={14} fill={vc.detection_dot_live} fillOpacity={0.15} className="animate-ping" />
                <circle cx={m.detSx} cy={m.detSy} r={7} fill={vc.detection_dot_live} fillOpacity={0.7} stroke={vc.detection_dot_live} strokeWidth={2} strokeOpacity={0.9} />
                {/* Distance + direction label */}
                <text
                  x={m.detSx} y={m.detSy - 12}
                  textAnchor="middle"
                  className="text-[9px] font-mono font-bold pointer-events-none"
                  style={{ fill: vc.detection_dot_live, paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3 }}
                >
                  {m.det!.distance}cm {m.det!.direction === "G" || m.det!.direction === "Gauche" ? "G" : m.det!.direction === "D" || m.det!.direction === "Droite" ? "D" : "C"}
                </text>
              </g>
            )}
            {/* Sensor dot (always visible) */}
            <circle
              cx={m.sx} cy={m.sy} r={5}
              fill={m.isPresence ? vc.detection_dot_live : (m.det ? vc.detection_dot_hold : vc.sensor_dot_idle)}
              className="stroke-background"
              strokeWidth={2}
            />
            {/* Sensor label */}
            <text
              x={m.sx}
              y={m.sy - 10}
              textAnchor="middle"
              className="fill-foreground text-[9px] font-mono pointer-events-none"
              style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3 }}
            >
              {m.device_name}
            </text>
            {/* Fallback: no planScale -> show distance at sensor position */}
            {m.isPresence && m.det && m.detSx == null && (
              <text
                x={m.sx}
                y={m.sy + 16}
                textAnchor="middle"
                className="text-[9px] font-mono font-bold pointer-events-none"
                style={{ fill: vc.detection_dot_live, paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3 }}
              >
                {m.det.distance}cm
              </text>
            )}
          </g>
        ))}

        {/* FOV cones (requires planScale) */}
        {showFov && planScale && sensorMarkers.map(m => {
          const zone = zones.find(z => z.id === m.zone_id)
          if (!zone?.polygon?.length) return null
          const sideIdx = sideLetterToIdx(m.side)
          const specs = SENSOR_SPECS[m.device_type ?? ""] ?? DEFAULT_SENSOR_SPECS
          const angleDeg = getEdgeNormal(zone.polygon, sideIdx, m.orientation ?? "inward")
          const radiusPx = specs.maxRangeM * planScale * scale
          const fovPath = buildFovPath(m.sx, m.sy, angleDeg, specs.fovDeg, radiusPx)
          return (
            <g key={`fov-${m.device_id}`}>
              <polygon
                points={fovPath}
                fill={vc.fov_overlay_color}
                fillOpacity={vc.fov_fill_opacity}
                stroke={vc.fov_overlay_color}
                strokeWidth={1}
                strokeOpacity={0.4}
                strokeDasharray="4 2"
              />
              {/* Max range arc label */}
              <text
                x={m.sx + Math.cos(angleDeg * Math.PI / 180) * radiusPx * 0.7}
                y={m.sy + Math.sin(angleDeg * Math.PI / 180) * radiusPx * 0.7}
                textAnchor="middle"
                className="fill-cyan-400/60 text-[8px] font-mono pointer-events-none"
              >
                {specs.maxRangeM}m
              </text>
            </g>
          )
        })}

        {/* Detection arcs removed -- only green dot + dashed line shown */}

        {/* Calibration overlay */}
        {calibrationMode && (
          <g>
            {/* Placed points */}
            {calPoints.map((p, i) => {
              const [x, y] = toSvg(p)
              return (
                <g key={`cal-${i}`}>
                  <circle cx={x} cy={y} r={8} fill="none" stroke="#f43f5e" strokeWidth={2} />
                  <circle cx={x} cy={y} r={3} fill="#f43f5e" />
                  <text x={x + 12} y={y + 4} className="fill-rose-400 text-[10px] font-mono font-bold pointer-events-none">
                    {i === 0 ? "A" : "B"}
                  </text>
                </g>
              )
            })}
            {/* Line between 2 points */}
            {calPoints.length === 2 && (() => {
              const [x1, y1] = toSvg(calPoints[0])
              const [x2, y2] = toSvg(calPoints[1])
              const pxDist = Math.sqrt(
                (calPoints[1][1] - calPoints[0][1]) ** 2 +
                (calPoints[1][0] - calPoints[0][0]) ** 2
              )
              return (
                <>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f43f5e" strokeWidth={2} strokeDasharray="6 3" />
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 8}
                    textAnchor="middle"
                    className="fill-rose-400 text-[10px] font-mono font-bold pointer-events-none"
                    style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3 }}
                  >
                    {Math.round(pxDist)}px
                  </text>
                </>
              )
            })()}
            {/* Instruction text */}
            {calPoints.length < 2 && (
              <text x={containerW / 2} y={30} textAnchor="middle" className="fill-rose-400 text-[11px] font-semibold pointer-events-none"
                style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3 }}>
                {calPoints.length === 0
                  ? "Cliquez le point A sur le plan"
                  : "Cliquez le point B sur le plan"}
              </text>
            )}
          </g>
        )}

        {/* Scale bar (bottom-left) */}
        {planScale && !calibrationMode && (() => {
          // Pick a nice round distance for the bar
          const candidates = [1, 2, 5, 10, 20, 50]
          const targetBarPx = Math.min(containerW * 0.25, 150)
          let barM = 5
          for (const c of candidates) {
            if (c * planScale * scale <= targetBarPx * 1.2) barM = c
          }
          const barW = barM * planScale * scale
          const barX = 16
          const barY = displayH - 20
          return (
            <g>
              <rect x={barX - 2} y={barY - 12} width={barW + 4} height={18} rx={3} fill="hsl(var(--background))" fillOpacity={0.7} />
              <line x1={barX} y1={barY} x2={barX + barW} y2={barY} stroke="hsl(var(--foreground))" strokeWidth={2} />
              <line x1={barX} y1={barY - 4} x2={barX} y2={barY + 2} stroke="hsl(var(--foreground))" strokeWidth={2} />
              <line x1={barX + barW} y1={barY - 4} x2={barX + barW} y2={barY + 2} stroke="hsl(var(--foreground))" strokeWidth={2} />
              <text x={barX + barW / 2} y={barY - 4} textAnchor="middle" className="fill-foreground text-[9px] font-mono font-bold pointer-events-none">
                {barM}m
              </text>
            </g>
          )
        })()}

        {/* Drawing mode: in-progress polygon */}
        {drawingMode && drawPoints.length > 0 && (
          <g>
            <polyline
              points={drawPoints.map(p => { const [x, y] = toSvg(p); return `${x},${y}` }).join(" ")}
              fill="none"
              stroke={vc.fov_overlay_color}
              strokeWidth={2}
              strokeDasharray="6 3"
            />
            {drawPoints.map((p, i) => {
              const [x, y] = toSvg(p)
              return (
                <circle
                  key={i}
                  cx={x} cy={y} r={5}
                  className="fill-cyan-400 stroke-background"
                  strokeWidth={2}
                />
              )
            })}
            {drawPoints.length >= 3 && (
              <text
                x={toSvg(drawPoints[drawPoints.length - 1])[0]}
                y={toSvg(drawPoints[drawPoints.length - 1])[1] - 14}
                textAnchor="middle"
                className="fill-cyan-300 text-[9px] font-mono pointer-events-none"
              >
                double-clic pour fermer
              </text>
            )}
          </g>
        )}
      </svg>

      {/* Calibration distance input (HTML overlay) */}
      {calibrationMode && calPoints.length === 2 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
          <label className="text-xs font-medium text-foreground whitespace-nowrap">Distance reelle :</label>
          <input
            ref={calInputRef}
            type="number"
            step="0.1"
            min="0.1"
            value={calDistInput}
            onChange={e => setCalDistInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCalValidate() }}
            className="w-20 h-7 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="m"
          />
          <span className="text-xs text-muted-foreground">m</span>
          <button
            onClick={handleCalValidate}
            disabled={!calDistInput || parseFloat(calDistInput) <= 0}
            className="h-7 px-3 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Valider
          </button>
          <button
            onClick={() => { setCalPoints([]); setCalDistInput("") }}
            className="h-7 px-2 rounded text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  )
}
