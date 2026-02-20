import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { store } from "@/lib/preview-store"

export async function GET() {
  if (isPreviewMode()) {
    return NextResponse.json(store.getDevices())
  }
  try {
    const res = await proxyToBackend("/api/devices")
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    const devices = await res.json()

    // Sync backend devices into local store for fallback
    for (const dev of devices) {
      const existing = store.getDevice(dev.id)
      if (existing) {
        store.updateDevice(dev.id, dev)
      } else {
        store.createDevice({ ...dev })
      }
    }
    return NextResponse.json(devices)
  } catch (err) {
    const fallback = store.getDevices()

    return NextResponse.json(fallback)
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  // Always create locally first
  const localDevice = store.createDevice({
    name: body.name ?? "New Device",
    dev_eui: body.dev_eui ?? "",
    hw_id: body.dev_eui ?? "",
    type: body.type ?? "microwave_tx",
    serial_port: body.serial_port ?? "",
  })

  if (isPreviewMode()) {
    return NextResponse.json(localDevice, { status: 201 })
  }

  try {
    const res = await proxyToBackend("/api/devices", {
      method: "POST",
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    return NextResponse.json(await res.json(), { status: 201 })
  } catch {
    // Backend down -- local device already created
    return NextResponse.json(localDevice, { status: 201 })
  }
}
