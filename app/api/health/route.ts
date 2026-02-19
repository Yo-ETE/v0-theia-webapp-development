import { NextResponse } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"

export async function GET() {
  if (isPreviewMode()) {
    return NextResponse.json({
      status: "ok",
      mode: "preview",
      version: "1.0.0-preview",
      timestamp: new Date().toISOString(),
    })
  }

  try {
    const res = await proxyToBackend("/api/health")
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { status: "error", mode: "pi", error: "Backend unreachable" },
      { status: 502 },
    )
  }
}
