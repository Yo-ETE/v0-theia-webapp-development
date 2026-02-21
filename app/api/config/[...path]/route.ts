import { NextRequest, NextResponse } from "next/server"
import { isPreviewMode, proxyToBackend } from "@/lib/api-mode"

// Mock data for preview mode
const MOCK_WIFI_STATUS = {
  connected: true,
  ssid: "THEIA-Lab",
  signal: -52,
  txRate: "72.2 Mb/s",
  ipLocal: "192.168.1.42",
  hasInternet: true,
  pingMs: 12.4,
}

const MOCK_ETHERNET = { connected: true, ipLocal: "192.168.1.100" }

const MOCK_NETWORKS = {
  status: "success",
  networks: [
    { ssid: "THEIA-Lab", signal: 85, security: "WPA2", bssid: "AA:BB:CC:DD:EE:01" },
    { ssid: "Livebox-5G", signal: 60, security: "WPA2", bssid: "AA:BB:CC:DD:EE:02" },
    { ssid: "FreeWifi", signal: 35, security: "Open", bssid: "AA:BB:CC:DD:EE:03" },
    { ssid: "Orange-Guest", signal: 45, security: "WPA2", bssid: "AA:BB:CC:DD:EE:04" },
  ],
}

const MOCK_SAVED = { saved: ["THEIA-Lab", "Home-Wifi"] }

const MOCK_TAILSCALE = {
  installed: true,
  running: true,
  online: true,
  tailscaleIp: "100.64.0.12",
  hostname: "theia-hub",
  magicDns: "theia-hub.tail1234.ts.net",
  version: "1.76.1",
  exitNode: false,
  authUrl: "",
  peers: [
    { id: "1", hostname: "macbook-yoann", ip: "100.64.0.1", os: "macOS", online: true, exitNodeOption: true, isExitNode: false, rxBytes: 1024000, txBytes: 512000 },
    { id: "2", hostname: "phone-yoann", ip: "100.64.0.2", os: "Android", online: true, exitNodeOption: false, isExitNode: false, rxBytes: 0, txBytes: 0 },
    { id: "3", hostname: "server-lab", ip: "100.64.0.3", os: "Linux", online: false, exitNodeOption: true, isExitNode: false, rxBytes: 0, txBytes: 0 },
  ],
}

const MOCK_BACKUPS = {
  backups: [
    { filename: "theia_backup_20260220_143000.tar.gz", size: 52428800, date: "2026-02-20T14:30:00" },
    { filename: "theia_backup_20260215_100000.tar.gz", size: 48234567, date: "2026-02-15T10:00:00" },
  ],
}

const MOCK_BRANCHES = {
  current: "main",
  branches: ["main", "develop", "feature/lora-v2", "hotfix/gps-timeout"],
}

function getMockResponse(path: string, method: string) {
  if (path === "wifi/status") return MOCK_WIFI_STATUS
  if (path === "wifi/scan") return MOCK_NETWORKS
  if (path === "wifi/saved") return MOCK_SAVED
  if (path === "wifi/connect") return { status: "success", message: "Connecte a THEIA-Lab" }
  if (path === "ethernet/status") return MOCK_ETHERNET
  if (path === "tailscale/status") return MOCK_TAILSCALE
  if (path === "tailscale/up") return { status: "success", message: "Tailscale connecte" }
  if (path === "tailscale/down") return { status: "success", message: "Tailscale deconnecte" }
  if (path === "tailscale/logout") return { status: "success", message: "Logout effectue" }
  if (path === "tailscale/exit-node") return { status: "success", message: "Exit node mis a jour" }
  if (path === "backups" && method === "GET") return MOCK_BACKUPS
  if (path === "backups" && method === "POST") return { status: "success", filename: `theia_backup_${Date.now()}.tar.gz`, message: "Sauvegarde creee" }
  if (path === "backups/restore") return { status: "success", message: "Sauvegarde restauree" }
  if (path.startsWith("backups/") && method === "DELETE") return { status: "success", message: "Supprime" }
  if (path === "git/branches") return MOCK_BRANCHES
  if (path === "git/fetch") return { status: "success", message: "Fetched latest from remote" }
  if (path === "git/update") return {
    status: "success",
    commands: [
      "git fetch --quiet",
      "git checkout main",
      "git pull --ff-only",
    ],
    output: "Already on 'main'\nUpdating abc1234..def5678\nFast-forward\n backend/routers/config.py | 12 +++++++++---\n frontend/components/map.tsx | 8 ++++----\n 2 files changed, 13 insertions(+), 7 deletions(-)\n[OK] Mise a jour terminee",
    commits: [
      { hash: "def5678", message: "fix: GPS timeout on cold start", date: "2026-02-20 14:30", author: "Yoann" },
      { hash: "bcd4567", message: "feat: add LoRa channel hopping", date: "2026-02-19 11:15", author: "Yoann" },
    ],
  }
  if (path === "apt/update") return { status: "success", output: "All packages are up to date." }
  if (path === "apt/upgrade") return { status: "success", output: "0 upgraded, 0 newly installed." }
  return { error: "Not found" }
}

/** Try backend, fall back to mock on ANY failure (network, 500, parse error) */
async function tryBackend(path: string, init?: RequestInit): Promise<Response | null> {
  if (isPreviewMode()) return null
  try {
    const res = await proxyToBackend(`/api/config/${path}`, init)
    if (!res.ok) {
      console.warn(`[THEIA] Backend ${init?.method ?? "GET"} /api/config/${path} returned ${res.status}`)
      return null
    }
    return res
  } catch (err) {
    console.warn(`[THEIA] Backend unreachable for /api/config/${path}:`, err)
    return null
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const joinedPath = path.join("/")

  const backendRes = await tryBackend(joinedPath)
  if (backendRes) {
    try {
      const data = await backendRes.json()
      return NextResponse.json(data)
    } catch { /* parse error, fall through to mock */ }
  }
  return NextResponse.json(getMockResponse(joinedPath, "GET"))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const joinedPath = path.join("/")

  let body = null
  try { body = await req.json() } catch {}

  const backendRes = await tryBackend(joinedPath, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  })
  if (backendRes) {
    try {
      const data = await backendRes.json()
      return NextResponse.json(data)
    } catch { /* parse error, fall through to mock */ }
  }
  return NextResponse.json(getMockResponse(joinedPath, "POST"))
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const joinedPath = path.join("/")

  const backendRes = await tryBackend(joinedPath, { method: "DELETE" })
  if (backendRes) {
    try {
      const data = await backendRes.json()
      return NextResponse.json(data)
    } catch { /* parse error, fall through to mock */ }
  }
  return NextResponse.json(getMockResponse(joinedPath, "DELETE"))
}
