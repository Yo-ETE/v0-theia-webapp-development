import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { store } from "@/lib/preview-store"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  if (isPreviewMode()) {
    const mission = store.getMission(id)
    if (!mission) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(mission)
  }

  try {
    const res = await proxyToBackend(`/api/missions/${id}`)
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    return NextResponse.json(await res.json())
  } catch {
    const mission = store.getMission(id)
    return NextResponse.json(mission ?? { error: "Not found" }, { status: mission ? 200 : 404 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await request.json()

  if (isPreviewMode()) {
    const updated = store.updateMission(id, body)
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(updated)
  }

  try {
    const res = await proxyToBackend(`/api/missions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    const updated = store.updateMission(id, body)
    return NextResponse.json(updated ?? { error: "Backend unreachable" }, { status: updated ? 200 : 503 })
  }
}
