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
    // If backend returned a different ID, update local store to match
    const backendId = backendMission.id
    if (backendId && backendId !== localMission.id) {
      store.deleteMission(localMission.id)
      store.createMission({ ...localMission, ...backendMission, id: backendId })
    } else {
      store.updateMission(localMission.id, {
        ...backendMission,
        // Keep local geo data (backend may return Pydantic defaults)
        center_lat: localMission.center_lat,
        center_lon: localMission.center_lon,
        zoom: localMission.zoom,
        zones: localMission.zones,
        floors: localMission.floors ?? [],
      })
    }
    const final = store.getMission(backendId ?? localMission.id) ?? localMission
    return NextResponse.json(final, { status: 201 })
  } catch {
    return NextResponse.json(localMission, { status: 201 })
  }
}
