import { NextResponse, type NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/api-mode"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const formData = await request.formData()

  try {
    const res = await proxyToBackend(`/api/missions/${id}/plan-image`, {
      method: "POST",
      body: formData,
      // Don't set Content-Type -- let fetch set multipart boundary automatically
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
    const res = await proxyToBackend(`/api/missions/${id}/plan-image/file`)
    if (!res.ok) {
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
