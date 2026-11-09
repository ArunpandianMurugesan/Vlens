// The Mac's own folder window: as a sheet on the Vlens window in the app, or
// shown by the server (AppleScript) in a plain browser. -> the path, or null.
type App = { chooseFolder?: (start: string | null) => Promise<string | null> };

export async function chooseFolder(start?: string | null): Promise<string | null> {
  const app = (window as unknown as { vlensApp?: App }).vlensApp;
  if (app?.chooseFolder) return app.chooseFolder(start ?? null);
  const r = await fetch("/api/folders/choose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start: start ?? null }) });
  const d = (await r.json().catch(() => ({}))) as { path?: string | null; error?: string };
  if (d.error) throw new Error(d.error);
  return d.path ?? null;
}
