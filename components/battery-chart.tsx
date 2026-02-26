"use client"

import { useState, useMemo } from "react"
import useSWR from "swr"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Battery, Clock, TrendingDown } from "lucide-react"
import { cn } from "@/lib/utils"

// --- types ---
type BatteryReading = { voltage: number; timestamp: string }
type DeviceBatteryData = {
  device_id: string
  name: string
  dev_eui: string
  readings: BatteryReading[]
}

// --- fetcher ---
function getBackendBase(): string | null {
  if (typeof window === "undefined") return null
  return `http://${window.location.hostname}:8000`
}
const fetcher = async (url: string) => {
  const base = getBackendBase()
  if (base) {
    try {
      const r = await fetch(`${base}${url}`)
      if (r.ok) return r.json()
    } catch { /* fall through */ }
  }
  const r = await fetch(url)
  if (!r.ok) throw new Error(`API ${r.status}`)
  return r.json()
}

// --- colors (computed, not CSS vars) ---
const DEVICE_COLORS = [
  "#22c55e", // green
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // purple
  "#06b6d4", // cyan
  "#f97316", // orange
  "#ec4899", // pink
]

// --- battery estimation ---
const VBATT_FULL = 4.2  // LiPo fully charged
const VBATT_EMPTY = 3.0 // LiPo cutoff
const VBATT_WARN = 3.5
const VBATT_CRIT = 3.3

function estimateBattery(readings: BatteryReading[]) {
  if (readings.length < 2) return null

  const first = readings[0]
  const last = readings[readings.length - 1]
  const firstTs = new Date(first.timestamp).getTime()
  const lastTs = new Date(last.timestamp).getTime()
  const deltaH = (lastTs - firstTs) / 3600000

  if (deltaH < 0.01) return null

  const voltDrop = first.voltage - last.voltage
  const dropPerH = voltDrop / deltaH
  const remaining = last.voltage - VBATT_EMPTY

  if (dropPerH <= 0.001) {
    return { dropPerH: 0, hoursLeft: Infinity, current: last.voltage, pct: Math.round(((last.voltage - VBATT_EMPTY) / (VBATT_FULL - VBATT_EMPTY)) * 100) }
  }

  const hoursLeft = remaining / dropPerH

  return {
    dropPerH: Math.round(dropPerH * 1000) / 1000,
    hoursLeft: Math.max(0, Math.round(hoursLeft * 10) / 10),
    current: last.voltage,
    pct: Math.min(100, Math.max(0, Math.round(((last.voltage - VBATT_EMPTY) / (VBATT_FULL - VBATT_EMPTY)) * 100))),
  }
}

// --- custom tooltip ---
function BatteryTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string; name: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 shadow-md">
      <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-mono font-medium" style={{ color: p.color }}>
            {p.value?.toFixed(2)}V
          </span>
        </div>
      ))}
    </div>
  )
}

// --- period selector ---
const PERIODS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7j", hours: 168 },
]

export function BatteryChart() {
  const [hours, setHours] = useState(24)
  const [selectedDevices, setSelectedDevices] = useState<Set<string> | "all">("all")
  const { data, isLoading } = useSWR<DeviceBatteryData[]>(
    `/api/devices/battery-history/all?hours=${hours}`,
    fetcher,
    { refreshInterval: 30000 }
  )

  // Build list of all devices
  const allDevices = useMemo(() => {
    if (!data || data.length === 0) return []
    return data.map((d, i) => ({
      id: d.device_id,
      name: d.name || d.dev_eui,
      eui: d.dev_eui,
      color: DEVICE_COLORS[i % DEVICE_COLORS.length],
      key: `v_${d.dev_eui}`,
      estimation: estimateBattery(d.readings),
    }))
  }, [data])

  // Toggle device visibility
  const toggleDevice = (eui: string) => {
    setSelectedDevices(prev => {
      if (prev === "all") {
        // Switch from "all" to "all except this one"
        const newSet = new Set(allDevices.map(d => d.eui))
        newSet.delete(eui)
        return newSet.size === 0 ? "all" : newSet
      }
      const newSet = new Set(prev)
      if (newSet.has(eui)) {
        newSet.delete(eui)
        if (newSet.size === 0) return "all" // if none selected, show all
      } else {
        newSet.add(eui)
        if (newSet.size === allDevices.length) return "all"
      }
      return newSet
    })
  }

  const showAll = () => setSelectedDevices("all")
  const showOnly = (eui: string) => setSelectedDevices(new Set([eui]))

  const isDeviceVisible = (eui: string) => selectedDevices === "all" || selectedDevices.has(eui)

  // Visible devices for chart and estimation cards
  const visibleDevices = allDevices.filter(d => isDeviceVisible(d.eui))

  // Transform data for recharts: merge all devices into time-aligned rows
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return []

    const allPoints: Map<string, Record<string, number>> = new Map()

    for (const device of data) {
      if (!isDeviceVisible(device.dev_eui)) continue
      const key = `v_${device.dev_eui}`
      for (const r of device.readings) {
        const ts = new Date(r.timestamp)
        ts.setSeconds(0, 0)
        const tsKey = ts.toISOString()
        if (!allPoints.has(tsKey)) {
          allPoints.set(tsKey, {})
        }
        allPoints.get(tsKey)![key] = r.voltage
      }
    }

    return Array.from(allPoints.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ts, values]) => {
        const d = new Date(ts)
        return {
          time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
          fullTime: ts,
          ...values,
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedDevices])

  const hasData = chartData.length > 0 && allDevices.length > 0

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Battery className="h-4 w-4" />
            Consommation batterie
          </CardTitle>
          <div className="flex items-center gap-1">
            {PERIODS.map(p => (
              <button
                key={p.hours}
                onClick={() => setHours(p.hours)}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                  hours === p.hours
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-[220px] text-xs text-muted-foreground">
            Chargement...
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center h-[220px] text-xs text-muted-foreground gap-2">
            <Battery className="h-8 w-8 text-muted-foreground/40" />
            <p>{"Aucune donnee batterie pour cette periode"}</p>
            <p className="text-[10px]">{"Les donnees s'accumuleront des que les capteurs transmettront."}</p>
          </div>
        ) : (
          <>
            {/* Device filter */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <button
                onClick={showAll}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                  selectedDevices === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                Tous
              </button>
              {allDevices.map(dev => {
                const visible = isDeviceVisible(dev.eui)
                return (
                  <button
                    key={dev.id}
                    onClick={(e) => {
                      if (e.shiftKey || e.metaKey) {
                        toggleDevice(dev.eui)
                      } else {
                        showOnly(dev.eui)
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      toggleDevice(dev.eui)
                    }}
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all",
                      visible
                        ? "bg-muted ring-1 text-foreground"
                        : "bg-muted/40 text-muted-foreground/50"
                    )}
                    style={visible ? { ringColor: dev.color, borderColor: dev.color, boxShadow: `inset 0 0 0 1px ${dev.color}40` } : undefined}
                    title="Clic = afficher seul | Shift+clic = ajouter/retirer"
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: visible ? dev.color : "hsl(0 0% 40%)" }}
                    />
                    {dev.name}
                  </button>
                )
              })}
            </div>

            {/* Chart */}
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 25%)" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10, fill: "hsl(0 0% 60%)" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[2.8, 4.4]}
                    tick={{ fontSize: 10, fill: "hsl(0 0% 60%)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${v.toFixed(1)}V`}
                  />
                  <Tooltip content={<BatteryTooltip />} />
                  {/* Warning / critical thresholds */}
                  <ReferenceLine y={VBATT_WARN} stroke="#f59e0b" strokeDasharray="5 5" strokeWidth={1} />
                  <ReferenceLine y={VBATT_CRIT} stroke="#ef4444" strokeDasharray="5 5" strokeWidth={1} />

                  {visibleDevices.map(dev => (
                    <Line
                      key={dev.key}
                      type="monotone"
                      dataKey={dev.key}
                      name={dev.name}
                      stroke={dev.color}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Estimations per device */}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {visibleDevices.map(dev => {
                const est = dev.estimation
                if (!est) return null
                const isWarn = est.current < VBATT_WARN
                const isCrit = est.current < VBATT_CRIT
                return (
                  <div
                    key={dev.id}
                    className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-2.5 py-1.5"
                  >
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: dev.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium text-foreground truncate">{dev.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={cn(
                          "font-mono text-[11px] font-semibold",
                          isCrit ? "text-destructive" : isWarn ? "text-warning" : "text-success"
                        )}>
                          {est.current.toFixed(2)}V
                        </span>
                        <Badge variant="outline" className={cn(
                          "text-[8px] px-1 py-0",
                          isCrit ? "border-destructive/40 text-destructive" : isWarn ? "border-warning/40 text-warning" : "border-success/40 text-success"
                        )}>
                          {est.pct}%
                        </Badge>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {est.dropPerH > 0 ? (
                        <>
                          <div className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                            <TrendingDown className="h-2.5 w-2.5" />
                            <span className="font-mono">{est.dropPerH}V/h</span>
                          </div>
                          <div className="flex items-center gap-0.5 text-[9px] text-muted-foreground mt-0.5">
                            <Clock className="h-2.5 w-2.5" />
                            <span className="font-mono">
                              {est.hoursLeft > 99 ? ">99h" : `~${est.hoursLeft}h`}
                            </span>
                          </div>
                        </>
                      ) : (
                        <span className="text-[9px] text-success">Stable</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
