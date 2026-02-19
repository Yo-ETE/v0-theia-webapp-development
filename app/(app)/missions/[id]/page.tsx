"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Radio, MapPin, Clock, Users, BarChart3 } from "lucide-react"
import { TopHeader } from "@/components/top-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MissionMap } from "@/components/mission/mission-map"
import { ErrorBoundary } from "@/components/error-boundary"
import { useMission, useEvents } from "@/hooks/use-api"
import { missionStatusConfig, eventTypeConfig, formatRelative, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"

export default function MissionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: mission, isLoading } = useMission(id)
  const { data: events } = useEvents({ mission_id: id })

  if (isLoading || !mission) {
    return (
      <>
        <TopHeader title="Mission" description="Loading..." />
        <main className="flex-1 p-4">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 rounded bg-muted" />
            <div className="h-[400px] rounded bg-muted" />
          </div>
        </main>
      </>
    )
  }

  const statusCfg = missionStatusConfig[mission.status] ?? missionStatusConfig.draft
  const zones = mission.zones ?? []
  const eventList = events ?? []

  return (
    <>
      <TopHeader title={mission.name} description={mission.description} />
      <main className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          {/* Breadcrumb + actions */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground">
              <Link href="/missions">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Missions
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild className="text-xs">
                <Link href={`/missions/${id}/sensors`}>
                  <Radio className="mr-1.5 h-3 w-3" />
                  Sensors
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="text-xs">
                <Link href={`/missions/${id}/history`}>
                  <BarChart3 className="mr-1.5 h-3 w-3" />
                  History
                </Link>
              </Button>
            </div>
          </div>

          {/* Mission info bar */}
          <Card className="border-border/50 bg-card py-3">
            <CardContent className="flex flex-wrap items-center gap-4 px-4">
              <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusCfg.className)}>
                {statusCfg.label}
              </Badge>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {mission.location}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                {mission.device_count} devices
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <BarChart3 className="h-3 w-3" />
                {mission.event_count} events
              </span>
              {mission.started_at && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                  <Clock className="h-3 w-3" />
                  Started {formatRelative(mission.started_at)}
                </span>
              )}
            </CardContent>
          </Card>

          {/* Map + Live events */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ErrorBoundary>
                <MissionMap
                  centerLat={mission.center_lat ?? 48.8566}
                  centerLon={mission.center_lon ?? 2.3522}
                  zoom={mission.zoom ?? 15}
                  zones={zones}
                  events={eventList}
                  className="h-[450px]"
                />
              </ErrorBoundary>
            </div>

            <div className="flex flex-col gap-3">
              {/* Zones panel */}
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs">Zones ({zones.length})</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {zones.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">
                      No zones configured
                    </p>
                  ) : (
                    zones.map((zone) => (
                      <div
                        key={zone.id}
                        className="flex items-center gap-2 rounded border border-border/50 p-2"
                      >
                        <div
                          className="h-3 w-3 rounded-sm shrink-0"
                          style={{ backgroundColor: zone.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">
                            {zone.label}
                          </p>
                          <p className="text-[10px] text-muted-foreground">{zone.type}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {zone.devices.length} TX
                        </span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Recent events */}
              <Card className="border-border/50 bg-card flex-1">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs">
                    Recent Events
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
                  {eventList.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">
                      No events yet
                    </p>
                  ) : (
                    eventList.slice(0, 8).map((evt) => {
                      const evtCfg = eventTypeConfig[evt.type] ?? eventTypeConfig.system
                      return (
                        <div
                          key={evt.id}
                          className="flex items-center gap-2 rounded border border-border/30 p-2"
                        >
                          <Badge
                            variant="outline"
                            className={cn("text-[8px] px-1 py-0 shrink-0", evtCfg.className)}
                          >
                            {evtCfg.label}
                          </Badge>
                          <span className="text-[11px] text-foreground truncate flex-1">
                            {evt.device_name}
                            {evt.zone_label && (
                              <span className="text-muted-foreground"> / {evt.zone_label}</span>
                            )}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                            {formatTime(evt.timestamp)}
                          </span>
                        </div>
                      )
                    })
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
