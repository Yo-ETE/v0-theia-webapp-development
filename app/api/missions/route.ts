import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { store } from "@/lib/preview-store"

export async function GET() {
  if (isPreviewMode()) {
    return NextResponse.json(store.getMissions())
  }
  try {
    const res = await proxyToBackend("/api/missions")
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json(store.getMissions())
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  if (isPreviewMode()) {
    const mission = store.createMission(body)
    return NextResponse.json(mission, { status: 201 })
  }

  try {
    const res = await proxyToBackend("/api/missions", {
      method: "POST",
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    // Fallback: store locally
    const mission = store.createMission(body)
    return NextResponse.json(mission, { status: 201 })
  }
}
