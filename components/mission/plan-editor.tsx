"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import type { Zone, DetectionEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

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

interface PlanEditorProps {
  planImage: string
  planWidth?: number | null
  planHeight?: number | null
  zones?: Zone[]
  sensorPlacements?: SensorPlacement[]
  liveByDevice?: Record<string, LiveDetection>
  className?: string
  drawingMode?: boolean
  onPolygonDrawn?: (polygon: [number, number][]) => void
  onZoneClick?: (zoneId: string) => void
  sensorPlaceMode?: SensorPlaceMode | null
  onSensorPlace?: (zoneId: string, side: string, position: number) => void
  editingZoneId?: string | null
  editingPolygon?: [number, number][] | null
  onZonePolygonUpdate?: (zoneId: string, polygon: [number, number][]) => void
  showFov?: boolean
  replayMode?: boolean
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
  zones = [],
  sensorPlacements = [],
  liveByDevice = {},
  className,
  drawingMode = false,
  onPolygonDrawn,
  onZoneClick,
  sensorPlaceMode,
  onSensorPlace,
  editingZoneId,
  editingPolygon,
  onZonePolygonUpdate,
}: PlanEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [editPoly, setEditPoly] = useState<[number, number][] | null>(null)

  // Track container size for scaling
  const [containerW, setContainerW] = useState(0)
  const scale = containerW > 0 && imgSize.w > 0 ? containerW / imgSize.w : 1
  const displayH = imgSize.h * scale

  // Load image dimensions
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = planImage
  }, [planImage])

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
    if (!drawingMode || !onPolygonDrawn) return
    e.preventDefault()
    const clientX = "touches" in e ? e.changedTouches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.changedTouches[0].clientY : e.clientY
    const pt = toImgCoords(clientX, clientY)
    setDrawPoints(prev => [...prev, pt])
  }, [drawingMode, onPolygonDrawn, toImgCoords])

  // Double click / double tap to finish drawing
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!drawingMode || !onPolygonDrawn || drawPoints.length < 3) return
    e.preventDefault()
    onPolygonDrawn(drawPoints)
    setDrawPoints([])
  }, [drawingMode, onPolygonDrawn, drawPoints])

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

  // Build sensor positions on the SVG
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
      return { ...sp, sx, sy, det, isPresence }
    }).filter(Boolean) as (SensorPlacement & { sx: number; sy: number; det?: LiveDetection; isPresence?: boolean })[]
  }, [sensorPlacements, zones, liveByDevice, toSvg])

  // Main click dispatcher
  const handleMainClick = useCallback((e: React.MouseEvent) => {
    if (sensorPlaceMode) {
      handlePlaceClick(e)
    } else if (drawingMode) {
      handleClick(e)
    }
  }, [sensorPlaceMode, handlePlaceClick, drawingMode, handleClick])

  const handleMainTouch = useCallback((e: React.TouchEvent) => {
    if (sensorPlaceMode) {
      handlePlaceClick(e)
    } else if (drawingMode) {
      handleClick(e)
    }
  }, [sensorPlaceMode, handlePlaceClick, drawingMode, handleClick])

  if (!planImage || imgSize.w === 0) {
    return (
      <div className={cn("flex items-center justify-center bg-muted/20 rounded-lg min-h-[200px]", className)}>
        <p className="text-xs text-muted-foreground">Chargement du plan...</p>
      </div>
    )
  }

  const activeZones = editingZoneId && editPoly
    ? zones.map(z => z.id === editingZoneId ? { ...z, polygon: editPoly } : z)
    : zones

  return (
    <div
      ref={containerRef}
      className={cn("relative select-none overflow-hidden rounded-lg bg-muted/10", className)}
      style={{ height: displayH || "auto" }}
    >
      {/* Background image */}
      <img
        src={planImage}
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
        style={{ touchAction: drawingMode || sensorPlaceMode ? "none" : "auto" }}
      >
        {/* Zone polygons */}
        {activeZones.map(zone => {
          if (!zone.polygon?.length || zone.polygon.length < 3) return null
          const pts = zone.polygon.map(p => toSvg(p))
          const polyStr = pts.map(p => `${p[0]},${p[1]}`).join(" ")
          const sides = groupSidesByBearing(zone.polygon)

          return (
            <g key={zone.id} onClick={(e) => { e.stopPropagation(); onZoneClick?.(zone.id) }} className="cursor-pointer">
              {/* Fill */}
              <polygon
                points={polyStr}
                fill={zone.color || "#3b82f6"}
                fillOpacity={0.15}
                stroke={zone.color || "#3b82f6"}
                strokeWidth={2}
                strokeOpacity={0.7}
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
                    className="fill-foreground text-[10px] font-mono font-bold pointer-events-none"
                    style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3 }}
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
                    className="fill-foreground text-[11px] font-semibold pointer-events-none"
                    style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 4 }}
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
                stroke="#22d3ee"
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
            {/* Detection pulse */}
            {m.isPresence && (
              <circle
                cx={m.sx} cy={m.sy} r={16}
                className="fill-warning/30 animate-ping"
              />
            )}
            {/* Sensor dot */}
            <circle
              cx={m.sx} cy={m.sy} r={6}
              className={cn(
                "stroke-background",
                m.isPresence ? "fill-warning" : m.det ? "fill-success" : "fill-primary"
              )}
              strokeWidth={2}
            />
            {/* Label */}
            <text
              x={m.sx}
              y={m.sy - 12}
              textAnchor="middle"
              className="fill-foreground text-[9px] font-mono pointer-events-none"
              style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3 }}
            >
              {m.device_name}
            </text>
            {/* Distance badge when detecting */}
            {m.isPresence && m.det && (
              <text
                x={m.sx}
                y={m.sy + 18}
                textAnchor="middle"
                className="fill-warning text-[9px] font-mono font-bold pointer-events-none"
                style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3 }}
              >
                {m.det.distance}cm
              </text>
            )}
          </g>
        ))}

        {/* Drawing mode: in-progress polygon */}
        {drawingMode && drawPoints.length > 0 && (
          <g>
            <polyline
              points={drawPoints.map(p => { const [x, y] = toSvg(p); return `${x},${y}` }).join(" ")}
              fill="none"
              stroke="#22d3ee"
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
    </div>
  )
}
