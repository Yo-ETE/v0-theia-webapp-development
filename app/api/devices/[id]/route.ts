import { NextResponse, type NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { mockDevices } from "@/lib/mock-data"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  if (isPreviewMode()) {
    const body = await request.json()
    const device = mockDevices.find((d) => d.id === id)
    if (!device) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 })
    }
    return NextResponse.json({ ...device, ...body })
  }

  try {
    const body = await request.text()
    const res = await proxyToBackend(`/api/devices/${id}`, {
      method: "PATCH",
      body,
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 })
  }
}
