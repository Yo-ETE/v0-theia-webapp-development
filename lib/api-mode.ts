// Determines if we should proxy to the real FastAPI backend or return mock data
// NEXT_PUBLIC_MODE=pi => proxy to THEIA_BACKEND_URL
// NEXT_PUBLIC_MODE=preview (default) => return mock data

export function isPreviewMode(): boolean {
  return process.env.NEXT_PUBLIC_MODE !== "pi"
}

export function getBackendUrl(): string {
  return process.env.THEIA_BACKEND_URL || "http://localhost:8000"
}

export async function proxyToBackend(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${getBackendUrl()}${path}`
  // Don't set Content-Type for FormData (let fetch set the multipart boundary)
  // Don't set Content-Type for GET requests (no body)
  const method = (init?.method || "GET").toUpperCase()
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData
  const proxyHeaders: Record<string, string> = isFormData
    ? {}
    : method === "GET" || method === "HEAD" || !init?.body
      ? {}
      : { "Content-Type": "application/json" }

  // Auto-forward auth cookie from the incoming Next.js request
  // This runs server-side in Route Handlers, so headers() is available.
  try {
    const { headers: nextHeaders } = await import("next/headers")
    const h = await nextHeaders()
    const cookie = h.get("cookie")
    if (cookie) {
      proxyHeaders["Cookie"] = cookie
    }
  } catch {
    // Not in a Next.js server context -- skip cookie forwarding
  }

  return fetch(url, {
    ...init,
    headers: {
      ...proxyHeaders,
      ...init?.headers,
    },
  })
}
