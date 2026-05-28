"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import type { Zone, DetectionEvent, LiveDetection } from "@/lib/types"
import { cn } from "@/lib/utils"
import type { VisualConfig } from "@/hooks/use-visual-config"
import { VISUAL_DEFAULTS } from "@/hooks/use-visual-config"

// ── Types (LiveDetection imported from @/lib/types) ──────────

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
  /** Called when drawing is cancelled */
  onDrawingCancel?: () => void
  onZoneClick?: (zoneId: string) => void
  sensorPlaceMode?: SensorPlaceMode | null
  onSensorPlace?: (zoneId: string, side: string, position: number) => void
  editingZoneId?: string | null
  editingPolygon?: [number, number][] | null
  onZonePolygonUpdate?: (zoneId: string, polygon: [number, number][]) => void
  /** Called when editing is finished (Deplacer button clicked) */
  onStopEditing?: () => void
  showFov?: boolean
  replayMode?: boolean
  /** Calibration mode: user clicks 2 points to set scale */
  calibrationMode?: boolean
  onCalibrationDone?: (scalePixelsPerMeter: number) => void
  /** Calibrated scale in image-pixels per metre */
  planScale?: number | null
  /** Visual configuration (colors, opacities) from per-mission settings */
  visualConfig?: VisualConfig | null
  /** Show measurements (side lengths, area) on zones */
  showMeasurements?: boolean
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

/** Calculate polygon area in square pixels */
function polygonAreaPx(polygon: [number, number][]): number {
  if (polygon.length < 3) return 0
  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length
    // polygon is [row, col] format
    area += polygon[i][1] * polygon[j][0]
    area -= polygon[j][1] * polygon[i][0]
  }
  return Math.abs(area) / 2
}

/** Calculate edge length in pixels */
function edgeLengthPx(p1: [number, number], p2: [number, number]): number {
  const dr = p2[0] - p1[0]
  const dc = p2[1] - p1[1]
  return Math.sqrt(dr * dr + dc * dc)
}

/** Format distance for display */
function formatDistance(px: number, scale: number | null): string {
  if (!scale || scale <= 0) return `${Math.round(px)}px`
  const meters = px / scale
  if (meters < 1) return `${Math.round(meters * 100)}cm`
  return `${meters.toFixed(1)}m`
}

/** Format area for display */
function formatArea(pxArea: number, scale: number | null): string {
  if (!scale || scale <= 0) return `${Math.round(pxArea)}px2`
  const m2 = pxArea / (scale * scale)
  if (m2 < 1) return `${Math.round(m2 * 10000)}cm2`
  return `${m2.toFixed(1)}m2`
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
  onDrawingCancel,
  onZoneClick,
  sensorPlaceMode,
  onSensorPlace,
  editingZoneId,
  editingPolygon,
  onZonePolygonUpdate,
  onStopEditing,
  showFov = false,
  calibrationMode = false,
  onCalibrationDone,
  planScale,
  visualConfig,
  showMeasurements = true,
}: PlanEditorProps) {
  // Use provided visual config or fall back to defaults
  const vc: VisualConfig = useMemo(() => visualConfig ?? {
    zone_fill_color: VISUAL_DEFAULTS.zone_fill_color,
    zone_fill_opacity: parseFloat(VISUAL_DEFAULTS.zone_fill_opacity),
    zone_stroke_opacity: parseFloat(VISUAL_DEFAULTS.zone_stroke_opacity),
    detection_dot_live: VISUAL_DEFAULTS.detection_dot_live,
    detection_dot_hold: VISUAL_DEFAULTS.detection_dot_hold,
    detection_line_color: VISUAL_DEFAULTS.detection_line_color,
    fov_overlay_color: VISUAL_DEFAULTS.fov_overlay_color,
    fov_fill_opacity: parseFloat(VISUAL_DEFAULTS.fov_fill_opacity),
    fov_default_visible: VISUAL_DEFAULTS.fov_default_visible === "true",
    sensor_dot_idle: VISUAL_DEFAULTS.sensor_dot_idle,
    estimated_pos_color: VISUAL_DEFAULTS.estimated_pos_color,
  }, [visualConfig])
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

  // Undo last point
  const undoLastPoint = useCallback(() => {
    setDrawPoints(prev => prev.slice(0, -1))
  }, [])

  // Cancel drawing
  const cancelDrawing = useCallback(() => {
    setDrawPoints([])
    onDrawingCancel?.()
  }, [onDrawingCancel])

  // Finish drawing (validate)
  const finishDrawing = useCallback(() => {
    if (drawPoints.length >= 3 && handlePolygonDone) {
      handlePolygonDone(drawPoints)
      setDrawPoints([])
    }
  }, [drawPoints, handlePolygonDone])

  // Calculate drawing stats
  const drawingPerimeter = useMemo(() => {
    if (drawPoints.length < 2) return 0
    let total = 0
    for (let i = 0; i < drawPoints.length - 1; i++) {
      total += edgeLengthPx(drawPoints[i], drawPoints[i + 1])
    }
    if (drawPoints.length >= 3) {
      total += edgeLengthPx(drawPoints[drawPoints.length - 1], drawPoints[0])
    }
    return total
  }, [drawPoints])

  const drawingArea = useMemo(() => {
    if (drawPoints.length < 3) return 0
    return polygonAreaPx(drawPoints)
  }, [drawPoints])

  // Drag drawing vertex
  const [draggingDrawVertex, setDraggingDrawVertex] = useState<number | null>(null)

  const handleDrawVertexDragStart = useCallback((index: number, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDraggingDrawVertex(index)
  }, [])

  const handleDrawVertexDrag = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (draggingDrawVertex === null) return
    e.preventDefault()
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY
    const pt = toImgCoords(clientX, clientY)
    setDrawPoints(prev => {
      const next = [...prev]
      next[draggingDrawVertex] = pt
      return next
    })
  }, [draggingDrawVertex, toImgCoords])

  const handleDrawVertexDragEnd = useCallback(() => {
    setDraggingDrawVertex(null)
  }, [])

  // Store refs for values that change frequently to avoid dependency issues
  const editingPolygonRef = useRef(editingPolygon)
  const editingZoneIdRef = useRef(editingZoneId)
  const onZonePolygonUpdateRef = useRef(onZonePolygonUpdate)
  
  useEffect(() => {
    editingPolygonRef.current = editingPolygon
    editingZoneIdRef.current = editingZoneId
    onZonePolygonUpdateRef.current = onZonePolygonUpdate
  }, [editingPolygon, editingZoneId, onZonePolygonUpdate])

  // Edit zone vertex dragging
  const [draggingEditVertex, setDraggingEditVertex] = useState<number | null>(null)

  const handleEditVertexDragStart = useCallback((index: number, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDraggingEditVertex(index)
  }, [])

  const handleEditVertexDrag = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (draggingEditVertex === null || !editingZoneIdRef.current || !editingPolygonRef.current) return
    e.preventDefault()
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY
    const pt = toImgCoords(clientX, clientY)
    const newPoly = [...editingPolygonRef.current]
    newPoly[draggingEditVertex] = pt
    onZonePolygonUpdateRef.current?.(editingZoneIdRef.current, newPoly)
  }, [draggingEditVertex, toImgCoords])

  const handleEditVertexDragEnd = useCallback(() => {
    setDraggingEditVertex(null)
  }, [])

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
      // Use zone.sides to get facade letters: { "A": "facadeLetter", "B": "facadeLetter", ... }
      const zoneSides = zone.sides as Record<string, string> | undefined
      for (let i = 0; i < zone.polygon.length; i++) {
        const a = zone.polygon[i]
        const b = zone.polygon[(i + 1) % zone.polygon.length]
        const segmentKey = String.fromCharCode(65 + i) // A, B, C, D, E, F...
        const side = zoneSides?.[segmentKey] ?? segmentKey // Use facade letter from zone.sides

        // Only consider edges matching the selected facade
        if (sensorPlaceMode.side && side !== sensorPlaceMode.side) continue

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

  // Combined drag handler - MUST be before conditional returns!
  const isDragging = draggingDrawVertex !== null || draggingEditVertex !== null
  const handleDrag = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (draggingDrawVertex !== null) handleDrawVertexDrag(e)
    else if (draggingEditVertex !== null) handleEditVertexDrag(e)
  }, [draggingDrawVertex, draggingEditVertex, handleDrawVertexDrag, handleEditVertexDrag])

  const handleDragEnd = useCallback(() => {
    handleDrawVertexDragEnd()
    handleEditVertexDragEnd()
  }, [handleDrawVertexDragEnd, handleEditVertexDragEnd])

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
      onMouseMove={isDragging ? handleDrag : undefined}
      onMouseUp={isDragging ? handleDragEnd : undefined}
      onMouseLeave={isDragging ? handleDragEnd : undefined}
      onTouchMove={isDragging ? handleDrag : undefined}
      onTouchEnd={isDragging ? handleDragEnd : undefined}
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
          
          // Calculate zone area
          const zoneAreaPx = polygonAreaPx(zone.polygon)

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
              {/* Vertex labels (circles with letters at corners) */}
              {zone.polygon.map((pt, i) => {
                const [sx, sy] = toSvg(pt)
                const label = String.fromCharCode(65 + i)
                return (
                  <g key={`vertex-label-${zone.id}-${i}`}>
                    <circle
                      cx={sx}
                      cy={sy}
                      r={10}
                      fill={zoneColor}
                      stroke="hsl(var(--background))"
                      strokeWidth={2}
                      className="pointer-events-none"
                    />
                    <text
                      x={sx}
                      y={sy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="text-[9px] font-mono font-bold pointer-events-none"
                      style={{ fill: "#ffffff" }}
                    >
                      {label}
                    </text>
                  </g>
                )
              })}
              {/* Side labels with measurements */}
              {zone.polygon.map((pt, i) => {
                const nextPt = zone.polygon[(i + 1) % zone.polygon.length]
                const mid = toSvg([(pt[0] + nextPt[0]) / 2, (pt[1] + nextPt[1]) / 2] as [number, number])
                const label = sides[i] ?? String.fromCharCode(65 + i)
                const lengthPx = edgeLengthPx(pt, nextPt)
                const lengthStr = showMeasurements ? formatDistance(lengthPx, planScale) : ""
                return (
                  <g key={`side-${zone.id}-${i}`}>
                    <text
                      x={mid[0]}
                      y={mid[1] - (showMeasurements ? 8 : 0)}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="text-[10px] font-mono font-bold pointer-events-none"
                      style={{ fill: "#ffffff", paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 4 }}
                    >
                      {label}
                    </text>
                    {showMeasurements && lengthStr && (
                      <text
                        x={mid[0]}
                        y={mid[1] + 8}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="text-[8px] font-mono pointer-events-none"
                        style={{ fill: zoneColor, paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3 }}
                      >
                        ({lengthStr})
                      </text>
                    )}
                  </g>
                )
              })}
              {/* Zone name + area */}
              {(() => {
                const cx = zone.polygon.reduce((s, p) => s + p[1], 0) / zone.polygon.length
                const cy = zone.polygon.reduce((s, p) => s + p[0], 0) / zone.polygon.length
                const [sx, sy] = toSvg([cy, cx] as [number, number])
                const areaStr = showMeasurements ? formatArea(zoneAreaPx, planScale) : ""
                return (
                  <g>
                    <text
                      x={sx}
                      y={sy - (showMeasurements ? 8 : 0)}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="text-[12px] font-bold pointer-events-none"
                      style={{ fill: zoneColor, paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 5 }}
                    >
                      {zone.name || zone.label}
                    </text>
                    {showMeasurements && areaStr && (
                      <text
                        x={sx}
                        y={sy + 10}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="text-[10px] font-mono pointer-events-none"
                        style={{ fill: zoneColor, paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3, opacity: 0.9 }}
                      >
                        {areaStr}
                      </text>
                    )}
                  </g>
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
                    r={12}
                    className="fill-primary stroke-background cursor-grab active:cursor-grabbing"
                    strokeWidth={3}
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
            {/* Detection point: solid circle (no pulsing) */}
            {m.isPresence && m.detSx != null && m.detSy != null && (
              <g>
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
            {/* Polygon fill preview */}
            {drawPoints.length >= 3 && (
              <polygon
                points={drawPoints.map(p => { const [x, y] = toSvg(p); return `${x},${y}` }).join(" ")}
                fill="#0891b2"
                fillOpacity={0.1}
                stroke="none"
              />
            )}
            {/* Drawing polyline with dashes */}
            <polyline
              points={drawPoints.map(p => { const [x, y] = toSvg(p); return `${x},${y}` }).join(" ")}
              fill="none"
              stroke="#0891b2"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
            {/* Closing line if >= 3 points */}
            {drawPoints.length >= 3 && (() => {
              const [x1, y1] = toSvg(drawPoints[drawPoints.length - 1])
              const [x2, y2] = toSvg(drawPoints[0])
              return (
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="#0891b2"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
              )
            })()}
            {/* Edge labels in badge style: "A: 15.2m" */}
            {drawPoints.map((p, i) => {
              const nextIdx = (i + 1) % drawPoints.length
              if (i === drawPoints.length - 1 && drawPoints.length < 3) return null
              const nextP = drawPoints[nextIdx]
              const [x1, y1] = toSvg(p)
              const [x2, y2] = toSvg(nextP)
              const midX = (x1 + x2) / 2
              const midY = (y1 + y2) / 2
              const lengthPx = edgeLengthPx(p, nextP)
              const lengthStr = formatDistance(lengthPx, planScale)
              const label = String.fromCharCode(65 + i)
              return (
                <g key={`draw-edge-label-${i}`}>
                  <rect
                    x={midX - 28}
                    y={midY - 10}
                    width={56}
                    height={20}
                    rx={3}
                    fill="rgba(255,255,255,0.95)"
                    stroke="#0891b2"
                    strokeWidth={1}
                  />
                  <text
                    x={midX}
                    y={midY}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="text-[10px] font-mono font-bold pointer-events-none"
                    style={{ fill: "#0891b2" }}
                  >
                    {label}: {lengthStr}
                  </text>
                </g>
              )
            })}
            {/* Central info badge: area + perimeter */}
            {drawPoints.length >= 3 && (() => {
              const cx = drawPoints.reduce((s, p) => s + p[1], 0) / drawPoints.length
              const cy = drawPoints.reduce((s, p) => s + p[0], 0) / drawPoints.length
              const [sx, sy] = toSvg([cy, cx] as [number, number])
              const areaStr = formatArea(drawingArea, planScale)
              const perimStr = formatDistance(drawingPerimeter, planScale)
              return (
                <g>
                  <rect
                    x={sx - 55}
                    y={sy - 10}
                    width={110}
                    height={20}
                    rx={3}
                    fill="rgba(255,255,255,0.95)"
                    stroke="#0891b2"
                    strokeWidth={1}
                  />
                  <text
                    x={sx}
                    y={sy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="text-[10px] font-mono font-bold pointer-events-none"
                    style={{ fill: "#0891b2" }}
                  >
                    {areaStr} | P: {perimStr}
                  </text>
                </g>
              )
            })()}
          </g>
        )}
      </svg>

      {/* Drawing vertices - HTML overlay for drag support */}
      {drawingMode && drawPoints.map((p, i) => {
        const [x, y] = toSvg(p)
        return (
          <div
            key={`draw-vertex-html-${i}`}
            className="absolute z-30 cursor-grab active:cursor-grabbing touch-none select-none"
            style={{
              left: x - 12,
              top: y - 12,
              width: 24,
              height: 24,
            }}
            onMouseDown={(e) => handleDrawVertexDragStart(i, e)}
            onTouchStart={(e) => handleDrawVertexDragStart(i, e)}
          >
            <div
              className="w-full h-full rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-md"
              style={{
                background: "#0891b2",
                border: "2px solid white",
              }}
            >
              {i + 1}
            </div>
            <div
              className="absolute -top-5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap"
              style={{ color: "#0891b2" }}
            >
              P{i + 1}
            </div>
          </div>
        )
      })}

      {/* Drawing mode toolbar (HTML) */}
      {drawingMode && (
        <div className="absolute top-2 left-2 right-2 z-20 flex flex-col gap-2">
          <div className="rounded-lg bg-card/95 backdrop-blur px-3 py-2 border border-cyan-600/40 shadow-lg">
            <span className="text-xs font-mono text-cyan-700 font-semibold">
              DRAW {drawPoints.length > 0 ? `-- ${drawPoints.length} pts` : "-- touchez pour placer les points"}
              {drawPoints.length >= 2 && ` | P: ${formatDistance(drawingPerimeter, planScale)}`}
              {drawPoints.length >= 3 && ` | ${formatArea(drawingArea, planScale)}`}
            </span>
          </div>
          {drawPoints.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={undoLastPoint}
                className="rounded-lg bg-card/95 backdrop-blur px-4 py-2.5 text-xs font-medium text-foreground active:bg-muted border border-border shadow-sm transition-colors min-h-[44px]"
              >
                Undo
              </button>
              <button
                onClick={cancelDrawing}
                className="rounded-lg bg-card/95 backdrop-blur px-4 py-2.5 text-xs font-medium text-destructive active:bg-destructive/10 border border-border shadow-sm transition-colors min-h-[44px]"
              >
                Cancel
              </button>
              {drawPoints.length >= 3 && (
                <button
                  onClick={finishDrawing}
                  className="rounded-lg bg-cyan-600 px-5 py-2.5 text-xs font-semibold text-white active:bg-cyan-500 shadow-lg transition-colors min-h-[44px] flex-1"
                >
                  Validate ({drawPoints.length} pts)
                </button>
              )}
            </div>
          )}
        </div>
      )}

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

      {/* Editing mode toolbar (like Habitation) */}
      {editingZoneId && editingPolygon && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-card/95 backdrop-blur border border-border rounded-xl px-3 py-2 shadow-xl">
          <button
            onClick={onStopEditing}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 text-white text-xs font-semibold hover:bg-cyan-500 active:bg-cyan-700 transition-colors min-h-[40px]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            Deplacer
          </button>
          <button
            onClick={() => {
              if (!editingPolygon || editingPolygon.length < 3) return
              // Add a point in the middle of the first edge
              const midRow = (editingPolygon[0][0] + editingPolygon[1][0]) / 2
              const midCol = (editingPolygon[0][1] + editingPolygon[1][1]) / 2
              const newPoly: [number, number][] = [editingPolygon[0], [midRow, midCol], ...editingPolygon.slice(1)]
              onZonePolygonUpdate?.(editingZoneId, newPoly)
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card text-foreground text-xs font-medium border border-border hover:bg-muted active:bg-muted/70 transition-colors min-h-[40px]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            Ajouter
          </button>
          <button
            onClick={() => {
              if (!editingPolygon || editingPolygon.length <= 3) return
              // Remove the last point
              const newPoly = editingPolygon.slice(0, -1)
              onZonePolygonUpdate?.(editingZoneId, newPoly)
            }}
            disabled={!editingPolygon || editingPolygon.length <= 3}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card text-destructive text-xs font-medium border border-border hover:bg-destructive/10 active:bg-destructive/20 transition-colors min-h-[40px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            Supprimer
          </button>
          <span className="text-xs text-muted-foreground ml-2 font-mono">
            {editingPolygon.length}pts {formatArea(polygonAreaPx(editingPolygon), planScale)}
          </span>
        </div>
      )}

      {/* Editing vertices (HTML overlay for drag support) */}
      {editingZoneId && editingPolygon && editingPolygon.map((pt, i) => {
        const [x, y] = toSvg(pt)
        return (
          <div
            key={`edit-vertex-html-${i}`}
            className="absolute z-25 cursor-grab active:cursor-grabbing touch-none select-none"
            style={{
              left: x - 14,
              top: y - 14,
              width: 28,
              height: 28,
            }}
            onMouseDown={(e) => handleEditVertexDragStart(i, e)}
            onTouchStart={(e) => handleEditVertexDragStart(i, e)}
          >
            <div
              className="w-full h-full rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-lg"
              style={{
                background: "#f59e0b",
                border: "3px solid white",
              }}
            >
              {i + 1}
            </div>
          </div>
        )
      })}
    </div>
  )
}
