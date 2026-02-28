"use client"

import { useState, useEffect, useCallback, useRef } from "react"

const STORAGE_KEY = "theia_notif_sound"

/**
 * Generates a short radar-style "ping" tone using the Web Audio API.
 * No external audio files needed.
 */
function playRadarPing() {
  try {
    const ctx = new AudioContext()

    // Two-tone ping: short high + lower resonance
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = "sine"
    osc1.frequency.setValueAtTime(1200, ctx.currentTime)
    osc1.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.15)
    gain1.gain.setValueAtTime(0.3, ctx.currentTime)
    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(ctx.currentTime)
    osc1.stop(ctx.currentTime + 0.3)

    // Second tone (lower, delayed)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = "sine"
    osc2.frequency.setValueAtTime(900, ctx.currentTime + 0.1)
    osc2.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.35)
    gain2.gain.setValueAtTime(0, ctx.currentTime)
    gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.1)
    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(ctx.currentTime + 0.1)
    osc2.stop(ctx.currentTime + 0.5)

    // Cleanup
    setTimeout(() => ctx.close(), 600)
  } catch {
    // AudioContext not available (e.g. SSR, old browser)
  }
}

export function useNotificationSound() {
  const [enabled, setEnabled] = useState(false)
  const lastCountRef = useRef<number | null>(null)

  // Load preference from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "true") setEnabled(true)
  }, [])

  const toggle = useCallback(() => {
    setEnabled(prev => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      // Play a test ping when enabling
      if (next) playRadarPing()
      return next
    })
  }, [])

  /**
   * Call this with the current notification count.
   * Plays a sound when count increases (new notification arrived).
   */
  const checkAndPlay = useCallback((count: number) => {
    if (!enabled) {
      lastCountRef.current = count
      return
    }
    if (lastCountRef.current !== null && count > lastCountRef.current) {
      playRadarPing()
    }
    lastCountRef.current = count
  }, [enabled])

  return { soundEnabled: enabled, toggleSound: toggle, checkAndPlay }
}
