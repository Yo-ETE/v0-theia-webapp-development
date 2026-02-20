// In-memory store for preview mode
// Persists data across API route calls within the same server process
// On Pi mode, all data goes through FastAPI + SQLite instead

import { mockMissions, mockDevices, mockEvents, mockLogs } from "./mock-data"
import type { Mission, Device, DetectionEvent, LogEntry } from "./types"

class PreviewStore {
  missions: Mission[]
  devices: Device[]
  events: DetectionEvent[]
  logs: LogEntry[]

  constructor() {
    this.missions = [...mockMissions]
    this.devices = [...mockDevices]
    this.events = [...mockEvents]
    this.logs = [...mockLogs]
  }

  // ── Missions ───────────────────────────────────────────────

  getMissions() {
    return this.missions
  }

  getMission(id: string) {
    return this.missions.find((m) => m.id === id) ?? null
  }

  createMission(data: Partial<Mission>): Mission {
    const mission: Mission = {
      id: `mission-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: "New Mission",
      description: "",
      status: "draft",
      location: "",
      environment: "horizontal",
      center_lat: 48.8566,
      center_lon: 2.3522,
      zoom: 19,
      zones: [],
      device_count: 0,
      event_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
      ...data,
    }
    this.missions.push(mission)
    return mission
  }

  updateMission(id: string, data: Partial<Mission>): Mission | null {
    const idx = this.missions.findIndex((m) => m.id === id)
    if (idx === -1) return null
    this.missions[idx] = {
      ...this.missions[idx],
      ...data,
      updated_at: new Date().toISOString(),
    }
    return this.missions[idx]
  }

  // ── Devices ────────────────────────────────────────────────

  getDevices() {
    return this.devices
  }

  getDevice(id: string) {
    return this.devices.find((d) => d.id === id) ?? null
  }

  createDevice(data: Partial<Device> & { name: string }): Device {
    const device: Device = {
      id: data.id ?? `dev-${Date.now().toString(36)}`,
      hw_id: data.hw_id ?? data.dev_eui ?? "",
      name: data.name,
      type: data.type ?? "microwave_tx",
      status: "unknown" as const,
      mission_id: data.mission_id ?? null,
      zone_id: data.zone_id ?? null,
      zone_label: data.zone_label ?? null,
      rssi: data.rssi ?? null,
      snr: data.snr ?? null,
      battery: data.battery ?? null,
      last_seen: data.last_seen ?? null,
      enabled: data.enabled ?? true,
      enrolled_at: new Date().toISOString(),
      firmware: data.firmware ?? "",
      dev_eui: data.dev_eui ?? "",
      serial_port: data.serial_port ?? "",
      side: data.side ?? null,
      floor: data.floor ?? null,
    }
    this.devices.push(device)
    return device
  }

  updateDevice(id: string, data: Partial<Device>): Device | null {
    const idx = this.devices.findIndex((d) => d.id === id)
    if (idx === -1) return null
    this.devices[idx] = { ...this.devices[idx], ...data }
    return this.devices[idx]
  }

  // ── Events ─────────────────────────────────────────────────

  getEvents(missionId?: string) {
    let result = missionId
      ? this.events.filter((e) => e.mission_id === missionId)
      : this.events

    // In preview mode, generate simulated detection events for assigned devices
    if (missionId) {
      const mission = this.getMission(missionId)
      if (mission && mission.status === "active" && mission.zones?.length) {
        const assignedDevices = this.devices.filter((d) => d.mission_id === missionId && d.zone_id)
        const simulated: DetectionEvent[] = assignedDevices.flatMap((dev) => {
          const zone = mission.zones.find((z) => z.id === dev.zone_id)
          if (!zone) return []
          const now = Date.now()
          return Array.from({ length: 5 }, (_, i) => {
            const ts = new Date(now - i * 8000).toISOString()
            const presence = Math.random() > 0.3
            const distance = presence ? Math.round(50 + Math.random() * 400) : 0
            const dirs = ["G", "C", "D"]
            const direction = dirs[Math.floor(Math.random() * dirs.length)]
            return {
              id: `sim-${dev.id}-${i}`,
              mission_id: missionId,
              device_id: dev.id,
              device_name: dev.name,
              zone_id: zone.id,
              zone_label: zone.label,
              type: "detection" as const,
              payload: {
                presence,
                distance,
                speed: presence ? Math.round(Math.random() * 120) : 0,
                angle: Math.round(Math.random() * 180 - 90),
                direction,
                sensor_type: "ld2450",
                side: dev.side ?? "",
                vbatt_tx: 3.2 + Math.random() * 0.5,
                tx_id: dev.dev_eui ?? dev.hw_id,
              },
              rssi: -50 - Math.round(Math.random() * 30),
              snr: 6 + Math.round(Math.random() * 8),
              timestamp: ts,
            }
          })
        })
        if (simulated.length > 0) {
          result = [...simulated, ...result].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          )
        }
      }
    }

    return result
  }

  // ── Logs ───────────────────────────────────────────────────

  getLogs(params?: { source?: string; level?: string; search?: string }) {
    let logs = [...this.logs]
    if (params?.source) logs = logs.filter((l) => l.source === params.source)
    if (params?.level) logs = logs.filter((l) => l.level === params.level)
    if (params?.search) {
      const q = params.search.toLowerCase()
      logs = logs.filter(
        (l) => l.message.toLowerCase().includes(q) || (l.details && l.details.toLowerCase().includes(q))
      )
    }
    return logs
  }
}

// Singleton via globalThis -- survives across route handler calls
// even in Next.js standalone mode with hot reload
const globalForStore = globalThis as unknown as { __theiaStore?: PreviewStore }
export const store = globalForStore.__theiaStore ?? (globalForStore.__theiaStore = new PreviewStore())
