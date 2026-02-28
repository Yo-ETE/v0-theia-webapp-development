"use client"

import { useState, useEffect, useCallback } from "react"
import { Bell, BellOff, Save, Loader2, Smartphone, SendHorizonal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePushSubscription } from "@/hooks/use-push-subscription"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

function _getApi(): string {
  if (typeof window === "undefined") return "http://localhost:8000"
  return `http://${window.location.hostname}:8000`
}
function _bH(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("theia_token") : null
  return t ? { Authorization: `Bearer ${t}` } : {}
}

interface NotificationConfigData {
  enabled: boolean
  cooldown_minutes: number
  channels: string[]
  zones: string[]
}

interface Props {
  missionId: string
  missionName: string
  zones?: { id: string; label: string }[]
  initialConfig?: NotificationConfigData | null
  onSaved?: () => void
}

export function NotificationConfig({ missionId, missionName, zones = [], initialConfig, onSaved }: Props) {
  const { isSupported: pushSupported, isSubscribed: pushSubscribed, permission: pushPermission, subscribe: pushSubscribe } = usePushSubscription()
  const [testingSend, setTestingSend] = useState(false)

  const sendTestPush = useCallback(async () => {
    setTestingSend(true)
    try {
      await fetch(`${_getApi()}/api/push/test`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ..._bH() },
      })
    } catch (e) {
      console.error("[THEIA] Test push error:", e)
    }
    setTestingSend(false)
  }, [])

  const [config, setConfig] = useState<NotificationConfigData>(
    initialConfig || {
      enabled: false,
      cooldown_minutes: 5,
      channels: ["web_push"],
      zones: ["all"],
    }
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (initialConfig) setConfig(initialConfig)
  }, [initialConfig])

  const toggleChannel = (channel: string) => {
    setConfig((prev) => ({
      ...prev,
      channels: prev.channels.includes(channel)
        ? prev.channels.filter((c) => c !== channel)
        : [...prev.channels, channel],
    }))
  }

  const toggleZone = (zoneId: string) => {
    setConfig((prev) => {
      if (zoneId === "all") return { ...prev, zones: ["all"] }
      const withoutAll = prev.zones.filter((z) => z !== "all")
      const has = withoutAll.includes(zoneId)
      const newZones = has ? withoutAll.filter((z) => z !== zoneId) : [...withoutAll, zoneId]
      return { ...prev, zones: newZones.length === 0 ? ["all"] : newZones }
    })
  }

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await fetch(`${_getApi()}/api/missions/${missionId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ..._bH() },
        body: JSON.stringify({ notification_config: JSON.stringify(config) }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved?.()
    } catch (e) {
      console.error("[THEIA] Save notification config error:", e)
    }
    setSaving(false)
  }, [missionId, config, onSaved])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          {config.enabled ? <Bell className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
          Notifications - {missionName}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <Label htmlFor={`notif-enable-${missionId}`} className="text-xs">Notifications actives</Label>
          <Switch
            id={`notif-enable-${missionId}`}
            checked={config.enabled}
            onCheckedChange={(v) => setConfig((p) => ({ ...p, enabled: v }))}
          />
        </div>

        {config.enabled && (
          <>
            {/* Cooldown */}
            <div className="space-y-1">
              <Label className="text-xs">Delai minimum entre alertes (min)</Label>
              <Input
                type="number"
                min={1}
                max={60}
                value={config.cooldown_minutes}
                onChange={(e) => setConfig((p) => ({ ...p, cooldown_minutes: parseInt(e.target.value) || 5 }))}
                className="h-8 text-xs"
              />
            </div>

            {/* Channels */}
            <div className="space-y-2">
              <Label className="text-xs">Canaux</Label>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.channels.includes("web_push")}
                    onChange={() => toggleChannel("web_push")}
                    className="rounded border-border"
                  />
                  Web Push
                </label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.channels.includes("sms")}
                    onChange={() => toggleChannel("sms")}
                    className="rounded border-border"
                  />
                  SMS
                </label>
              </div>

              {/* Push subscription status */}
              {config.channels.includes("web_push") && (
                <div className="rounded-md border border-border/50 bg-muted/30 p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground">
                      {!pushSupported
                        ? "Push non supporte sur ce navigateur"
                        : pushPermission === "denied"
                          ? "Notifications bloquees dans les parametres du navigateur"
                          : pushSubscribed
                            ? "Push actif sur cet appareil"
                            : "Push non active sur cet appareil"
                      }
                    </span>
                    {pushSupported && pushPermission !== "denied" && !pushSubscribed && (
                      <button
                        onClick={pushSubscribe}
                        className="text-[10px] text-primary hover:underline cursor-pointer ml-auto"
                      >
                        Activer
                      </button>
                    )}
                  </div>
                  {pushSubscribed && (
                    <button
                      onClick={sendTestPush}
                      disabled={testingSend}
                      className="flex items-center gap-1.5 text-[10px] text-primary hover:underline cursor-pointer disabled:opacity-50"
                    >
                      {testingSend ? <Loader2 className="h-3 w-3 animate-spin" /> : <SendHorizonal className="h-3 w-3" />}
                      Envoyer un push de test
                    </button>
                  )}
                  {pushSupported && pushPermission !== "denied" && (
                    <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                      {"Sur iPhone, ajoutez THEIA a l'ecran d'accueil pour recevoir les notifications en arriere-plan."}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Zones filter */}
            {zones.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs">Zones surveillees</Label>
                <div className="flex flex-wrap gap-2">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.zones.includes("all")}
                      onChange={() => toggleZone("all")}
                      className="rounded border-border"
                    />
                    Toutes
                  </label>
                  {zones.map((z) => (
                    <label key={z.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.zones.includes(z.id)}
                        onChange={() => toggleZone(z.id)}
                        className="rounded border-border"
                      />
                      {z.label || z.id}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Save */}
        <Button onClick={save} disabled={saving} size="sm" className="w-full text-xs">
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
          {saved ? "Enregistre" : "Enregistrer"}
        </Button>
      </CardContent>
    </Card>
  )
}
