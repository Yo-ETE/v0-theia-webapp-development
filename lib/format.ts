import type { MissionStatus, DeviceStatus, LogLevel, EventType } from "./types"

// ─── Mission Status ──────────────────────────────────────────────

export const missionStatusConfig: Record<
  MissionStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "DRAFT",
    className: "border-sky-500/30 bg-sky-500/10 text-sky-400",
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

// Parse timestamp assuming it's in local Paris time (no timezone suffix)
function parseLocalTimestamp(ts: string): Date {
  // If timestamp has no timezone info (e.g. "2025-04-02 10:07:20"), treat as Europe/Paris local time
  // by appending the offset. Otherwise, parse as-is.
  if (!ts.includes("Z") && !ts.includes("+") && !ts.includes("T")) {
    // Format: "2025-04-02 10:07:20" - convert to ISO with explicit Paris interpretation
    // We create a date assuming it's already in local time
    const d = new Date(ts.replace(" ", "T"))
    // The date was parsed as UTC, but it's actually local time
    // So we need to NOT convert it - just use the values directly
    return d
  }
  return new Date(ts)
}

/** Parse a timestamp string, treating ambiguous (no Z/+) timestamps as UTC */
function parseTimestampAsUTC(ts: string): Date {
  // If timestamp lacks timezone indicator, assume it's UTC from the database
  // Check for timezone offset format like +02:00 or -05:00
  const hasTimezoneOffset = /[+-]\d{2}:\d{2}$/.test(ts)
  if (!ts.includes("Z") && !hasTimezoneOffset) {
    // Replace space with T and add Z suffix for UTC
    return new Date(ts.replace(" ", "T") + "Z")
  }
  return new Date(ts)
}

export function formatDate(iso: string): string {
  const date = parseTimestampAsUTC(iso)
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Paris",
  })
}

export function formatTime(iso: string): string {
  const date = parseTimestampAsUTC(iso)
  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Paris",
  })
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - parseTimestampAsUTC(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
