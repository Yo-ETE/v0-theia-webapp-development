import type { MissionStatus, DeviceStatus, LogLevel, EventType } from "./types"

// ─── Mission Status ──────────────────────────────────────────────

export const missionStatusConfig: Record<
  MissionStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "DRAFT",
    className: "border-muted-foreground/30 bg-muted text-muted-foreground",
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

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
