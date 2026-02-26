import { NextResponse, type NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/api-mode"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  
  // Read the raw body and re-forward it to the backend
  // We can't use formData() and re-send because Node fetch may lose boundaries
  const contentType = request.headers.get("content-type") || ""
  console.log("[v0] Plan image upload proxy: id=", id, "content-type=", contentType)

  try {
    // Forward raw body with original content-type to preserve multipart boundary
    const rawBody = await request.arrayBuffer()
    const res = await proxyToBackend(`/api/missions/${id}/plan-image`, {
      method: "POST",
      body: rawBody,
      headers: {
        "Content-Type": contentType,
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return NextResponse.json({ error: text }, { status: res.status })
    }
    return NextResponse.json(await res.json())
  } catch (err) {
    console.error("[THEIA] Plan image upload error:", err)
    return NextResponse.json({ error: "Upload failed" }, { status: 502 })
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    // Backend endpoint is at /api/missions/{id}/plan-image/file
    const res = await proxyToBackend(`/api/missions/${id}/plan-image/file`, {
      method: "GET",
    })
    if (!res.ok) {
      console.error("[THEIA] Plan image GET failed:", res.status)
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const blob = await res.blob()
    return new NextResponse(blob, {
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    })
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
}
