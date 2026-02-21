"use client"

import { useState, useEffect, useCallback } from "react"
import {
  RefreshCw,
  Power,
  PowerOff,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Terminal,
  GitBranch,
  GitCommitHorizontal,
  RotateCcw,
  Globe,
  Download,
  Wifi,
  WifiOff,
  Cable,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Star,
  Signal,
  Shield,
  ShieldCheck,
  ShieldOff,
  ExternalLink,
  Monitor,
  Smartphone,
  Laptop,
  Server,
  Copy,
  LogOut,
  Archive,
  HardDrive,
  Trash2,
  BookOpen,
  Scale,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { TopHeader } from "@/components/top-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

// ── Types ──

interface WifiStatus {
  connected: boolean
  ssid: string
  signal: number
  txRate: string
  ipLocal: string
  hasInternet: boolean
  pingMs: number
}

interface EthernetStatus {
  connected: boolean
  ipLocal: string
}

interface WifiNetwork {
  ssid: string
  signal: number
  security: string
  bssid: string
}

interface TailscalePeer {
  id: string
  hostname: string
  ip: string
  os: string
  online: boolean
  exitNodeOption: boolean
  isExitNode: boolean
  rxBytes: number
  txBytes: number
}

interface TailscaleStatus {
  installed: boolean
  running: boolean
  online: boolean
  tailscaleIp: string
  hostname: string
  magicDns: string
  version: string
  exitNode: boolean
  authUrl: string
  peers: TailscalePeer[]
}

interface GitCommit {
  hash: string
  message: string
  date: string
  author: string
}

interface VersionInfo {
  branch: string
  commit: string
  commitDate: string | null
  commitMessage?: string
  commitAuthor?: string
  updateAvailable: boolean
  commitsBehind: number
  latestCommits?: GitCommit[]
  }

interface GitUpdateStep {
  name: string
  status: "pending" | "running" | "done" | "error"
  output?: string
}

interface GitUpdateResult {
  status: string
  output: string
  commands?: string[]
  steps?: GitUpdateStep[]
  commits?: GitCommit[]
}

interface GitBranches {
  current: string
  branches: string[]
}

interface BackupInfo {
  filename: string
  size: number
  date: string
}

// ── API helpers ──

const api = {
  get: async (path: string) => {
    const res = await fetch(`/api/config/${path}`)
    return res.json()
  },
  post: async (path: string, body?: Record<string, unknown>) => {
    const res = await fetch(`/api/config/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    return res.json()
  },
  del: async (path: string) => {
    const res = await fetch(`/api/config/${path}`, { method: "DELETE" })
    return res.json()
  },
}

// ── Helpers ──

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function getPeerOsIcon(os: string) {
  const osLower = os.toLowerCase()
  if (osLower.includes("android") || osLower.includes("ios")) return Smartphone
  if (osLower.includes("windows") || osLower.includes("macos")) return Laptop
  if (osLower.includes("linux")) return Server
  return Monitor
}

function getSignalIcon(signal: number) {
  if (signal >= 70) return <Signal className="h-4 w-4 text-success" />
  if (signal >= 40) return <Signal className="h-4 w-4 text-warning" />
  return <Signal className="h-4 w-4 text-destructive" />
}

// ── Page ──

export default function AdminPage() {
  // WiFi
  const [wifiStatus, setWifiStatus] = useState<WifiStatus | null>(null)
  const [ethernetStatus, setEthernetStatus] = useState<EthernetStatus | null>(null)
  const [networks, setNetworks] = useState<WifiNetwork[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null)
  const [wifiPassword, setWifiPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [savedNetworks, setSavedNetworks] = useState<string[]>([])
  const [isConnecting, setIsConnecting] = useState(false)
  const [wifiError, setWifiError] = useState<string | null>(null)
  const [wifiSuccess, setWifiSuccess] = useState<string | null>(null)

  // Tailscale
  const [tsStatus, setTsStatus] = useState<TailscaleStatus | null>(null)
  const [tsLoading, setTsLoading] = useState(false)
  const [tsAction, setTsAction] = useState<string | null>(null)
  const [tsMessage, setTsMessage] = useState<{ type: "success" | "error" | "auth"; text: string; url?: string } | null>(null)

  // Git / Version
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [isCheckingVersion, setIsCheckingVersion] = useState(false)
  const [gitBranches, setGitBranches] = useState<GitBranches | null>(null)
  const [selectedBranch, setSelectedBranch] = useState("")
  const [isFetchingBranches, setIsFetchingBranches] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateOutput, setUpdateOutput] = useState<string | null>(null)
  const [selectedCommit, setSelectedCommit] = useState<string>("") // empty = latest

  // Backup
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [isCreatingBackup, setIsCreatingBackup] = useState(false)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)

  // Power
  const [isRebooting, setIsRebooting] = useState(false)
  const [isShuttingDown, setIsShuttingDown] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const [systemMessage, setSystemMessage] = useState<string | null>(null)

  // Licence / Guide
  const [showLicence, setShowLicence] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [guideSection, setGuideSection] = useState<string | null>(null)

  // ── Fetchers ──

  const fetchConnectionStatus = useCallback(async () => {
    try {
      const [wifi, eth] = await Promise.all([
        api.get("wifi/status"),
        api.get("ethernet/status"),
      ])
      setWifiStatus(wifi)
      setEthernetStatus(eth)
    } catch { /* ignore */ }
  }, [])

  const fetchSavedNetworks = useCallback(async () => {
    try {
      const result = await api.get("wifi/saved")
      setSavedNetworks(result.saved || [])
    } catch { /* ignore */ }
  }, [])

  const handleScan = async () => {
    setIsScanning(true)
    setWifiError(null)
    try {
      const [scanResult] = await Promise.all([api.get("wifi/scan"), fetchSavedNetworks()])
      if (scanResult.status === "success") {
        setNetworks(scanResult.networks)
      } else {
        setWifiError(scanResult.message || "Erreur lors du scan")
      }
    } catch {
      setWifiError("Erreur lors du scan Wi-Fi")
    } finally {
      setIsScanning(false)
    }
  }

  const handleConnect = async () => {
    if (!selectedNetwork) return
    setIsConnecting(true)
    setWifiError(null)
    setWifiSuccess(null)
    try {
      const result = await api.post("wifi/connect", { ssid: selectedNetwork, password: wifiPassword })
      if (result.status === "success") {
        setWifiSuccess(result.message)
        setWifiPassword("")
        setSelectedNetwork(null)
        await fetchConnectionStatus()
      } else {
        setWifiError(result.message)
      }
    } catch {
      setWifiError("Erreur de connexion")
    } finally {
      setIsConnecting(false)
    }
  }

  const fetchTailscale = useCallback(async () => {
    setTsLoading(true)
    try {
      const data = await api.get("tailscale/status")
      setTsStatus(data)
    } catch {
      setTsStatus(null)
    } finally {
      setTsLoading(false)
    }
  }, [])

  const handleTsUp = async () => {
    setTsAction("up"); setTsMessage(null)
    try {
      const result = await api.post("tailscale/up")
      if (result.status === "auth_needed") setTsMessage({ type: "auth", text: "Authentification requise", url: result.authUrl })
      else if (result.status === "success") setTsMessage({ type: "success", text: result.message })
      else setTsMessage({ type: "error", text: result.message })
      await fetchTailscale()
    } catch (e) { setTsMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" }) }
    finally { setTsAction(null) }
  }

  const handleTsDown = async () => {
    setTsAction("down"); setTsMessage(null)
    try {
      const result = await api.post("tailscale/down")
      setTsMessage({ type: result.status === "success" ? "success" : "error", text: result.message })
      await fetchTailscale()
    } catch (e) { setTsMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" }) }
    finally { setTsAction(null) }
  }

  const handleTsLogout = async () => {
    setTsAction("logout"); setTsMessage(null)
    try {
      const result = await api.post("tailscale/logout")
      setTsMessage({ type: result.status === "success" ? "success" : "error", text: result.message })
      await fetchTailscale()
    } catch (e) { setTsMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" }) }
    finally { setTsAction(null) }
  }

  const handleTsExitNode = async (ip: string) => {
    setTsAction("exit"); setTsMessage(null)
    try {
      const result = await api.post("tailscale/exit-node", { ip })
      setTsMessage({ type: result.status === "success" ? "success" : "error", text: result.message })
      await fetchTailscale()
    } catch (e) { setTsMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" }) }
    finally { setTsAction(null) }
  }

  const fetchVersionInfo = useCallback(async () => {
    setIsCheckingVersion(true)
    try {
      const res = await fetch("/api/admin/version")
      const data = await res.json()
      setVersionInfo(data)
    } catch { setVersionInfo(null) }
    finally { setIsCheckingVersion(false) }
  }, [])

  const fetchBranches = useCallback(async () => {
    setIsFetchingBranches(true)
    try {
      const data = await api.get("git/branches")
      setGitBranches(data)
      if (!selectedBranch && data.current) setSelectedBranch(data.current)
    } catch { setGitBranches(null) }
    finally { setIsFetchingBranches(false) }
  }, [selectedBranch])

  const [updateResult, setUpdateResult] = useState<GitUpdateResult | null>(null)

  const handleRefreshCommits = useCallback(async () => {
    setIsCheckingVersion(true)
    setSelectedCommit("")
    try {
      const branchToUse = selectedBranch || gitBranches?.current || ""
      // 1. Tell backend to git fetch the latest from remote
      if (branchToUse) {
        await api.post("git/fetch", { branch: branchToUse })
      }
      // 2. Re-read version info (backend will now see new remote commits)
      const qs = branchToUse ? `?branch=${encodeURIComponent(branchToUse)}` : ""
      const res = await fetch(`/api/admin/version${qs}`)
      const data = await res.json()
      setVersionInfo(data)
    } catch { /* ignore */ }
    finally { setIsCheckingVersion(false) }
  }, [selectedBranch, gitBranches])

  const handleUpdate = async () => {
    const branchToUse = selectedBranch || gitBranches?.current || ""
    const commitInfo = selectedCommit ? ` au commit ${selectedCommit.slice(0, 7)}` : ""
    if (!confirm(`Mettre a jour THEIA depuis la branche "${branchToUse}"${commitInfo} ? Les services seront redemarres.`)) return
    setIsUpdating(true)
    setUpdateOutput(null)
    setUpdateResult(null)
    try {
      const body: Record<string, string> = { branch: branchToUse }
      if (selectedCommit) body.commit = selectedCommit
      const result: GitUpdateResult = await api.post("git/update", body)
      setUpdateOutput(result.output || "")
      setUpdateResult(result)
      if (result.status === "success") {
        setSystemMessage("Mise a jour terminee. Redemarrage des services...")
        await fetchVersionInfo()
        setTimeout(async () => {
          try {
            await fetch("/api/admin/restart-services", { method: "POST" })
            setSystemMessage("Services redemarres. La page va se recharger...")
            setTimeout(() => window.location.reload(), 2000)
          } catch { setSystemMessage("Veuillez redemarrer les services manuellement.") }
        }, 1000)
      }
    } catch { setSystemMessage("Erreur lors de la mise a jour") }
    finally { setIsUpdating(false) }
  }

  const fetchBackups = useCallback(async () => {
    try {
      const result = await api.get("backups")
      setBackups(result.backups || [])
    } catch { setBackups([]) }
  }, [])

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true)
    setBackupMessage(null)
    try {
      const result = await api.post("backups")
      setBackupMessage(result.status === "success" ? `Sauvegarde creee: ${result.filename}` : result.message)
      fetchBackups()
    } catch { setBackupMessage("Erreur lors de la sauvegarde") }
    finally { setIsCreatingBackup(false) }
  }

  const handleRestoreBackup = async (filename: string) => {
    if (!confirm(`Restaurer la sauvegarde ${filename} ?\nLes donnees actuelles seront ecrasees.`)) return
    try {
      const result = await api.post("backups/restore", { filename })
      setBackupMessage(result.message)
    } catch { setBackupMessage("Erreur lors de la restauration") }
  }

  const handleDeleteBackup = async (filename: string) => {
    if (!confirm(`Supprimer la sauvegarde ${filename} ?`)) return
    try {
      await api.del(`backups/${filename}`)
      fetchBackups()
    } catch { setBackupMessage("Erreur lors de la suppression") }
  }

  const handleRestartServices = async () => {
    setIsRestarting(true)
    try {
      await fetch("/api/admin/restart-services", { method: "POST" })
      setSystemMessage("Services redemarres. Rechargement...")
      setTimeout(() => window.location.reload(), 2000)
    } catch { setSystemMessage("Erreur lors du redemarrage des services") }
    finally { setIsRestarting(false) }
  }

  const handleReboot = async () => {
    if (!confirm("Voulez-vous vraiment redemarrer le Raspberry Pi ?")) return
    setIsRebooting(true)
    try {
      await fetch("/api/admin/reboot", { method: "POST" })
      setSystemMessage("Redemarrage en cours... La connexion sera perdue.")
    } catch { setSystemMessage("Erreur lors du redemarrage"); setIsRebooting(false) }
  }

  const handleShutdown = async () => {
    if (!confirm("Voulez-vous vraiment eteindre le Raspberry Pi ?")) return
    setIsShuttingDown(true)
    try {
      await fetch("/api/admin/shutdown", { method: "POST" })
      setSystemMessage("Arret en cours... La connexion sera perdue.")
    } catch { setSystemMessage("Erreur lors de l'arret"); setIsShuttingDown(false) }
  }

  // Initial load
  useEffect(() => {
    fetchConnectionStatus()
    handleScan()
    fetchVersionInfo()
    fetchBranches()
    fetchBackups()
    fetchTailscale()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── RENDER ──

  return (
    <>
      <TopHeader title="Configuration" description="Administration reseau et systeme du Raspberry Pi" />
      <main className="flex-1 overflow-auto p-4">
        <div className="grid gap-6 lg:grid-cols-2">

          {/* ── Connection Status ── */}
          <Card className="border-border/50 bg-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Globe className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Etat connexion</CardTitle>
                    <CardDescription>Wi-Fi et Ethernet</CardDescription>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={fetchConnectionStatus} className="bg-transparent">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* WiFi */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  {wifiStatus?.connected ? <Wifi className="h-4 w-4 text-success" /> : <WifiOff className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-sm font-medium text-foreground">Wi-Fi</span>
                  {wifiStatus?.connected && <span className="ml-auto text-xs text-success">Connecte</span>}
                </div>
                {wifiStatus?.connected ? (
                  <div className="grid grid-cols-2 gap-3 pl-6 text-sm">
                    <div>
                      <p className="text-[10px] text-muted-foreground">SSID</p>
                      <p className="text-xs font-medium text-foreground">{wifiStatus.ssid}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Signal</p>
                      <p className="text-xs font-mono text-foreground">{wifiStatus.signal} dBm</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">IP Locale</p>
                      <p className="text-xs font-mono text-foreground">{wifiStatus.ipLocal}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Debit</p>
                      <p className="text-xs font-mono text-foreground">{wifiStatus.txRate || "---"}</p>
                    </div>
                    <div className="col-span-2 border-t border-border/50 pt-2">
                      <p className="text-[10px] text-muted-foreground mb-1">Connectivite Internet</p>
                      {wifiStatus.hasInternet ? (
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1.5 text-success text-xs font-medium">
                            <CheckCircle2 className="h-3 w-3" />
                            Connecte
                          </span>
                          {wifiStatus.pingMs > 0 && (
                            <span className="text-xs text-muted-foreground">Ping: {wifiStatus.pingMs} ms</span>
                          )}
                        </div>
                      ) : (
                        <span className="flex items-center gap-1.5 text-destructive text-xs font-medium">
                          <AlertCircle className="h-3 w-3" />
                          {"Pas d'acces Internet"}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="pl-6 text-xs text-muted-foreground">Non connecte</p>
                )}
              </div>

              <div className="border-t border-border/50" />

              {/* Ethernet */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Cable className={cn("h-4 w-4", ethernetStatus?.connected ? "text-success" : "text-muted-foreground")} />
                  <span className="text-sm font-medium text-foreground">Ethernet</span>
                  {ethernetStatus?.connected && <span className="ml-auto text-xs text-success">Connecte</span>}
                </div>
                {ethernetStatus?.connected ? (
                  <div className="pl-6">
                    <p className="text-[10px] text-muted-foreground">IP Locale</p>
                    <p className="text-xs font-mono text-foreground">{ethernetStatus.ipLocal}</p>
                  </div>
                ) : (
                  <p className="pl-6 text-xs text-muted-foreground">Non connecte</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Tailscale VPN ── */}
          <Card className="border-border/50 bg-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg",
                    tsStatus?.running && tsStatus.online ? "bg-success/10" : "bg-muted"
                  )}>
                    {tsStatus?.running && tsStatus.online
                      ? <ShieldCheck className="h-5 w-5 text-success" />
                      : tsStatus?.installed
                        ? <ShieldOff className="h-5 w-5 text-muted-foreground" />
                        : <Shield className="h-5 w-5 text-muted-foreground" />}
                  </div>
                  <div>
                    <CardTitle className="text-base">Tailscale VPN</CardTitle>
                    <CardDescription>
                      {!tsStatus?.installed ? "Non installe"
                        : tsStatus.running && tsStatus.online ? "Connecte au reseau"
                        : tsStatus.running ? "En cours de connexion..."
                        : "Deconnecte"}
                    </CardDescription>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={fetchTailscale} disabled={tsLoading} className="bg-transparent">
                  <RefreshCw className={cn("h-4 w-4", tsLoading && "animate-spin")} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!tsStatus?.installed ? (
                <div className="text-sm text-muted-foreground">
                  <p>{"Tailscale n'est pas installe sur ce Pi."}</p>
                  <p className="mt-1 font-mono text-xs bg-secondary rounded px-2 py-1">
                    curl -fsSL https://tailscale.com/install.sh | sh
                  </p>
                </div>
              ) : (
                <>
                  {tsStatus.running && tsStatus.online && (
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-[10px] text-muted-foreground">IP Tailscale</p>
                        <div className="flex items-center gap-1.5">
                          <p className="font-mono text-xs text-foreground">{tsStatus.tailscaleIp}</p>
                          <button onClick={() => navigator.clipboard.writeText(tsStatus.tailscaleIp)}
                            className="text-muted-foreground hover:text-foreground transition-colors" title="Copier">
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">Hostname</p>
                        <p className="font-mono text-xs text-foreground">{tsStatus.hostname}</p>
                      </div>
                      {tsStatus.magicDns && (
                        <div className="col-span-2">
                          <p className="text-[10px] text-muted-foreground">Magic DNS</p>
                          <div className="flex items-center gap-1.5">
                            <p className="font-mono text-xs text-foreground truncate">{tsStatus.magicDns}</p>
                            <button onClick={() => navigator.clipboard.writeText(tsStatus.magicDns)}
                              className="text-muted-foreground hover:text-foreground transition-colors shrink-0" title="Copier">
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {tsStatus.authUrl && (
                    <Alert className="border-warning/50 bg-warning/10">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      <AlertDescription className="text-warning text-xs">
                        <a href={tsStatus.authUrl} target="_blank" rel="noopener noreferrer" className="underline flex items-center gap-1">
                          Authentifier ce device <ExternalLink className="h-3 w-3" />
                        </a>
                      </AlertDescription>
                    </Alert>
                  )}

                  {tsMessage && (
                    <Alert className={cn(
                      tsMessage.type === "success" ? "border-success/50 bg-success/10" :
                      tsMessage.type === "auth" ? "border-warning/50 bg-warning/10" :
                      "border-destructive/50 bg-destructive/10"
                    )}>
                      {tsMessage.type === "success" ? <CheckCircle2 className="h-4 w-4 text-success" /> :
                       tsMessage.type === "auth" ? <AlertTriangle className="h-4 w-4 text-warning" /> :
                       <AlertCircle className="h-4 w-4 text-destructive" />}
                      <AlertDescription className={cn("text-xs",
                        tsMessage.type === "success" ? "text-success" :
                        tsMessage.type === "auth" ? "text-warning" : "text-destructive"
                      )}>
                        {tsMessage.text}
                        {tsMessage.url && (
                          <a href={tsMessage.url} target="_blank" rel="noopener noreferrer" className="ml-2 underline inline-flex items-center gap-1">
                            Ouvrir <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Peers */}
                  {tsStatus.running && tsStatus.online && tsStatus.peers.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                        Machines ({tsStatus.peers.filter(p => p.online).length}/{tsStatus.peers.length} en ligne)
                      </p>
                      <ScrollArea className="h-36 rounded-md border border-border/50">
                        <div className="flex flex-col gap-1 p-2">
                          {tsStatus.peers.map((peer) => {
                            const OsIcon = getPeerOsIcon(peer.os)
                            return (
                              <div key={peer.id} className={cn("flex items-center gap-2.5 rounded-md p-2 text-sm",
                                peer.online ? "bg-secondary/50" : "opacity-50")}>
                                <OsIcon className={cn("h-4 w-4 shrink-0", peer.online ? "text-primary" : "text-muted-foreground")} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-foreground truncate">{peer.hostname}</span>
                                    {peer.online && <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0" />}
                                    {peer.isExitNode && <Badge variant="outline" className="text-[9px] px-1 py-0 border-success/50 text-success">EXIT</Badge>}
                                  </div>
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                    <span className="font-mono">{peer.ip}</span>
                                    <span>{peer.os}</span>
                                    {peer.online && (peer.rxBytes > 0 || peer.txBytes > 0) && (
                                      <span>rx:{formatBytes(peer.rxBytes)} tx:{formatBytes(peer.txBytes)}</span>
                                    )}
                                  </div>
                                </div>
                                {peer.exitNodeOption && !peer.isExitNode && peer.online && (
                                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0"
                                    onClick={() => handleTsExitNode(peer.ip)} disabled={!!tsAction} title="Utiliser comme exit node">
                                    <Globe className="h-3 w-3" />
                                  </Button>
                                )}
                                {peer.isExitNode && (
                                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-success"
                                    onClick={() => handleTsExitNode("")} disabled={!!tsAction} title="Desactiver exit node">
                                    <Globe className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </ScrollArea>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {tsStatus.running ? (
                      <Button variant="outline" size="sm" onClick={handleTsDown} disabled={!!tsAction} className="gap-1.5 bg-transparent">
                        {tsAction === "down" ? <Loader2 className="h-3 w-3 animate-spin" /> : <PowerOff className="h-3 w-3" />}
                        Deconnecter
                      </Button>
                    ) : (
                      <Button size="sm" onClick={handleTsUp} disabled={!!tsAction} className="gap-1.5">
                        {tsAction === "up" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
                        Connecter
                      </Button>
                    )}
                    {tsStatus.running && (
                      <Button variant="outline" size="sm" onClick={handleTsLogout} disabled={!!tsAction}
                        className="gap-1.5 text-destructive hover:text-destructive bg-transparent">
                        {tsAction === "logout" ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                        Logout
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── WiFi Scanner ── */}
          <Card className="border-border/50 bg-card lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Wifi className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Reseaux disponibles</CardTitle>
                    <CardDescription>Selectionnez un reseau Wi-Fi</CardDescription>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={handleScan} disabled={isScanning} className="bg-transparent gap-2">
                  <RefreshCw className={cn("h-4 w-4", isScanning && "animate-spin")} />
                  Scanner
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {wifiError && (
                <Alert className="border-destructive/50 bg-destructive/10">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <AlertDescription className="text-destructive text-xs">{wifiError}</AlertDescription>
                </Alert>
              )}
              {wifiSuccess && (
                <Alert className="border-success/50 bg-success/10">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <AlertDescription className="text-success text-xs">{wifiSuccess}</AlertDescription>
                </Alert>
              )}

              <ScrollArea className="h-48 rounded-md border border-border/50">
                <div className="flex flex-col gap-1 p-2">
                  {networks.map((network) => (
                    <button
                      key={network.bssid || network.ssid}
                      onClick={() => setSelectedNetwork(network.ssid)}
                      className={cn(
                        "w-full flex items-center justify-between p-2 rounded-md text-left transition-colors",
                        selectedNetwork === network.ssid
                          ? "bg-primary/20 border border-primary"
                          : "hover:bg-secondary"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {network.security !== "Open" ? <Lock className="h-4 w-4 text-muted-foreground" /> : <Unlock className="h-4 w-4 text-muted-foreground" />}
                        <span className="text-sm font-medium text-foreground">{network.ssid}</span>
                        {savedNetworks.includes(network.ssid) && <Star className="h-3 w-3 text-warning fill-warning" title="Reseau enregistre" />}
                        {wifiStatus?.ssid === network.ssid && <CheckCircle2 className="h-4 w-4 text-success" />}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{network.signal}%</span>
                        {getSignalIcon(network.signal)}
                      </div>
                    </button>
                  ))}
                  {networks.length === 0 && !isScanning && (
                    <p className="text-center text-muted-foreground text-sm py-4">Aucun reseau trouve</p>
                  )}
                </div>
              </ScrollArea>

              {selectedNetwork && (
                <div className="flex flex-col gap-3 border-t border-border/50 pt-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">Connexion a: {selectedNetwork}</p>
                    {savedNetworks.includes(selectedNetwork) && (
                      <span className="text-[10px] bg-warning/20 text-warning px-2 py-0.5 rounded flex items-center gap-1">
                        <Star className="h-3 w-3 fill-warning" />
                        Enregistre
                      </span>
                    )}
                  </div>
                  {savedNetworks.includes(selectedNetwork) ? (
                    <p className="text-xs text-muted-foreground">
                      Ce reseau est deja enregistre. Cliquez sur Se connecter pour vous reconnecter.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="wifi-password" className="text-xs">Mot de passe</Label>
                      <div className="relative">
                        <Input
                          id="wifi-password"
                          type={showPassword ? "text" : "password"}
                          value={wifiPassword}
                          onChange={(e) => setWifiPassword(e.target.value)}
                          placeholder="Mot de passe Wi-Fi"
                          className="pr-10"
                        />
                        <Button type="button" variant="ghost" size="icon"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => setShowPassword(!showPassword)}>
                          {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                      </div>
                    </div>
                  )}
                  <Button onClick={handleConnect} disabled={isConnecting} className="w-full gap-2">
                    {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                    {isConnecting ? "Connexion..." : "Se connecter"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── THEIA Update ── */}
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
                  {/* Current version info */}
                  <div className="rounded-lg border border-border/50 bg-secondary/10 p-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Version actuelle</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1">
                        <GitBranch className="h-3 w-3 text-primary" />
                        <span className="font-mono text-xs text-foreground font-medium">{versionInfo.branch}</span>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1">
                        <GitCommitHorizontal className="h-3 w-3 text-primary" />
                        <span className="font-mono text-xs text-primary font-bold">{versionInfo.commit}</span>
                      </div>
                    </div>
                    {(versionInfo.commitMessage || versionInfo.commitDate) && (
                      <div className="flex flex-col gap-0.5 ml-0.5">
                        {versionInfo.commitMessage && (
                          <p className="text-xs text-foreground">{versionInfo.commitMessage}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          {versionInfo.commitAuthor && `${versionInfo.commitAuthor} - `}{versionInfo.commitDate}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Branch selector */}
                  <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-secondary/20 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-3.5 w-3.5 text-primary" />
                        <p className="text-xs font-medium text-foreground">Branche cible</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={fetchBranches} disabled={isFetchingBranches} className="h-6 px-2 text-xs">
                        <RefreshCw className={cn("h-3 w-3 mr-1", isFetchingBranches && "animate-spin")} />
                        Actualiser
                      </Button>
                    </div>
                    <div className="relative">
                      <select
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        disabled={isUpdating || isFetchingBranches}
                        className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                      >
                        {!gitBranches && <option value="">Chargement des branches...</option>}
                        {gitBranches?.branches.map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}{branch === versionInfo.branch ? " (actuelle)" : ""}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                    {selectedBranch && selectedBranch !== versionInfo.branch && (
                      <p className="text-[11px] text-warning flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {"Changement de branche"}: {versionInfo.branch} {"→"} {selectedBranch}
                      </p>
                    )}
                  </div>

                  {/* Refresh button to check for new commits */}
                  <Button
                    variant="outline" size="sm"
                    onClick={handleRefreshCommits}
                    disabled={isCheckingVersion}
                    className="w-full gap-2 bg-transparent"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", isCheckingVersion && "animate-spin")} />
                    {isCheckingVersion ? "Verification..." : "Verifier les mises a jour"}
                  </Button>

                  {versionInfo.updateAvailable && (
                    <div className="flex flex-col gap-2">
                      <Alert className="border-success/50 bg-success/10">
                        <Download className="h-4 w-4 text-success" />
                        <AlertDescription className="text-success text-xs">
                          {versionInfo.commitsBehind} commit(s) disponible(s)
                        </AlertDescription>
                      </Alert>
                      {versionInfo.latestCommits && versionInfo.latestCommits.length > 0 && (
                        <div className="rounded-md border border-border/50 bg-secondary/20 overflow-hidden">
                          <div className="flex items-center justify-between px-3 pt-2 pb-1">
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                              Commits disponibles (cliquer pour selectionner)
                            </p>
                            {selectedCommit && (
                              <button
                                onClick={() => setSelectedCommit("")}
                                className="text-[10px] text-primary hover:underline"
                              >
                                Dernier commit
                              </button>
                            )}
                          </div>
                          <div className="flex flex-col">
                            {versionInfo.latestCommits.map((c) => (
                              <button
                                key={c.hash}
                                onClick={() => setSelectedCommit(selectedCommit === c.hash ? "" : c.hash)}
                                className={cn(
                                  "flex items-start gap-2 px-3 py-1.5 border-t border-border/30 text-left transition-all hover:bg-primary/5",
                                  selectedCommit === c.hash && "bg-primary/10 border-primary/30"
                                )}
                              >
                                <span className={cn(
                                  "font-mono text-[10px] shrink-0 mt-0.5",
                                  selectedCommit === c.hash ? "text-primary font-bold" : "text-primary"
                                )}>
                                  {c.hash.slice(0, 7)}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-foreground truncate">{c.message}</p>
                                  <p className="text-[10px] text-muted-foreground">{c.author} - {c.date}</p>
                                </div>
                                {selectedCommit === c.hash && (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button onClick={handleUpdate} disabled={isUpdating} className="flex-1 gap-2">
                      {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {isUpdating ? "Mise a jour en cours..." : selectedCommit ? `Deployer ${selectedCommit.slice(0, 7)}` : "Mettre a jour (dernier commit)"}
                    </Button>
                    <Button variant="outline" onClick={handleRestartServices} disabled={isRestarting} className="gap-2 bg-transparent">
                      {isRestarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      Redemarrer
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Chargement...</p>
              )}

              {(updateOutput || updateResult || isUpdating) && (
                <div className="flex flex-col rounded-lg border border-border/50 bg-[hsl(var(--card))] overflow-hidden">
                  {/* Terminal header */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30 border-b border-border/30">
                    <div className="flex gap-1.5">
                      <div className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
                      <div className="h-2.5 w-2.5 rounded-full bg-warning/60" />
                      <div className="h-2.5 w-2.5 rounded-full bg-success/60" />
                    </div>
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground ml-1" />
                    <span className="text-[10px] font-medium font-mono text-muted-foreground">theia@pi ~ update</span>
                    {updateResult?.status === "success" && (
                      <Badge variant="outline" className="ml-auto h-4 text-[8px] border-success/50 text-success">EXIT 0</Badge>
                    )}
                    {updateResult?.status === "error" && (
                      <Badge variant="outline" className="ml-auto h-4 text-[8px] border-destructive/50 text-destructive">EXIT 1</Badge>
                    )}
                    {isUpdating && !updateResult && (
                      <div className="ml-auto flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                        <span className="text-[9px] text-primary font-mono">RUNNING</span>
                      </div>
                    )}
                  </div>

                  {/* Steps + output */}
                  <ScrollArea className="h-56">
                    <div className="p-3 flex flex-col gap-2">
                      {/* Step-by-step process view */}
                      {updateResult?.steps && updateResult.steps.length > 0 ? (
                        updateResult.steps.map((step, i) => (
                          <div key={i} className="flex flex-col">
                            <div className="flex items-center gap-2">
                              {step.status === "done" && <CheckCircle2 className="h-3 w-3 text-success shrink-0" />}
                              {step.status === "error" && <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />}
                              {step.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />}
                              {step.status === "pending" && <div className="h-3 w-3 rounded-full border border-border/50 shrink-0" />}
                              <span className="text-[10px] text-success font-mono font-bold select-none">$</span>
                              <code className="text-[11px] font-mono text-foreground">{step.name}</code>
                            </div>
                            {step.output && (
                              <pre className="ml-5 mt-0.5 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed pl-2 border-l border-border/30">{step.output}</pre>
                            )}
                          </div>
                        ))
                      ) : updateResult?.commands && updateResult.commands.length > 0 ? (
                        /* Fallback: simple commands list if no steps */
                        <div className="flex flex-col gap-0.5">
                          {updateResult.commands.map((cmd, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                              <span className="text-[10px] text-success font-mono font-bold select-none">$</span>
                              <code className="text-[11px] font-mono text-foreground">{cmd}</code>
                            </div>
                          ))}
                        </div>
                      ) : isUpdating ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          <span className="text-[11px] font-mono text-muted-foreground">Connexion au serveur...</span>
                        </div>
                      ) : null}

                      {/* Raw output */}
                      {updateOutput && !updateResult?.steps && (
                        <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed mt-1 pt-1 border-t border-border/20">{updateOutput}</pre>
                      )}
                    </div>
                  </ScrollArea>

                  {/* New commits pulled */}
                  {updateResult?.commits && updateResult.commits.length > 0 && (
                    <div className="border-t border-success/20 bg-success/5">
                      <p className="text-[10px] text-success font-medium uppercase tracking-wider px-3 pt-2 pb-1">
                        Commits integres ({updateResult.commits.length})
                      </p>
                      <div className="flex flex-col">
                        {updateResult.commits.map((c) => (
                          <div key={c.hash} className="flex items-start gap-2 px-3 py-1.5 border-t border-success/20">
                            <span className="font-mono text-[10px] text-success shrink-0 mt-0.5">{c.hash.slice(0, 7)}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-foreground truncate">{c.message}</p>
                              <p className="text-[10px] text-muted-foreground">{c.author} - {c.date}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Backups ── */}
          <Card className="border-border/50 bg-card">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Archive className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Sauvegardes</CardTitle>
                  <CardDescription>Sauvegarde des donnees missions</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-xs text-muted-foreground">
                {"Archive le dossier"} <code className="bg-secondary px-1 rounded text-foreground">/opt/theia/data/</code> {"contenant toutes les missions, captures, logs et configurations. Utilisez la restauration pour recuperer vos donnees apres un crash ou reinstallation."}
              </p>
              <Button onClick={handleCreateBackup} disabled={isCreatingBackup} className="w-full gap-2">
                {isCreatingBackup ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDrive className="h-4 w-4" />}
                {isCreatingBackup ? "Sauvegarde..." : "Creer une sauvegarde"}
              </Button>

              {backupMessage && (
                <Alert className="border-muted">
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription className="text-xs">{backupMessage}</AlertDescription>
                </Alert>
              )}

              {backups.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Sauvegardes existantes</p>
                  <ScrollArea className="h-40">
                    <div className="flex flex-col gap-2">
                      {backups.map((backup) => (
                        <div key={backup.filename} className="flex items-center justify-between rounded-md bg-secondary/50 p-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono text-foreground truncate">{backup.filename}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {backup.size > 0 ? `${(backup.size / 1024 / 1024).toFixed(2)} Mo` : "Vide"}
                            </p>
                          </div>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-primary"
                              onClick={() => handleRestoreBackup(backup.filename)} title="Restaurer">
                              <RotateCcw className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                              onClick={() => handleDeleteBackup(backup.filename)} title="Supprimer">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Power Controls ── */}
          <Card className="border-border/50 bg-card lg:col-span-2">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
                  <Power className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <CardTitle className="text-base">Alimentation</CardTitle>
                  <CardDescription>Demarrage et arret du systeme</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {systemMessage && (
                <Alert className="border-warning/50 bg-warning/10">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <AlertDescription className="text-warning text-xs">{systemMessage}</AlertDescription>
                </Alert>
              )}
              <div className="flex gap-3">
                <Button onClick={handleReboot} disabled={isRebooting || isShuttingDown} variant="outline" className="gap-2 bg-transparent flex-1">
                  {isRebooting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Redemarrer
                </Button>
                <Button onClick={handleShutdown} disabled={isRebooting || isShuttingDown} variant="destructive" className="gap-2 flex-1">
                  {isShuttingDown ? <Loader2 className="h-4 w-4 animate-spin" /> : <PowerOff className="h-4 w-4" />}
                  Eteindre
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ── Licence ── */}
          <Card className="border-border/50 bg-card lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Scale className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Licence</CardTitle>
                    <CardDescription>{"Propriete intellectuelle et conditions d'utilisation"}</CardDescription>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowLicence(!showLicence)} className="bg-transparent gap-2">
                  <ChevronRight className={cn("h-4 w-4 transition-transform", showLicence && "rotate-90")} />
                  {showLicence ? "Masquer" : "Voir la licence"}
                </Button>
              </div>
            </CardHeader>
            {showLicence && (
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <pre className="whitespace-pre-wrap text-xs font-mono text-muted-foreground leading-relaxed p-4 rounded-lg bg-muted/30 border border-border/30">
{`THEIA - Surveillance IoT Hub
Licence proprietaire - Tous droits reserves

Copyright (c) 2026 Yoann ETE.

AVIS DE PROPRIETE INTELLECTUELLE

Ce logiciel, incluant sans limitation son code source, son architecture,
ses algorithmes, ses interfaces utilisateur, sa documentation et tous les
materiaux associes (ci-apres "le Logiciel"), est la propriete exclusive
de Yoann ETE.

RESTRICTIONS

Sauf accord ecrit prealable du titulaire des droits, il est STRICTEMENT
INTERDIT de :

1. Reproduire, copier ou dupliquer tout ou partie du Logiciel
2. Distribuer, publier ou rendre accessible le Logiciel a des tiers
3. Modifier, adapter, traduire ou creer des oeuvres derivees du Logiciel
4. Decompiler, desassembler ou tenter d'extraire le code source
5. Utiliser le Logiciel a des fins commerciales
6. Sous-licencier, louer ou preter le Logiciel
7. Retirer ou modifier les mentions de propriete intellectuelle

LIMITATION DE RESPONSABILITE

LE LOGICIEL EST FOURNI "EN L'ETAT", SANS GARANTIE D'AUCUNE SORTE.

CONTACT : contact@yoann-ete.fr`}
                  </pre>
                </ScrollArea>
              </CardContent>
            )}
          </Card>

          {/* ── Guide d'utilisation ── */}
          <Card className="border-border/50 bg-card lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <BookOpen className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{"Guide d'utilisation"}</CardTitle>
                    <CardDescription>Notice complete de chaque page et fonctionnalite</CardDescription>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowGuide(!showGuide)} className="bg-transparent gap-2">
                  <ChevronRight className={cn("h-4 w-4 transition-transform", showGuide && "rotate-90")} />
                  {showGuide ? "Masquer" : "Ouvrir le guide"}
                </Button>
              </div>
            </CardHeader>
            {showGuide && (
              <CardContent>
                <div className="flex flex-col gap-2">
                  {[
                    {
                      id: "dashboard", icon: Globe, title: "Dashboard",
                      content: "Vue d'ensemble du systeme : etat du Raspberry Pi (CPU, RAM, disque, temperature), connexion internet avec debit et ping, etat GPS et LoRa RX avec RSSI. Les indicateurs passent au vert/orange/rouge selon les seuils."
                    },
                    {
                      id: "missions", icon: Terminal, title: "Missions",
                      content: "Gestion des missions de surveillance. Creez une mission, assignez des capteurs, definissez des zones de surveillance avec le plan builder integre. Chaque mission contient ses propres evenements de detection, logs, et configurations de capteurs."
                    },
                    {
                      id: "sensors", icon: Signal, title: "Capteurs",
                      content: "Page de gestion des devices LoRa TX. Ajoutez des capteurs par leur Dev EUI, donnez-leur un nom, puis assignez-les a une mission. Le statut (en ligne/hors ligne), RSSI, batterie et derniere activite sont affiches en temps reel."
                    },
                    {
                      id: "events", icon: AlertTriangle, title: "Evenements",
                      content: "Journal des evenements de detection : intrusions, mouvements, alertes capteurs. Filtrez par mission, type d'evenement, plage de dates. Chaque evenement affiche le capteur source, la zone, l'horodatage et les donnees brutes."
                    },
                    {
                      id: "config", icon: Terminal, title: "Configuration Pi",
                      content: "Cette page. Administration du Raspberry Pi : Wi-Fi (scan, connexion, mot de passe persistant), Ethernet, Tailscale VPN, mises a jour Git avec choix de branche, sauvegardes, alimentation (redemarrage/arret)."
                    },
                  ].map((section) => (
                    <button
                      key={section.id}
                      onClick={() => setGuideSection(guideSection === section.id ? null : section.id)}
                      className="w-full text-left"
                    >
                      <div className={cn(
                        "flex items-center gap-3 rounded-md border border-border/50 p-3 transition-colors",
                        guideSection === section.id ? "bg-secondary/50" : "hover:bg-secondary/30"
                      )}>
                        <section.icon className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-sm font-medium text-foreground flex-1">{section.title}</span>
                        <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", guideSection === section.id && "rotate-90")} />
                      </div>
                      {guideSection === section.id && (
                        <div className="mt-1 rounded-md border border-border/30 bg-muted/20 p-4">
                          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{section.content}</p>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>

          {/* ── Footer ── */}
          <div className="lg:col-span-2 border-t border-border/50 pt-4 pb-2 text-center">
            <p className="text-[10px] text-muted-foreground">
              THEIA Hub Control v1.0 - (c) 2026 Yoann ETE
            </p>
          </div>
        </div>
      </main>
    </>
  )
}
