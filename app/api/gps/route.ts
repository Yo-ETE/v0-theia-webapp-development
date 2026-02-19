import { NextResponse } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { mockSystemStatus } from "@/lib/mock-data"

export async function GET() {
  if (isPreviewMode()) {
    return NextResponse.json(mockSystemStatus.gps)
  }
  const res = await proxyToBackend("/api/gps")
  const data = await res.json()
  return NextResponse.json(data)
}
