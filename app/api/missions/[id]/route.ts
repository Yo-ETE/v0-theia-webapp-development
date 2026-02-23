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
    // Merge: local store has freshest geo/zones (drawn in the UI).
    // Backend is ALWAYS authoritative for status, event_count, device_count.
    const localZones = local?.zones ?? []
    const localFloors = local?.floors ?? []
    const merged = {
      ...backend,
      // Local store wins ONLY for geo/zones/floors/environment (drawn in UI)
      center_lat: local?.center_lat ?? backend.center_lat,
      center_lon: local?.center_lon ?? backend.center_lon,
      zoom: local?.zoom ?? backend.zoom,
      zones: localZones.length > 0 ? localZones : (backend.zones ?? []),
      floors: localFloors.length > 0 ? localFloors : (backend.floors ?? []),
      environment: local?.environment ?? backend.environment ?? "horizontal",
      // Backend ALWAYS wins for these (never override with local store)
      status: backend.status ?? local?.status,
      event_count: backend.event_count ?? 0,
      device_count: backend.device_count ?? 0,
    }
    store.updateMission(id, merged)
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

  // Retry up to 2 times for critical status changes
  const maxRetries = body.status ? 2 : 1
  let lastErr: unknown = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await proxyToBackend(`/api/missions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        console.error(`[THEIA] Mission PATCH backend error ${res.status}: ${errText}`)
        throw new Error(`Backend ${res.status}`)
      }
      const backend = await res.json()
      console.log(`[THEIA] Mission PATCH OK: id=${id} status=${backend.status}`)
      // Merge: backend ALWAYS wins for status/event_count/device_count
      // Local wins ONLY for geo/zones/floors (drawn in UI)
      const merged = {
        ...backend,
        center_lat: localUpdated?.center_lat ?? backend.center_lat,
        center_lon: localUpdated?.center_lon ?? backend.center_lon,
        zoom: localUpdated?.zoom ?? backend.zoom,
        zones: localUpdated?.zones?.length ? localUpdated.zones : (backend.zones ?? []),
        floors: localUpdated?.floors?.length ? localUpdated.floors : (backend.floors ?? []),
        environment: localUpdated?.environment ?? backend.environment,
        // Backend ALWAYS wins for these (never override with local store)
        status: backend.status ?? localUpdated?.status,
        event_count: backend.event_count ?? 0,
        device_count: backend.device_count ?? 0,
      }
      store.updateMission(id, merged)
      return NextResponse.json(merged)
    } catch (err) {
      lastErr = err
      console.error(`[THEIA] Mission PATCH attempt ${attempt + 1}/${maxRetries} FAILED for ${id}:`, err)
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 500))
      }
    }
  }

  // All retries failed -- return error so frontend knows it failed
  console.error(`[THEIA] Mission PATCH ALL RETRIES FAILED for ${id}, body:`, JSON.stringify(body), "error:", lastErr)
  return NextResponse.json(
    { error: `Backend unreachable after ${maxRetries} attempts` },
    { status: 502 },
  )
}
