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
    // Merge: local store always has the freshest zones/coords (drawn in the UI).
    // Backend zones are only used if the local store has none.
    const localZones = local?.zones ?? []
    const localFloors = local?.floors ?? []
    const merged = {
      ...backend,
      center_lat: local?.center_lat ?? backend.center_lat,
      center_lon: local?.center_lon ?? backend.center_lon,
      zoom: local?.zoom ?? backend.zoom,
      zones: localZones.length > 0 ? localZones : (backend.zones ?? []),
      floors: localFloors.length > 0 ? localFloors : (backend.floors ?? []),
      environment: local?.environment ?? backend.environment ?? "horizontal",
    }
    if (local) store.updateMission(id, merged)
    return NextResponse.json(merged)
  } catch {
    if (local) return NextResponse.json(local)
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  store.deleteMission(id)

  if (isPreviewMode()) {
    return NextResponse.json({ ok: true })
  }

  try {
    const res = await proxyToBackend(`/api/missions/${id}`, { method: "DELETE" })
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    return NextResponse.json({ ok: true })
  } catch {
    // Local store already deleted -- return success regardless
    return NextResponse.json({ ok: true })
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
    const merged = { ...localUpdated, ...backend, zones: localUpdated?.zones ?? backend.zones, floors: localUpdated?.floors ?? backend.floors }
    store.updateMission(id, merged)
    return NextResponse.json(merged)
  } catch {
    // Backend down -- return local data if available, or echo the body back
    if (localUpdated) return NextResponse.json(localUpdated)
    // Even if store didn't have the mission, return success with the sent data
    // so the UI doesn't break when the backend is temporarily unavailable
    return NextResponse.json({ id, ...body })
  }
}
