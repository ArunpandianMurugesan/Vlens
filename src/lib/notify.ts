"use client";

// Desktop notifications for when Claude needs you or finishes, sent only while
// Vlens isn't the window you're looking at. Turned on and off in Settings.
let enabled = true;
export const setNotifications = (on: boolean) => {
  enabled = on;
};

export const notificationsSupported = () => typeof window !== "undefined" && "Notification" in window;

// In the Vlens Mac app, macOS refuses the page's own notifications (the app is
// never registered with Notification Center), so they go through the server,
// which posts them with macOS's `display notification` (api/notify).
const inMacApp = () => typeof navigator !== "undefined" && /Electron/.test(navigator.userAgent) && /Mac/.test(navigator.platform);

export const notificationPermission = (): NotificationPermission | "unsupported" =>
  inMacApp() ? "granted" : notificationsSupported() ? Notification.permission : "unsupported";

export async function askNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (inMacApp()) return "granted";
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

const viaMac = (title: string, body: string) =>
  void fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, body }) }).catch(() => {});

// Same tag within a short while = the same news; don't post it twice.
const recent = new Map<string, number>();

// `tag` replaces an earlier notification about the same thing instead of stacking.
export function notify(title: string, body: string, opts: { tag?: string; onClick?: () => void; force?: boolean } = {}) {
  if (notificationPermission() !== "granted") return;
  if (!opts.force && (!enabled || (document.visibilityState === "visible" && document.hasFocus()))) return;
  if (opts.tag) {
    const at = recent.get(opts.tag);
    if (at && Date.now() - at < 5_000) return;
    recent.set(opts.tag, Date.now());
  }
  if (inMacApp()) return viaMac(title, body.slice(0, 180));
  try {
    const n = new Notification(title, { body: body.slice(0, 180), tag: opts.tag, silent: false });
    n.onclick = () => {
      window.focus();
      opts.onClick?.();
      n.close();
    };
  } catch {}
}
