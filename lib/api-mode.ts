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
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData
  const headers: Record<string, string> = isFormData
    ? {}
    : { "Content-Type": "application/json" }
  return fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...init?.headers,
    },
  })
}
