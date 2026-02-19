import { NextResponse } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { mockSystemStatus } from "@/lib/mock-data"

export async function GET() {
  if (isPreviewMode()) {
    return NextResponse.json(mockSystemStatus)
  }

  try {
    const res = await proxyToBackend("/api/status")
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { error: "Backend unreachable" },
      { status: 502 },
    )
  }
}
