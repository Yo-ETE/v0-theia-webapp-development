import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { mockMissions } from "@/lib/mock-data"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  if (isPreviewMode()) {
    const mission = mockMissions.find((m) => m.id === id)
    if (!mission) {
      return NextResponse.json({ error: "Mission not found" }, { status: 404 })
    }
    return NextResponse.json(mission)
  }

  try {
    const res = await proxyToBackend(`/api/missions/${id}`)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  if (isPreviewMode()) {
    const body = await request.json()
    const mission = mockMissions.find((m) => m.id === id)
    if (!mission) {
      return NextResponse.json({ error: "Mission not found" }, { status: 404 })
    }
    return NextResponse.json({ ...mission, ...body, updated_at: new Date().toISOString() })
  }

  try {
    const body = await request.text()
    const res = await proxyToBackend(`/api/missions/${id}`, {
      method: "PATCH",
      body,
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 })
  }
}
