"use client"

import { useState, useEffect, useCallback } from "react"
import {
  RefreshCw,
  Power,
  PowerOff,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  GitBranch,
  RotateCcw,
  Globe,
  Cpu,
  Thermometer,
  HardDrive,
  MemoryStick,
  Clock,
  Satellite,
  Radio,
  Download,
  Activity,
} from "lucide-react"
import { TopHeader } from "@/components/top-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useStatus } from "@/hooks/use-api"
import { cn } from "@/lib/utils"

// ── Types ──

interface VersionInfo {
  branch: string
  commit: string
  commitDate: string | null
  updateAvailable: boolean
  commitsBehind: number
}

// ── Helpers ──

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

function statusColor(s: "success" | "warning" | "critical" | "info") {
  if (s === "critical") return "text-destructive"
  if (s === "warning") return "text-warning"
  if (s === "success") return "text-success"
  return "text-muted-foreground"
}

// ── Page ──

export default function AdminPage() {
  const { data: status, isLoading: statusLoading } = useStatus()

  // Version / update state
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [isCheckingVersion, setIsCheckingVersion] = useState(false)
  const [updateOutput, setUpdateOutput] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)

  // Power state
  const [isRebooting, setIsRebooting] = useState(false)
  const [isShuttingDown, setIsShuttingDown] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const [systemMessage, setSystemMessage] = useState<{ type: "success" | "error" | "warning"; text: string } | null>(null)

  // Fetch version info
  const fetchVersionInfo = useCallback(async () => {
    setIsCheckingVersion(true)
    try {
      const res = await fetch("/api/admin/version")
      const data = await res.json()
      setVersionInfo(data)
    } catch {
      setVersionInfo(null)
    } finally {
      setIsCheckingVersion(false)
    }
  }, [])

  useEffect(() => {
    fetchVersionInfo()
  }, [fetchVersionInfo])

  // Update THEIA
  const handleUpdate = async () => {
    if (!confirm("Mettre a jour THEIA ? Les services seront redemarres.")) return
    setIsUpdating(true)
    setUpdateOutput(null)
    try {
      const res = await fetch("/api/admin/update", { method: "POST" })
      const data = await res.json()
      setUpdateOutput(data.output || data.message)
      if (data.status === "success") {
        setSystemMessage({ type: "success", text: "Mise a jour terminee. Redemarrage des services..." })
        // Auto-restart services
        setTimeout(async () => {
          try {
            await fetch("/api/admin/restart-services", { method: "POST" })
            setSystemMessage({ type: "success", text: "Services redemarres. La page va se recharger..." })
            setTimeout(() => window.location.reload(), 2000)
          } catch {
            setSystemMessage({ type: "warning", text: "Veuillez redemarrer les services manuellement." })
          }
        }, 1000)
      } else {
        setSystemMessage({ type: "error", text: data.message })
      }
    } catch {
      setSystemMessage({ type: "error", text: "Erreur lors de la mise a jour" })
    } finally {
      setIsUpdating(false)
    }
  }

  // Restart services
  const handleRestartServices = async () => {
    setIsRestarting(true)
    setSystemMessage(null)
    try {
      const res = await fetch("/api/admin/restart-services", { method: "POST" })
      const data = await res.json()
      if (data.status === "success") {
        setSystemMessage({ type: "success", text: "Services redemarres. Rechargement..." })
        setTimeout(() => window.location.reload(), 2000)
      } else {
        setSystemMessage({ type: "error", text: data.message })
      }
    } catch {
      setSystemMessage({ type: "error", text: "Erreur lors du redemarrage des services" })
    } finally {
      setIsRestarting(false)
    }
  }

  // Reboot
  const handleReboot = async () => {
    if (!confirm("Voulez-vous vraiment redemarrer le Raspberry Pi ?")) return
    setIsRebooting(true)
    setSystemMessage(null)
    try {
      await fetch("/api/admin/reboot", { method: "POST" })
      setSystemMessage({ type: "warning", text: "Redemarrage en cours... La connexion sera perdue." })
    } catch {
      setSystemMessage({ type: "error", text: "Erreur lors du redemarrage" })
      setIsRebooting(false)
    }
  }

  // Shutdown
  const handleShutdown = async () => {
    if (!confirm("Voulez-vous vraiment eteindre le Raspberry Pi ?")) return
    setIsShuttingDown(true)
    setSystemMessage(null)
    try {
      await fetch("/api/admin/shutdown", { method: "POST" })
      setSystemMessage({ type: "warning", text: "Arret en cours... La connexion sera perdue." })
    } catch {
      setSystemMessage({ type: "error", text: "Erreur lors de l'arret" })
      setIsShuttingDown(false)
    }
  }

  // Extract system data
  const hub = {
    cpu_percent: 0, ram_percent: 0, ram_used_mb: 0, ram_total_mb: 0,
    disk_percent: 0, disk_used_gb: 0, disk_total_gb: 0,
    temperature: null as number | null, uptime_seconds: 0,
    ...status?.hub,
  }
  const gps = {
    fix: false, latitude: 0, longitude: 0, altitude: 0, satellites: 0, hdop: 0,
    ...status?.gps,
  }
  const lora = {
    connected: false, port: "---", baud_rate: 0, packets_received: 0, packets_errors: 0,
    ...status?.lora,
  }
  const network = {
    hostname: "---", lan_ip: "---", tailscale_ip: null as string | null,
    interfaces: {} as Record<string, string>,
    ...status?.network,
  }

  return (
    <>
      <TopHeader title="Administration" description="Configuration systeme du Raspberry Pi" />
      <main className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-6">
          {/* ── System Status Overview ── */}
          <section>
            <h2 className="mb-3 text-[11px] uppercase tracking-widest text-muted-foreground">
              Etat du systeme
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {/* CPU */}
              <Card className="border-border/50 bg-card">
                <CardContent className="flex items-center gap-3 px-4 py-3">
                  <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", 
                    statusFor(hub.cpu_percent, 70, 90) === "critical" ? "bg-destructive/10" :
                    statusFor(hub.cpu_percent, 70, 90) === "warning" ? "bg-warning/10" : "bg-success/10"
                  )}>
                    <Cpu className={cn("h-4 w-4", statusColor(statusFor(hub.cpu_percent, 70, 90)))} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">CPU</p>
                    <p className={cn("font-mono text-lg font-semibold", statusColor(statusFor(hub.cpu_percent, 70, 90)))}>
                      {statusLoading ? "---" : `${hub.cpu_percent}%`}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* RAM */}
              <Card className="border-border/50 bg-card">
                <CardContent className="flex items-center gap-3 px-4 py-3">
                  <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg",
                    statusFor(hub.ram_percent, 70, 90) === "critical" ? "bg-destructive/10" :
                    statusFor(hub.ram_percent, 70, 90) === "warning" ? "bg-warning/10" : "bg-success/10"
                  )}>
                    <MemoryStick className={cn("h-4 w-4", statusColor(statusFor(hub.ram_percent, 70, 90)))} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">RAM</p>
                    <p className={cn("font-mono text-lg font-semibold", statusColor(statusFor(hub.ram_percent, 70, 90)))}>
                      {statusLoading ? "---" : `${hub.ram_percent}%`}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {hub.ram_used_mb > 0 ? `${hub.ram_used_mb} / ${hub.ram_total_mb} MB` : ""}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Disk */}
              <Card className="border-border/50 bg-card">
                <CardContent className="flex items-center gap-3 px-4 py-3">
                  <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg",
                    statusFor(hub.disk_percent, 80, 95) === "critical" ? "bg-destructive/10" :
                    statusFor(hub.disk_percent, 80, 95) === "warning" ? "bg-warning/10" : "bg-success/10"
                  )}>
                    <HardDrive className={cn("h-4 w-4", statusColor(statusFor(hub.disk_percent, 80, 95)))} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Disque</p>
                    <p className={cn("font-mono text-lg font-semibold", statusColor(statusFor(hub.disk_percent, 80, 95)))}>
                      {statusLoading ? "---" : `${hub.disk_percent}%`}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {hub.disk_used_gb > 0 ? `${hub.disk_used_gb} / ${hub.disk_total_gb} GB` : ""}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Temperature */}
              <Card className="border-border/50 bg-card">
                <CardContent className="flex items-center gap-3 px-4 py-3">
                  <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg",
                    hub.temperature != null
                      ? (statusFor(hub.temperature, 65, 80) === "critical" ? "bg-destructive/10" :
                         statusFor(hub.temperature, 65, 80) === "warning" ? "bg-warning/10" : "bg-success/10")
                      : "bg-muted"
                  )}>
                    <Thermometer className={cn("h-4 w-4",
                      hub.temperature != null ? statusColor(statusFor(hub.temperature, 65, 80)) : "text-muted-foreground"
                    )} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Temperature</p>
                    <p className={cn("font-mono text-lg font-semibold",
                      hub.temperature != null ? statusColor(statusFor(hub.temperature, 65, 80)) : "text-muted-foreground"
                    )}>
                      {statusLoading ? "---" : hub.temperature != null ? `${hub.temperature}C` : "---"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* ── Sensors + Network Row ── */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Uptime */}
            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Uptime
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-2xl font-semibold text-foreground">
                  {statusLoading ? "---" : formatUptime(hub.uptime_seconds)}
                </p>
              </CardContent>
            </Card>

            {/* GPS */}
            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Satellite className={cn("h-4 w-4", gps.fix ? "text-success" : "text-destructive")} />
                  GPS
                  <Badge variant="outline" className={cn(
                    "text-[9px] px-1.5 py-0 ml-auto",
                    gps.fix
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-destructive/30 bg-destructive/10 text-destructive",
                  )}>
                    {gps.fix ? "FIX" : "NO FIX"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div>
                    <span className="text-[10px] text-muted-foreground">Lat</span>
                    <p className="font-mono text-xs text-foreground">{gps.latitude?.toFixed(6) ?? "---"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground">Lon</span>
                    <p className="font-mono text-xs text-foreground">{gps.longitude?.toFixed(6) ?? "---"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground">Alt</span>
                    <p className="font-mono text-xs text-foreground">{gps.altitude ? `${gps.altitude}m` : "---"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground">Sats</span>
                    <p className="font-mono text-xs text-foreground">{gps.satellites}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* LoRa */}
            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Radio className={cn("h-4 w-4", lora.connected ? "text-success" : "text-destructive")} />
                  LoRa Bridge
                  <Badge variant="outline" className={cn(
                    "text-[9px] px-1.5 py-0 ml-auto",
                    lora.connected
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-destructive/30 bg-destructive/10 text-destructive",
                  )}>
                    {lora.connected ? "CONNECTED" : "OFFLINE"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div>
                    <span className="text-[10px] text-muted-foreground">Port</span>
                    <p className="font-mono text-xs text-foreground">{lora.port}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground">Baud</span>
                    <p className="font-mono text-xs text-foreground">{lora.baud_rate || "---"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground">Packets RX</span>
                    <p className="font-mono text-xs text-foreground">{lora.packets_received}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground">Errors</span>
                    <p className="font-mono text-xs text-foreground">{lora.packets_errors}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Network Info ── */}
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Globe className="h-4 w-4 text-primary" />
                Reseau
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                <div>
                  <span className="text-[10px] text-muted-foreground">Hostname</span>
                  <p className="font-mono text-xs text-foreground">{network.hostname}</p>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">IP LAN</span>
                  <p className="font-mono text-xs text-foreground">{network.lan_ip}</p>
                </div>
                {network.tailscale_ip && (
                  <div>
                    <span className="text-[10px] text-muted-foreground">IP Tailscale</span>
                    <p className="font-mono text-xs text-foreground">{network.tailscale_ip}</p>
                  </div>
                )}
                {Object.entries(network.interfaces).length > 0 && (
                  <div className="col-span-2 sm:col-span-4">
                    <span className="text-[10px] text-muted-foreground">Interfaces</span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {Object.entries(network.interfaces).map(([name, ip]) => (
                        <Badge key={name} variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-secondary/30 text-foreground border-border/50">
                          {name}: {ip}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── THEIA Update + Services ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Version & Update Card */}
            <Card className="border-border/50 bg-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                      <GitBranch className="h-5 w-5 text-success" />
                    </div>
                    <div>
                      <CardTitle className="text-base">Mise a jour THEIA</CardTitle>
                      <CardDescription>Version et mise a jour depuis Git</CardDescription>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchVersionInfo} disabled={isCheckingVersion} className="bg-transparent">
                    <RefreshCw className={cn("h-4 w-4", isCheckingVersion && "animate-spin")} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {versionInfo ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-[10px] text-muted-foreground">Branche</p>
                        <p className="font-mono text-xs text-foreground">{versionInfo.branch}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">Commit</p>
                        <p className="font-mono text-xs text-foreground">{versionInfo.commit}</p>
                      </div>
                      {versionInfo.commitDate && (
                        <div className="col-span-2">
                          <p className="text-[10px] text-muted-foreground">Date</p>
                          <p className="text-xs text-foreground">{versionInfo.commitDate}</p>
                        </div>
                      )}
                    </div>

                    {versionInfo.updateAvailable && (
                      <Alert className="border-success/50 bg-success/10">
                        <Activity className="h-4 w-4 text-success" />
                        <AlertDescription className="text-success text-xs">
                          {versionInfo.commitsBehind} commit(s) disponible(s)
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="flex gap-2">
                      <Button
                        onClick={handleUpdate}
                        disabled={isUpdating}
                        className="flex-1 gap-2"
                      >
                        {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {isUpdating ? "Mise a jour..." : "Mettre a jour"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleRestartServices}
                        disabled={isRestarting}
                        className="gap-2 bg-transparent"
                      >
                        {isRestarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                        Redemarrer services
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Chargement...
                  </div>
                )}

                {updateOutput && (
                  <ScrollArea className="h-32 rounded-md border border-border bg-secondary/30 p-3">
                    <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                      {updateOutput}
                    </pre>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            {/* Power Controls */}
            <Card className="border-border/50 bg-card">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
                    <Power className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Alimentation</CardTitle>
                    <CardDescription>Redemarrage et arret du systeme</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {systemMessage && (
                  <Alert className={cn(
                    systemMessage.type === "success" ? "border-success/50 bg-success/10" :
                    systemMessage.type === "warning" ? "border-warning/50 bg-warning/10" :
                    "border-destructive/50 bg-destructive/10"
                  )}>
                    {systemMessage.type === "success" ? <CheckCircle2 className="h-4 w-4 text-success" /> :
                     systemMessage.type === "warning" ? <AlertTriangle className="h-4 w-4 text-warning" /> :
                     <AlertTriangle className="h-4 w-4 text-destructive" />}
                    <AlertDescription className={cn(
                      "text-xs",
                      systemMessage.type === "success" ? "text-success" :
                      systemMessage.type === "warning" ? "text-warning" :
                      "text-destructive"
                    )}>
                      {systemMessage.text}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex gap-3">
                  <Button
                    onClick={handleReboot}
                    disabled={isRebooting || isShuttingDown}
                    variant="outline"
                    className="gap-2 bg-transparent flex-1"
                  >
                    {isRebooting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Redemarrer
                  </Button>
                  <Button
                    onClick={handleShutdown}
                    disabled={isRebooting || isShuttingDown}
                    variant="destructive"
                    className="gap-2 flex-1"
                  >
                    {isShuttingDown ? <Loader2 className="h-4 w-4 animate-spin" /> : <PowerOff className="h-4 w-4" />}
                    Eteindre
                  </Button>
                </div>

                <div className="border-t border-border/50 pt-4">
                  <h3 className="text-xs font-medium text-muted-foreground mb-3">Services THEIA</h3>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between rounded-md border border-border/50 bg-secondary/20 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Terminal className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-medium text-foreground">theia-backend</span>
                      </div>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-success/30 bg-success/10 text-success">
                        ACTIVE
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-border/50 bg-secondary/20 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-medium text-foreground">theia-frontend</span>
                      </div>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-success/30 bg-success/10 text-success">
                        ACTIVE
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-border/50 bg-secondary/20 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Satellite className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-medium text-foreground">gpsd</span>
                      </div>
                      <Badge variant="outline" className={cn(
                        "text-[9px] px-1.5 py-0",
                        gps.fix || gps.satellites > 0
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-warning/30 bg-warning/10 text-warning"
                      )}>
                        {gps.fix || gps.satellites > 0 ? "ACTIVE" : "NO SIGNAL"}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Copyright ── */}
          <div className="border-t border-border/50 pt-4 pb-2 text-center">
            <p className="text-[10px] text-muted-foreground">
              THEIA Hub Control v1.0 - (c) 2026 Yoann ETE
            </p>
          </div>
        </div>
      </main>
    </>
  )
}
