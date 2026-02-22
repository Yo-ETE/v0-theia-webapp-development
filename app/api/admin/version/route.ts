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
    const res = await proxyToBackend(`/api/config/git/version${qs}`)
    const data = await res.json()
    // Normalize field names from backend (may use different naming)
    const normalized = {
      branch: data.branch || data.current_branch || data.git_branch || "unknown",
      commit: data.commit || data.current_commit || data.git_commit || data.commit_hash || "unknown",
      commitDate: data.commitDate || data.commit_date || data.date || null,
      commitMessage: data.commitMessage || data.commit_message || data.message || null,
      commitAuthor: data.commitAuthor || data.commit_author || data.author || null,
      updateAvailable: data.updateAvailable ?? data.update_available ?? false,
      commitsBehind: data.commitsBehind ?? data.commits_behind ?? 0,
      latestCommits: (data.latestCommits || data.latest_commits || []).map((c: Record<string, string>) => ({
        hash: c.hash || c.commit || c.sha || "",
        message: c.message || c.commit_message || "",
        date: c.date || c.commit_date || "",
        author: c.author || c.commit_author || "",
      })),
    }
    return NextResponse.json(normalized)
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
