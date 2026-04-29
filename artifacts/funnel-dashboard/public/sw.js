const API_TRACK = "/api/push/track";

function track(notificationId, event) {
  if (!notificationId) return;
  fetch(API_TRACK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notificationId, event }),
    keepalive: true,
  }).catch(function () {});
}

self.addEventListener("push", function (event) {
  const data = event.data?.json() ?? {};
  const title = data.title ?? "إشعار جديد";
  const notificationId = data.notificationId ?? null;
  const options = {
    body: data.body ?? "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    dir: "rtl",
    lang: "ar",
    data: { url: data.url ?? "/", notificationId },
    vibrate: [200, 100, 200],
  };
  event.waitUntil(
    self.registration.showNotification(title, options).then(function () {
      track(notificationId, "shown");
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const notificationId = event.notification.data?.notificationId ?? null;
  const url = event.notification.data?.url ?? "/";
  track(notificationId, "clicked");
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        for (const client of clientList) {
          if (client.url.includes(url) && "focus" in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

self.addEventListener("notificationclose", function (event) {
  const notificationId = event.notification.data?.notificationId ?? null;
  track(notificationId, "dismissed");
});
