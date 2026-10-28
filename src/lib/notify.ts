"use client";

// Desktop notifications for when Claude needs you or finishes, sent only while
// Vlens isn't the window you're looking at. Turned on and off in Settings.
let enabled = true;
export const setNotifications = (on: boolean) => {
  enabled = on;
};

export const notificationsSupported = () => typeof window !== "undefined" && "Notification" in window;

export async function askNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

// `tag` replaces an earlier notification about the same thing instead of stacking.
export function notify(title: string, body: string, opts: { tag?: string; onClick?: () => void; force?: boolean } = {}) {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  if (!opts.force && (!enabled || (document.visibilityState === "visible" && document.hasFocus()))) return;
  try {
    const n = new Notification(title, { body: body.slice(0, 180), tag: opts.tag, silent: false });
    n.onclick = () => {
      window.focus();
      opts.onClick?.();
      n.close();
    };
  } catch {}
}
