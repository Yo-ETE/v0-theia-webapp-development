"use client"

import { useState, useEffect, useCallback } from "react"
import { MessageSquare, Save, Loader2, Send, CheckCircle2, AlertCircle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

function _getApi(): string {
  if (typeof window === "undefined") return "http://localhost:8000"
  return `http://${window.location.hostname}:8000`
}
function _bH(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("theia_token") : null
  return t ? { Authorization: `Bearer ${t}` } : {}
}

interface SmsConfigData {
  provider: string
  free_user: string
  free_api_key: string
  twilio_sid: string
  twilio_token: string
  twilio_from: string
  ntfy_server: string
  ntfy_topic: string
}

const DEFAULT_CONFIG: SmsConfigData = {
  provider: "",
  free_user: "",
  free_api_key: "",
  twilio_sid: "",
  twilio_token: "",
  twilio_from: "",
  ntfy_server: "https://ntfy.sh",
  ntfy_topic: "theia",
}

export function SmsConfig() {
  const [config, setConfig] = useState<SmsConfigData>(DEFAULT_CONFIG)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(`${_getApi()}/api/admin/sms-config`, { credentials: "include", headers: _bH() })
      if (res.ok) {
        const data = await res.json()
        setConfig({ ...DEFAULT_CONFIG, ...data })
      }
    } catch {
      /* ignore - may not exist yet */
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`${_getApi()}/api/admin/sms-config`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ..._bH() },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setMessage({ type: "success", text: "Configuration SMS enregistree" })
      } else {
        setMessage({ type: "error", text: "Erreur lors de la sauvegarde" })
      }
    } catch {
      setMessage({ type: "error", text: "Erreur reseau" })
    }
    setSaving(false)
  }

  const test = async () => {
    setTesting(true)
    setMessage(null)
    try {
      const res = await fetch(`${_getApi()}/api/admin/sms-test`, {
        method: "POST",
        credentials: "include",
        headers: _bH(),
      })
      const data = await res.json()
      if (data.ok) {
        setMessage({ type: "success", text: "SMS de test envoye avec succes" })
      } else {
        setMessage({ type: "error", text: data.detail || "Echec de l'envoi" })
      }
    } catch {
      setMessage({ type: "error", text: "Erreur reseau" })
    }
    setTesting(false)
  }

  const update = (key: keyof SmsConfigData, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader>
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">Configuration SMS</CardTitle>
            <CardDescription className="truncate">Provider pour les alertes SMS de detection</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Provider select */}
        <div className="space-y-1">
          <Label className="text-xs">Provider</Label>
          <Select value={config.provider} onValueChange={(v) => update("provider", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Choisir un provider..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="free_mobile">Free Mobile (France, gratuit)</SelectItem>
              <SelectItem value="twilio">Twilio (International, payant)</SelectItem>
              <SelectItem value="ntfy">ntfy.sh (Push, gratuit)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Free Mobile config */}
        {config.provider === "free_mobile" && (
          <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3">
            <p className="text-[10px] text-muted-foreground">
              Identifiants Free Mobile SMS API (gratuit pour les abonnes Free).
              Activable dans votre espace abonne : Mes Options &gt; Notifications par SMS.
            </p>
            <div className="space-y-1">
              <Label htmlFor="sms-free-user" className="text-xs">Identifiant utilisateur</Label>
              <Input id="sms-free-user" name="free_user" className="h-8 text-xs" value={config.free_user} onChange={(e) => update("free_user", e.target.value)} placeholder="12345678" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sms-free-key" className="text-xs">Cle API</Label>
              <Input id="sms-free-key" name="free_api_key" className="h-8 text-xs" type="password" value={config.free_api_key} onChange={(e) => update("free_api_key", e.target.value)} placeholder="xxxxxxxxxxxx" />
            </div>
          </div>
        )}

        {/* Twilio config */}
        {config.provider === "twilio" && (
          <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3">
            <div className="space-y-1">
              <Label htmlFor="sms-twilio-sid" className="text-xs">Account SID</Label>
              <Input id="sms-twilio-sid" name="twilio_sid" className="h-8 text-xs" value={config.twilio_sid} onChange={(e) => update("twilio_sid", e.target.value)} placeholder="AC..." />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sms-twilio-token" className="text-xs">Auth Token</Label>
              <Input id="sms-twilio-token" name="twilio_token" className="h-8 text-xs" type="password" value={config.twilio_token} onChange={(e) => update("twilio_token", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sms-twilio-from" className="text-xs">Numero expediteur</Label>
              <Input id="sms-twilio-from" name="twilio_from" className="h-8 text-xs" value={config.twilio_from} onChange={(e) => update("twilio_from", e.target.value)} placeholder="+1234567890" />
            </div>
          </div>
        )}

        {/* ntfy config */}
        {config.provider === "ntfy" && (
          <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3">
            <p className="text-[10px] text-muted-foreground">
              ntfy.sh est un service de notifications push gratuit et auto-hebergeable.
            </p>
            <div className="space-y-1">
              <Label htmlFor="sms-ntfy-server" className="text-xs">Serveur</Label>
              <Input id="sms-ntfy-server" name="ntfy_server" className="h-8 text-xs" value={config.ntfy_server} onChange={(e) => update("ntfy_server", e.target.value)} placeholder="https://ntfy.sh" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sms-ntfy-topic" className="text-xs">Topic</Label>
              <Input id="sms-ntfy-topic" name="ntfy_topic" className="h-8 text-xs" value={config.ntfy_topic} onChange={(e) => update("ntfy_topic", e.target.value)} placeholder="theia" />
            </div>
          </div>
        )}

        {message && (
          <div className={`flex items-center gap-2 text-xs ${message.type === "success" ? "text-green-500" : "text-destructive"}`}>
            {message.type === "success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            {message.text}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={save} disabled={saving || !config.provider} size="sm" className="flex-1 text-xs">
            {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
            Enregistrer
          </Button>
          <Button onClick={test} disabled={testing || !config.provider} variant="outline" size="sm" className="text-xs">
            {testing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
            Test
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
