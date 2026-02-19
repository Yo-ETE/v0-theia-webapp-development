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
    console.log("[v0] createMission stored:", mission.id, "lat:", mission.center_lat, "lon:", mission.center_lon, "zoom:", mission.zoom)
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
    console.log("[v0] updateMission:", id, "zones:", this.missions[idx].zones?.length, "lat:", this.missions[idx].center_lat)
    return this.missions[idx]
  }

  // ── Devices ────────────────────────────────────────────────

  getDevices() {
    return this.devices
  }

  getDevice(id: string) {
    return this.devices.find((d) => d.id === id) ?? null
  }

  updateDevice(id: string, data: Partial<Device>): Device | null {
    const idx = this.devices.findIndex((d) => d.id === id)
    if (idx === -1) return null
    this.devices[idx] = { ...this.devices[idx], ...data }
    return this.devices[idx]
  }

  // ── Events ─────────────────────────────────────────────────

  getEvents(missionId?: string) {
    if (missionId) return this.events.filter((e) => e.mission_id === missionId)
    return this.events
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
