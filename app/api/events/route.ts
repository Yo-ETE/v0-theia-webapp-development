import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { store } from "@/lib/preview-store"

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const missionId = searchParams.get("mission_id")

  if (isPreviewMode()) {
    return NextResponse.json(store.getEvents(missionId ?? undefined))
  }

  try {
    const qs = searchParams.toString()
    const url = `/api/events${qs ? `?${qs}` : ""}`
    console.log("[v0] Events proxy ->", url)
    const res = await proxyToBackend(url)
    if (!res.ok) {
      console.log("[v0] Events proxy error:", res.status, res.statusText)
      throw new Error(`Backend ${res.status}`)
    }
    const data = await res.json()
    console.log("[v0] Events proxy got", Array.isArray(data) ? data.length : "non-array", "events")
    return NextResponse.json(data)
  } catch (err) {
    console.log("[v0] Events proxy fallback to store, error:", err)
    return NextResponse.json(store.getEvents(missionId ?? undefined))
  }
}
