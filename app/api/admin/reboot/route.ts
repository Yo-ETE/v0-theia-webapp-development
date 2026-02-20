import { NextResponse } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"

export async function POST() {
  if (isPreviewMode()) {
    return NextResponse.json({ status: "success", message: "Redemarrage simule (mode preview)" })
  }
  try {
    const res = await proxyToBackend("/api/admin/reboot", { method: "POST" })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ status: "error", message: "Erreur lors du redemarrage" }, { status: 500 })
  }
}
