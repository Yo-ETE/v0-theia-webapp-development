import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { store } from "@/lib/preview-store"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await request.json()

  // Always update local store
  store.updateDevice(id, body)

  // Always try the real backend first (even in preview mode)
  // This is critical: the backend SQLite is the source of truth
  try {
    const res = await proxyToBackend(`/api/devices/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => "Unknown error")
      console.error("[THEIA] Backend PATCH failed:", res.status, errBody)
      // If in preview mode, fall back to local store
      if (isPreviewMode()) {
        const local = store.updateDevice(id, body)
        return NextResponse.json(local ?? { id, ...body })
      }
      return NextResponse.json({ error: `Backend error: ${res.status}` }, { status: res.status })
    }
    const backendDevice = await res.json()
    store.updateDevice(id, backendDevice)
    return NextResponse.json(backendDevice)
  } catch (err) {
    console.error("[THEIA] Backend unreachable for PATCH device:", (err as Error).message)
    // If in preview mode (no backend expected), return local store
    if (isPreviewMode()) {
      const local = store.updateDevice(id, body)
      return NextResponse.json(local ?? { id, ...body })
    }
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

  // Always try backend first
  try {
    const res = await proxyToBackend(`/api/devices/${id}`, { method: "DELETE" })
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
