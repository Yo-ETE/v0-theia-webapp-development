"use client"

import { Radio, Battery, Signal } from "lucide-react"
import { TopHeader } from "@/components/top-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useDevices, useMissions } from "@/hooks/use-api"
import { deviceStatusConfig, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

export default function DevicesPage() {
  const { data: devices, isLoading } = useDevices()
  const { data: missions } = useMissions()

  function getMissionName(missionId: string | null) {
    if (!missionId || !missions) return "---"
    const m = missions.find((m) => m.id === missionId)
    return m?.name ?? "---"
  }

  const onlineCount = devices?.filter((d) => d.status === "online").length ?? 0
  const offlineCount = devices?.filter((d) => d.status === "offline").length ?? 0
  const totalCount = devices?.length ?? 0

  return (
    <>
      <TopHeader title="Devices" description="TX device management and enrollment" />
      <main className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          {/* Stats */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">{totalCount}</span>
              <span className="text-xs text-muted-foreground">Total</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-success" />
              <span className="text-sm font-medium text-success">{onlineCount}</span>
              <span className="text-xs text-muted-foreground">Online</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-destructive" />
              <span className="text-sm font-medium text-destructive">{offlineCount}</span>
              <span className="text-xs text-muted-foreground">Offline</span>
            </div>
          </div>

          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">All Devices</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-48 animate-pulse rounded bg-muted" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead className="text-[10px]">Name</TableHead>
                      <TableHead className="text-[10px]">HW ID</TableHead>
                      <TableHead className="text-[10px]">Status</TableHead>
                      <TableHead className="text-[10px]">Mission</TableHead>
                      <TableHead className="text-[10px]">Zone</TableHead>
                      <TableHead className="text-[10px]">RSSI</TableHead>
                      <TableHead className="text-[10px]">SNR</TableHead>
                      <TableHead className="text-[10px]">Battery</TableHead>
                      <TableHead className="text-[10px]">Firmware</TableHead>
                      <TableHead className="text-[10px]">Last Seen</TableHead>
                      <TableHead className="text-[10px]">Enabled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {devices?.map((device) => {
                      const sCfg = deviceStatusConfig[device.status] ?? deviceStatusConfig.unknown
                      return (
                        <TableRow key={device.id} className="border-border/30">
                          <TableCell className="font-mono text-xs font-medium text-foreground">
                            <div className="flex items-center gap-2">
                              <Signal className={cn("h-3 w-3", sCfg.className.includes("success") ? "text-success" : sCfg.className.includes("destructive") ? "text-destructive" : "text-muted-foreground")} />
                              {device.name}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {device.hw_id}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[9px] px-1 py-0", sCfg.className)}>
                              <span className={cn("mr-1 h-1.5 w-1.5 rounded-full inline-block", sCfg.dot)} />
                              {sCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-foreground">
                            {getMissionName(device.mission_id)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {device.zone_label ?? "---"}
                          </TableCell>
                          <TableCell>
                            {device.rssi !== null ? (
                              <span className={cn(
                                "font-mono text-[11px]",
                                device.rssi >= -70 ? "text-success" : device.rssi >= -85 ? "text-warning" : "text-destructive"
                              )}>
                                {device.rssi}
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">---</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-foreground">
                            {device.snr !== null ? device.snr : "---"}
                          </TableCell>
                          <TableCell>
                            {device.battery !== null ? (
                              <div className="flex items-center gap-1">
                                <Battery className={cn(
                                  "h-3 w-3",
                                  device.battery > 50 ? "text-success" : device.battery > 20 ? "text-warning" : "text-destructive"
                                )} />
                                <span className="font-mono text-[11px]">{device.battery}%</span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">---</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {device.firmware}
                          </TableCell>
                          <TableCell className="text-[11px] text-muted-foreground">
                            {device.last_seen ? formatRelative(device.last_seen) : "Never"}
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={device.enabled}
                              aria-label={`Toggle ${device.name}`}
                              className="scale-75"
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  )
}
