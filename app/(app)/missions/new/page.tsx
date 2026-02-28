"use client"

import { useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { TopHeader } from "@/components/top-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { MissionMap } from "@/components/mission/mission-map"
import { ErrorBoundary } from "@/components/error-boundary"
import { createMission } from "@/lib/api-client"
import type { EnvironmentType } from "@/lib/types"
import {
  ArrowLeft, ArrowRight, Save, Search, Crosshair,
  Building2, Home, Loader2, MapPin, Check, Warehouse,
  FileImage, Upload, X,
} from "lucide-react"

const STEPS = ["Info", "Type", "Location", "Review"] as const

interface GeoResult {
  display_name: string
  lat: string
  lon: string
}

export default function NewMissionPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [searching, setSearching] = useState(false)
  const [locatingGps, setLocatingGps] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<GeoResult[]>([])

  // Plan image for "plan" environment type
  const [planFile, setPlanFile] = useState<File | null>(null)
  const [planPreview, setPlanPreview] = useState<string | null>(null)
  const planInputRef = useRef<HTMLInputElement>(null)

  // Stable form ref so state persists perfectly across step changes
  const [form, setForm] = useState({
    name: "",
    description: "",
    location: "",
    environment: "habitation" as EnvironmentType,
    center_lat: 48.8566,
    center_lon: 2.3522,
    zoom: 19,
  })

  // Track whether user has explicitly set a position
  const positionSet = useRef(false)
  const mapKey = useRef(0)

  const setPosition = useCallback((lat: number, lon: number, label?: string) => {
    positionSet.current = true
    mapKey.current += 1
    setForm((f) => ({
      ...f,
      center_lat: lat,
      center_lon: lon,
      location: label ?? f.location,
    }))
  }, [])

  // Geocoding via server-side proxy to Nominatim
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    setSearchResults([])
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(searchQuery)}`)
      const data: GeoResult[] = await res.json()
      setSearchResults(data)
    } catch {
      // silent
    } finally {
      setSearching(false)
    }
  }, [searchQuery])

  const selectResult = useCallback((r: GeoResult) => {
    const label = r.display_name.split(",").slice(0, 3).join(",").trim()
    setPosition(parseFloat(r.lat), parseFloat(r.lon), label)
    setSearchResults([])
    setSearchQuery(label)
  }, [setPosition])

  // GPS position from Hub or browser
  const useGpsPosition = useCallback(async () => {
    setLocatingGps(true)
    try {
      const res = await fetch("/api/gps")
      const gps = await res.json()
      if (gps.fix && gps.latitude && gps.longitude) {
        setPosition(gps.latitude, gps.longitude, `GPS ${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`)
        setLocatingGps(false)
        return
      }
    } catch { /* fall through to browser */ }
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setPosition(pos.coords.latitude, pos.coords.longitude, `GPS ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`)
          setLocatingGps(false)
        },
        () => setLocatingGps(false),
        { enableHighAccuracy: true, timeout: 10000 }
      )
    } else {
      setLocatingGps(false)
    }
  }, [setPosition])

  // Handle plan image selection
  const handlePlanImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPlanFile(file)
    const url = URL.createObjectURL(file)
    setPlanPreview(url)
  }, [])

  // Submit
  async function handleSubmit() {
    setSaving(true)
    try {
      const mission = await createMission(form)
      // If plan type, upload the plan image DIRECTLY to backend BEFORE redirecting
      if (form.environment === "plan" && planFile && mission.id) {
        try {
          const backendBase = `http://${window.location.hostname}:8000`
          const uploadRes = await fetch(`${backendBase}/api/missions/${mission.id}/plan-image`, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": planFile.type || "application/octet-stream",
              "X-Filename": planFile.name,
            },
            body: planFile,
          })
          if (!uploadRes.ok) {
            const errTxt = await uploadRes.text().catch(() => "")
            console.error("[v0] Plan image upload failed:", uploadRes.status, errTxt)
          }
          // Small delay to ensure file is flushed to disk on the Pi
          await new Promise(r => setTimeout(r, 500))
        } catch (err) {
          console.error("[v0] Plan image upload error:", err)
        }
      }
      // Add timestamp param so the detail page PlanEditor doesn't use a cached 404
      const ts = form.environment === "plan" ? `?t=${Date.now()}` : ""
      router.push(`/missions/${mission.id}${ts}`)
    } catch (err) {
      console.error("Failed to create mission:", err)
    } finally {
      setSaving(false)
    }
  }

  const canNext =
    step === 0 ? form.name.trim().length > 0
    : step === 1 ? true  // Type step: always valid (has default)
    : step === 2 ? form.environment === "plan" ? !!planFile : (positionSet.current || (form.center_lat !== 48.8566 || form.center_lon !== 2.3522))
    : true

  return (
    <>
      <TopHeader title="New Mission" description="Mission creation wizard" />
      <main className="flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-3xl">
          <div className="mb-4">
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground">
              <Link href="/missions">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Back to missions
              </Link>
            </Button>
          </div>

          {/* Step indicator -- compact on mobile, full on desktop */}
          <div className="flex flex-wrap items-center gap-1 mb-5">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                <button
                  onClick={() => i < step && setStep(i)}
                  disabled={i > step}
                  className={`flex items-center gap-1 rounded-full min-h-[36px] px-2.5 sm:px-3 py-1 text-xs font-mono transition-colors ${
                    i === step
                      ? "bg-primary text-primary-foreground"
                      : i < step
                        ? "bg-primary/20 text-primary cursor-pointer hover:bg-primary/30"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i < step ? <Check className="h-3 w-3" /> : <span className="text-[10px]">{i + 1}</span>}
                  <span className={i !== step ? "hidden sm:inline" : ""}>{s}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={`h-px w-3 sm:w-6 ${i < step ? "bg-primary/50" : "bg-border"}`} />
                )}
              </div>
            ))}
          </div>

          {/* ── Step 0: Basic Info ── */}
          {step === 0 && (
            <Card className="border-border/50 bg-card">
              <CardHeader>
                <CardTitle className="text-sm">Mission Info</CardTitle>
                <CardDescription className="text-xs">
                  Name your mission and add a description.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="name" className="text-xs text-muted-foreground">Mission Name *</Label>
                  <Input
                    id="name"
                    placeholder="e.g. ALPHA-7"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="bg-input/50 border-border font-mono text-sm"
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="desc" className="text-xs text-muted-foreground">Description</Label>
                  <Textarea
                    id="desc"
                    placeholder="Brief description of the operation..."
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="bg-input/50 border-border text-sm min-h-20"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Step 2: Location / Plan ── */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Location</CardTitle>
                  <CardDescription className="text-xs">
                    Search an address, use Hub GPS, or enter coordinates manually.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {/* Search bar */}
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs text-muted-foreground">Address Search</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          placeholder="12 rue de la Paix, Paris..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                          className="bg-input/50 border-border text-sm pr-8"
                        />
                        {searching && (
                          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      <Button size="sm" variant="outline" onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
                        <Search className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={useGpsPosition} disabled={locatingGps} title="Use Hub GPS">
                        {locatingGps ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
                        <span className="ml-1 text-xs hidden sm:inline">GPS</span>
                      </Button>
                    </div>

                    {/* Search results */}
                    {searchResults.length > 0 && (
                      <div className="rounded-lg border border-border/50 bg-popover overflow-hidden max-h-48 overflow-y-auto">
                        {searchResults.map((r, i) => (
                          <button
                            key={i}
                            onClick={() => selectResult(r)}
                            className="w-full flex items-start gap-2 px-3 py-2 text-left text-xs hover:bg-accent transition-colors border-b border-border/30 last:border-0"
                          >
                            <MapPin className="h-3 w-3 shrink-0 mt-0.5 text-primary" />
                            <div className="min-w-0">
                              <span className="text-foreground block truncate">{r.display_name}</span>
                              <span className="text-[10px] font-mono text-muted-foreground">
                                {parseFloat(r.lat).toFixed(5)}, {parseFloat(r.lon).toFixed(5)}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Manual coordinates */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[10px] text-muted-foreground font-mono">Latitude</Label>
                      <Input
                        type="number"
                        step="0.000001"
                        value={form.center_lat}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value)
                          if (!isNaN(v)) { positionSet.current = true; setForm((f) => ({ ...f, center_lat: v })) }
                        }}
                        onBlur={() => { mapKey.current += 1; setForm((f) => ({ ...f })) }}
                        className="bg-input/50 border-border font-mono text-xs h-8"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[10px] text-muted-foreground font-mono">Longitude</Label>
                      <Input
                        type="number"
                        step="0.000001"
                        value={form.center_lon}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value)
                          if (!isNaN(v)) { positionSet.current = true; setForm((f) => ({ ...f, center_lon: v })) }
                        }}
                        onBlur={() => { mapKey.current += 1; setForm((f) => ({ ...f })) }}
                        className="bg-input/50 border-border font-mono text-xs h-8"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[10px] text-muted-foreground font-mono">Zoom</Label>
                      <Input
                        type="number" min={1} max={22}
                        value={form.zoom}
                        onChange={(e) => setForm((f) => ({ ...f, zoom: parseInt(e.target.value) || 19 }))}
                        className="bg-input/50 border-border font-mono text-xs h-8"
                      />
                    </div>
                  </div>

                  {/* Location label */}
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-[10px] text-muted-foreground">Location Label</Label>
                    <Input
                      placeholder="e.g. Zone Industrielle Nord"
                      value={form.location}
                      onChange={(e) => setForm({ ...form, location: e.target.value })}
                      className="bg-input/50 border-border text-xs h-8"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Plan image upload OR map preview */}
              {form.environment === "plan" ? (
                <Card className="border-border/50 bg-card">
                  <CardHeader className="py-2 px-4">
                    <CardTitle className="text-xs flex items-center gap-2">
                      <FileImage className="h-3.5 w-3.5" />
                      Plan du batiment
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {planPreview ? (
                      <div className="relative">
                        <img
                          src={planPreview}
                          alt="Plan du batiment"
                          className="w-full max-h-[350px] object-contain rounded-lg border border-border/50 bg-muted/20"
                        />
                        <button
                          onClick={() => { setPlanFile(null); setPlanPreview(null); if (planInputRef.current) planInputRef.current.value = "" }}
                          className="absolute top-2 right-2 h-8 w-8 flex items-center justify-center rounded-full bg-background/80 backdrop-blur-sm border border-border text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                        <p className="mt-2 text-[10px] text-muted-foreground text-center">
                          {planFile?.name} ({planFile ? (planFile.size / 1024).toFixed(0) : 0} Ko)
                        </p>
                      </div>
                    ) : (
                      <button
                        onClick={() => planInputRef.current?.click()}
                        className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border/50 p-8 hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer min-h-[200px]"
                      >
                        <Upload className="h-8 w-8 text-muted-foreground" />
                        <div className="text-center">
                          <p className="text-sm font-medium text-foreground">Importer un plan</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Photo de plan d'evacuation, plan architecte, etc.
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            JPG, PNG ou WebP
                          </p>
                        </div>
                      </button>
                    )}
                    <input
                      ref={planInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handlePlanImageChange}
                    />
                  </CardContent>
                </Card>
              ) : (
              <Card className="border-border/50 bg-card overflow-hidden">
                <CardHeader className="py-2 px-4">
                  <CardTitle className="text-xs flex items-center gap-2">
                    Map Preview
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 font-mono">
                      {form.center_lat.toFixed(5)}, {form.center_lon.toFixed(5)}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ErrorBoundary>
                    <MissionMap
                      key={mapKey.current}
                      centerLat={form.center_lat}
                      centerLon={form.center_lon}
                      zoom={form.zoom}
                      zones={[]}
                      className="h-[350px]"
                      onMapMove={(lat, lon, z) => {
                        positionSet.current = true
                        setForm((f) => ({ ...f, center_lat: lat, center_lon: lon, zoom: z }))
                      }}
                    />
                  </ErrorBoundary>
                </CardContent>
              </Card>
              )}
            </div>
          )}

          {/* ── Step 1: Environment Type ── */}
          {step === 1 && (
            <Card className="border-border/50 bg-card">
              <CardHeader>
                <CardTitle className="text-sm">Type de mission</CardTitle>
                <CardDescription className="text-xs">
                  Determine le mode de configuration des capteurs et le layout de visualisation.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Habitation */}
                <button
                  onClick={() => setForm({ ...form, environment: "habitation" })}
                  className={`flex flex-col gap-3 rounded-lg border-2 p-5 text-left transition-all ${
                    form.environment === "habitation"
                      ? "border-primary bg-primary/5"
                      : "border-border/50 bg-card hover:border-border"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`rounded-lg p-2 ${form.environment === "habitation" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <Home className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Habitation</p>
                      <p className="text-[10px] text-muted-foreground">Maison, villa, batiment</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Dessinez les zones sur la carte, definissez les facades et placez les TX sur chaque cote.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[9px] py-0">Zones sur carte</Badge>
                    <Badge variant="outline" className="text-[9px] py-0">Facades A/B/C/D</Badge>
                  </div>
                </button>

                {/* Garage / Souterrain */}
                <button
                  onClick={() => setForm({ ...form, environment: "garage" })}
                  className={`flex flex-col gap-3 rounded-lg border-2 p-5 text-left transition-all ${
                    form.environment === "garage"
                      ? "border-primary bg-primary/5"
                      : "border-border/50 bg-card hover:border-border"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`rounded-lg p-2 ${form.environment === "garage" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <Warehouse className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Garage / Souterrain</p>
                      <p className="text-[10px] text-muted-foreground">Parking, tunnel, rangee</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Definissez le nombre de troncons cote a cote et assignez les TX par troncon.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[9px] py-0">Troncons horizontaux</Badge>
                    <Badge variant="outline" className="text-[9px] py-0">TX par troncon</Badge>
                  </div>
                </button>

                {/* Etages */}
                <button
                  onClick={() => setForm({ ...form, environment: "etages" })}
                  className={`flex flex-col gap-3 rounded-lg border-2 p-5 text-left transition-all ${
                    form.environment === "etages"
                      ? "border-primary bg-primary/5"
                      : "border-border/50 bg-card hover:border-border"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`rounded-lg p-2 ${form.environment === "etages" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Etages</p>
                      <p className="text-[10px] text-muted-foreground">Immeuble, cage d'escalier</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Definissez le nombre d'etages empiles verticalement et assignez les TX par etage.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[9px] py-0">Etages empiles</Badge>
                    <Badge variant="outline" className="text-[9px] py-0">TX par etage</Badge>
                  </div>
                </button>

                {/* Sur Plan */}
                <button
                  onClick={() => setForm({ ...form, environment: "plan" })}
                  className={`flex flex-col gap-3 rounded-lg border-2 p-5 text-left transition-all ${
                    form.environment === "plan"
                      ? "border-primary bg-primary/5"
                      : "border-border/50 bg-card hover:border-border"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`rounded-lg p-2 ${form.environment === "plan" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <FileImage className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Sur Plan</p>
                      <p className="text-[10px] text-muted-foreground">Plan de batiment, evacuation</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Importez une photo de plan et dessinez les zones directement dessus. Meme principe que Habitation.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[9px] py-0">Plan importe</Badge>
                    <Badge variant="outline" className="text-[9px] py-0">Zones + Facades</Badge>
                  </div>
                </button>
              </CardContent>
            </Card>
          )}

          {/* ── Step 3: Review ── */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <Card className="border-border/50 bg-card">
                <CardHeader>
                  <CardTitle className="text-sm">Review Mission</CardTitle>
                  <CardDescription className="text-xs">
                    Verify before creation. Zones and TX devices are configured after.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded border border-border/50 p-3">
                      <p className="text-[10px] text-muted-foreground mb-1">Mission</p>
                      <p className="text-sm font-mono text-foreground">{form.name}</p>
                    </div>
                    <div className="rounded border border-border/50 p-3">
                      <p className="text-[10px] text-muted-foreground mb-1">Type</p>
                      <div className="flex items-center gap-1.5">
                        {form.environment === "habitation" && <Home className="h-3.5 w-3.5 text-primary" />}
                        {form.environment === "garage" && <Warehouse className="h-3.5 w-3.5 text-primary" />}
                        {form.environment === "etages" && <Building2 className="h-3.5 w-3.5 text-primary" />}
                        {form.environment === "plan" && <FileImage className="h-3.5 w-3.5 text-primary" />}
                        <p className="text-sm text-foreground capitalize">
                          {{ habitation: "Habitation", garage: "Garage / Souterrain", etages: "Etages", plan: "Sur Plan" }[form.environment] ?? form.environment}
                        </p>
                      </div>
                    </div>
                    <div className="rounded border border-border/50 p-3 col-span-2">
                      <p className="text-[10px] text-muted-foreground mb-1">Location</p>
                      <p className="text-xs text-foreground">{form.location || "---"}</p>
                      <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                        {form.center_lat.toFixed(5)}, {form.center_lon.toFixed(5)} z{form.zoom}
                      </p>
                    </div>
                    {form.description && (
                      <div className="rounded border border-border/50 p-3 col-span-2">
                        <p className="text-[10px] text-muted-foreground mb-1">Description</p>
                        <p className="text-xs text-foreground">{form.description}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card overflow-hidden">
                <CardContent className="p-0">
                  {form.environment === "plan" && planPreview ? (
                    <img
                      src={planPreview}
                      alt="Plan du batiment"
                      className="w-full max-h-[300px] object-contain bg-muted/20"
                    />
                  ) : (
                    <ErrorBoundary>
                      <MissionMap
                        key={`review-${form.center_lat}-${form.center_lon}`}
                        centerLat={form.center_lat}
                        centerLon={form.center_lon}
                        zoom={form.zoom}
                        zones={[]}
                        className="h-[300px]"
                      />
                    </ErrorBoundary>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between items-center mt-5 pt-4 border-t border-border/50">
            <Button
              variant="ghost" size="sm"
              onClick={() => step > 0 ? setStep(step - 1) : router.push("/missions")}
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              {step === 0 ? "Cancel" : "Previous"}
            </Button>

            {step < STEPS.length - 1 ? (
              <Button size="sm" onClick={() => setStep(step + 1)} disabled={!canNext}>
                Next
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button size="sm" onClick={handleSubmit} disabled={saving || !form.name}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {saving ? "Creating..." : "Create Mission"}
              </Button>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
