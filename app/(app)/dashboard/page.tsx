"use client"

import {
  Cpu,
  MemoryStick,
  HardDrive,
  Thermometer,
  Clock,
  Satellite,
  Radio,
} from "lucide-react"
import { TopHeader } from "@/components/top-header"
import { StatusCard } from "@/components/dashboard/status-card"
import { AlertList } from "@/components/dashboard/alert-list"
import { NetworkCard } from "@/components/dashboard/network-card"
import { useStatus } from "@/hooks/use-api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${d}d ${h}h ${m}m`
}

function statusFor(value: number, warn: number, crit: number) {
  if (value >= crit) return "critical" as const
  if (value >= warn) return "warning" as const
  return "success" as const
}

export default function DashboardPage() {
  const { data: status, isLoading } = useStatus()

  if (isLoading || !status) {
    return (
      <>
        <TopHeader title="Dashboard" description="Hub system overview" />
        <main className="flex-1 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="border-border/50 bg-card py-4 animate-pulse">
                <CardContent className="px-4">
                  <div className="h-14 rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        </main>
      </>
    )
  }

  const { hub, gps, lora, network, alerts } = status

  return (
    <>
      <TopHeader title="Dashboard" description="Hub system overview" />
      <main className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          {/* Hub metrics */}
          <section>
            <h2 className="mb-3 text-[11px] uppercase tracking-widest text-muted-foreground">
              Hub System
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <StatusCard
                title="CPU"
                value={`${hub.cpu_percent}%`}
                icon={Cpu}
                status={statusFor(hub.cpu_percent, 70, 90)}
              />
              <StatusCard
                title="RAM"
                value={`${hub.ram_percent}%`}
                icon={MemoryStick}
                status={statusFor(hub.ram_percent, 70, 90)}
              />
              <StatusCard
                title="Disk"
                value={`${hub.disk_percent}%`}
                icon={HardDrive}
                status={statusFor(hub.disk_percent, 80, 95)}
              />
              <StatusCard
                title="Temperature"
                value={`${hub.temperature}C`}
                icon={Thermometer}
                status={statusFor(hub.temperature, 65, 80)}
              />
              <StatusCard
                title="Uptime"
                value={formatUptime(hub.uptime_seconds)}
                icon={Clock}
                status="info"
              />
            </div>
          </section>

          {/* Sensors row */}
          <section>
            <h2 className="mb-3 text-[11px] uppercase tracking-widest text-muted-foreground">
              Sensors
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* GPS Card */}
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Satellite className={cn("h-4 w-4", gps.fix ? "text-success" : "text-destructive")} />
                    GPS
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] px-1.5 py-0 ml-auto",
                        gps.fix
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-destructive/30 bg-destructive/10 text-destructive",
                      )}
                    >
                      {gps.fix ? "FIX" : "NO FIX"}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    <div>
                      <span className="text-[10px] text-muted-foreground">Latitude</span>
                      <p className="font-mono text-sm text-foreground">
                        {gps.latitude?.toFixed(6) ?? "---"}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground">Longitude</span>
                      <p className="font-mono text-sm text-foreground">
                        {gps.longitude?.toFixed(6) ?? "---"}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground">Altitude</span>
                      <p className="font-mono text-sm text-foreground">
                        {gps.altitude ? `${gps.altitude}m` : "---"}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground">Satellites</span>
                      <p className="font-mono text-sm text-foreground">{gps.satellites}</p>
                    </div>
                  </div>
                  {gps.hdop !== null && (
                    <div className="mt-1 border-t border-border/50 pt-2">
                      <span className="text-[10px] text-muted-foreground">HDOP: </span>
                      <span className={cn(
                        "font-mono text-xs",
                        (gps.hdop ?? 0) <= 2 ? "text-success" : (gps.hdop ?? 0) <= 5 ? "text-warning" : "text-destructive"
                      )}>
                        {gps.hdop}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* LoRa RX Card */}
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Radio className={cn("h-4 w-4", lora.connected ? "text-success" : "text-destructive")} />
                    LoRa RX
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] px-1.5 py-0 ml-auto",
                        lora.connected
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-destructive/30 bg-destructive/10 text-destructive",
                      )}
                    >
                      {lora.connected ? "CONNECTED" : "DISCONNECTED"}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    <div>
                      <span className="text-[10px] text-muted-foreground">Port</span>
                      <p className="font-mono text-sm text-foreground">{lora.port}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground">Baud Rate</span>
                      <p className="font-mono text-sm text-foreground">{lora.baud_rate.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground">RSSI</span>
                      <p className={cn(
                        "font-mono text-sm",
                        lora.rssi !== null
                          ? (lora.rssi >= -70 ? "text-success" : lora.rssi >= -85 ? "text-warning" : "text-destructive")
                          : "text-muted-foreground"
                      )}>
                        {lora.rssi !== null ? `${lora.rssi} dBm` : "---"}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground">SNR</span>
                      <p className="font-mono text-sm text-foreground">
                        {lora.snr !== null ? `${lora.snr} dB` : "---"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t border-border/50 pt-2">
                    <div>
                      <span className="text-[10px] text-muted-foreground">Packets: </span>
                      <span className="font-mono text-xs text-success">{lora.packets_received.toLocaleString()}</span>
                      <span className="text-[10px] text-muted-foreground"> / Errors: </span>
                      <span className="font-mono text-xs text-destructive">{lora.packets_errors}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Network + Alerts */}
          <section>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <NetworkCard network={network} />
              <AlertList alerts={alerts} />
            </div>
          </section>
        </div>
      </main>
    </>
  )
}
