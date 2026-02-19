import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { mockMissions } from "@/lib/mock-data"

export async function GET() {
  if (isPreviewMode()) {
    return NextResponse.json(mockMissions)
  }

  try {
    const res = await proxyToBackend("/api/missions")
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  if (isPreviewMode()) {
    const body = await request.json()
    const newMission = {
      id: `mission-${Date.now()}`,
      ...body,
      status: "draft",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
      zones: [],
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
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 })
  }
}
