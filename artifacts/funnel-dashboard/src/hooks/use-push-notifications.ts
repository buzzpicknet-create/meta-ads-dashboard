import { useState, useEffect, useCallback } from "react";

const BASE = "";
const API = BASE.endsWith("/") ? `${BASE}api` : `${BASE}/api`;

function urlBase64ToApplicationServerKey(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const bytes = Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

export type PushState =
  | "unsupported"   // browser doesn't support push
  | "denied"        // user blocked notifications in browser settings
  | "blocked"       // browser is blocking permission requests (quiet UI / site-blocked)
  | "subscribed"
  | "unsubscribed"
  | "loading";

/**
 * Syncs an existing browser-side push subscription to the server.
 * Silently succeeds or fails — does not throw.
 */
async function syncSubscriptionToServer(sub: PushSubscription): Promise<void> {
  try {
    const json = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
    await fetch(`${API}/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json),
      credentials: "include",
    });
  } catch {
    // silent — next page load will retry
  }
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>("loading");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    navigator.serviceWorker.getRegistration("/sw.js").then(async (reg) => {
      if (!reg) {
        setState("unsubscribed");
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Subscription exists in browser — re-sync to server on every load
        // This fixes cases where the initial POST to server failed silently
        await syncSubscriptionToServer(sub);
        setState("subscribed");
      } else {
        setState("unsubscribed");
      }
    });
  }, []);

  const subscribe = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;

    // Guard: if already denied in browser settings, don't try
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    setState("loading");
    try {
      let perm: NotificationPermission;
      try {
        perm = await Notification.requestPermission();
      } catch {
        // Chrome throws when it can't show the permission dialog
        // (quiet notification blocking, or site-blocked)
        setState("blocked");
        return;
      }

      if (perm === "denied") {
        setState("denied");
        return;
      }
      if (perm !== "granted") {
        // User dismissed the dialog without choosing — treat as blocked
        setState("blocked");
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;

      const keyRes = await fetch(`${API}/push/vapid-key`);
      const { publicKey } = await keyRes.json() as { publicKey: string };

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToApplicationServerKey(publicKey),
      });

      const json = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
      const saveRes = await fetch(`${API}/push/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
        credentials: "include",
      });

      if (!saveRes.ok) {
        // Server rejected — unsubscribe from browser too to keep state consistent
        await sub.unsubscribe();
        setState("unsubscribed");
        return;
      }

      setState("subscribed");
    } catch {
      setState("unsubscribed");
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setState("loading");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch(`${API}/push/subscribe`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
          credentials: "include",
        });
        await sub.unsubscribe();
      }
      setState("unsubscribed");
    } catch {
      setState("unsubscribed");
    }
  }, []);

  return { state, subscribe, unsubscribe };
}
