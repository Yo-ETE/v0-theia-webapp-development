import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { mockMissions } from "@/lib/mock-data"

export async function GET() {
  if (isPreviewMode()) {
    return NextResponse.json(mockMissions)
  }

  try {
    const res = await proxyToBackend("/api/missions")
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(mockMissions)
  }
}

export async function POST(request: NextRequest) {
  if (isPreviewMode()) {
    const body = await request.json()
    const newMission = {
      id: `mission-${Date.now()}`,
      name: "New Mission",
      description: "",
      location: "",
      environment: "horizontal",
      center_lat: 48.8566,
      center_lon: 2.3522,
      zoom: 17,
      ...body,
      status: "draft",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
      zones: body.zones ?? [],
      device_count: 0,
      event_count: 0,
    }
    return NextResponse.json(newMission, { status: 201 })
  }

  try {
    const body = await request.text()
    const res = await proxyToBackend("/api/missions", {
      method: "POST",
      body,
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 503 })
  }
}
