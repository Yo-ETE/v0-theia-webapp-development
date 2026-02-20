import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")
  if (!q) return NextResponse.json([])

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&addressdetails=1`,
      {
        headers: {
          "User-Agent": "THEIA-Hub/1.0 (theia-control-system)",
          Accept: "application/json",
        },
      }
    )
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json([])
  }
}
