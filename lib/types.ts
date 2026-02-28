// ─── THEIA Core Types ─────────────────────────────────────────────

export interface HubStatus {
  cpu_percent: number
  ram_percent: number
  disk_percent: number
  temperature: number
  uptime_seconds: number
}

export interface NetworkInfo {
  hostname: string
  lan_ip: string
  tailscale_ip: string | null
  interfaces: Record<string, string>
}

export interface GpsData {
  fix: boolean
  latitude: number | null
  longitude: number | null
  altitude: number | null
  satellites: number
  hdop: number | null
  timestamp: string | null
}

export interface LoraStatus {
  connected: boolean
  port: string
  baud_rate: number
  last_message_at: string | null
  rssi: number | null
  snr: number | null
  packets_received: number
  packets_errors: number
}

export interface SystemStatus {
  hub: HubStatus
  network: NetworkInfo
  gps: GpsData
  lora: LoraStatus
  alerts: Alert[]
  mode: "preview" | "pi"
  version: string
}

export interface Alert {
  id: string
  severity: "info" | "warning" | "critical"
  message: string
  source: string
  timestamp: string
  acknowledged: boolean
}

// ─── Missions ────────────────────────────────────────────────────

export type MissionStatus = "draft" | "active" | "paused" | "completed" | "archived"
export type EnvironmentType = "horizontal" | "vertical" | "habitation" | "garage" | "etages" | "plan"

export interface Mission {
  id: string
  name: string
  description: string
  status: MissionStatus
  location: string
  environment: EnvironmentType
  created_at: string
  updated_at: string
  started_at: string | null
  ended_at: string | null
  center_lat: number
  center_lon: number
  zoom: number
  zones: Zone[]
  floors?: Floor[]
  plan_image?: string | null  // URL/path to uploaded floor plan image (for "plan" environment)
  plan_width?: number | null  // image natural width in px
  plan_height?: number | null // image natural height in px
  plan_scale?: number | null  // calibrated scale: image pixels per metre
  detection_reset_at?: string | null  // ISO timestamp: ignore events/detections before this
  device_placements?: Record<string, { zone_id: string; side: string; sensor_position: number; orientation: string; device_name: string }> // Persisted TX positions for timelapse replay
  device_count: number
  event_count: number
}

export interface Zone {
  id: string
  mission_id: string
  name: string
  label: string
  type: "facade" | "perimeter" | "interior" | "roof" | "floor" | "section" | "custom"
  polygon: [number, number][]
  color: string
  floor?: number
  devices: string[]
  sides?: Record<string, string>
}

export interface Floor {
  level: number
  label: string
  devices: string[]
  device_history?: string[]
}

// ─── Devices (TX) ────────────────────────────────────────────────

export type DeviceStatus = "online" | "idle" | "offline" | "unknown"

export interface Device {
  id: string
  hw_id: string
  dev_eui?: string
  name: string
  type: "tx_microwave" | "microwave_tx" | string
  serial_port?: string
  status: DeviceStatus
  mission_id: string | null
  zone_id: string | null
  zone_label: string | null
  side?: string | null
  sensor_position?: number | null  // 0..1 along the assigned side
  orientation?: "inward" | "outward"  // detection direction relative to polygon
  muted?: boolean  // device still broadcasts SSE but skips DB event storage
  floor?: number | null
  rssi: number | null
  snr: number | null
  battery: number | null
  last_seen: string | null
  enabled: boolean
  enrolled_at: string
  firmware: string
}

// ─── Events / Detections ─────────────────────────────────────────

export type EventType = "detection" | "heartbeat" | "alert" | "enrollment" | "system"

export interface DetectionEvent {
  id: string
  mission_id: string
  device_id: string
  device_name: string
  zone_id: string | null
  zone_label: string | null
  side: string | null
  sensor_position: number | null
  orientation: "inward" | "outward" | null
  floor: number | null
  type: EventType
  payload: Record<string, unknown>
  rssi: number | null
  snr: number | null
  timestamp: string
}

// ─── Logs ────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warning" | "error" | "critical"
export type LogSource = "system" | "api" | "lora" | "gps" | "mission"

export interface LogEntry {
  id: string
  level: LogLevel
  source: LogSource
  message: string
  details: string | null
  timestamp: string
}

// ─── API ─────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T
  success: boolean
  error?: string
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number
  page: number
  per_page: number
}
