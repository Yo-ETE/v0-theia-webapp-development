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
    // IMPORTANT: never overwrite local geo/zone data with backend defaults
    for (const m of missions) {
      const existing = store.getMission(m.id)
      if (!existing) {
        store.createMission(m)
      } else {
        // Only update non-geo backend-authoritative fields
        store.updateMission(m.id, {
          status: m.status,
          event_count: m.event_count,
          device_count: m.device_count,
          name: m.name,
          location: m.location,
        })
      }
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
    // Merge: local always wins for geo (backend may return Pydantic defaults)
    const merged = {
      ...backendMission,
      ...localMission,
      // Backend authoritative
      status: backendMission.status ?? localMission.status,
      event_count: backendMission.event_count ?? 0,
    }
    store.updateMission(merged.id, merged)
    return NextResponse.json(merged, { status: 201 })
  } catch {
    return NextResponse.json(localMission, { status: 201 })
  }
}
