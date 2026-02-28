"use client"

import { useState, useEffect } from "react"
import { Search, Download, Filter, Terminal, Database } from "lucide-react"
import { TopHeader } from "@/components/top-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useLogs } from "@/hooks/use-api"
import { logLevelConfig, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

type Tab = "app" | "system"

function getBackendBase() {
  if (typeof window === "undefined") return ""
  return `http://${window.location.hostname}:8000`
}

export default function LogsPage() {
  const [tab, setTab] = useState<Tab>("app")
  const [source, setSource] = useState("all")
  const [level, setLevel] = useState("all")
  const [search, setSearch] = useState("")
  const [systemUnit, setSystemUnit] = useState("theia-api")
  const [systemLogs, setSystemLogs] = useState<string[]>([])
  const [systemLoading, setSystemLoading] = useState(false)

  const { data: logs, isLoading } = useLogs({
    source: source === "all" ? undefined : source,
    level: level === "all" ? undefined : level,
    search: search || undefined,
  })

  // Fetch Pi system logs -- only when tab is active and page is visible
  useEffect(() => {
    if (tab !== "system") return
    let cancelled = false
    async function load() {
      // Skip if page is hidden (user navigated away)
      if (document.hidden) return
      setSystemLoading(true)
      try {
        const base = getBackendBase()
        if (!base) return
        const token = localStorage.getItem("theia_token")
        const res = await fetch(`${base}/api/logs/system?unit=${systemUnit}&lines=300`, {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setSystemLogs(data.map((d: { line: string }) => d.line))
        }
      } catch { /* ignore */ }
      if (!cancelled) setSystemLoading(false)
    }
    load()
    const iv = setInterval(load, 10000)
    // Also pause/resume on visibility change
    const onVis = () => { if (!document.hidden && !cancelled) load() }
    document.addEventListener("visibilitychange", onVis)
    return () => { cancelled = true; clearInterval(iv); document.removeEventListener("visibilitychange", onVis) }
  }, [tab, systemUnit])

  function handleExport() {
    if (!logs) return
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}${l.details ? ` | ${l.details}` : ""}`)
      .join("\n")
    const blob = new Blob([text], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "theia-logs.txt"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <TopHeader title="Logs" description="Application, device et systeme" />
      <main className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-border pb-0">
            <button
              onClick={() => setTab("app")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors cursor-pointer -mb-px",
                tab === "app" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Database className="h-3 w-3" />
              Application
            </button>
            <button
              onClick={() => setTab("system")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors cursor-pointer -mb-px",
                tab === "system" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Terminal className="h-3 w-3" />
              Systeme (Pi)
            </button>
          </div>

          {/* App Logs Filters */}
          {tab === "app" && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Rechercher dans les logs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 bg-input/50 border-border text-sm h-8"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="h-8 w-28 text-xs bg-input/50 border-border">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                  <SelectItem value="api">API</SelectItem>
                  <SelectItem value="lora">LoRa</SelectItem>
                  <SelectItem value="gps">GPS</SelectItem>
                  <SelectItem value="mission">Mission</SelectItem>
                  <SelectItem value="device">Device</SelectItem>
                </SelectContent>
              </Select>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger className="h-8 w-28 text-xs bg-input/50 border-border">
                  <SelectValue placeholder="Level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Levels</SelectItem>
                  <SelectItem value="debug">Debug</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!logs || logs.length === 0} className="h-8">
              <Download className="mr-1.5 h-3 w-3" />
              Export
            </Button>
          </div>
          )}

          {/* System Logs Filters */}
          {tab === "system" && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={systemUnit} onValueChange={setSystemUnit}>
                <SelectTrigger className="h-8 w-36 text-xs bg-input/50 border-border font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="theia-api">theia-api</SelectItem>
                  <SelectItem value="theia-web">theia-web</SelectItem>
                  <SelectItem value="gpsd">gpsd</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Badge variant="outline" className="text-[10px] border-border">
              {systemLogs.length} lignes
            </Badge>
            {systemLoading && (
              <span className="text-[10px] text-muted-foreground animate-pulse">Chargement...</span>
            )}
          </div>
          )}

          {/* App Log viewer */}
          {tab === "app" && (
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                Log Entries
                <Badge variant="outline" className="text-[10px] border-border">
                  {logs?.length ?? 0} entries
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="h-96 animate-pulse m-4 rounded bg-muted" />
              ) : (
                <ScrollArea className="h-[calc(100vh-320px)]">
                  <div className="font-mono text-[12px] leading-relaxed">
                    {logs?.map((log) => {
                      const lvlCfg = logLevelConfig[log.level] ?? logLevelConfig.info
                      return (
                        <div
                          key={log.id}
                          className={cn(
                            "flex border-b border-border/20 px-4 py-2 hover:bg-muted/30 transition-colors",
                            log.level === "error" && "bg-destructive/5",
                            log.level === "critical" && "bg-destructive/10",
                          )}
                        >
                          <span className="w-36 shrink-0 text-muted-foreground tabular-nums">
                            {formatDateTime(log.timestamp)}
                          </span>
                          <span className={cn("w-12 shrink-0 text-center", lvlCfg.className)}>
                            {lvlCfg.label}
                          </span>
                          <Badge
                            variant="outline"
                            className="ml-2 mr-3 text-[9px] px-1 py-0 border-border shrink-0 self-start"
                          >
                            {log.source}
                          </Badge>
                          <span className="flex-1 text-foreground">
                            {log.message}
                            {log.details && (
                              <span className="ml-2 text-muted-foreground">
                                {log.details}
                              </span>
                            )}
                          </span>
                        </div>
                      )
                    })}
                    {(!logs || logs.length === 0) && (
                      <div className="py-12 text-center text-sm text-muted-foreground">
                        Aucune entree trouvee
                      </div>
                    )}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
          )}

          {/* System (Pi) Log viewer */}
          {tab === "system" && (
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Terminal className="h-4 w-4" />
                journalctl -u {systemUnit}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {systemLoading && systemLogs.length === 0 ? (
                <div className="h-96 animate-pulse m-4 rounded bg-muted" />
              ) : (
                <ScrollArea className="h-[calc(100vh-320px)]">
                  <div className="font-mono text-[11px] leading-5 p-1">
                    {systemLogs.map((line, i) => (
                      <div
                        key={i}
                        className={cn(
                          "px-3 py-0.5 hover:bg-muted/30 transition-colors whitespace-pre-wrap break-all",
                          line.includes("ERROR") && "text-destructive bg-destructive/5",
                          line.includes("WARNING") && "text-amber-500",
                          line.includes("[ERROR]") && "text-destructive",
                        )}
                      >
                        {line}
                      </div>
                    ))}
                    {systemLogs.length === 0 && (
                      <div className="py-12 text-center text-sm text-muted-foreground">
                        Aucun log systeme disponible
                      </div>
                    )}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
          )}
        </div>
      </main>
    </>
  )
}
