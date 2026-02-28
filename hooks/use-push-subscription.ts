"use client"

import { useState, useEffect, useCallback } from "react"

function _getApi(): string {
  if (typeof window === "undefined") return "http://localhost:8000"
  return `http://${window.location.hostname}:8000`
}
function _bH(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("theia_token") : null
  return t ? { Authorization: `Bearer ${t}` } : {}
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function usePushSubscription() {
  const [isSupported, setIsSupported] = useState(false)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>("default")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
    setIsSupported(supported)
    if (supported) {
      setPermission(Notification.permission)
      // Check if already subscribed
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setIsSubscribed(!!sub)
        })
      })
    }
  }, [])

  const subscribe = useCallback(async () => {
    if (!isSupported) return false
    setIsLoading(true)
    try {
      // 1. Request notification permission
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== "granted") {
        setIsLoading(false)
        return false
      }

      // 2. Register service worker
      const registration = await navigator.serviceWorker.register("/sw.js")
      await navigator.serviceWorker.ready

      // 3. Get VAPID public key from backend
      const res = await fetch(`${_getApi()}/api/push/vapid-key`, { credentials: "include", headers: _bH() })
      const { public_key } = await res.json()

      // 4. Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      })

      // 5. Send subscription to backend
      const subJson = subscription.toJSON()
      await fetch(`${_getApi()}/api/push/subscribe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ..._bH() },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
        }),
      })

      setIsSubscribed(true)
      setIsLoading(false)
      return true
    } catch (e) {
      console.error("[THEIA] Push subscription error:", e)
      setIsLoading(false)
      return false
    }
  }, [isSupported])

  const unsubscribe = useCallback(async () => {
    setIsLoading(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        const subJson = subscription.toJSON()
        // Remove from backend
        await fetch(`${API_BASE}/api/push/subscribe`, {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: subJson.endpoint,
            keys: subJson.keys,
          }),
        })
        await subscription.unsubscribe()
      }
      setIsSubscribed(false)
    } catch (e) {
      console.error("[THEIA] Push unsubscribe error:", e)
    }
    setIsLoading(false)
  }, [])

  return { isSupported, isSubscribed, permission, isLoading, subscribe, unsubscribe }
}
