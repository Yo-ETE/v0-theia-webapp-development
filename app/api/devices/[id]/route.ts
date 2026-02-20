import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { store } from "@/lib/preview-store"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await request.json()

  // Always update local store first
  const localUpdated = store.updateDevice(id, body)

  if (isPreviewMode()) {
    if (!localUpdated) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(localUpdated)
  }

  try {
    const res = await proxyToBackend(`/api/devices/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    return NextResponse.json(await res.json())
  } catch {
    if (localUpdated) return NextResponse.json(localUpdated)
    return NextResponse.json({ error: "Backend unreachable" }, { status: 503 })
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
