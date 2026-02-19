import { NextResponse } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"
import { store } from "@/lib/preview-store"

export async function GET() {
  if (isPreviewMode()) {
    return NextResponse.json(store.getDevices())
  }
  try {
    const res = await proxyToBackend("/api/devices")
    if (!res.ok) throw new Error(`Backend ${res.status}`)
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json(store.getDevices())
  }
}
