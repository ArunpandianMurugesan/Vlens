import { execFile } from "node:child_process";
import { getProvider, isSupported, PROVIDER_CHOICES } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The AI agents Vlens can drive, for Settings: which one is in use, which are
// installed here, and which Vlens has an adapter for yet (lib/providers).
const which = (bin: string) =>
  new Promise<boolean>((resolve) => execFile("/bin/zsh", ["-lc", `command -v ${bin}`], { timeout: 5000 }, (e, out) => resolve(!e && !!String(out).trim())));

export async function GET() {
  const current = await getProvider();
  const mine = current.detect();
  const list = await Promise.all(
    PROVIDER_CHOICES.map(async (p) => {
      const supported = isSupported(p.id);
      if (p.id === current.id) return { ...p, supported, ...(await mine) };
      return { ...p, supported, installed: await which(p.binary), version: null };
    }),
  );
  return Response.json({ current: current.id, capabilities: current.capabilities, providers: list });
}
