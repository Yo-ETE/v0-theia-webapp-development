"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, CheckCircle, Loader } from "lucide-react"

interface DeviceCommand {
  label: string
  device: string
  cmd: string
  variant?: "default" | "destructive" | "outline"
}

const DEVICE_COMMANDS: DeviceCommand[] = [
  // XAVER 01
  { label: "Status", device: "xaver01", cmd: "status", variant: "outline" },
  { label: "Restart", device: "xaver01", cmd: "restart", variant: "default" },
  { label: "Logs (50)", device: "xaver01", cmd: "logs", variant: "outline" },
  { label: "Process", device: "xaver01", cmd: "ps", variant: "outline" },

  // XAVER 02
  { label: "Status", device: "xaver02", cmd: "status", variant: "outline" },
  { label: "Restart", device: "xaver02", cmd: "restart", variant: "default" },
  { label: "Logs (50)", device: "xaver02", cmd: "logs", variant: "outline" },
  { label: "Process", device: "xaver02", cmd: "ps", variant: "outline" },

  // HUB
  { label: "Status", device: "hub", cmd: "status", variant: "outline" },
  { label: "Restart API", device: "hub", cmd: "restart-api", variant: "default" },
  { label: "Logs (50)", device: "hub", cmd: "logs", variant: "outline" },
]

function getBackendBase() {
  if (typeof window === "undefined") return ""
  return `http://${window.location.hostname}:8000`
}

export function DeviceControl() {
  const [loading, setLoading] = useState<string | null>(null)
  const [result, setResult] = useState<{ device: string; output: string; success: boolean } | null>(null)

  const handleCommand = async (device: string, cmd: string) => {
    const key = `${device}-${cmd}`
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
        body: JSON.stringify({ device, cmd }),
        credentials: "include",
      })

      const data = await res.json()
      setResult({
        device,
        output: data.output || `[Error ${res.status}] ${res.statusText}`,
        success: res.ok && data.returncode === 0,
      })
    } catch (e) {
      setResult({
        device,
        output: `[Exception] ${String(e)}`,
        success: false,
      })
    } finally {
      setLoading(null)
    }
  }

  const groupedCmds = {
    xaver01: DEVICE_COMMANDS.filter((c) => c.device === "xaver01"),
    xaver02: DEVICE_COMMANDS.filter((c) => c.device === "xaver02"),
    hub: DEVICE_COMMANDS.filter((c) => c.device === "hub"),
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* XAVER 01 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
              TX-XAVER01
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {groupedCmds.xaver01.map((cmd) => (
              <Button
                key={`${cmd.device}-${cmd.cmd}`}
                size="sm"
                variant={cmd.variant || "outline"}
                onClick={() => handleCommand(cmd.device, cmd.cmd)}
                disabled={loading === `${cmd.device}-${cmd.cmd}`}
                className="text-xs w-full"
              >
                {loading === `${cmd.device}-${cmd.cmd}` ? (
                  <Loader className="h-3 w-3 animate-spin mr-1" />
                ) : null}
                {cmd.label}
              </Button>
            ))}
          </CardContent>
        </Card>

        {/* XAVER 02 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
              TX-XAVER02
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {groupedCmds.xaver02.map((cmd) => (
              <Button
                key={`${cmd.device}-${cmd.cmd}`}
                size="sm"
                variant={cmd.variant || "outline"}
                onClick={() => handleCommand(cmd.device, cmd.cmd)}
                disabled={loading === `${cmd.device}-${cmd.cmd}`}
                className="text-xs w-full"
              >
                {loading === `${cmd.device}-${cmd.cmd}` ? (
                  <Loader className="h-3 w-3 animate-spin mr-1" />
                ) : null}
                {cmd.label}
              </Button>
            ))}
          </CardContent>
        </Card>

        {/* HUB */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
              HUB (192.168.84.179)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {groupedCmds.hub.map((cmd) => (
              <Button
                key={`${cmd.device}-${cmd.cmd}`}
                size="sm"
                variant={cmd.variant || "outline"}
                onClick={() => handleCommand(cmd.device, cmd.cmd)}
                disabled={loading === `${cmd.device}-${cmd.cmd}`}
                className="text-xs w-full"
              >
                {loading === `${cmd.device}-${cmd.cmd}` ? (
                  <Loader className="h-3 w-3 animate-spin mr-1" />
                ) : null}
                {cmd.label}
              </Button>
            ))}
          </CardContent>
        </Card>
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
