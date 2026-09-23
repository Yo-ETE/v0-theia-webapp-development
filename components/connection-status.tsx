"use client"

/**
 * Tells the operator when the interface has stopped hearing from the hub.
 *
 * Every page polls the backend through SWR with `keepPreviousData`, so when the hub goes
 * away the screen does not go blank: it keeps rendering the last values it received. During
 * a mission that is the dangerous failure -- "no detections" and "the hub is dead" looked
 * exactly the same, and nothing on screen distinguished a quiet room from a severed link.
 *
 * This reuses the `/api/status` SWR key the dashboard already polls, so it costs no extra
 * request: SWR dedupes by key. It renders nothing while the link is healthy -- an indicator
 * that is always on is an indicator nobody reads.
 */

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { useStatus } from "@/hooks/use-api"
import { Button } from "@/components/ui/button"

/** How the age of the last contact reads in the banner. */
function formatSince(ms: number): string {
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}min`
  return `${Math.floor(mins / 60)}h`
}

export function ConnectionStatus() {
  const { data, error, isValidating, mutate } = useStatus()
  const lastOkRef = useRef<number | null>(null)
  // Re-render on a timer so the "figées depuis" counter keeps moving while the link is down.
  const [, setTick] = useState(0)

  useEffect(() => {
    if (data && !error) lastOkRef.current = Date.now()
  }, [data, error])

  useEffect(() => {
    if (!error) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [error])

  if (!error) return null

  const lastOk = lastOkRef.current
  return (
    <div
      role="alert"
      className="sticky top-0 z-50 flex items-center gap-3 border-b border-destructive/40 bg-destructive/15 px-4 py-2 backdrop-blur"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">Hub injoignable</p>
        <p className="text-xs text-muted-foreground font-mono">
          {lastOk
            ? `Données figées depuis ${formatSince(Date.now() - lastOk)} — l'affichage n'est plus à jour`
            : "Aucune donnée reçue depuis le chargement de la page"}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="min-h-[36px] shrink-0 gap-1.5 text-xs"
        onClick={() => mutate()}
        disabled={isValidating}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isValidating ? "animate-spin" : ""}`} />
        Réessayer
      </Button>
    </div>
  )
}
