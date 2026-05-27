"use client"

import { useState, useCallback, useMemo } from "react"
import Link from "next/link"
import { Plus, Crosshair, Radio, BarChart3, MoreHorizontal, Pencil, Archive, ArchiveRestore, Trash2, ChevronDown, ChevronRight } from "lucide-react"
import { TopHeader } from "@/components/top-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useMissions } from "@/hooks/use-api"
import { deleteMission, updateMission } from "@/lib/api-client"
import { missionStatusConfig, formatDate, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Mission } from "@/lib/types"

const STATUS_ORDER = ["active", "paused", "draft", "completed"] as const
const SECTION_LABELS: Record<string, string> = {
  active: "En cours", paused: "En pause", draft: "En preparation",
  completed: "Terminees", archived: "Archivees",
}

type MissionAction = 
  | { type: "delete"; mission: { id: string; name: string } }
  | { type: "rename"; mission: { id: string; name: string } }
  | { type: "archive"; mission: { id: string; name: string } }
  | { type: "unarchive"; mission: { id: string; name: string } }

function MissionCard({ 
  mission, 
  onAction 
}: { 
  mission: Mission
  onAction: (action: MissionAction) => void 
}) {
  const statusCfg = missionStatusConfig[mission.status] ?? missionStatusConfig.draft
  const isArchived = mission.status === "archived"
  
  return (
    <Card className={cn(
      "border-border/50 bg-card transition-colors hover:border-primary/30 hover:bg-card/80 group relative",
      isArchived && "opacity-60"
    )}>
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
            <div className="flex items-center gap-1">
              <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", statusCfg.className)}>
                {statusCfg.label}
              </Badge>
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.preventDefault()}>
                  <button className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-muted text-muted-foreground">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={(e) => {
                    e.preventDefault()
                    onAction({ type: "rename", mission: { id: mission.id, name: mission.name } })
                  }}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Renommer
                  </DropdownMenuItem>
                  {isArchived ? (
                    <DropdownMenuItem onClick={(e) => {
                      e.preventDefault()
                      onAction({ type: "unarchive", mission: { id: mission.id, name: mission.name } })
                    }}>
                      <ArchiveRestore className="mr-2 h-3.5 w-3.5" />
                      Restaurer
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={(e) => {
                      e.preventDefault()
                      onAction({ type: "archive", mission: { id: mission.id, name: mission.name } })
                    }}>
                      <Archive className="mr-2 h-3.5 w-3.5" />
                      Archiver
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => {
                      e.preventDefault()
                      onAction({ type: "delete", mission: { id: mission.id, name: mission.name } })
                    }}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Supprimer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
            <span>Updated {formatRelative(mission.updated_at)}</span>
          </div>
        </CardContent>
      </Link>
    </Card>
  )
}

function MissionGroups({ missions, onAction }: { missions: Mission[]; onAction: (action: MissionAction) => void }) {
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
            {group.items.map((mission) => (
              <MissionCard key={mission.id} mission={mission} onAction={onAction} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ArchivedSection({ missions, onAction }: { missions: Mission[]; onAction: (action: MissionAction) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const archivedMissions = useMemo(() => missions.filter(m => m.status === "archived"), [missions])
  
  if (archivedMissions.length === 0) return null
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-8 border-t border-border/50 pt-6">
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Archive className="h-4 w-4" />
          <span className="text-[11px] uppercase tracking-widest">
            Archivees ({archivedMissions.length})
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {archivedMissions.map((mission) => (
            <MissionCard key={mission.id} mission={mission} onAction={onAction} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export default function MissionsPage() {
  const { data: missions, isLoading, mutate } = useMissions()
  const [action, setAction] = useState<MissionAction | null>(null)
  const [newName, setNewName] = useState("")

  const handleAction = useCallback((a: MissionAction) => {
    setAction(a)
    if (a.type === "rename") {
      setNewName(a.mission.name)
    }
  }, [])

  const handleDelete = useCallback(async () => {
    if (!action || action.type !== "delete") return
    try {
      await deleteMission(action.mission.id)
      mutate((prev) => prev?.filter((m) => m.id !== action.mission.id), false)
    } catch (err) {
      console.warn("[THEIA] Failed to delete mission:", err)
    }
    setAction(null)
  }, [action, mutate])

  const handleRename = useCallback(async () => {
    if (!action || action.type !== "rename" || !newName.trim()) return
    try {
      await updateMission(action.mission.id, { name: newName.trim() })
      mutate((prev) => prev?.map((m) => m.id === action.mission.id ? { ...m, name: newName.trim() } : m), false)
    } catch (err) {
      console.warn("[THEIA] Failed to rename mission:", err)
    }
    setAction(null)
    setNewName("")
  }, [action, newName, mutate])

  const handleArchive = useCallback(async () => {
    if (!action || (action.type !== "archive" && action.type !== "unarchive")) return
    const newStatus = action.type === "archive" ? "archived" : "draft"
    try {
      await updateMission(action.mission.id, { status: newStatus })
      mutate((prev) => prev?.map((m) => m.id === action.mission.id ? { ...m, status: newStatus } : m), false)
    } catch (err) {
      console.warn("[THEIA] Failed to archive/unarchive mission:", err)
    }
    setAction(null)
  }, [action, mutate])

  const activeMissions = useMemo(() => missions?.filter(m => m.status !== "archived") ?? [], [missions])

  return (
    <>
      <TopHeader title="Missions" description="Manage surveillance operations" />
      <main className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {activeMissions.length} missions
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
            <>
              <MissionGroups missions={activeMissions} onAction={handleAction} />
              <ArchivedSection missions={missions ?? []} onAction={handleAction} />
            </>
          )}
        </div>

        {/* Delete confirmation */}
        <AlertDialog open={action?.type === "delete"} onOpenChange={(open) => !open && setAction(null)}>
          <AlertDialogContent className="bg-card border-border">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-sm">Supprimer la mission</AlertDialogTitle>
              <AlertDialogDescription className="text-xs">
                Etes-vous sur de vouloir supprimer <strong>{action?.mission.name}</strong> ? Cette action est irreversible et supprimera toutes les donnees associees.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="text-xs h-8">Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs h-8">
                Supprimer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Rename dialog */}
        <Dialog open={action?.type === "rename"} onOpenChange={(open) => !open && setAction(null)}>
          <DialogContent className="bg-card border-border sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">Renommer la mission</DialogTitle>
              <DialogDescription className="text-xs">
                Entrez un nouveau nom pour cette mission.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nom de la mission"
              className="text-sm"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
            />
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setAction(null)}>
                Annuler
              </Button>
              <Button size="sm" onClick={handleRename} disabled={!newName.trim()}>
                Renommer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Archive confirmation */}
        <AlertDialog open={action?.type === "archive" || action?.type === "unarchive"} onOpenChange={(open) => !open && setAction(null)}>
          <AlertDialogContent className="bg-card border-border">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-sm">
                {action?.type === "archive" ? "Archiver la mission" : "Restaurer la mission"}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs">
                {action?.type === "archive" 
                  ? `La mission "${action?.mission.name}" sera deplacee dans les archives. Vous pourrez la restaurer plus tard.`
                  : `La mission "${action?.mission.name}" sera restauree et redeviendra visible dans la liste principale.`
                }
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="text-xs h-8">Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={handleArchive} className="text-xs h-8">
                {action?.type === "archive" ? "Archiver" : "Restaurer"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </>
  )
}
