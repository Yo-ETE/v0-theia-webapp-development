import { NextResponse } from "next/server"
import { NextRequest } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"

export async function GET(request: NextRequest) {
  const branch = request.nextUrl.searchParams.get("branch") || ""

  if (isPreviewMode()) {
    return NextResponse.json({
      branch: branch || "main",
      commit: "abc1234",
      commitDate: "2026-02-20 14:30:00 +0100",
      commitMessage: "fix: GPS timeout on cold start",
      commitAuthor: "Yoann",
      updateAvailable: true,
      commitsBehind: 2,
      latestCommits: [
        { hash: "def5678", message: "fix: ajout retry sur connexion LoRa", date: "2026-02-21 09:45", author: "Yoann" },
        { hash: "bcd4567", message: "feat: add LoRa channel hopping", date: "2026-02-20 14:30", author: "Yoann" },
      ],
    })
  }
  try {
    const qs = branch ? `?branch=${encodeURIComponent(branch)}` : ""
    const res = await proxyToBackend(`/api/admin/version${qs}`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({
      branch: "unknown",
      commit: "unknown",
      commitDate: null,
      updateAvailable: false,
      commitsBehind: 0,
    })
  }
}
