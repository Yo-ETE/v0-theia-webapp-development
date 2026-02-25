"use client"

import {
  Cpu,
  MemoryStick,
  HardDrive,
  Thermometer,
  Clock,
  Satellite,
  Radio,
  Wifi,
  WifiOff,
  Globe,
  Cable,
  Activity,
  Smartphone,
  AlertTriangle,
  Battery,
  Signal,
  X,
} from "lucide-react"
import { TopHeader } from "@/components/top-header"
import { StatusCard } from "@/components/dashboard/status-card"
import { useStatus, useNotifications, type Notification } from "@/hooks/use-api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${d}j ${h}h ${m}m`
}

function statusFor(value: number, warn: number, crit: number) {
  if (value >= crit) return "critical" as const
  if (value >= warn) return "warning" as const
  return "success" as const
}

function alertIcon(type: string) {
  switch (type) {
    case "battery_low": return <Battery className="h-4 w-4" />
    case "rssi_weak": return <Signal className="h-4 w-4" />
    case "device_offline": return <WifiOff className="h-4 w-4" />
    default: return <AlertTriangle className="h-4 w-4" />
  }
}

function getBackendBase(): string | null {
  if (typeof window === "undefined") return null
  return `http://${window.location.hostname}:8000`
}

export default function DashboardPage() {
  const { data: status, isLoading } = useStatus()
  const { data: allNotifs, mutate: mutateNotifs } = useNotifications()

  // Filter only warning/critical non-dismissed
  const alerts = (allNotifs ?? []).filter(
    (n: Notification) => (n.severity === "warning" || n.severity === "critical") && n.dismissed === 0
  )

  const handleDismiss = async (id: number) => {
    const base = getBackendBase()
    if (base) {
      await fetch(`${base}/api/notifications/${id}`, { method: "DELETE" })
      mutateNotifs()
    }
  }

  const handleDismissAll = async () => {
    const base = getBackendBase()
    if (base) {
      await fetch(`${base}/api/notifications/dismiss-all`, { method: "POST" })
      mutateNotifs()
    }
  }

  if (isLoading || !status) {
    return (
      <>
        <TopHeader title="Dashboard" description="Vue d'ensemble du systeme" />
        <main className="flex-1 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
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

  const hub = {
    cpu_percent: 0, ram_percent: 0, ram_used_mb: 0, ram_total_mb: 0,
    disk_percent: 0, disk_used_gb: 0, disk_total_gb: 0,
    temperature: 0 as number | null, uptime_seconds: 0,
    ...status.hub,
  }
  const gps = {
    fix: false, latitude: null as number | null, longitude: null as number | null,
    altitude: null as number | null, satellites: 0, hdop: null as number | null,
    ...status.gps,
  }
  const lora = {
    connected: false, port: "---", baud_rate: 0, rssi: null as number | null,
    snr: null as number | null, packets_received: 0, packets_errors: 0,
    ...status.lora,
  }
  const network = {
    hostname: "---", lan_ip: "---", tailscale_ip: null as string | null,
    interfaces: {} as Record<string, string>,
    internet: { connected: false, ping_ms: 0 },
    wifi: { connected: false, ssid: "", signal: 0, tx_rate: "", rx_rate: "" },
    ethernet: { connected: false, ip: "" },
    usb_modem: { connected: false, ip: "", interface: "", type: "USB Modem" },
    ...status.network,
  }

  return (
    <>
      <TopHeader title="Dashboard" description="Vue d'ensemble du systeme" />
      <main className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          {/* ── Active Alerts ── */}
          {alerts.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  Alertes actives ({alerts.length})
                </h2>
                <button
                  onClick={handleDismissAll}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  Tout effacer
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {alerts.map((n: Notification) => (
                  <Card
                    key={n.id}
                    className={cn(
                      "border-l-2",
                      n.severity === "critical"
                        ? "border-l-destructive bg-destructive/5"
                        : "border-l-amber-500 bg-amber-500/5"
                    )}
                  >
                    <CardContent className="flex items-center gap-3 px-3 py-2.5">
                      <div className={cn(
                        "shrink-0",
                        n.severity === "critical" ? "text-destructive" : "text-amber-500"
                      )}>
                        {alertIcon(n.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {n.message}
                        </p>
                        {n.device_name && (
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {n.device_name}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDismiss(n.id)}
                        className="shrink-0 text-muted-foreground/40 hover:text-destructive transition-colors cursor-pointer p-1"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* ── Raspberry Pi ── */}
          <section>
            <h2 className="mb-3 text-[11px] uppercase tracking-widest text-muted-foreground">
              Raspberry Pi
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatusCard
                title="CPU"
                value={`${hub.cpu_percent}%`}
                icon={Cpu}
                status={statusFor(hub.cpu_percent, 70, 90)}
              />
              <StatusCard
                title="RAM"
                value={`${hub.ram_percent}%`}
                subtitle={hub.ram_used_mb > 0 ? `${hub.ram_used_mb} / ${hub.ram_total_mb} MB` : undefined}
                icon={MemoryStick}
                status={statusFor(hub.ram_percent, 70, 90)}
              />
              <StatusCard
                title="Disque"
                value={`${hub.disk_percent}%`}
                subtitle={hub.disk_used_gb > 0 ? `${hub.disk_used_gb} / ${hub.disk_total_gb} GB` : undefined}
                icon={HardDrive}
                status={statusFor(hub.disk_percent, 80, 95)}
              />
              <StatusCard
                title="Temperature"
                value={hub.temperature != null ? `${hub.temperature}C` : "---"}
                icon={Thermometer}
                status={hub.temperature != null ? statusFor(hub.temperature, 65, 80) : "info"}
              />
              <StatusCard
                title="Uptime"
                value={formatUptime(hub.uptime_seconds)}
                icon={Clock}
                status="info"
              />
            </div>
          </section>

          {/* ── Connexion Internet ── */}
          <section>
            <h2 className="mb-3 text-[11px] uppercase tracking-widest text-muted-foreground">
              Connexion Internet
            </h2>
            <Card className="border-border/50 bg-card">
              <CardContent className="px-4 py-4">
                {/* If network data is not yet populated (backend slow), show skeleton */}
                {!status.network ? (
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                      <div className="h-3 w-16 rounded bg-muted animate-pulse" />
                    </div>
                  </div>
                ) : (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-8">
                  {/* Status global */}
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                      network.internet.connected ? "bg-success/10" : "bg-destructive/10"
                    )}>
                      <Globe className={cn("h-5 w-5", network.internet.connected ? "text-success" : "text-destructive")} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {network.internet.connected ? "Connecte" : "Hors ligne"}
                      </p>
                      {network.internet.connected && network.internet.ping_ms > 0 && (
                        <p className="text-xs text-muted-foreground font-mono">
                          Ping: {network.internet.ping_ms} ms
                        </p>
                      )}
                    </div>
                  </div>

                  {/* WiFi */}
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      network.wifi.connected ? "bg-primary/10" : "bg-muted"
                    )}>
                      {network.wifi.connected ? (
                        <Wifi className="h-4 w-4 text-primary" />
                      ) : (
                        <WifiOff className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">WiFi</p>
                      {network.wifi.connected ? (
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs text-muted-foreground">{network.wifi.ssid}</span>
                          {network.wifi.signal !== 0 && (
                            <span className={cn(
                              "font-mono text-[11px]",
                              network.wifi.signal >= -50 ? "text-success" :
                              network.wifi.signal >= -70 ? "text-warning" : "text-destructive"
                            )}>
                              {network.wifi.signal} dBm
                            </span>
                          )}
                          {network.wifi.tx_rate && (
                            <span className="text-[11px] text-muted-foreground">{network.wifi.tx_rate}</span>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Non connecte</p>
                      )}
                    </div>
                  </div>

                  {/* Ethernet */}
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      network.ethernet.connected ? "bg-primary/10" : "bg-muted"
                    )}>
                      <Cable className={cn("h-4 w-4", network.ethernet.connected ? "text-primary" : "text-muted-foreground")} />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">Ethernet</p>
                      {network.ethernet.connected ? (
                        <span className="font-mono text-xs text-muted-foreground">{network.ethernet.ip}</span>
                      ) : (
                        <p className="text-xs text-muted-foreground">Non connecte</p>
                      )}
                    </div>
                  </div>

                  {/* USB Modem */}
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      network.usb_modem.connected ? "bg-primary/10" : "bg-muted"
                    )}>
                      <Smartphone className={cn("h-4 w-4", network.usb_modem.connected ? "text-primary" : "text-muted-foreground")} />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">USB Modem</p>
                      {network.usb_modem.connected ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{network.usb_modem.ip}</span>
                          <span className="text-[10px] text-muted-foreground">({network.usb_modem.interface})</span>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Non connecte</p>
                      )}
                    </div>
                  </div>

                  {/* Tailscale */}
                  {network.tailscale_ip && (
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info/10">
                        <Activity className="h-4 w-4 text-info" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-foreground">Tailscale</p>
                        <span className="font-mono text-xs text-muted-foreground">{network.tailscale_ip}</span>
                      </div>
                    </div>
                  )}

                  {/* IPs */}
                  <div className="sm:ml-auto flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">Hostname</span>
                      <span className="font-mono text-xs text-foreground">{network.hostname}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">LAN IP</span>
                      <span className="font-mono text-xs text-foreground">{network.lan_ip}</span>
                    </div>
                  </div>
                </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* ── GPS & LoRa ── */}
          <section>
            <h2 className="mb-3 text-[11px] uppercase tracking-widest text-muted-foreground">
              Capteurs
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
                      <span className="text-[10px] text-muted-foreground">RSSI</span>
                      <p className={cn(
                        "font-mono text-lg font-semibold",
                        lora.rssi !== null
                          ? (lora.rssi >= -70 ? "text-success" : lora.rssi >= -85 ? "text-warning" : "text-destructive")
                          : "text-muted-foreground"
                      )}>
                        {lora.rssi !== null ? `${lora.rssi} dBm` : "---"}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground">SNR</span>
                      <p className="font-mono text-lg font-semibold text-foreground">
                        {lora.snr !== null ? `${lora.snr} dB` : "---"}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground">Port</span>
                      <p className="font-mono text-sm text-foreground truncate" title={lora.port}>
                        {lora.port === "/dev/theia-rx"
                          ? "/dev/theia-rx"
                          : lora.port?.includes("/by-id/")
                            ? lora.port.split("/by-id/")[1]?.replace(/-port\d+$/, "").replace(/^usb-/, "") || lora.port
                            : lora.port}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground">Baud Rate</span>
                      <p className="font-mono text-sm text-foreground">{lora.baud_rate.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t border-border/50 pt-2">
                    <div>
                      <span className="text-[10px] text-muted-foreground">Packets RX: </span>
                      <span className="font-mono text-xs text-success">{lora.packets_received.toLocaleString()}</span>
                      <span className="text-[10px] text-muted-foreground"> / Errors: </span>
                      <span className="font-mono text-xs text-destructive">{lora.packets_errors}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      </main>
    </>
  )
}
