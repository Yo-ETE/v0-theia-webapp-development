import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { mockEvents } from "@/lib/mock-data"

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const missionId = searchParams.get("mission_id")

  if (isPreviewMode()) {
    let events = [...mockEvents]
    if (missionId) {
      events = events.filter((e) => e.mission_id === missionId)
    }
    return NextResponse.json(events)
  }

  try {
    const qs = searchParams.toString()
    const res = await proxyToBackend(`/api/events${qs ? `?${qs}` : ""}`)
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    let events = [...mockEvents]
    if (missionId) {
      events = events.filter((e) => e.mission_id === missionId)
    }
    return NextResponse.json(events)
  }
}
