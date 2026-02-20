import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { store } from "@/lib/preview-store"

/** Parse payload robustly -- handles object or JSON string */
function parsePayload(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null
  if (typeof raw === "string") {
    try { return JSON.parse(raw) } catch { return null }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>
  return null
}

/**
 * Filter out ghost / stale detection events:
 * 1) No real presence or distance < 15cm
 * 2) Stale replay: multiple events with the exact same (x,y) coordinates
 *    from the same device in a short window = RX LoRa replaying its buffer
 */
function filterGhosts(events: Record<string, unknown>[]): Record<string, unknown>[] {
  // First pass: basic presence/distance filter
  const basic = events.filter((evt) => {
    if (evt.type !== "detection") return true
    const p = parsePayload(evt.payload)
    if (!p) return true
    const dist = Number(p.distance ?? 0)
    if (dist < 15) return false
    const pres = p.presence
    if (pres === false || pres === "false" || pres === 0 || pres === "0") return false
    return true
  })

  // Second pass: stale replay detection per device
  // Events are sorted newest-first. Group consecutive events from the same device
  // that have the exact same (x,y) coordinates -- these are stale RX replays.
  // Keep only the first occurrence of each unique coordinate set.
  const result: Record<string, unknown>[] = []
  // Track last N coordinate signatures per device to detect replay bursts
  const deviceCoordHistory: Record<string, { sig: string; count: number }> = {}

  for (const evt of basic) {
    if (evt.type !== "detection") {
      result.push(evt)
      continue
    }
    const p = parsePayload(evt.payload)
    const deviceId = String(evt.device_id ?? "")
    if (!p || !deviceId) {
      result.push(evt)
      continue
    }
    // Build a coordinate signature from the raw sensor data
    const x = p.x ?? p.target_x ?? ""
    const y = p.y ?? p.target_y ?? ""
    const d = p.distance ?? ""
    const sig = `${x}|${y}|${d}`

    const prev = deviceCoordHistory[deviceId]
    if (prev && prev.sig === sig) {
      prev.count++
      // Allow up to 2 events with the same coordinates (real person standing still)
      // but beyond that it's almost certainly stale replay
      if (prev.count > 2) continue // skip this stale event
    } else {
      deviceCoordHistory[deviceId] = { sig, count: 1 }
    }
    result.push(evt)
  }

  return result
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const missionId = searchParams.get("mission_id")

  if (isPreviewMode()) {
    return NextResponse.json({ ok: true })
  }

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
