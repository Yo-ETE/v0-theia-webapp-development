import { NextResponse } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"

export async function GET() {
  if (isPreviewMode()) {
    return NextResponse.json({ fix: false, latitude: 0, longitude: 0, altitude: 0, speed: 0, satellites: 0, hdop: 0 })
  }
  try {
    const res = await proxyToBackend("/api/gps")
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ fix: false, latitude: 0, longitude: 0, altitude: 0, speed: 0, satellites: 0, hdop: 0 })
  }
}
