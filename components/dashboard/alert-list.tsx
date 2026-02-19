"use client"

import { AlertTriangle, Info, AlertCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { Alert } from "@/lib/types"

const severityConfig = {
  critical: {
    icon: AlertCircle,
    color: "text-destructive",
    bg: "bg-destructive/10",
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-warning",
    bg: "bg-warning/10",
    badge: "border-warning/30 bg-warning/10 text-warning",
  },
  info: {
    icon: Info,
    color: "text-info",
    bg: "bg-info/10",
    badge: "border-info/30 bg-info/10 text-info",
  },
}

function formatRelativeTime(timestamp: string) {
  const diff = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function AlertList({ alerts }: { alerts: Alert[] }) {
  const activeAlerts = alerts.filter((a) => !a.acknowledged)

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          Alerts
          {activeAlerts.length > 0 && (
            <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive text-[10px]">
              {activeAlerts.length} active
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No alerts
          </p>
        ) : (
          alerts.map((alert) => {
            const config = severityConfig[alert.severity]
            const Icon = config.icon
            return (
              <div
                key={alert.id}
                className={cn(
                  "flex items-start gap-3 rounded-lg border border-border/50 p-3",
                  alert.acknowledged && "opacity-50",
                )}
              >
                <div className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded", config.bg)}>
                  <Icon className={cn("h-3.5 w-3.5", config.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground">{alert.message}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="outline" className={cn("text-[9px] px-1 py-0", config.badge)}>
                      {alert.severity.toUpperCase()}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {alert.source}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatRelativeTime(alert.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
