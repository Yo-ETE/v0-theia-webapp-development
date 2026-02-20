import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")
  if (!q || !q.trim()) return NextResponse.json([])

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q.trim())}&limit=6&addressdetails=0`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "THEIA-Hub/1.0 (theia-control-system)",
        "Accept-Language": "fr,en",
        Accept: "application/json",
      },
    })
    clearTimeout(timeout)

    if (!res.ok) return NextResponse.json([])

    const data = await res.json()
    // Return minimal fields to avoid leaking data
    const results = (data ?? []).map((item: { display_name: string; lat: string; lon: string }) => ({
      display_name: item.display_name ?? "",
      lat: item.lat ?? "0",
      lon: item.lon ?? "0",
    }))
    return NextResponse.json(results)
  } catch {
    return NextResponse.json([])
  }
}
