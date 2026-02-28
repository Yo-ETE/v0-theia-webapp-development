/**
 * THEIA - Service Worker for Web Push Notifications
 */

// Listen for push events from the server
self.addEventListener("push", (event) => {
  let data = { title: "THEIA", body: "Nouvelle notification" };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    // fallback to text
    data = { title: "THEIA", body: event.data?.text() || "Notification" };
  }

  const options = {
    body: data.body || "",
    icon: "/icon-512x512.jpg",
    badge: "/icon-512x512.jpg",
    tag: data.tag || "theia-default",
    renotify: true,
    vibrate: [200, 100, 200],
    data: data.data || {},
  };

  event.waitUntil(self.registration.showNotification(data.title || "THEIA", options));
});

// Handle notification click -- open the relevant mission page
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const missionId = event.notification.data?.mission_id;
  const targetUrl = missionId ? `/missions/${missionId}` : "/dashboard";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Focus existing tab if possible
      for (const client of windowClients) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      // Open new tab
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
