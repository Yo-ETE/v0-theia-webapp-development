import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"

// No client-side ghost filter: the backend rate-limits INSERTs (1 per 2s per device)
// so all stored events are legitimate detections.

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const missionId = searchParams.get("mission_id")

  // Always try backend first
  try {
    const qs = missionId ? `?mission_id=${missionId}` : ""
    const res = await proxyToBackend(`/api/events${qs}`, { method: "DELETE" })
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ ok: false, error: "Backend unreachable" }, { status: 502 })
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const missionId = searchParams.get("mission_id")

  // Always try backend first
  try {
    const qs = searchParams.toString()
    const res = await proxyToBackend(`/api/events${qs ? `?${qs}` : ""}`)
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch (err) {
    // Backend unreachable -- return empty array
    console.error("[THEIA] Events GET failed - backend unreachable:", err)
    return NextResponse.json([])
  }
}
