"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

export default function MissionError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[THEIA] Mission page error:", error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 max-w-md w-full">
        <h2 className="text-lg font-semibold text-foreground">Erreur</h2>
        <p className="mt-2 text-sm text-muted-foreground break-words">
          {error.message || "Une erreur est survenue lors du chargement de la mission."}
        </p>
        {error.stack && (
          <pre className="mt-3 text-left text-[10px] text-muted-foreground/60 overflow-auto max-h-40 bg-muted/30 rounded p-2">
            {error.stack.split("\n").slice(0, 8).join("\n")}
          </pre>
        )}
        <Button onClick={reset} className="mt-4" size="sm">
          Reessayer
        </Button>
      </div>
    </div>
  )
}
