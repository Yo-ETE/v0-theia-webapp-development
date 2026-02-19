import { isPreviewMode, getBackendUrl } from "@/lib/api-mode"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  if (isPreviewMode()) {
    // In preview, return a no-op SSE stream that just sends a heartbeat every 30s
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        // Send initial connected event
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "connected", mode: "preview" })}\n\n`),
        )

        const interval = setInterval(() => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "heartbeat", timestamp: new Date().toISOString() })}\n\n`),
            )
          } catch {
            clearInterval(interval)
          }
        }, 30000)

        // Clean up on close
        return () => clearInterval(interval)
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  }

  // In pi mode, proxy to FastAPI SSE endpoint
  try {
    const res = await fetch(`${getBackendUrl()}/api/stream`, {
      headers: { Accept: "text/event-stream" },
    })

    return new Response(res.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "Backend unreachable" })}\n\n`,
      {
        status: 502,
        headers: { "Content-Type": "text/event-stream" },
      },
    )
  }
}
