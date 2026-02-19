"use client"

import { use } from "react"
import Link from "next/link"
import { ArrowLeft, Download } from "lucide-react"
import { TopHeader } from "@/components/top-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useMission, useEvents } from "@/hooks/use-api"
import { eventTypeConfig, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

export default function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: mission } = useMission(id)
  const { data: events, isLoading } = useEvents({ mission_id: id })

  function handleExport() {
    if (!events) return
    const csv = [
      "timestamp,type,device,zone,rssi,snr,payload",
      ...events.map((e) =>
        [
          e.timestamp,
          e.type,
          e.device_name,
          e.zone_label ?? "",
          e.rssi ?? "",
          e.snr ?? "",
          JSON.stringify(e.payload),
        ].join(","),
      ),
    ].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${mission?.name ?? "events"}-history.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <TopHeader
        title={mission ? `${mission.name} - History` : "History"}
        description="Event timeline and detection history"
      />
      <main className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground">
              <Link href={`/missions/${id}`}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Back to mission
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!events || events.length === 0}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>

          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Events ({events?.length ?? 0})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-48 animate-pulse rounded bg-muted" />
              ) : !events || events.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No events recorded for this mission
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead className="text-[10px]">Time</TableHead>
                      <TableHead className="text-[10px]">Type</TableHead>
                      <TableHead className="text-[10px]">Device</TableHead>
                      <TableHead className="text-[10px]">Zone</TableHead>
                      <TableHead className="text-[10px]">RSSI</TableHead>
                      <TableHead className="text-[10px]">SNR</TableHead>
                      <TableHead className="text-[10px]">Payload</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((evt) => {
                      const evtCfg = eventTypeConfig[evt.type]
                      return (
                        <TableRow key={evt.id} className="border-border/30">
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {formatDateTime(evt.timestamp)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn("text-[9px] px-1 py-0", evtCfg.className)}
                            >
                              {evtCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-foreground">
                            {evt.device_name}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {evt.zone_label ?? "---"}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-foreground">
                            {evt.rssi !== null ? `${evt.rssi}` : "---"}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-foreground">
                            {evt.snr !== null ? `${evt.snr}` : "---"}
                          </TableCell>
                          <TableCell className="font-mono text-[10px] text-muted-foreground max-w-48 truncate">
                            {JSON.stringify(evt.payload)}
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
