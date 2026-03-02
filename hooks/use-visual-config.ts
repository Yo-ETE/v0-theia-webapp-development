"use client"

import { useCallback, useMemo } from "react"

// ── Default visual settings ──────────────────────────────────────

export const VISUAL_DEFAULTS: Record<string, string> = {
  zone_fill_color: "#3b82f6",
  zone_fill_opacity: "0.08",
  zone_stroke_opacity: "0.7",
  detection_dot_live: "#22c55e",
  detection_dot_hold: "#f59e0b",
  detection_line_color: "#22c55e",
  fov_overlay_color: "#22d3ee",
  fov_fill_opacity: "0.08",
  fov_default_visible: "false",
  sensor_dot_idle: "#6366f1",
  estimated_pos_color: "#3b82f6",
}

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

function resolve(r: Record<string, string>): VisualConfig {
  return {
    zone_fill_color: r.zone_fill_color ?? VISUAL_DEFAULTS.zone_fill_color,
    zone_fill_opacity: parseFloat(r.zone_fill_opacity ?? VISUAL_DEFAULTS.zone_fill_opacity),
    zone_stroke_opacity: parseFloat(r.zone_stroke_opacity ?? VISUAL_DEFAULTS.zone_stroke_opacity),
    detection_dot_live: r.detection_dot_live ?? VISUAL_DEFAULTS.detection_dot_live,
    detection_dot_hold: r.detection_dot_hold ?? VISUAL_DEFAULTS.detection_dot_hold,
    detection_line_color: r.detection_line_color ?? VISUAL_DEFAULTS.detection_line_color,
    fov_overlay_color: r.fov_overlay_color ?? VISUAL_DEFAULTS.fov_overlay_color,
    fov_fill_opacity: parseFloat(r.fov_fill_opacity ?? VISUAL_DEFAULTS.fov_fill_opacity),
    fov_default_visible: (r.fov_default_visible ?? VISUAL_DEFAULTS.fov_default_visible) === "true",
    sensor_dot_idle: r.sensor_dot_idle ?? VISUAL_DEFAULTS.sensor_dot_idle,
    estimated_pos_color: r.estimated_pos_color ?? VISUAL_DEFAULTS.estimated_pos_color,
  }
}

function getBackendBase(): string | null {
  if (typeof window === "undefined") return null
  return `http://${window.location.hostname}:8000`
}

interface UseVisualConfigOptions {
  missionOverrides?: Record<string, string> | null
  missionId?: string | null
  onMissionMutate?: () => void
}

export function useVisualConfig(opts?: UseVisualConfigOptions) {
  const missionOverrides = opts?.missionOverrides ?? null
  const missionId = opts?.missionId ?? null
  const onMissionMutate = opts?.onMissionMutate

  const merged: Record<string, string> = useMemo(() => {
    const base: Record<string, string> = { ...VISUAL_DEFAULTS }

    if (missionOverrides) {
      for (const k of Object.keys(VISUAL_DEFAULTS)) {
        const v = missionOverrides[k]
        if (v != null) base[k] = v
      }
    }

    return base
  }, [missionOverrides])

  const config: VisualConfig = useMemo(() => resolve(merged), [merged])

  const updateConfig = useCallback(
    async (key: VisualConfigKey, value: string) => {
      if (!missionId) return

      const newOverrides = { ...(missionOverrides ?? {}), [key]: value }
      const base = getBackendBase()
      const url = base ? `${base}/api/missions/${missionId}` : `/api/missions/${missionId}`

      try {
        const _t = typeof window !== "undefined" ? localStorage.getItem("theia_token") : null

        const res = await fetch(url, {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(_t ? { Authorization: `Bearer ${_t}` } : {}),
          },
          body: JSON.stringify({ visual_config: newOverrides }),
        })

        // optionnel: si tu veux détecter un 401/500
        // if (!res.ok) console.warn("update visual_config failed", res.status)
      } catch {
        /* ignore */
      }

      onMissionMutate?.()
    },
    [missionId, missionOverrides, onMissionMutate],
  )

  const resetAll = useCallback(async () => {
    if (!missionId) return

    const base = getBackendBase()
    const url = base ? `${base}/api/missions/${missionId}` : `/api/missions/${missionId}`

    try {
      const _t = typeof window !== "undefined" ? localStorage.getItem("theia_token") : null

      await fetch(url, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(_t ? { Authorization: `Bearer ${_t}` } : {}),
        },
        body: JSON.stringify({ visual_config: null }),
      })
    } catch {
      /* ignore */
    }

    onMissionMutate?.()
  }, [missionId, onMissionMutate])

  const hasMissionOverrides = useMemo(
    () => missionOverrides != null && Object.keys(missionOverrides).length > 0,
    [missionOverrides],
  )

  return { config, raw: merged, updateConfig, resetAll, hasMissionOverrides }
}
