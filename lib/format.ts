import type { MissionStatus, DeviceStatus, LogLevel, EventType } from "./types"

// ─── Mission Status ──────────────────────────────────────────────

export const missionStatusConfig: Record<
  MissionStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "DRAFT",
    className: "border-info/30 bg-info/10 text-info",
  },
  active: {
    label: "ACTIVE",
    className: "border-success/30 bg-success/10 text-success",
  },
  paused: {
    label: "PAUSED",
    className: "border-warning/30 bg-warning/10 text-warning",
  },
  completed: {
    label: "COMPLETED",
    className: "border-info/30 bg-info/10 text-info",
  },
  archived: {
    label: "ARCHIVED",
    className: "border-border bg-muted text-muted-foreground",
  },
}

// ─── Device Status ───────────────────────────────────────────────

export const deviceStatusConfig: Record<
  DeviceStatus,
  { label: string; className: string; dot: string }
> = {
  online: {
    label: "ONLINE",
    className: "border-success/30 bg-success/10 text-success",
    dot: "bg-success",
  },
  idle: {
    label: "IDLE",
    className: "border-warning/30 bg-warning/10 text-warning",
    dot: "bg-warning",
  },
  offline: {
    label: "OFFLINE",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
  unknown: {
    label: "UNKNOWN",
    className: "border-muted-foreground/30 bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
}

// ─── Log Levels ──────────────────────────────────────────────────

export const logLevelConfig: Record<
  LogLevel,
  { label: string; className: string }
> = {
  debug: { label: "DEBUG", className: "text-muted-foreground" },
  info: { label: "INFO", className: "text-info" },
  warning: { label: "WARN", className: "text-warning" },
  error: { label: "ERROR", className: "text-destructive" },
  critical: { label: "CRIT", className: "text-destructive font-bold" },
}

// ─── Event Types ─────────────────────────────────────────────────

export const eventTypeConfig: Record<
  EventType,
  { label: string; className: string }
> = {
  detection: {
    label: "DETECTION",
    className: "border-warning/30 bg-warning/10 text-warning",
  },
  heartbeat: {
    label: "HEARTBEAT",
    className: "border-success/30 bg-success/10 text-success",
  },
  alert: {
    label: "ALERT",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  enrollment: {
    label: "ENROLLED",
    className: "border-info/30 bg-info/10 text-info",
  },
  system: {
    label: "SYSTEM",
    className: "border-muted-foreground/30 bg-muted text-muted-foreground",
  },
}

// ─── Formatters ──────────────────────────────────────────────────

/**
 * Parse a timestamp as the database actually writes it: the hub's wall clock.
 *
 * This used to add a "Z" and parse as UTC, on the stated belief that the backend stored UTC.
 * It does not -- every table declares `datetime('now','localtime')` -- so every absolute time
 * in the interface was shown one or two hours in the future depending on the season. Measured
 * on the hub: a log row written at 19:19:53 displayed as 21:19:53, and the replay tab
 * returned 125 events for a window that contains 26.
 *
 * It went unnoticed because the shift is uniform: everything was equally wrong, so nothing
 * looked out of place next to anything else. There used to be a parallel set of `...Local`
 * helpers here, added by someone who hit this on the SSE path and worked around it rather
 * than correcting the assumption; with the assumption fixed they were the same functions
 * twice, so they are gone.
 *
 * Any timezone marker is stripped rather than honoured: the backend sometimes appends a "Z"
 * to a value that is not UTC, and the wall-clock reading is the one that matches the hub.
 */
export function parseDbTime(ts: string): Date {
  if (!ts) return new Date(NaN)
  const cleaned = ts.replace("Z", "").replace(/[+-]\d{2}:\d{2}$/, "").replace(" ", "T")
  return new Date(cleaned)
}

/** @deprecated Misnamed: the value is local, not UTC. Use parseDbTime. */
export const parseAsUTC = parseDbTime

export function formatDate(iso: string): string {
  const date = parseDbTime(iso)
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export function formatTime(iso: string): string {
  const date = parseDbTime(iso)
  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - parseDbTime(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `il y a ${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `il y a ${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `il y a ${hours}h`
  return `il y a ${Math.floor(hours / 24)}j`
}

/**
 * Past this, a sensor's last reported values stop describing the present.
 *
 * A node reports every few seconds while it is alive, so an hour of silence already means
 * something is wrong; a day means the reading is history. The threshold only governs how the
 * numbers are PRESENTED -- nothing is hidden, it stops being asserted as current.
 */
export const STALE_MEASURE_MS = 60 * 60 * 1000

/** True when a device's last contact is old enough that its measurements are not news. */
export function measuresAreStale(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return true
  const t = parseAsUTC(lastSeen).getTime()
  if (!Number.isFinite(t)) return true
  return Date.now() - t > STALE_MEASURE_MS
}

/** Age of a database timestamp, in French, for UI copy: "maintenant", "12min", "3h", "2j". */
export function formatAgeFr(iso: string): string {
  const diff = Date.now() - parseDbTime(iso).getTime()
  if (!Number.isFinite(diff)) return ""
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "maintenant"
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}j`
}

