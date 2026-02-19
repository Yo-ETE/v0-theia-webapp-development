"use client"

import Link from "next/link"
import { Plus, Crosshair, Radio, BarChart3 } from "lucide-react"
import { TopHeader } from "@/components/top-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useMissions } from "@/hooks/use-api"
import { missionStatusConfig, formatDate, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

export default function MissionsPage() {
  const { data: missions, isLoading } = useMissions()

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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {missions?.map((mission) => {
                const statusCfg = missionStatusConfig[mission.status] ?? missionStatusConfig.draft
                return (
                  <Link key={mission.id} href={`/missions/${mission.id}`}>
                    <Card className="border-border/50 bg-card transition-colors hover:border-primary/30 hover:bg-card/80 cursor-pointer">
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
                          <span>Updated {formatRelative(mission.updated_at)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
