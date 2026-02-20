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
    const missions = await res.json()
    // Sync backend data into local store for resilience
    for (const m of missions) {
      if (!store.getMission(m.id)) store.createMission(m)
      else store.updateMission(m.id, m)
    }
    return NextResponse.json(missions)
  } catch {
    return NextResponse.json(store.getMissions())
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  // Always store locally first so coordinates are never lost
  const localMission = store.createMission(body)

  if (isPreviewMode()) {
    return NextResponse.json(localMission, { status: 201 })
  }

  try {
    const res = await proxyToBackend("/api/missions", {
      method: "POST",
      body: JSON.stringify({ ...body, id: localMission.id }),
    })
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    const backendMission = await res.json()
    // Merge: keep local coords if backend didn't store them
    const merged = {
      ...localMission,
      ...backendMission,
      center_lat: backendMission.center_lat ?? localMission.center_lat,
      center_lon: backendMission.center_lon ?? localMission.center_lon,
      zoom: backendMission.zoom ?? localMission.zoom,
      zones: backendMission.zones ?? localMission.zones,
    }
    store.updateMission(merged.id, merged)
    return NextResponse.json(merged, { status: 201 })
  } catch {
    return NextResponse.json(localMission, { status: 201 })
  }
}
