"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertCircle, CheckCircle, Loader, RefreshCw, Wifi, WifiOff } from "lucide-react"

interface PiNode {
  id: string
  name: string
  hostname: string
  ssh_user: string
  ip_address: string | null
  service_name: string
  node_type: "xaver" | "hub"
  last_seen: string | null
  online: number
  target: string
}

interface NetworkStatus {
  allowed: { id: number; network_type: string; network_value: string; description: string }[]
  current: string
  is_allowed: boolean
}

interface DeviceCommand {
  label: string
  cmd: string
  variant?: "default" | "destructive" | "outline"
}

const XAVER_COMMANDS: DeviceCommand[] = [
  { label: "Status", cmd: "status", variant: "outline" },
  { label: "Restart", cmd: "restart", variant: "default" },
  { label: "Logs (50)", cmd: "logs", variant: "outline" },
  { label: "Process", cmd: "ps", variant: "outline" },
]

const HUB_COMMANDS: DeviceCommand[] = [
  { label: "Status", cmd: "status", variant: "outline" },
  { label: "Restart API", cmd: "restart-api", variant: "default" },
  { label: "Logs (50)", cmd: "logs", variant: "outline" },
]

function getBackendBase() {
  if (typeof window === "undefined") return ""
  return `http://${window.location.hostname}:8000`
}

export function DeviceControl() {
  const [nodes, setNodes] = useState<PiNode[]>([])
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus | null>(null)
  const [loadingNodes, setLoadingNodes] = useState(true)
  const [loading, setLoading] = useState<string | null>(null)
  const [result, setResult] = useState<{ device: string; output: string; success: boolean; target?: string; networkError?: boolean } | null>(null)

  const fetchNodes = async () => {
    setLoadingNodes(true)
    try {
      const base = getBackendBase()
      const [nodesRes, networkRes] = await Promise.all([
        fetch(`${base}/api/logs/nodes`, { credentials: "include" }),
        fetch(`${base}/api/logs/networks`, { credentials: "include" }),
      ])
      
      if (nodesRes.ok) {
        const data = await nodesRes.json()
        setNodes(data)
      }
      if (networkRes.ok) {
        const data = await networkRes.json()
        setNetworkStatus(data)
      }
    } catch (e) {
      console.error("Failed to fetch nodes:", e)
    } finally {
      setLoadingNodes(false)
    }
  }

  useEffect(() => {
    fetchNodes()
    // Refresh every 30s
    const interval = setInterval(fetchNodes, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleCommand = async (nodeId: string, cmd: string) => {
    const key = `${nodeId}-${cmd}`
    setLoading(key)
    setResult(null)

    try {
      const base = getBackendBase()
      const res = await fetch(`${base}/api/logs/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: nodeId, cmd }),
        credentials: "include",
      })

      const data = await res.json()
      setResult({
        device: nodeId,
        output: data.output || `[Error ${res.status}] ${data.detail || res.statusText}`,
        success: res.ok && data.returncode === 0,
        target: data.target,
        networkError: data.network_error,
      })
    } catch (e) {
      setResult({
        device: nodeId,
        output: `[Exception] ${String(e)}`,
        success: false,
      })
    } finally {
      setLoading(null)
    }
  }

  const formatLastSeen = (lastSeen: string | null) => {
    if (!lastSeen) return "Never"
    const date = new Date(lastSeen)
    const now = new Date()
    const diffSec = (now.getTime() - date.getTime()) / 1000
    if (diffSec < 60) return "Just now"
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
    return date.toLocaleDateString()
  }

  if (loadingNodes) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading nodes...</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Network status banner */}
      {networkStatus && (
        <div className={`flex items-center justify-between p-3 rounded-lg border ${
          networkStatus.is_allowed 
            ? "bg-green-500/10 border-green-500/30" 
            : "bg-red-500/10 border-red-500/30"
        }`}>
          <div className="flex items-center gap-2">
            {networkStatus.is_allowed ? (
              <Wifi className="h-4 w-4 text-green-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-red-500" />
            )}
            <span className="text-sm">
              Network: <span className="font-mono text-xs">{networkStatus.current}</span>
              {networkStatus.is_allowed ? (
                <span className="ml-2 text-green-600">Authorized</span>
              ) : (
                <span className="ml-2 text-red-600">Not authorized - Commands blocked</span>
              )}
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={fetchNodes}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Pi nodes register their IP via heartbeat. IPs update automatically when devices connect.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {nodes.map((node) => {
          const commands = node.node_type === "xaver" ? XAVER_COMMANDS : HUB_COMMANDS
          const isOnline = node.online === 1
          const statusColor = isOnline ? "bg-green-500" : "bg-gray-400"
          const canExecute = networkStatus?.is_allowed || node.node_type === "hub"
          
          return (
            <Card key={node.id} className={!isOnline ? "opacity-70" : ""}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${statusColor}`} />
                  {node.name}
                  {!isOnline && <span className="text-xs text-muted-foreground">(offline)</span>}
                </CardTitle>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-mono">
                    {node.ip_address || node.hostname}
                  </p>
                  {node.last_seen && (
                    <p className="text-[10px] text-muted-foreground">
                      Last seen: {formatLastSeen(node.last_seen)}
                    </p>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {commands.map((cmd) => (
                  <Button
                    key={`${node.id}-${cmd.cmd}`}
                    size="sm"
                    variant={cmd.variant || "outline"}
                    onClick={() => handleCommand(node.id, cmd.cmd)}
                    disabled={loading === `${node.id}-${cmd.cmd}` || !canExecute}
                    className="text-xs w-full"
                  >
                    {loading === `${node.id}-${cmd.cmd}` ? (
                      <Loader className="h-3 w-3 animate-spin mr-1" />
                    ) : null}
                    {cmd.label}
                  </Button>
                ))}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Command output */}
      {result && (
        <Card className={result.success ? "border-green-500/50" : "border-red-500/50"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {result.success ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-red-500" />
              )}
              {result.device.toUpperCase()} Output
              {result.target && (
                <span className="text-xs font-normal text-muted-foreground ml-2">
                  ({result.target})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-64 font-mono whitespace-pre-wrap break-words">
              {result.output}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
