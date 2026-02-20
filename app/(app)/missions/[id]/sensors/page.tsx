"use client"

import { useCallback } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Radio, Signal, Battery, Wifi, Unlink } from "lucide-react"
import { TopHeader } from "@/components/top-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { useMission, useDevices } from "@/hooks/use-api"
import { updateDevice, updateMission } from "@/lib/api-client"
import { deviceStatusConfig, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

export default function SensorsPage() {
  const { id } = useParams<{ id: string }>()
  const { data: mission, mutate: mutateMission } = useMission(id)
  const { data: allDevices, isLoading, mutate: mutateDevices } = useDevices()

  const missionDevices = allDevices?.filter((d) => d.mission_id === id) ?? []
  const unassigned = allDevices?.filter((d) => !d.mission_id) ?? []

  const assignToMission = useCallback(async (deviceId: string) => {
    if (!mission) return
    await updateDevice(deviceId, { mission_id: id })
    const updated = await updateMission(id, { device_count: (mission.device_count ?? 0) + 1 })
    mutateMission(updated, false)
    mutateDevices()
  }, [mission, id, mutateMission, mutateDevices])

  const unassignFromMission = useCallback(async (deviceId: string) => {
    if (!mission) return
    try {
      await updateDevice(deviceId, { mission_id: "", zone_id: "", zone_label: "", side: "", sensor_position: 0.5 } as Partial<import("@/lib/types").Device>)
    } catch (err) {
      console.warn("[THEIA] Failed to update device, continuing with mission update:", err)
    }
    // Remove device from zone devices arrays
    const zones = (mission.zones ?? []).map((z) => ({
      ...z,
      devices: z.devices.filter((did) => did !== deviceId),
    }))
    try {
      const updated = await updateMission(id, {
        zones,
        device_count: Math.max(0, (mission.device_count ?? 1) - 1),
      })
      mutateMission(updated, false)
    } catch (err) {
      console.warn("[THEIA] Failed to update mission:", err)
    }
    mutateDevices()
  }, [mission, id, mutateMission, mutateDevices])

  return (
    <>
      <TopHeader
        title={mission ? `${mission.name} - Sensors` : "Sensors"}
        description="Assign and configure TX devices for this mission"
      />
      <main className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          <Button variant="ghost" size="sm" asChild className="self-start text-muted-foreground hover:text-foreground">
            <Link href={`/missions/${id}`}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back to mission
            </Link>
          </Button>

          {/* Assigned Devices */}
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Radio className="h-4 w-4 text-primary" />
                Assigned Devices ({missionDevices.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-32 animate-pulse rounded bg-muted" />
              ) : missionDevices.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No devices assigned to this mission yet
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead className="text-[10px]">Name</TableHead>
                      <TableHead className="text-[10px]">TX ID</TableHead>
                      <TableHead className="text-[10px]">Status</TableHead>
                      <TableHead className="text-[10px]">Zone / Side</TableHead>
                      <TableHead className="text-[10px]">RSSI</TableHead>
                      <TableHead className="text-[10px]">Battery</TableHead>
                      <TableHead className="text-[10px]">Last Seen</TableHead>
                      <TableHead className="text-[10px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {missionDevices.map((device) => {
                      const sCfg = deviceStatusConfig[device.status] ?? deviceStatusConfig.unknown
                      return (
                        <TableRow key={device.id} className="border-border/30">
                          <TableCell className="font-mono text-xs font-medium text-foreground">
                            {device.name}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {device.dev_eui || device.hw_id || "---"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[9px] px-1 py-0", sCfg.className)}>
                              <span className={cn("mr-1 h-1.5 w-1.5 rounded-full inline-block", sCfg.dot)} />
                              {sCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {device.zone_label ? (
                              <span>
                                {device.zone_label}
                                {device.side && <span className="ml-1 text-primary font-mono">[{device.side}]</span>}
                              </span>
                            ) : "---"}
                          </TableCell>
                          <TableCell>
                            {device.rssi !== null ? (
                              <span className={cn(
                                "font-mono text-xs",
                                device.rssi >= -70 ? "text-success" : device.rssi >= -85 ? "text-warning" : "text-destructive"
                              )}>
                                {device.rssi} dBm
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">---</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {device.battery !== null ? (
                              <div className="flex items-center gap-1">
                                <Battery className={cn(
                                  "h-3 w-3",
                                  device.battery > 50 ? "text-success" : device.battery > 20 ? "text-warning" : "text-destructive"
                                )} />
                                <span className="font-mono text-xs text-foreground">{device.battery}%</span>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">---</span>
                            )}
                          </TableCell>
                          <TableCell className="text-[11px] text-muted-foreground">
                            {device.last_seen ? formatRelative(device.last_seen) : "Never"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost" size="sm"
                              className="h-6 text-[10px] px-2 text-destructive hover:text-destructive/80"
                              onClick={() => unassignFromMission(device.id)}
                            >
                              <Unlink className="mr-1 h-3 w-3" />
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Unassigned Devices */}
          {unassigned.length > 0 && (
            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Wifi className="h-4 w-4 text-muted-foreground" />
                  Available Devices ({unassigned.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead className="text-[10px]">Name</TableHead>
                      <TableHead className="text-[10px]">TX ID</TableHead>
                      <TableHead className="text-[10px]">Type</TableHead>
                      <TableHead className="text-[10px]">Status</TableHead>
                      <TableHead className="text-[10px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unassigned.map((device) => {
                      const sCfg = deviceStatusConfig[device.status] ?? deviceStatusConfig.unknown
                      return (
                        <TableRow key={device.id} className="border-border/30">
                          <TableCell className="font-mono text-xs font-medium text-foreground">
                            {device.name}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {device.dev_eui || device.hw_id || "---"}
                          </TableCell>
                          <TableCell className="text-[11px] text-muted-foreground">
                            {device.type || "TX"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[9px] px-1 py-0", sCfg.className)}>
                              {sCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline" size="sm"
                              className="h-6 text-[10px] px-2"
                              onClick={() => assignToMission(device.id)}
                            >
                              <Signal className="mr-1 h-3 w-3" />
                              Assign
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </>
  )
}
