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

// ── Resolve raw string values to typed VisualConfig ──────────────

function resolve(r: Record<string, string>): VisualConfig {
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
}

// ── Hook ─────────────────────────────────────────────────────────
// When `missionOverrides` is provided, the priority is:
//   per-mission override > global settings > VISUAL_DEFAULTS

interface UseVisualConfigOptions {
  /** Per-mission visual_config object from mission.visual_config (pass-through from useMission) */
  missionOverrides?: Record<string, string> | null
  /** Mission ID -- needed to save per-mission overrides via PATCH */
  missionId?: string | null
  /** Callback when mission visual_config changes (to mutate useMission SWR) */
  onMissionMutate?: () => void
}

export function useVisualConfig(opts?: UseVisualConfigOptions) {
  const missionOverrides = opts?.missionOverrides ?? null
  const missionId = opts?.missionId ?? null
  const onMissionMutate = opts?.onMissionMutate

  // Global settings
  const { data: globalRaw, mutate: mutateGlobal } = useSWR<Record<string, string>>(
    "/api/config/settings",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000, fallbackData: {} },
  )

  // 3-layer merge: defaults < global < per-mission
  const merged: Record<string, string> = useMemo(() => {
    const base: Record<string, string> = { ...VISUAL_DEFAULTS }
    const g = globalRaw ?? {}
    for (const k of Object.keys(VISUAL_DEFAULTS)) {
      if (g[k] != null) base[k] = g[k]
    }
    if (missionOverrides) {
      for (const k of Object.keys(VISUAL_DEFAULTS)) {
        if (missionOverrides[k] != null) base[k] = missionOverrides[k]
      }
    }
    return base
  }, [globalRaw, missionOverrides])

  const config: VisualConfig = useMemo(() => resolve(merged), [merged])

  // Update: if missionId is provided, save to per-mission overrides; otherwise save to global
  const updateConfig = useCallback(async (key: VisualConfigKey, value: string) => {
    if (missionId) {
      // Save to mission's visual_config
      const newOverrides = { ...(missionOverrides ?? {}), [key]: value }
      const base = getBackendBase()
      const url = base
        ? `${base}/api/missions/${missionId}`
        : `/api/missions/${missionId}`
      try {
        await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visual_config: JSON.stringify(newOverrides) }),
        })
      } catch { /* ignore */ }
      onMissionMutate?.()
    } else {
      // Save to global settings
      mutateGlobal((prev) => ({ ...prev, [key]: value }), false)
      const base = getBackendBase()
      const url = base ? `${base}/api/config/settings` : "/api/config/settings"
      try {
        await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: value }),
        })
      } catch { /* ignore */ }
    }
  }, [missionId, missionOverrides, mutateGlobal, onMissionMutate])

  // Reset: if missionId, clear per-mission overrides; otherwise clear global
  const resetAll = useCallback(async () => {
    if (missionId) {
      const base = getBackendBase()
      const url = base
        ? `${base}/api/missions/${missionId}`
        : `/api/missions/${missionId}`
      try {
        await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visual_config: null }),
        })
      } catch { /* ignore */ }
      onMissionMutate?.()
    } else {
      mutateGlobal({}, false)
      const base = getBackendBase()
      const url = base ? `${base}/api/config/settings` : "/api/config/settings"
      try {
        await fetch(url, { method: "DELETE" })
      } catch { /* ignore */ }
      mutateGlobal()
    }
  }, [missionId, mutateGlobal, onMissionMutate])

  // Check if this mission has any per-mission overrides
  const hasMissionOverrides = useMemo(
    () => missionOverrides != null && Object.keys(missionOverrides).length > 0,
    [missionOverrides],
  )

  return { config, raw: merged, updateConfig, resetAll, mutate: mutateGlobal, hasMissionOverrides }
}
