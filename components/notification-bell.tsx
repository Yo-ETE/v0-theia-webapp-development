"use client"

import { Bell, BellOff, Battery, Signal, Wifi, WifiOff, X } from "lucide-react"
import { useNotifications, useNotificationCount, type Notification } from "@/hooks/use-api"
import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

function getBackendBase(): string | null {
  if (typeof window === "undefined") return null
  return `http://${window.location.hostname}:8000`
}

async function apiPost(path: string) {
  const base = getBackendBase()
  if (!base) return
  await fetch(`${base}/api${path}`, { method: "POST", credentials: "include" })
}

async function apiDelete(path: string) {
  const base = getBackendBase()
  if (!base) return
  await fetch(`${base}/api${path}`, { method: "DELETE", credentials: "include" })
}

function notifIcon(type: string) {
  switch (type) {
    case "battery_low": return <Battery className="h-3.5 w-3.5" />
    case "rssi_weak": return <Signal className="h-3.5 w-3.5" />
    case "device_offline": return <WifiOff className="h-3.5 w-3.5" />
    case "device_online": return <Wifi className="h-3.5 w-3.5" />
    default: return <Bell className="h-3.5 w-3.5" />
  }
}

function severityColor(severity: string) {
  switch (severity) {
    case "critical": return "text-destructive"
    case "warning": return "text-amber-500"
    case "info": return "text-emerald-500"
    default: return "text-muted-foreground"
  }
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "maintenant"
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}j`
}

export function NotificationBell() {
  const { data: notifications, mutate: mutateNotifs } = useNotifications()
  const { data: countData, mutate: mutateCount } = useNotificationCount()
  const count = countData?.count ?? 0

  const handleDismissAll = async () => {
    await apiPost("/notifications/dismiss-all")
    mutateNotifs()
    mutateCount()
  }

  const handleReadAll = async () => {
    await apiPost("/notifications/read-all")
    mutateNotifs()
    mutateCount()
  }

  const handleDelete = async (id: number) => {
    await apiDelete(`/notifications/${id}`)
    mutateNotifs()
    mutateCount()
  }

  const items = notifications ?? []

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="relative flex items-center justify-center h-8 w-8 rounded-md hover:bg-sidebar-accent transition-colors cursor-pointer"
          aria-label="Notifications"
        >
          {count > 0 ? (
            <Bell className="h-4 w-4 text-sidebar-foreground" />
          ) : (
            <BellOff className="h-4 w-4 text-muted-foreground" />
          )}
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-[calc(100vw-2rem)] sm:w-80 max-h-[70vh] p-0 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-semibold text-foreground">Notifications</span>
          <div className="flex items-center gap-1">
            {count > 0 && (
              <button
                onClick={handleReadAll}
                className="text-[10px] text-primary hover:underline cursor-pointer px-1"
              >
                Tout lire
              </button>
            )}
            {items.length > 0 && (
              <button
                onClick={handleDismissAll}
                className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer px-1"
              >
                Tout effacer
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto max-h-[60vh] divide-y divide-border">
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              Aucune notification
            </div>
          ) : (
            items.map((n: Notification) => (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-2 px-3 py-2 transition-colors",
                  n.read === 0 && "bg-primary/5"
                )}
              >
                <div className={cn("mt-0.5 shrink-0", severityColor(n.severity))}>
                  {notifIcon(n.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-foreground leading-tight">{n.message}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5">
                    {n.device_name && <span className="font-mono">{n.device_name}</span>}
                    {n.device_name && " \u00b7 "}
                    {timeAgo(n.created_at)}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(n.id)}
                  className="shrink-0 text-muted-foreground/40 hover:text-destructive transition-colors cursor-pointer p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
