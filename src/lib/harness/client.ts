import "server-only";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../paths";

// Vlens talking to the Vendasta dev agent harness directly, the way claude.ai's
// connector does: its own sign-in (OAuth with PKCE, the client registered once
// with the harness), then MCP tool calls over HTTPS. No Claude in the middle, so
// watching runs is instant and free.
//
//   harness-auth.json (in Vlens's data folder, readable by you only): the
//   registered client and your tokens. Never logged, never sent anywhere else.

export const HARNESS = "https://developer-agent-harness.vendasta-internal.com";
const MCP = `${HARNESS}/mcp`;
const FILE = path.join(DATA_DIR, "harness-auth.json");

interface Auth {
  redirectUri: string;
  clientId: string;
  access?: string;
  refresh?: string;
  expiresAt?: number; // ms
  signedInAt?: string;
}

async function load(): Promise<Auth | null> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return null;
  }
}
async function store(a: Auth | null) {
  if (!a) return fs.rm(FILE, { force: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE + ".tmp", JSON.stringify(a), { mode: 0o600 });
  await fs.rename(FILE + ".tmp", FILE);
}

const g = globalThis as { lensHarnessPending?: Map<string, { verifier: string; redirectUri: string; at: number }>; lensHarnessSession?: { token: string; id: string | null } };
const pending = (g.lensHarnessPending ??= new Map());

export async function status(): Promise<{ signedIn: boolean; since: string | null }> {
  const a = await load();
  return { signedIn: !!a?.refresh || !!(a?.access && (a.expiresAt ?? 0) > Date.now()), since: a?.signedInAt ?? null };
}

// Step 1: the harness's sign-in page (Google, then a consent screen naming Vlens).
export async function startLogin(origin: string): Promise<string> {
  const redirectUri = `${origin}/api/harness/callback`;
  let a = await load();
  if (!a || a.redirectUri !== redirectUri) {
    // Register Vlens as a public client (no secret: PKCE protects the code).
    const r = await fetch(`${HARNESS}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Vlens", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", scope: "harness" }),
    });
    const d = (await r.json().catch(() => ({}))) as { client_id?: string; error_description?: string; error?: string };
    if (!r.ok || !d.client_id) throw new Error(`The harness didn't register Vlens: ${d.error_description ?? d.error ?? r.status}`);
    a = { redirectUri, clientId: d.client_id };
    await store(a);
  }
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("base64url");
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60_000) pending.delete(k);
  pending.set(state, { verifier, redirectUri, at: Date.now() });
  const q = new URLSearchParams({
    response_type: "code",
    client_id: a.clientId,
    redirect_uri: redirectUri,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
    scope: "harness",
    resource: MCP,
  });
  return `${HARNESS}/authorize?${q}`;
}

// Step 2: the harness sends you back with a code; trade it for tokens.
export async function finishLogin(code: string, state: string) {
  const p = pending.get(state);
  if (!p) throw new Error("This sign-in expired or didn't start in Vlens. Start it again from the Harness page.");
  pending.delete(state);
  const a = await load();
  if (!a) throw new Error("Vlens isn't registered with the harness. Start the sign-in again.");
  await tokens(a, { grant_type: "authorization_code", code, redirect_uri: p.redirectUri, code_verifier: p.verifier });
}

async function tokens(a: Auth, body: Record<string, string>) {
  const r = await fetch(`${HARNESS}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, client_id: a.clientId, resource: MCP }),
  });
  const d = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !d.access_token) {
    if (body.grant_type === "refresh_token") await store({ redirectUri: a.redirectUri, clientId: a.clientId }); // signed out
    throw new Error(`Harness sign-in failed: ${d.error_description ?? d.error ?? r.status}`);
  }
  const next: Auth = { ...a, access: d.access_token, refresh: d.refresh_token ?? a.refresh, expiresAt: Date.now() + (d.expires_in ?? 3600) * 1000, signedInAt: a.signedInAt ?? new Date().toISOString() };
  if (body.grant_type === "authorization_code") next.signedInAt = new Date().toISOString();
  await store(next);
  return next.access!;
}

let refreshing: Promise<string> | null = null;
async function accessToken(): Promise<string> {
  const a = await load();
  if (!a?.access && !a?.refresh) throw new NotSignedIn();
  if (a.access && (a.expiresAt ?? 0) > Date.now() + 60_000) return a.access;
  if (!a.refresh) throw new NotSignedIn();
  refreshing ??= tokens(a, { grant_type: "refresh_token", refresh_token: a.refresh }).finally(() => (refreshing = null));
  return refreshing;
}

export class NotSignedIn extends Error {
  constructor() {
    super("Sign in to the harness first.");
  }
}

export async function signOut() {
  const a = await load();
  if (a?.refresh)
    await fetch(`${HARNESS}/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: a.refresh, client_id: a.clientId }) }).catch(() => {});
  if (a) await store({ redirectUri: a.redirectUri, clientId: a.clientId });
  g.lensHarnessSession = undefined;
}

// ── MCP over HTTPS (JSON-RPC; the answer may come as JSON or as a short event stream) ──

let seq = 0;
async function rpc(token: string, session: string | null, method: string, params?: unknown, notify = false) {
  const r = await fetch(MCP, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...(session ? { "Mcp-Session-Id": session } : {}),
    },
    body: JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++seq, method, params }),
  });
  if (r.status === 401) throw Object.assign(new Error("unauthorized"), { status: 401 });
  if (r.status === 404 && session) throw Object.assign(new Error("session gone"), { status: 404 });
  const text = await r.text();
  if (!r.ok) throw new Error(`The harness answered ${r.status}: ${text.slice(0, 200)}`);
  if (notify) return { session: r.headers.get("mcp-session-id"), msg: null };
  const json = r.headers.get("content-type")?.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .find((m) => m && "id" in m)
    : JSON.parse(text);
  return { session: r.headers.get("mcp-session-id"), msg: json as { result?: unknown; error?: { message: string } } };
}

async function session(token: string): Promise<string | null> {
  const s = g.lensHarnessSession;
  if (s && s.token === token) return s.id;
  const init = await rpc(token, null, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Vlens", version: "1" } });
  if (init.msg?.error) throw new Error(init.msg.error.message);
  const id = init.session;
  await rpc(token, id, "notifications/initialized", undefined, true);
  g.lensHarnessSession = { token, id };
  return id;
}

// One harness tool, with its answer parsed (most tools answer with JSON text).
export async function callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken();
    try {
      const sid = await session(token);
      const { msg } = await rpc(token, sid, "tools/call", { name, arguments: args });
      if (msg?.error) throw new Error(msg.error.message);
      const res = msg?.result as { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: unknown } | undefined;
      const text = (res?.content ?? []).map((c) => c.text ?? "").join("\n");
      if (res?.isError) throw new Error(text.replace(/^Error:\s*/, "").slice(0, 500) || `${name} failed.`);
      if (res?.structuredContent !== undefined) return res.structuredContent as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as T;
      }
    } catch (e) {
      const st = (e as { status?: number }).status;
      g.lensHarnessSession = undefined;
      if (st === 401 && attempt === 0) {
        const a = await load();
        if (a) await store({ ...a, expiresAt: 0 }); // force a refresh, then try once more
        continue;
      }
      if (st === 404 && attempt === 0) continue; // its session expired: start a new one
      throw e;
    }
  }
  throw new Error(`${name} failed.`);
}
