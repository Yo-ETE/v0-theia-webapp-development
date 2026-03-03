"use client"

import { useState, useCallback, useMemo } from "react"
import Link from "next/link"
import { Plus, Crosshair, Radio, BarChart3, Trash2 } from "lucide-react"
import { TopHeader } from "@/components/top-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useMissions } from "@/hooks/use-api"
import { deleteMission } from "@/lib/api-client"
import { missionStatusConfig, formatDate, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Mission } from "@/lib/types"

const STATUS_ORDER = ["active", "paused", "draft", "completed", "archived"] as const
const SECTION_LABELS: Record<string, string> = {
  active: "En cours", paused: "En pause", draft: "En preparation",
  completed: "Terminees", archived: "Archivees",
}

function MissionGroups({ missions, setDeleteTarget }: { missions: Mission[]; setDeleteTarget: (t: { id: string; name: string }) => void }) {
  const grouped = useMemo(() =>
    STATUS_ORDER.map(status => ({
      status,
      label: SECTION_LABELS[status],
      cfg: missionStatusConfig[status],
      items: missions.filter(m => m.status === status),
    })).filter(g => g.items.length > 0),
    [missions]
  )

  return (
    <div className="flex flex-col gap-6">
      {grouped.map(group => (
        <div key={group.status}>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", group.cfg.className)}>
              {group.cfg.label}
            </Badge>
            <span className="text-[10px] text-muted-foreground font-medium">
              {group.label} ({group.items.length})
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {group.items.map((mission) => {
              const statusCfg = missionStatusConfig[mission.status] ?? missionStatusConfig.draft
              return (
                <Card key={mission.id} className="border-border/50 bg-card transition-colors hover:border-primary/30 hover:bg-card/80 group relative">
                  <Link href={`/missions/${mission.id}`} className="block">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2 text-sm">
                            <Crosshair className="h-3.5 w-3.5 text-primary" />
                            {mission.name}
                          </CardTitle>
                          <CardDescription className="mt-1 text-xs">
                            {mission.description}
                          </CardDescription>
                        </div>
                        <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", statusCfg.className)}>
                          {statusCfg.label}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pb-4">
                      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Radio className="h-3 w-3" />
                          {mission.device_count} TX
                        </span>
                        <span className="flex items-center gap-1">
                          <BarChart3 className="h-3 w-3" />
                          {mission.event_count} events
                        </span>
                        <span className="ml-auto">
                          {mission.location}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Created {formatDate(mission.created_at)}</span>
                        <div className="flex items-center gap-2">
                          <span>Updated {formatRelative(mission.updated_at)}</span>
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setDeleteTarget({ id: mission.id, name: mission.name })
                            }}
                            className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity rounded p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                            title="Delete mission"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Link>
                </Card>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function MissionsPage() {
  const { data: missions, isLoading, mutate } = useMissions()
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await deleteMission(deleteTarget.id)
      mutate((prev) => prev?.filter((m) => m.id !== deleteTarget.id), false)
    } catch (err) {
      console.warn("[THEIA] Failed to delete mission:", err)
    }
    setDeleteTarget(null)
  }, [deleteTarget, mutate])

  return (
    <>
      <TopHeader title="Missions" description="Manage surveillance operations" />
      <main className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {missions?.length ?? 0} missions
            </h2>
            <Button asChild size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/missions/new">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New Mission
              </Link>
            </Button>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="border-border/50 bg-card animate-pulse">
                  <CardContent className="p-6">
                    <div className="h-20 rounded bg-muted" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <MissionGroups missions={missions ?? []} setDeleteTarget={setDeleteTarget} />
          )}
        </div>

        {/* Delete confirmation */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent className="bg-card border-border">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-sm">Delete mission</AlertDialogTitle>
              <AlertDialogDescription className="text-xs">
                Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This will unassign all devices and remove the mission permanently.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="text-xs h-8">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs h-8">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </>
  )
}
