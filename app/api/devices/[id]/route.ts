import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { store } from "@/lib/preview-store"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await request.json()

  // Always update local store first
  const localUpdated = store.updateDevice(id, body)

  if (isPreviewMode()) {
    if (!localUpdated) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(localUpdated)
  }

  try {
    const res = await proxyToBackend(`/api/devices/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    return NextResponse.json(await res.json())
  } catch {
    if (localUpdated) return NextResponse.json(localUpdated)
    return NextResponse.json({ error: "Backend unreachable" }, { status: 503 })
  }
}
