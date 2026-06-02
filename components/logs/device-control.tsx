"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertCircle, CheckCircle, Loader, RefreshCw } from "lucide-react"

interface DeviceInfo {
  id: string
  name: string
  target: string
  type: "xaver" | "hub"
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
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loadingDevices, setLoadingDevices] = useState(true)
  const [loading, setLoading] = useState<string | null>(null)
  const [result, setResult] = useState<{ device: string; output: string; success: boolean; target?: string } | null>(null)

  const fetchDevices = async () => {
    setLoadingDevices(true)
    try {
      const base = getBackendBase()
      const token = localStorage.getItem("theia_token")
      const res = await fetch(`${base}/api/logs/devices`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setDevices(data)
      }
    } catch (e) {
      console.error("Failed to fetch devices:", e)
    } finally {
      setLoadingDevices(false)
    }
  }

  useEffect(() => {
    fetchDevices()
  }, [])

  const handleCommand = async (deviceId: string, cmd: string) => {
    const key = `${deviceId}-${cmd}`
    setLoading(key)
    setResult(null)

    try {
      const base = getBackendBase()
      const token = localStorage.getItem("theia_token")
      const res = await fetch(`${base}/api/logs/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ device: deviceId, cmd }),
        credentials: "include",
      })

      const data = await res.json()
      setResult({
        device: deviceId,
        output: data.output || `[Error ${res.status}] ${data.detail || res.statusText}`,
        success: res.ok && data.returncode === 0,
        target: data.target,
      })
    } catch (e) {
      setResult({
        device: deviceId,
        output: `[Exception] ${String(e)}`,
        success: false,
      })
    } finally {
      setLoading(null)
    }
  }

  if (loadingDevices) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading devices...</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          IPs resolved via Tailscale or local network fallback
        </p>
        <Button size="sm" variant="ghost" onClick={fetchDevices}>
          <RefreshCw className="h-3 w-3 mr-1" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {devices.map((device) => {
          const commands = device.type === "xaver" ? XAVER_COMMANDS : HUB_COMMANDS
          const statusColor = device.type === "xaver" ? "bg-green-500" : "bg-blue-500"
          
          return (
            <Card key={device.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${statusColor}`} />
                  {device.name}
                </CardTitle>
                <p className="text-xs text-muted-foreground font-mono">
                  {device.target || "No target resolved"}
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {commands.map((cmd) => (
                  <Button
                    key={`${device.id}-${cmd.cmd}`}
                    size="sm"
                    variant={cmd.variant || "outline"}
                    onClick={() => handleCommand(device.id, cmd.cmd)}
                    disabled={loading === `${device.id}-${cmd.cmd}` || !device.target}
                    className="text-xs w-full"
                  >
                    {loading === `${device.id}-${cmd.cmd}` ? (
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
