import "server-only";
import { randomUUID } from "node:crypto";
import { jsonStore } from "./jsonStore";
import { macNotify } from "./macNotify";
import type { Bot, BotNotification } from "./types";

// What your bots want you to know: the bell at the top right of Vlens. Not Mac
// notifications (those are for Claude sessions); a bot only lands here, and
// each one points at the thing in its Inbox it's about.
const store = jsonStore<BotNotification[]>("bot-notifications.json", () => []);
const KEEP = 300;

export async function notifyBot(b: Bot, n: { title: string; body?: string; target?: BotNotification["target"] }) {
  await store.update((all) => {
    // Something it already told you about, again: update that one instead of adding another.
    const same = n.target?.key ? all.findIndex((x) => x.bot === b.id && x.target?.key === n.target!.key) : -1;
    const next: BotNotification = { id: randomUUID().slice(0, 12), bot: b.id, botName: b.name, avatar: b.avatar, at: new Date().toISOString(), title: n.title.slice(0, 200), body: (n.body ?? "").slice(0, 400), target: n.target, read: false };
    if (same >= 0) all.splice(same, 1);
    all.unshift(next);
    all.splice(KEEP);
  });
}

// The same, if you want to hear about this kind of thing (its Settings, Notifications),
// and as a Mac notification too when you turned that on.
export async function alertBot(b: Bot, kind: "needsYou" | "finished" | "failed", n: { title: string; body?: string; target?: BotNotification["target"] }) {
  if (b.notify?.[kind] === false) return;
  await notifyBot(b, n);
  if (b.notify?.mac) void macNotify(`${b.name}: ${n.title}`, n.body ?? "").catch(() => {});
}

export const listNotifications = () => store.load();

export function markRead(ids: string[] | "all", bot?: string) {
  return store.update((all) => {
    for (const n of all) if (ids === "all" ? !bot || n.bot === bot : ids.includes(n.id)) n.read = true;
  });
}

// It's been dealt with (you answered on the card): its bell item no longer needs you.
export function markTargetRead(bot: string, key: string) {
  return store.update((all) => {
    for (const n of all) if (n.bot === bot && n.target?.key === key) n.read = true;
  });
}
