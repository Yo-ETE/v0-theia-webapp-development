import { NextResponse } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { mockDevices } from "@/lib/mock-data"

export async function GET() {
  if (isPreviewMode()) {
    return NextResponse.json(mockDevices)
  }

  try {
    const res = await proxyToBackend("/api/devices")
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 })
  }
}
