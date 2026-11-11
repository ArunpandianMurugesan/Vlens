import { finishLogin } from "@/lib/harness/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Where the harness's sign-in sends you back (in your browser). Trades the code for
// tokens, then says so; the Harness page in Vlens notices on its own.
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  let msg = "Signed in to the harness. You can close this tab and go back to Vlens.";
  let ok = true;
  try {
    if (u.get("error")) throw new Error(u.get("error_description") ?? u.get("error")!);
    await finishLogin(u.get("code") ?? "", u.get("state") ?? "");
  } catch (e) {
    ok = false;
    msg = `Sign-in didn't finish: ${(e as Error).message}`;
  }
  const esc = msg.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Vlens</title><body style="font:15px -apple-system,system-ui;display:flex;align-items:center;justify-content:center;height:90vh;color:${ok ? "#1a7f37" : "#b42318"}">${esc}</body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" }, status: ok ? 200 : 400 },
  );
}
