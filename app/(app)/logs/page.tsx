"use client"

import { useState } from "react"
import { Search, Download, Filter } from "lucide-react"
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

export default function LogsPage() {
  const [source, setSource] = useState("all")
  const [level, setLevel] = useState("all")
  const [search, setSearch] = useState("")

  const { data: logs, isLoading } = useLogs({
    source: source === "all" ? undefined : source,
    level: level === "all" ? undefined : level,
    search: search || undefined,
  })

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
      <TopHeader title="Logs" description="System, API, and LoRa logs" />
      <main className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
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

          {/* Log viewer */}
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
                <ScrollArea className="h-[calc(100vh-280px)]">
                  <div className="font-mono text-[12px] leading-relaxed">
                    {logs?.map((log) => {
                      const lvlCfg = logLevelConfig[log.level]
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
                        No log entries found
                      </div>
                    )}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  )
}
