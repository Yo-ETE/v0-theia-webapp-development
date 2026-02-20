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
    const res = await proxyToBackend(`/api/events${qs ? `?${qs}` : ""}`)
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json(store.getEvents(missionId ?? undefined))
  }
}
