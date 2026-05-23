"use client"

import { useState, useMemo } from "react"
import useSWR from "swr"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Signal, TrendingUp, TrendingDown, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"

// --- types ---
type RssiReading = { rssi: number; snr: number | null; timestamp: string }
type DeviceRssiData = {
  device_id: string
  name: string
  dev_eui: string
  readings: RssiReading[]
}

// --- fetcher ---
function getBackendBase(): string | null {
  if (typeof window === "undefined") return null
  return `http://${window.location.hostname}:8000`
}
function _bearerH(): Record<string, string> {
  try {
    const token = typeof window !== "undefined" ? localStorage.getItem("theia_token") : null
    return token ? { "Authorization": `Bearer ${token}` } : {}
  } catch { return {} }
}
const fetcher = async (url: string) => {
  const base = getBackendBase()
  if (base) {
    try {
      const r = await fetch(`${base}${url}`, { credentials: "include", headers: _bearerH() })
      if (r.ok) return r.json()
    } catch { /* fall through */ }
  }
  const r = await fetch(url, { credentials: "include", headers: _bearerH() })
  if (!r.ok) throw new Error(`API ${r.status}`)
  return r.json()
}

// --- colors ---
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

// --- RSSI thresholds ---
const RSSI_EXCELLENT = -70  // Excellent signal
const RSSI_GOOD = -85       // Good signal
const RSSI_WEAK = -100      // Weak signal (below this is poor)

// Gap threshold: if no data for this many minutes, consider it a disconnection
const GAP_THRESHOLD_MINUTES = 10

function analyzeRssi(readings: RssiReading[]) {
  if (readings.length === 0) return null

  const rssiValues = readings.map(r => r.rssi)
  const avg = rssiValues.reduce((a, b) => a + b, 0) / rssiValues.length
  const min = Math.min(...rssiValues)
  const max = Math.max(...rssiValues)
  const current = readings[readings.length - 1].rssi
  const currentSnr = readings[readings.length - 1].snr

  // Count disconnections (gaps > GAP_THRESHOLD_MINUTES)
  let disconnections = 0
  for (let i = 1; i < readings.length; i++) {
    const prevTs = new Date(readings[i - 1].timestamp).getTime()
    const currTs = new Date(readings[i].timestamp).getTime()
    const gapMinutes = (currTs - prevTs) / 60000
    if (gapMinutes > GAP_THRESHOLD_MINUTES) {
      disconnections++
    }
  }

  // Trend: compare first half average to second half (only if enough data)
  let trend = 0
  if (readings.length >= 2) {
    const midpoint = Math.floor(readings.length / 2)
    const firstHalf = rssiValues.slice(0, midpoint || 1)
    const secondHalf = rssiValues.slice(midpoint || 1)
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length
    trend = secondAvg - firstAvg // positive = improving, negative = degrading
  }

  return {
    current: Math.round(current),
    currentSnr: currentSnr != null ? Math.round(currentSnr * 10) / 10 : null,
    avg: Math.round(avg),
    min: Math.round(min),
    max: Math.round(max),
    trend: Math.round(trend * 10) / 10,
    disconnections,
    quality: current >= RSSI_EXCELLENT ? "excellent" : current >= RSSI_GOOD ? "good" : current >= RSSI_WEAK ? "weak" : "poor",
  }
}

// --- custom tooltip ---
function RssiTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string; name: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 shadow-md">
      <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-mono font-medium" style={{ color: p.color }}>
            {p.value != null ? `${p.value} dBm` : "—"}
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

export function RssiChart() {
  const [hours, setHours] = useState(24)
  const [selectedDevices, setSelectedDevices] = useState<Set<string> | "all">("all")
  
  // Fetch RSSI history data
  const { data, isLoading } = useSWR<DeviceRssiData[]>(
    `/api/devices/rssi-history/all?hours=${hours}`,
    fetcher,
    { refreshInterval: 30000 }
  )

  // Build list of devices from RSSI data only (like BatteryChart)
  const allDevices = useMemo(() => {
    if (!data || data.length === 0) return []
    return data.map((d, i) => ({
      id: d.device_id,
      name: d.name || d.dev_eui,
      eui: d.dev_eui,
      color: DEVICE_COLORS[i % DEVICE_COLORS.length],
      key: `rssi_${d.dev_eui}`,
      analysis: analyzeRssi(d.readings),
    }))
  }, [data])

  // Toggle device visibility
  const toggleDevice = (eui: string) => {
    setSelectedDevices(prev => {
      if (prev === "all") {
        const newSet = new Set(allDevices.map(d => d.eui))
        newSet.delete(eui)
        return newSet.size === 0 ? "all" : newSet
      }
      const newSet = new Set(prev)
      if (newSet.has(eui)) {
        newSet.delete(eui)
        if (newSet.size === 0) return "all"
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

  const visibleDevices = allDevices.filter(d => isDeviceVisible(d.eui))

  // Transform data for recharts
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return []

    const allPoints: Map<string, Record<string, number | null>> = new Map()

    for (const device of data) {
      if (!isDeviceVisible(device.dev_eui)) continue
      const key = `rssi_${device.dev_eui}`
      const readings = device.readings
      
      for (let i = 0; i < readings.length; i++) {
        const r = readings[i]
        const ts = new Date(r.timestamp)
        ts.setSeconds(0, 0)
        const tsKey = ts.toISOString()
        
        if (!allPoints.has(tsKey)) {
          allPoints.set(tsKey, {})
        }
        allPoints.get(tsKey)![key] = r.rssi
      }
    }

    return Array.from(allPoints.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ts, values]) => {
        const d = new Date(ts)
        // Format based on period: show date for 7d, time for shorter periods
        let timeLabel: string
        if (hours >= 168) {
          // 7 days: show day/month
          timeLabel = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`
        } else {
          // Less than 7 days: show time
          timeLabel = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
        }
        return {
          time: timeLabel,
          fullTime: ts,
          ...values,
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedDevices, hours])

  const hasData = chartData.length > 0 && allDevices.length > 0

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Signal className="h-4 w-4" />
            Historique RSSI
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
        {/* Device filter - always visible when we have devices */}
        {allDevices.length > 0 && (
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
                  style={visible ? { borderColor: dev.color, boxShadow: `inset 0 0 0 1px ${dev.color}40` } : undefined}
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
        )}
        
        {isLoading ? (
          <div className="flex items-center justify-center h-[220px] text-xs text-muted-foreground">
            Chargement...
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center h-[220px] text-xs text-muted-foreground gap-2">
            <Signal className="h-8 w-8 text-muted-foreground/40" />
            <p>{"Aucune donnee RSSI pour cette periode"}</p>
            <p className="text-[10px]">{"Les donnees s'accumuleront des que les capteurs transmettront."}</p>
          </div>
        ) : (
          <>
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
                    domain={[-120, -40]}
                    tick={{ fontSize: 10, fill: "hsl(0 0% 60%)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${v}`}
                  />
                  <Tooltip content={<RssiTooltip />} />
                  {/* Signal quality thresholds */}
                  <ReferenceLine y={RSSI_EXCELLENT} stroke="#22c55e" strokeDasharray="5 5" strokeWidth={1} />
                  <ReferenceLine y={RSSI_GOOD} stroke="#f59e0b" strokeDasharray="5 5" strokeWidth={1} />
                  <ReferenceLine y={RSSI_WEAK} stroke="#ef4444" strokeDasharray="5 5" strokeWidth={1} />

                  {visibleDevices.map(dev => (
                    <Line
                      key={dev.key}
                      type="monotone"
                      dataKey={dev.key}
                      name={dev.name}
                      stroke={dev.color}
                      strokeWidth={2}
                      dot={{ r: 3, fill: dev.color, strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: dev.color, strokeWidth: 2, stroke: "hsl(0 0% 10%)" }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Signal stats per device */}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {visibleDevices.map(dev => {
                const analysis = dev.analysis
                if (!analysis) return null
                const qualityColor = {
                  excellent: "text-success",
                  good: "text-success",
                  weak: "text-warning",
                  poor: "text-destructive",
                }[analysis.quality]
                const qualityBorder = {
                  excellent: "border-success/40",
                  good: "border-success/40",
                  weak: "border-warning/40",
                  poor: "border-destructive/40",
                }[analysis.quality]
                return (
                  <div
                    key={dev.id}
                    className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-2.5 py-1.5"
                  >
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: dev.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium text-foreground truncate">{dev.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={cn("font-mono text-[11px] font-semibold", qualityColor)}>
                          {analysis.current} dBm
                        </span>
                        <Badge variant="outline" className={cn("text-[8px] px-1 py-0", qualityBorder, qualityColor)}>
                          {analysis.quality === "excellent" ? "Excellent" : analysis.quality === "good" ? "Bon" : analysis.quality === "weak" ? "Faible" : "Mauvais"}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                        <span className="font-mono">min {analysis.min} / max {analysis.max}</span>
                      </div>
                      <div className="flex items-center gap-0.5 text-[9px] text-muted-foreground mt-0.5">
                        {analysis.trend > 1 ? (
                          <><TrendingUp className="h-2.5 w-2.5 text-success" /><span className="text-success">+{analysis.trend} dB</span></>
                        ) : analysis.trend < -1 ? (
                          <><TrendingDown className="h-2.5 w-2.5 text-warning" /><span className="text-warning">{analysis.trend} dB</span></>
                        ) : (
                          <span className="text-muted-foreground">Stable</span>
                        )}
                      </div>
                      {analysis.currentSnr != null && (
                        <div className="text-[9px] text-muted-foreground mt-0.5">
                          SNR: <span className="font-mono">{analysis.currentSnr} dB</span>
                        </div>
                      )}
                      {analysis.disconnections > 0 && (
                        <div className="flex items-center gap-0.5 text-[9px] text-warning mt-0.5" title="Nombre de gaps detectes">
                          <WifiOff className="h-2.5 w-2.5" />
                          <span className="font-mono">{analysis.disconnections}</span>
                        </div>
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
