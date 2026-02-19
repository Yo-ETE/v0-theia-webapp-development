import { NextResponse } from "next/server"
import { isPreview, proxyGet } from "@/lib/api-mode"
import { mockGps } from "@/lib/mock-data"

export async function GET() {
  if (isPreview()) {
    return NextResponse.json(mockGps)
  }
  return proxyGet("/api/gps")
}
