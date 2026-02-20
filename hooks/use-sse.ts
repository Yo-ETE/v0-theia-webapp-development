"use client"

import { useEffect, useRef, useCallback, useState } from "react"

type SSEEvent = {
  type: string
  data: Record<string, unknown>
}

type SSEHandler = (event: SSEEvent) => void

/**
 * Connects directly to the backend SSE endpoint (not via Next.js proxy).
 * The handler ref is updated without re-creating the EventSource connection.
 */
export function useSSE(onEvent?: SSEHandler) {
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const onEventRef = useRef<SSEHandler | undefined>(onEvent)
  const handlersRef = useRef<SSEHandler[]>([])

  // Keep ref up-to-date without triggering reconnect
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  const addHandler = useCallback((handler: SSEHandler) => {
    handlersRef.current.push(handler)
    return () => {
      handlersRef.current = handlersRef.current.filter((h) => h !== handler)
    }
  }, [])

  useEffect(() => {
    const mode = process.env.NEXT_PUBLIC_MODE || "preview"
    if (mode === "preview") return

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let closed = false

    function connect() {
      if (closed) return

      // Connect directly to backend SSE, not via Next.js proxy
      // This avoids buffering issues in the proxy layer
      const backendUrl = window.location.protocol + "//" + window.location.hostname + ":8000"
      const es = new EventSource(`${backendUrl}/api/stream`)
      esRef.current = es

      es.onopen = () => {
        setConnected(true)
      }

      es.onmessage = (evt) => {
        try {
          const parsed: SSEEvent = JSON.parse(evt.data)
          // Call the main handler via ref (never stale)
          onEventRef.current?.(parsed)
          // Call additional handlers
          for (const handler of handlersRef.current) {
            handler(parsed)
          }
        } catch {
          // ignore parse errors
        }
      }

      es.onerror = () => {
        setConnected(false)
        es.close()
        esRef.current = null
        if (!closed) {
          reconnectTimer = setTimeout(connect, 2000)
        }
      }
    }

    connect()

    return () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      setConnected(false)
    }
  }, []) // Empty deps: connect once, never reconnect on handler change

  return { connected, addHandler }
}
