"use client"

import useSWR from "swr"
import { useCallback, useMemo } from "react"

// ── Default visual settings ──────────────────────────────────────

export const VISUAL_DEFAULTS = {
  zone_fill_color:       "#3b82f6",
  zone_fill_opacity:     "0.08",
  zone_stroke_opacity:   "0.7",
  detection_dot_live:    "#22c55e",
  detection_dot_hold:    "#f59e0b",
  detection_line_color:  "#22c55e",
  fov_overlay_color:     "#22d3ee",
  fov_fill_opacity:      "0.08",
  fov_default_visible:   "false",
  sensor_dot_idle:       "#6366f1",
  estimated_pos_color:   "#3b82f6",
} as const

export type VisualConfigKey = keyof typeof VISUAL_DEFAULTS

export interface VisualConfig {
  zone_fill_color: string
  zone_fill_opacity: number
  zone_stroke_opacity: number
  detection_dot_live: string
  detection_dot_hold: string
  detection_line_color: string
  fov_overlay_color: string
  fov_fill_opacity: number
  fov_default_visible: boolean
  sensor_dot_idle: string
  estimated_pos_color: string
}

// ── Fetcher ──────────────────────────────────────────────────────

function getBackendBase(): string | null {
  if (typeof window === "undefined") return null
  return `http://${window.location.hostname}:8000`
}

const fetcher = async (url: string) => {
  const base = getBackendBase()
  if (base && url.startsWith("/api/")) {
    try {
      const r = await fetch(`${base}${url}`, { headers: { "Content-Type": "application/json" } })
      if (r.ok) return r.json()
    } catch { /* fall through */ }
  }
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Settings fetch error: ${r.status}`)
  return r.json()
}

// ── Hook ─────────────────────────────────────────────────────────

export function useVisualConfig() {
  const { data: raw, mutate } = useSWR<Record<string, string>>(
    "/api/config/settings",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000, fallbackData: {} },
  )

  const config: VisualConfig = useMemo(() => {
    const r = raw ?? {}
    return {
      zone_fill_color:     r.zone_fill_color     ?? VISUAL_DEFAULTS.zone_fill_color,
      zone_fill_opacity:   parseFloat(r.zone_fill_opacity ?? VISUAL_DEFAULTS.zone_fill_opacity),
      zone_stroke_opacity: parseFloat(r.zone_stroke_opacity ?? VISUAL_DEFAULTS.zone_stroke_opacity),
      detection_dot_live:  r.detection_dot_live   ?? VISUAL_DEFAULTS.detection_dot_live,
      detection_dot_hold:  r.detection_dot_hold   ?? VISUAL_DEFAULTS.detection_dot_hold,
      detection_line_color: r.detection_line_color ?? VISUAL_DEFAULTS.detection_line_color,
      fov_overlay_color:   r.fov_overlay_color    ?? VISUAL_DEFAULTS.fov_overlay_color,
      fov_fill_opacity:    parseFloat(r.fov_fill_opacity ?? VISUAL_DEFAULTS.fov_fill_opacity),
      fov_default_visible: (r.fov_default_visible ?? VISUAL_DEFAULTS.fov_default_visible) === "true",
      sensor_dot_idle:     r.sensor_dot_idle      ?? VISUAL_DEFAULTS.sensor_dot_idle,
      estimated_pos_color: r.estimated_pos_color  ?? VISUAL_DEFAULTS.estimated_pos_color,
    }
  }, [raw])

  const updateConfig = useCallback(async (key: VisualConfigKey, value: string) => {
    // Optimistic update
    mutate((prev) => ({ ...prev, [key]: value }), false)
    // Persist
    const base = getBackendBase()
    const url = base ? `${base}/api/config/settings` : "/api/config/settings"
    try {
      await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      })
    } catch { /* ignore */ }
  }, [mutate])

  const resetAll = useCallback(async () => {
    mutate({}, false)
    const base = getBackendBase()
    const url = base ? `${base}/api/config/settings` : "/api/config/settings"
    try {
      await fetch(url, { method: "DELETE" })
    } catch { /* ignore */ }
    mutate()
  }, [mutate])

  return { config, raw: raw ?? {}, updateConfig, resetAll, mutate }
}
