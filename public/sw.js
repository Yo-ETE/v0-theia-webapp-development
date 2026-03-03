/**
 * THEIA - Service Worker for Web Push Notifications
 * Handles push events, notification display, and click-to-open.
 * Works on mobile (Android/iOS 16.4+) and desktop browsers.
 */

const SW_VERSION = "2.0";

// ── Push Event ──────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = { title: "THEIA", body: "Nouvelle notification" };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    data = { title: "THEIA", body: event.data?.text() || "Notification" };
  }

  const options = {
    body: data.body || "",
    icon: "/icon-192x192.jpg",
    badge: "/icon-192x192.jpg",
    tag: data.tag || "theia-detection",
    // Renotify: show again even if same tag (important for repeated detections)
    renotify: true,
    // Vibration pattern: short-pause-long (mobile only)
    vibrate: [150, 80, 300],
    // Silent: false = use system notification sound on mobile
    silent: false,
    // Keep notification visible until user interacts
    requireInteraction: data.data?.requireInteraction || false,
    // Timestamp for ordering
    timestamp: Date.now(),
    // Custom data for click handling
    data: {
      ...(data.data || {}),
      url: data.data?.mission_id
        ? `/missions/${data.data.mission_id}`
        : "/dashboard",
    },
    // Actions (Android only -- ignored on iOS/desktop)
    actions: data.data?.mission_id
      ? [
          { action: "open", title: "Voir la mission" },
          { action: "dismiss", title: "Ignorer" },
        ]
      : [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "THEIA", options)
  );
});

// ── Notification Click ──────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Handle action buttons (Android)
  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Try to focus an existing THEIA tab
        for (const client of windowClients) {
          if (client.url.includes(targetUrl) && "focus" in client) {
            return client.focus();
          }
        }
        // Try any THEIA tab and navigate it
        for (const client of windowClients) {
          if ("focus" in client && "navigate" in client) {
            client.focus();
            return client.navigate(targetUrl);
          }
        }
        // Open new window/tab
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

// ── Notification Close (analytics / cleanup) ────────────────
self.addEventListener("notificationclose", (event) => {
  // Could send analytics event here if needed
});

// ── Activate: take control of all clients immediately ───────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      // Claim all open tabs so push works immediately after install
      self.clients.claim(),
      // Clean old caches if any
      caches.keys().then((names) =>
        Promise.all(names.map((name) => caches.delete(name)))
      ),
    ])
  );
});

// ── Install: skip waiting to activate immediately ───────────
self.addEventListener("install", (event) => {
  self.skipWaiting();
});
