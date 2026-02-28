"use client"

import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"

/** Force-clear all caches and reload the page */
async function hardReload() {
  try {
    // Unregister all service workers
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
    // Clear all caches (old chunks)
    if ("caches" in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch { /* best effort */ }
  // Navigate with cache-bust query param to force fresh load
  const url = new URL(window.location.href)
  url.searchParams.set("_t", String(Date.now()))
  window.location.replace(url.toString())
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const autoReloaded = useRef(false)

  const isChunkError =
    error.message?.includes("Failed to load") ||
    error.message?.includes("chunk") ||
    error.message?.includes("Loading chunk") ||
    error.message?.includes("dynamically imported module")

  useEffect(() => {
    console.error("[THEIA] App error:", error)

    // Auto-reload once for chunk errors (post-update)
    if (isChunkError && !autoReloaded.current) {
      // Check if we already auto-reloaded (prevent infinite loop)
      const lastReload = sessionStorage.getItem("theia_chunk_reload")
      const now = Date.now()
      if (lastReload && now - Number(lastReload) < 30000) {
        // Already reloaded within 30s, don't loop
        return
      }
      autoReloaded.current = true
      sessionStorage.setItem("theia_chunk_reload", String(now))
      hardReload()
    }
  }, [error, isChunkError])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex flex-col items-center gap-4 rounded-xl border border-border/50 bg-card p-8 text-center max-w-sm">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
          <svg className="h-5 w-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          {isChunkError ? "Mise a jour detectee" : "Erreur"}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {isChunkError
            ? "Une nouvelle version de THEIA est disponible. La page va se recharger automatiquement."
            : error.message || "Une erreur inattendue s'est produite."}
        </p>
        {isChunkError ? (
          <Button
            onClick={() => hardReload()}
            className="bg-primary text-primary-foreground"
          >
            Recharger maintenant
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button onClick={reset} variant="outline">
              Reessayer
            </Button>
            <Button
              onClick={() => { window.location.href = "/login" }}
              className="bg-primary text-primary-foreground"
            >
              Retour au login
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
