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

    // Always update local store first (may be null if device was backend-only)
    let localDevice = store.updateDevice(id, body)

    if (isPreviewMode()) {
      if (!localDevice) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json(localDevice)
    }

    // Pi mode: try the real backend
    try {
      const res = await proxyToBackend(`/api/devices/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`Backend ${res.status}`)
      const backendDevice = await res.json()
      // Sync backend response into local store
      if (localDevice) {
        store.updateDevice(id, backendDevice)
      } else {
        store.createDevice({ ...backendDevice, id: backendDevice.id, name: backendDevice.name ?? id })
      }
      return NextResponse.json(backendDevice)
    } catch (err) {
      // Backend unreachable -- fallback to local store
      console.warn("[THEIA] Backend unreachable for PATCH device:", (err as Error).message)
      if (!localDevice) {
        localDevice = store.createDevice({
          id,
          name: body.name ?? `Device-${id.slice(0, 6)}`,
          dev_eui: body.dev_eui ?? "",
          type: body.type ?? "microwave_tx",
          ...body,
        })
      }
      return NextResponse.json(localDevice)
    }
  } catch (outerErr) {
    console.error("[THEIA] PATCH /api/devices/[id] unhandled error:", outerErr)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
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
