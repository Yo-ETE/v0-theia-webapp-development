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
    console.error("[THEIA] App error:", error)
  }, [error])

  const isChunkError = error.message?.includes("Failed to load") || error.message?.includes("chunk")

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex flex-col items-center gap-4 rounded-xl border border-destructive/50 bg-destructive/5 p-8 text-center max-w-sm">
        <h2 className="text-lg font-semibold text-foreground">Erreur</h2>
        <p className="text-sm text-muted-foreground">
          {isChunkError
            ? "Une nouvelle version est disponible. Rechargez la page."
            : error.message || "Une erreur inattendue s'est produite."}
        </p>
        {isChunkError ? (
          <Button
            onClick={() => window.location.reload()}
            className="bg-primary text-primary-foreground"
          >
            Recharger
          </Button>
        ) : (
          <Button onClick={reset} className="bg-primary text-primary-foreground">
            Reessayer
          </Button>
        )}
      </div>
    </div>
  )
}
