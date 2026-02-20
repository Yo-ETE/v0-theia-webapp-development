import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { store } from "@/lib/preview-store"

/** Filter out ghost detection events (no real presence / distance < 15cm) */
function filterGhosts(events: Record<string, unknown>[]): Record<string, unknown>[] {
  return events.filter((evt) => {
    if (evt.type !== "detection") return true
    // payload may be an object or a JSON string (if backend didn't parse it)
    let p = evt.payload as Record<string, unknown> | string | undefined
    if (typeof p === "string") {
      try { p = JSON.parse(p) } catch { return true }
    }
    if (!p || typeof p !== "object") return true
    const dist = Number((p as Record<string, unknown>).distance ?? 0)
    if (dist < 15) return false
    const pres = (p as Record<string, unknown>).presence
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
