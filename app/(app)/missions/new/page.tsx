"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { TopHeader } from "@/components/top-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createMission } from "@/lib/api-client"
import { ArrowLeft, Save } from "lucide-react"
import Link from "next/link"

export default function NewMissionPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: "",
    description: "",
    location: "",
    center_lat: 48.8566,
    center_lon: 2.3522,
    zoom: 16,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const mission = await createMission(form)
      router.push(`/missions/${mission.id}`)
    } catch (err) {
      console.error("Failed to create mission:", err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <TopHeader title="New Mission" description="Create a new surveillance operation" />
      <main className="flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4">
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground">
              <Link href="/missions">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Back to missions
              </Link>
            </Button>
          </div>

          <Card className="border-border/50 bg-card">
            <CardHeader>
              <CardTitle className="text-sm">Mission Configuration</CardTitle>
              <CardDescription className="text-xs">
                Define the basic parameters for your new mission. Zones and devices can be configured after creation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="name" className="text-xs text-muted-foreground">
                    Mission Name
                  </Label>
                  <Input
                    id="name"
                    placeholder="e.g. ALPHA-7"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="bg-input/50 border-border font-mono text-sm"
                    required
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

                <div className="flex flex-col gap-2">
                  <Label htmlFor="location" className="text-xs text-muted-foreground">
                    Location
                  </Label>
                  <Input
                    id="location"
                    placeholder="e.g. Zone Industrielle Nord"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    className="bg-input/50 border-border text-sm"
                    required
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="lat" className="text-xs text-muted-foreground">
                      Center Latitude
                    </Label>
                    <Input
                      id="lat"
                      type="number"
                      step="0.000001"
                      value={form.center_lat}
                      onChange={(e) => setForm({ ...form, center_lat: parseFloat(e.target.value) })}
                      className="bg-input/50 border-border font-mono text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="lon" className="text-xs text-muted-foreground">
                      Center Longitude
                    </Label>
                    <Input
                      id="lon"
                      type="number"
                      step="0.000001"
                      value={form.center_lon}
                      onChange={(e) => setForm({ ...form, center_lon: parseFloat(e.target.value) })}
                      className="bg-input/50 border-border font-mono text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="zoom" className="text-xs text-muted-foreground">
                      Zoom Level
                    </Label>
                    <Input
                      id="zoom"
                      type="number"
                      min={1}
                      max={20}
                      value={form.zoom}
                      onChange={(e) => setForm({ ...form, zoom: parseInt(e.target.value) })}
                      className="bg-input/50 border-border font-mono text-sm"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2 border-t border-border/50">
                  <Button variant="ghost" asChild>
                    <Link href="/missions">Cancel</Link>
                  </Button>
                  <Button type="submit" disabled={saving || !form.name || !form.location}>
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    {saving ? "Creating..." : "Create Mission"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  )
}
