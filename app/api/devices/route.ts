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
    return NextResponse.json(devices)
  } catch {
    return NextResponse.json(store.getDevices())
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  if (isPreviewMode()) {
    // Create in local store
    const device = {
      id: `dev-${Date.now().toString(36)}`,
      dev_eui: body.dev_eui ?? "",
      hw_id: body.dev_eui ?? "",
      name: body.name ?? "New Device",
      type: body.type ?? "microwave_tx",
      serial_port: body.serial_port ?? "",
      status: "unknown",
      mission_id: null,
      zone_id: "",
      zone_label: "",
      side: "",
      floor: null,
      rssi: null,
      snr: null,
      battery: null,
      firmware: "1.0.0",
      last_seen: null,
      enabled: true,
      created_at: new Date().toISOString(),
    }
    store.getDevices().push(device)
    return NextResponse.json(device, { status: 201 })
  }

  try {
    const res = await proxyToBackend("/api/devices", {
      method: "POST",
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    return NextResponse.json(await res.json(), { status: 201 })
  } catch {
    return NextResponse.json({ error: "Failed to create device" }, { status: 503 })
  }
}
