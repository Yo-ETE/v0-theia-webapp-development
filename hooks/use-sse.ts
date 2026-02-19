"use client"

import { useEffect, useRef, useCallback, useState } from "react"

type SSEEvent = {
  type: string
  data: Record<string, unknown>
}

type SSEHandler = (event: SSEEvent) => void

export function useSSE(onEvent?: SSEHandler) {
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const handlersRef = useRef<SSEHandler[]>([])

  const addHandler = useCallback((handler: SSEHandler) => {
    handlersRef.current.push(handler)
    return () => {
      handlersRef.current = handlersRef.current.filter((h) => h !== handler)
    }
  }, [])

  useEffect(() => {
    if (onEvent) {
      handlersRef.current.push(onEvent)
    }

    const mode = process.env.NEXT_PUBLIC_MODE || "preview"
    // In preview mode, SSE is not available (mock data)
    if (mode === "preview") return

    const es = new EventSource("/api/stream")
    esRef.current = es

    es.onopen = () => setConnected(true)

    es.onmessage = (evt) => {
      try {
        const parsed: SSEEvent = JSON.parse(evt.data)
        for (const handler of handlersRef.current) {
          handler(parsed)
        }
      } catch {
        // ignore parse errors
      }
    }

    es.onerror = () => {
      setConnected(false)
    }

    return () => {
      es.close()
      esRef.current = null
      setConnected(false)
      if (onEvent) {
        handlersRef.current = handlersRef.current.filter((h) => h !== onEvent)
      }
    }
  }, [onEvent])

  return { connected, addHandler }
}
