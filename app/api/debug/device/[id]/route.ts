import { NextResponse, type NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/api-mode"

// Debug endpoint: directly query backend for a device's current state
// Usage: GET /api/debug/device/<id>
// This bypasses all caching and local store to show the raw SQLite state
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const res = await proxyToBackend(`/api/devices/${id}`)
    if (!res.ok) {
      return NextResponse.json({
        error: `Backend returned ${res.status}`,
        backend_reachable: true,
      })
    }
    const device = await res.json()
    return NextResponse.json({
      backend_reachable: true,
      device_id: id,
      mission_id: device.mission_id,
      zone_id: device.zone_id,
      enabled: device.enabled,
      name: device.name,
      raw: device,
    })
  } catch (err) {
    return NextResponse.json({
      backend_reachable: false,
      error: (err as Error).message,
    })
  }
}
