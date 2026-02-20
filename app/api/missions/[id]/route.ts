import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { store } from "@/lib/preview-store"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Always check local store first (has freshest coords/zones)
  const local = store.getMission(id)

  if (isPreviewMode()) {
    if (!local) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(local)
  }

  try {
    const res = await proxyToBackend(`/api/missions/${id}`)
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    const backend = await res.json()
    // Merge: local store has zones/coords that backend might not
    const merged = {
      ...backend,
      center_lat: backend.center_lat ?? local?.center_lat,
      center_lon: backend.center_lon ?? local?.center_lon,
      zoom: backend.zoom ?? local?.zoom,
      zones: (backend.zones?.length ? backend.zones : null) ?? local?.zones ?? [],
      environment: backend.environment ?? local?.environment ?? "horizontal",
    }
    if (local) store.updateMission(id, merged)
    return NextResponse.json(merged)
  } catch {
    if (local) return NextResponse.json(local)
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await request.json()

  // Always update local store first -- never lose data
  const localUpdated = store.updateMission(id, body)

  if (isPreviewMode()) {
    if (!localUpdated) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(localUpdated)
  }

  try {
    const res = await proxyToBackend(`/api/missions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    const backend = await res.json()
    // Merge backend response with local (local has definitive zones)
    const merged = { ...localUpdated, ...backend, zones: localUpdated?.zones ?? backend.zones }
    store.updateMission(id, merged)
    return NextResponse.json(merged)
  } catch {
    // Backend down or 405 -- local store has the data
    if (localUpdated) return NextResponse.json(localUpdated)
    return NextResponse.json({ error: "Backend unreachable" }, { status: 503 })
  }
}
