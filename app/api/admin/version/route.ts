import { NextResponse } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"

export async function GET() {
  if (isPreviewMode()) {
    return NextResponse.json({
      branch: "main",
      commit: "abc1234",
      commitDate: "2026-02-20 14:30:00 +0100",
      updateAvailable: false,
      commitsBehind: 0,
    })
  }
  try {
    const res = await proxyToBackend("/api/admin/version")
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({
      branch: "unknown",
      commit: "unknown",
      commitDate: null,
      updateAvailable: false,
      commitsBehind: 0,
    })
  }
}
