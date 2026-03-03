import { NextResponse } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { mockSystemStatus } from "@/lib/mock-data"

export async function GET() {
  if (isPreviewMode()) {
    return NextResponse.json(mockSystemStatus)
  }

  try {
    const res = await proxyToBackend("/api/status")
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    // Fallback to mock data when backend is unreachable
    return NextResponse.json({ ...mockSystemStatus, _fallback: true })
  }
}
