// ─── THEIA Core Types ─────────────────────────────────────────────

// ─── User Permissions ─────────────────────────────────────────────
export interface UserPermissions {
  // Pages access
  dashboard: boolean
  missions: boolean
  devices: boolean
  logs: boolean
  administration: boolean
  
  // Mission actions
  missions_create: boolean      // Creer un draft
  missions_edit: boolean        // Modifier une mission (zones, parametres)
  missions_delete: boolean      // Supprimer une mission
  missions_control: boolean     // Start/Pause/Resume/Stop
  
  // Device actions
  devices_assign: boolean       // Assigner un capteur a une mission
  devices_unassign: boolean     // Retirer un capteur
  devices_flash: boolean        // Flasher le firmware
  devices_enroll: boolean       // Enroller manuellement
  devices_delete: boolean       // Supprimer un device
  
  // System actions
  system_backup: boolean        // Creer/restaurer sauvegardes
  system_update: boolean        // Mettre a jour via Git
  system_reboot: boolean        // Redemarrer/Arreter le Pi
}

// Presets de permissions
export const PERMISSION_PRESETS: Record<string, { label: string; description: string; permissions: UserPermissions }> = {
  admin: {
    label: "Administrateur",
    description: "Acces complet a toutes les fonctionnalites",
    permissions: {
      dashboard: true, missions: true, devices: true, logs: true, administration: true,
      missions_create: true, missions_edit: true, missions_delete: true, missions_control: true,
      devices_assign: true, devices_unassign: true, devices_flash: true, devices_enroll: true, devices_delete: true,
      system_backup: true, system_update: true, system_reboot: true,
    }
  },
  operator: {
    label: "Operateur",
    description: "Gestion des missions et capteurs, sans acces admin",
    permissions: {
      dashboard: true, missions: true, devices: true, logs: true, administration: false,
      missions_create: true, missions_edit: true, missions_delete: false, missions_control: true,
      devices_assign: true, devices_unassign: true, devices_flash: false, devices_enroll: true, devices_delete: false,
      system_backup: false, system_update: false, system_reboot: false,
    }
  },
  viewer: {
    label: "Visualisateur",
    description: "Lecture seule : dashboard et missions",
    permissions: {
      dashboard: true, missions: true, devices: false, logs: false, administration: false,
      missions_create: false, missions_edit: false, missions_delete: false, missions_control: false,
      devices_assign: false, devices_unassign: false, devices_flash: false, devices_enroll: false, devices_delete: false,
      system_backup: false, system_update: false, system_reboot: false,
    }
  },
}

// Default permissions for new users
export const DEFAULT_PERMISSIONS: UserPermissions = PERMISSION_PRESETS.viewer.permissions

export interface HubStatus {
  cpu_percent: number
  ram_percent: number
  ram_used_mb?: number
  ram_total_mb?: number
  disk_percent: number
  disk_used_gb?: number
  disk_total_gb?: number
  temperature: number | null
  uptime_seconds: number
}

export interface NetworkInfo {
  hostname: string
  lan_ip: string
  tailscale_ip: string | null
  interfaces: Record<string, string>
  internet?: { connected: boolean; ping_ms: number }
  wifi?: { connected: boolean; ssid: string; signal: number; tx_rate?: string; rx_rate?: string }
  ethernet?: { connected: boolean; ip: string }
  usb_modem?: { connected: boolean; ip: string; interface: string; type: string }
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
  notification_config?: { enabled: boolean; cooldown_minutes: number; channels: string[]; zones: string[] } | null
  visual_config?: Record<string, unknown> | null
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
  // Multi-floor plan support (for habitation type)
  plan_image?: string | null      // URL/path to floor plan image
  plan_width?: number | null      // image natural width in px
  plan_height?: number | null     // image natural height in px
  plan_scale?: number | null      // calibrated scale: pixels per metre
  zones?: Zone[]                  // zones specific to this floor
}

// ─── Devices (TX) ────────────────────────────────────────────────

export type DeviceStatus = "online" | "idle" | "offline" | "unknown"

export interface Device {
  id: string
  hw_id: string
  dev_eui?: string
  name: string
  type: "tx_microwave" | "microwave_tx" | string
  device_type?: string
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
  firmware_version?: string
  needs_update?: boolean
  sensor_status?: string | {
    presence?: boolean
    direction?: string
    distance?: number
    rssi?: number
    battery?: number
  }
}

// ─── Live Detection (SSE) ────────────────────────────────────────

export interface LiveDetection {
  device_id: string
  device_name: string
  tx_id?: string | null
  mission_id?: string
  zone_id: string | null
  zone_label: string
  side: string
  presence: boolean
  distance: number
  speed?: number
  angle?: number
  direction: string
  vbatt_tx?: number | null
  rssi: number | null
  sensor_type?: string
  timestamp: string
  sensor_position?: number
  floor?: number | null
  [key: string]: unknown
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
  zone_name?: string | null
  side?: string | null
  sensor_position?: number | null
  orientation?: "inward" | "outward" | null
  floor?: number | null
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
