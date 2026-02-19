import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { mockLogs } from "@/lib/mock-data"

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const source = searchParams.get("source")
  const level = searchParams.get("level")
  const search = searchParams.get("search")

  if (isPreviewMode()) {
    let logs = [...mockLogs]
    if (source) {
      logs = logs.filter((l) => l.source === source)
    }
    if (level) {
      logs = logs.filter((l) => l.level === level)
    }
    if (search) {
      const q = search.toLowerCase()
      logs = logs.filter(
        (l) =>
          l.message.toLowerCase().includes(q) ||
          (l.details && l.details.toLowerCase().includes(q)),
      )
    }
    return NextResponse.json(logs)
  }

  try {
    const qs = searchParams.toString()
    const res = await proxyToBackend(`/api/logs${qs ? `?${qs}` : ""}`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 })
  }
}
