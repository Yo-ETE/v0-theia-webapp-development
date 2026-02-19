"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
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
  ArrowLeft,
  ArrowRight,
  Save,
  Search,
  Crosshair,
  Building2,
  Home,
  Loader2,
} from "lucide-react"
import Link from "next/link"

const STEPS = ["Info", "Location", "Type", "Review"] as const

export default function NewMissionPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [searching, setSearching] = useState(false)
  const [locatingGps, setLocatingGps] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<
    { display_name: string; lat: string; lon: string }[]
  >([])

  const [form, setForm] = useState({
    name: "",
    description: "",
    location: "",
    environment: "horizontal" as EnvironmentType,
    center_lat: 48.8566,
    center_lon: 2.3522,
    zoom: 19,
  })

  // ── Geocoding via Nominatim ───────────────────────────────────
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    setSearchResults([])
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`,
        { headers: { "User-Agent": "THEIA-Hub/1.0" } }
      )
      const data = await res.json()
      setSearchResults(data)
      if (data.length > 0) {
        const top = data[0]
        setForm((f) => ({
          ...f,
          center_lat: parseFloat(top.lat),
          center_lon: parseFloat(top.lon),
          location: top.display_name.split(",").slice(0, 3).join(",").trim(),
        }))
      }
    } catch {
      // Nominatim may fail silently
    } finally {
      setSearching(false)
    }
  }, [searchQuery])

  const selectResult = (r: { display_name: string; lat: string; lon: string }) => {
    setForm((f) => ({
      ...f,
      center_lat: parseFloat(r.lat),
      center_lon: parseFloat(r.lon),
      location: r.display_name.split(",").slice(0, 3).join(",").trim(),
    }))
    setSearchResults([])
  }

  // ── Use GPS position ──────────────────────────────────────────
  const useGpsPosition = useCallback(async () => {
    setLocatingGps(true)
    try {
      const res = await fetch("/api/gps")
      const gps = await res.json()
      if (gps.fix && gps.latitude && gps.longitude) {
        setForm((f) => ({
          ...f,
          center_lat: gps.latitude,
          center_lon: gps.longitude,
          location: f.location || `GPS ${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`,
        }))
      } else {
        // Fallback: browser geolocation
        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              setForm((f) => ({
                ...f,
                center_lat: pos.coords.latitude,
                center_lon: pos.coords.longitude,
                location: f.location || `GPS ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
              }))
            },
            () => {}
          )
        }
      }
    } catch {
      // If GPS API fails, try browser geolocation
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setForm((f) => ({
              ...f,
              center_lat: pos.coords.latitude,
              center_lon: pos.coords.longitude,
              location: f.location || `GPS ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
            }))
          },
          () => {}
        )
      }
    } finally {
      setLocatingGps(false)
    }
  }, [])

  // ── Submit ────────────────────────────────────────────────────
  async function handleSubmit() {
    setSaving(true)
    try {
      console.log("[v0] Creating mission with:", JSON.stringify({ lat: form.center_lat, lon: form.center_lon, zoom: form.zoom }))
      const mission = await createMission(form)
      console.log("[v0] Created mission:", mission.id, "lat:", mission.center_lat, "lon:", mission.center_lon)
      router.push(`/missions/${mission.id}`)
    } catch (err) {
      console.error("Failed to create mission:", err)
    } finally {
      setSaving(false)
    }
  }

  const canNext =
    step === 0
      ? form.name.trim().length > 0
      : step === 1
        ? form.center_lat !== 0 && form.center_lon !== 0
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

          {/* Step indicator */}
          <div className="flex items-center gap-1 mb-5">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                <button
                  onClick={() => i < step && setStep(i)}
                  disabled={i > step}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-mono transition-colors ${
                    i === step
                      ? "bg-primary text-primary-foreground"
                      : i < step
                        ? "bg-primary/20 text-primary cursor-pointer hover:bg-primary/30"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  <span className="text-[10px]">{i + 1}</span>
                  {s}
                </button>
                {i < STEPS.length - 1 && (
                  <div className={`h-px w-6 ${i < step ? "bg-primary/50" : "bg-border"}`} />
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
                  <Label htmlFor="name" className="text-xs text-muted-foreground">
                    Mission Name *
                  </Label>
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
                  <Label htmlFor="description" className="text-xs text-muted-foreground">
                    Description
                  </Label>
                  <Textarea
                    id="description"
                    placeholder="Brief description of the operation..."
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="bg-input/50 border-border text-sm min-h-20"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Step 1: Location ── */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <Card className="border-border/50 bg-card">
                <CardHeader>
                  <CardTitle className="text-sm">Location</CardTitle>
                  <CardDescription className="text-xs">
                    Search an address, use GPS position, or enter coordinates manually.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {/* Address search */}
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs text-muted-foreground">Search Address</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g. 12 rue de la Paix, Paris"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                        className="bg-input/50 border-border text-sm flex-1"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSearch}
                        disabled={searching || !searchQuery.trim()}
                        className="shrink-0"
                      >
                        {searching ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Search className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={useGpsPosition}
                        disabled={locatingGps}
                        className="shrink-0"
                        title="Use GPS / Hub position"
                      >
                        {locatingGps ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Crosshair className="h-3.5 w-3.5" />
                        )}
                        <span className="ml-1.5 text-xs hidden sm:inline">GPS</span>
                      </Button>
                    </div>

                    {/* Search results dropdown */}
                    {searchResults.length > 0 && (
                      <div className="rounded-lg border border-border/50 bg-popover overflow-hidden">
                        {searchResults.map((r, i) => (
                          <button
                            key={i}
                            onClick={() => selectResult(r)}
                            className="w-full px-3 py-2 text-left text-xs hover:bg-accent transition-colors border-b border-border/30 last:border-0"
                          >
                            <span className="text-foreground">{r.display_name}</span>
                            <span className="block text-[10px] font-mono text-muted-foreground mt-0.5">
                              {parseFloat(r.lat).toFixed(5)}, {parseFloat(r.lon).toFixed(5)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Manual coords */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[10px] text-muted-foreground font-mono">Latitude</Label>
                      <Input
                        type="number"
                        step="0.000001"
                        value={form.center_lat}
                        onChange={(e) => setForm({ ...form, center_lat: parseFloat(e.target.value) || 0 })}
                        className="bg-input/50 border-border font-mono text-xs h-8"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[10px] text-muted-foreground font-mono">Longitude</Label>
                      <Input
                        type="number"
                        step="0.000001"
                        value={form.center_lon}
                        onChange={(e) => setForm({ ...form, center_lon: parseFloat(e.target.value) || 0 })}
                        className="bg-input/50 border-border font-mono text-xs h-8"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[10px] text-muted-foreground font-mono">Zoom</Label>
                      <Input
                        type="number"
                        min={1}
                        max={22}
                        value={form.zoom}
                        onChange={(e) => setForm({ ...form, zoom: parseInt(e.target.value) || 17 })}
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

              {/* Live map preview */}
              <Card className="border-border/50 bg-card">
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
                      centerLat={form.center_lat}
                      centerLon={form.center_lon}
                      zoom={form.zoom}
                      zones={[]}
                      className="h-[300px]"
                    />
                  </ErrorBoundary>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── Step 2: Environment Type ── */}
          {step === 2 && (
            <Card className="border-border/50 bg-card">
              <CardHeader>
                <CardTitle className="text-sm">Environment Type</CardTitle>
                <CardDescription className="text-xs">
                  Choose how sensors will be arranged. This determines zone layout and triangulation logic.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Horizontal */}
                <button
                  onClick={() => setForm({ ...form, environment: "horizontal" })}
                  className={`flex flex-col gap-3 rounded-lg border-2 p-5 text-left transition-all ${
                    form.environment === "horizontal"
                      ? "border-primary bg-primary/5"
                      : "border-border/50 bg-card hover:border-border"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`rounded-lg p-2 ${
                      form.environment === "horizontal" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                    }`}>
                      <Home className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Horizontal</p>
                      <p className="text-[10px] text-muted-foreground">Plan view / ground level</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      House, garage row, corridor, perimeter. Sensors placed on facades, walls, or segments.
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <Badge variant="outline" className="text-[9px] py-0">Facades</Badge>
                      <Badge variant="outline" className="text-[9px] py-0">Perimeter</Badge>
                      <Badge variant="outline" className="text-[9px] py-0">Triangulation 2D</Badge>
                    </div>
                  </div>
                </button>

                {/* Vertical */}
                <button
                  onClick={() => setForm({ ...form, environment: "vertical" })}
                  className={`flex flex-col gap-3 rounded-lg border-2 p-5 text-left transition-all ${
                    form.environment === "vertical"
                      ? "border-primary bg-primary/5"
                      : "border-border/50 bg-card hover:border-border"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`rounded-lg p-2 ${
                      form.environment === "vertical" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                    }`}>
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Vertical</p>
                      <p className="text-[10px] text-muted-foreground">Multi-floor / stairwell</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Staircase, building floors, landings. Sensors placed on specific floors/levels.
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <Badge variant="outline" className="text-[9px] py-0">Floors</Badge>
                      <Badge variant="outline" className="text-[9px] py-0">Landings</Badge>
                      <Badge variant="outline" className="text-[9px] py-0">Vertical tracking</Badge>
                    </div>
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
                    Verify all parameters before creating. Zones and devices can be configured after creation.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded border border-border/50 p-3">
                      <p className="text-[10px] text-muted-foreground mb-1">Mission Name</p>
                      <p className="text-sm font-mono text-foreground">{form.name}</p>
                    </div>
                    <div className="rounded border border-border/50 p-3">
                      <p className="text-[10px] text-muted-foreground mb-1">Environment</p>
                      <div className="flex items-center gap-1.5">
                        {form.environment === "horizontal" ? (
                          <Home className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <Building2 className="h-3.5 w-3.5 text-primary" />
                        )}
                        <p className="text-sm text-foreground capitalize">{form.environment}</p>
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

              {/* Map preview */}
              <Card className="border-border/50 bg-card">
                <CardContent className="p-0">
                  <ErrorBoundary>
                    <MissionMap
                      centerLat={form.center_lat}
                      centerLon={form.center_lon}
                      zoom={form.zoom}
                      zones={[]}
                      className="h-[250px]"
                    />
                  </ErrorBoundary>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex justify-between items-center mt-5 pt-4 border-t border-border/50">
            <Button
              variant="ghost"
              size="sm"
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
