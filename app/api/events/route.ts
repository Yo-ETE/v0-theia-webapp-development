import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { store } from "@/lib/preview-store"

/** Filter out ghost detection events (no real presence / distance < 15cm) */
function filterGhosts(events: Record<string, unknown>[]): Record<string, unknown>[] {
  return events.filter((evt) => {
    if (evt.type !== "detection") return true
    const p = evt.payload as Record<string, unknown> | undefined
    if (!p || typeof p !== "object") return true
    const dist = Number(p.distance ?? 0)
    if (dist < 15) return false
    const pres = p.presence
    if (pres === false || pres === "false" || pres === 0 || pres === "0") return false
    return true
  })
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const missionId = searchParams.get("mission_id")

  if (isPreviewMode()) {
    return NextResponse.json(store.getEvents(missionId ?? undefined))
  }

  try {
    const qs = searchParams.toString()
    const res = await proxyToBackend(`/api/events${qs ? `?${qs}` : ""}`)
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    const data = await res.json()
    // Always filter ghosts even if backend didn't (old backend still running)
    const clean = Array.isArray(data) ? filterGhosts(data) : data
    return NextResponse.json(clean)
  } catch {
    return NextResponse.json(store.getEvents(missionId ?? undefined))
  }
}
