"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[THEIA] Runtime error:", error)
  }, [error])

  const isChunkError = error.message?.includes("Failed to load") || error.message?.includes("ChunkLoadError")

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-xl border border-destructive/50 bg-destructive/5 p-6 text-center">
        <h2 className="mb-2 text-lg font-semibold text-foreground">Erreur</h2>
        <p className="mb-1 text-sm text-muted-foreground">{error.message}</p>
        {isChunkError && (
          <p className="mb-4 text-xs text-muted-foreground">
            Le code a ete mis a jour. Rechargez la page.
          </p>
        )}
        <div className="flex items-center justify-center gap-3">
          <Button
            onClick={() => reset()}
            variant="outline"
            size="sm"
          >
            Reessayer
          </Button>
          <Button
            onClick={() => window.location.reload()}
            className="bg-primary text-primary-foreground"
            size="sm"
          >
            Recharger
          </Button>
        </div>
      </div>
    </div>
  )
}
