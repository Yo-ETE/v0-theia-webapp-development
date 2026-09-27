"use client"

import { RotateCw } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { VISUAL_DEFAULTS, type VisualConfigKey } from "@/hooks/use-visual-config"

const VC_COLOR_ROWS: { key: VisualConfigKey; label: string }[] = [
  { key: "zone_fill_color",      label: "Zone (remplissage)" },
  { key: "detection_dot_live",   label: "Detection (live)" },
  { key: "detection_dot_hold",   label: "Detection (maintien)" },
  { key: "detection_line_color", label: "Ligne detection" },
  { key: "fov_overlay_color",    label: "FOV capteur" },
  { key: "sensor_dot_idle",      label: "Capteur (inactif)" },
  { key: "estimated_pos_color",  label: "Position estimee" },
]

const VC_OPACITY_ROWS: { key: VisualConfigKey; label: string }[] = [
  { key: "zone_fill_opacity",    label: "Opacite zone" },
  { key: "zone_stroke_opacity",  label: "Contour zone" },
  { key: "fov_fill_opacity",     label: "Opacite FOV" },
]

export function VisualConfigPopover({
  raw,
  updateConfig,
  resetAll,
  hasMissionOverrides,
}: {
  raw: Record<string, string>
  updateConfig: (key: VisualConfigKey, value: string) => void
  resetAll: () => void
  hasMissionOverrides: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">Apparence</p>
        <button
          onClick={resetAll}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          title={hasMissionOverrides ? "Revenir aux parametres globaux" : "Reinitialiser les valeurs par defaut"}
        >
          <RotateCw className="h-3 w-3" />
          {hasMissionOverrides ? "Global" : "Defaut"}
        </button>
      </div>

      {/* Colors */}
      <div className="grid grid-cols-1 gap-1.5">
        {VC_COLOR_ROWS.map(({ key, label }) => {
          const val = (raw[key] ?? VISUAL_DEFAULTS[key]) as string
          const isCustom = val !== VISUAL_DEFAULTS[key]
          return (
            <div key={key} className="flex items-center gap-2">
              <label className="relative cursor-pointer shrink-0">
                <span
                  className="block h-5 w-5 rounded border border-border/50"
                  style={{ backgroundColor: val }}
                />
                <input
                  type="color"
                  value={val}
                  onChange={(e) => updateConfig(key, e.target.value)}
                  onBlur={(e) => updateConfig(key, e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
              <span className="text-xs text-muted-foreground truncate flex-1">{label}</span>
              {isCustom && (
                <button
                  onClick={() => updateConfig(key, VISUAL_DEFAULTS[key])}
                  className="text-2xs text-muted-foreground/60 hover:text-foreground transition-colors shrink-0"
                  title="Reinitialiser"
                >
                  <RotateCw className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Opacities */}
      <div className="flex flex-col gap-1.5 pt-1 border-t border-border/30">
        {VC_OPACITY_ROWS.map(({ key, label }) => {
          const val = parseFloat(raw[key] ?? VISUAL_DEFAULTS[key])
          const isCustom = (raw[key] ?? VISUAL_DEFAULTS[key]) !== VISUAL_DEFAULTS[key]
          return (
            <div key={key} className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(val * 100)}
                onChange={(e) => updateConfig(key, String(parseInt(e.target.value) / 100))}
                className="w-20 accent-primary h-1"
              />
              <span className="text-xs text-muted-foreground truncate flex-1">{label}</span>
              <span className="text-xs font-mono text-muted-foreground w-8 text-right">{Math.round(val * 100)}%</span>
              {isCustom && (
                <button
                  onClick={() => updateConfig(key, VISUAL_DEFAULTS[key])}
                  className="text-2xs text-muted-foreground/60 hover:text-foreground transition-colors shrink-0"
                  title="Reinitialiser"
                >
                  <RotateCw className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* FOV toggle */}
      <div className="flex items-center justify-between pt-1 border-t border-border/30">
        <span className="text-xs text-muted-foreground">FOV visible par defaut</span>
        <Switch
          checked={(raw.fov_default_visible ?? VISUAL_DEFAULTS.fov_default_visible) === "true"}
          onCheckedChange={(v) => updateConfig("fov_default_visible", v ? "true" : "false")}
          className="scale-75"
        />
      </div>
    </div>
  )
}

