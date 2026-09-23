"use client"

/**
 * Switches the interface into the red low-luminance palette defined in globals.css.
 *
 * The choice is per-device on purpose, not per-account: whether the screen is about to be
 * the brightest thing in a dark stairwell depends on where the tablet is, not on who is
 * logged into it. It is read back by the inline script in app/layout.tsx before first
 * paint, so switching to night mode does not flash a bright screen on reload -- which
 * would defeat the whole point.
 */

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

const STORAGE_KEY = "theia_theme"

export function NightModeToggle() {
  const [night, setNight] = useState(false)

  // The DOM is the source of truth at mount: the inline head script has already applied
  // the stored preference by the time React hydrates.
  useEffect(() => {
    setNight(document.documentElement.dataset.theme === "night")
  }, [])

  const toggle = () => {
    const next = !night
    setNight(next)
    const root = document.documentElement
    if (next) root.dataset.theme = "night"
    else delete root.dataset.theme
    try {
      localStorage.setItem(STORAGE_KEY, next ? "night" : "dark")
    } catch {
      // Private mode or blocked storage: the toggle still works for this session.
    }
  }

  return (
    <button
      onClick={toggle}
      aria-pressed={night}
      aria-label={night ? "Repasser en mode normal" : "Passer en mode nuit"}
      title={night ? "Mode nuit actif - repasser en normal" : "Mode nuit (faible luminosite)"}
      className="flex items-center justify-center min-h-[32px] min-w-[32px] rounded text-muted-foreground/50 transition-colors hover:text-foreground"
    >
      {night ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
    </button>
  )
}
