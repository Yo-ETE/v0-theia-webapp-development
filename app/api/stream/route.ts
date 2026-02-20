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
  // We re-emit each chunk individually to avoid Node.js buffering
  try {
    const backendRes = await fetch(`${getBackendUrl()}/api/stream`, {
      headers: { Accept: "text/event-stream" },
      // @ts-expect-error -- Node.js fetch extension to disable response buffering
      highWaterMark: 0,
    })

    if (!backendRes.body) throw new Error("No body")

    const reader = backendRes.body.getReader()
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            controller.close()
            return
          }
          controller.enqueue(value)
        } catch {
          controller.close()
        }
      },
      cancel() {
        reader.cancel()
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
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
