import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { store } from "@/lib/preview-store"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()

    if (isPreviewMode()) {
      const localDevice = store.updateDevice(id, body)
      if (!localDevice) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json(localDevice)
    }

    // Pi mode: backend is the source of truth -- MUST succeed
    const res = await proxyToBackend(`/api/devices/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => "Unknown error")
      console.error("[THEIA] Backend PATCH failed:", res.status, errBody)
      return NextResponse.json({ error: `Backend error: ${res.status}` }, { status: res.status })
    }
    const backendDevice = await res.json()
    // Sync backend response into local store
    store.updateDevice(id, backendDevice)
    return NextResponse.json(backendDevice)
  } catch (err) {
    console.error("[THEIA] PATCH /api/devices/[id] error:", err)
    return NextResponse.json(
      { error: `Backend unreachable: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Remove from local store
  const devices = store.getDevices()
  const idx = devices.findIndex((d) => d.id === id)
  if (idx !== -1) devices.splice(idx, 1)

  if (isPreviewMode()) {
    return NextResponse.json({ ok: true })
  }

  try {
    const res = await proxyToBackend(`/api/devices/${id}`, { method: "DELETE" })
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
