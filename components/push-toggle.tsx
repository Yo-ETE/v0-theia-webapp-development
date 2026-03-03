"use client"

import { Bell, BellOff, Loader2 } from "lucide-react"
import { usePushSubscription } from "@/hooks/use-push-subscription"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function PushToggle() {
  const { isSupported, isSubscribed, permission, isLoading, subscribe, unsubscribe } = usePushSubscription()

  if (!isSupported) return null

  const denied = permission === "denied"

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => {
            if (denied) return
            if (isSubscribed) unsubscribe()
            else subscribe()
          }}
          disabled={isLoading || denied}
          className={`flex items-center justify-center h-8 w-8 rounded-md transition-colors ${
            denied
              ? "text-muted-foreground/30 cursor-not-allowed"
              : isSubscribed
                ? "text-primary hover:bg-sidebar-accent"
                : "text-muted-foreground hover:bg-sidebar-accent"
          }`}
          aria-label={isSubscribed ? "Desactiver les notifications push" : "Activer les notifications push"}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isSubscribed ? (
            <Bell className="h-4 w-4" />
          ) : (
            <BellOff className="h-4 w-4" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {denied
          ? "Notifications bloquees par le navigateur"
          : isSubscribed
            ? "Notifications push activees"
            : "Activer les notifications push"
        }
      </TooltipContent>
    </Tooltip>
  )
}
