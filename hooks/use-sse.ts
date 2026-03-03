"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import { getAuthToken } from "@/lib/auth-context"

type SSEEvent = {
  type: string
  data: Record<string, unknown>
}

type SSEHandler = (event: SSEEvent) => void

/**
 * Robust SSE connection directly to the backend (:8000).
 * - Sends JWT token as query param (EventSource can't send headers)
 * - Reconnects automatically on error
 * - Monitors for stale connections (no data for 45s) and forces reconnect
 * - Handler is stored via ref so it never triggers reconnection
 */
export function useSSE(onEvent?: SSEHandler) {
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const onEventRef = useRef<SSEHandler | undefined>(onEvent)
  const handlersRef = useRef<SSEHandler[]>([])
  const lastMessageRef = useRef<number>(0)

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
    let healthCheckTimer: ReturnType<typeof setInterval> | null = null
    let closed = false
    let attempt = 0

    function connect() {
      if (closed) return

      // Close any existing connection first
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }

      // Connect directly to FastAPI backend with JWT token as query param
      const token = getAuthToken()
      const backendBase = `http://${window.location.hostname}:8000`
      const url = token
        ? `${backendBase}/api/stream?token=${encodeURIComponent(token)}`
        : "/api/stream"  // fallback to Next.js proxy (preview)
      const es = new EventSource(url)
      esRef.current = es

      es.onopen = () => {
        attempt = 0
        lastMessageRef.current = Date.now()
        setConnected(true)
      }

      es.onmessage = (evt) => {
        lastMessageRef.current = Date.now()
        // Skip keepalive comments (they start with ":")
        if (!evt.data || evt.data.trim() === "") return
        try {
          const parsed: SSEEvent = JSON.parse(evt.data)
          onEventRef.current?.(parsed)
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
          // Exponential backoff: 1s, 2s, 4s, max 10s
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000)
          attempt++
          reconnectTimer = setTimeout(connect, delay)
        }
      }
    }

    connect()

    // Health check: if no message (including keepalive) for 45s, force reconnect
    // Backend sends keepalive every 30s, so 45s means the connection is dead
    healthCheckTimer = setInterval(() => {
      if (closed) return
      const sinceLastMsg = Date.now() - lastMessageRef.current
      if (lastMessageRef.current > 0 && sinceLastMsg > 45000) {
        setConnected(false)
        if (esRef.current) {
          esRef.current.close()
          esRef.current = null
        }
        attempt = 0
        connect()
      }
    }, 10000)

    return () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (healthCheckTimer) clearInterval(healthCheckTimer)
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      setConnected(false)
    }
  }, [])

  return { connected, addHandler }
}
