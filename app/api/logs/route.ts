import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { store } from "@/lib/preview-store"

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const source = searchParams.get("source")
  const level = searchParams.get("level")
  const search = searchParams.get("search")

  if (isPreviewMode()) {
    return NextResponse.json(
      store.getLogs({
        source: source ?? undefined,
        level: level ?? undefined,
        search: search ?? undefined,
      })
    )
  }

  try {
    const qs = searchParams.toString()
    const res = await proxyToBackend(`/api/logs${qs ? `?${qs}` : ""}`)
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json(
      store.getLogs({
        source: source ?? undefined,
        level: level ?? undefined,
        search: search ?? undefined,
      })
    )
  }
}
