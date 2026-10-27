import { resolveDir } from "@/lib/folders";
import { createSkill, deleteSkill, listSkills, readSkillFile, saveSkill, setSkillEnabled } from "@/lib/skills";

export const dynamic = "force-dynamic";

async function projectParam(p: string | null | undefined) {
  return p ? ((await resolveDir(p)) ?? undefined) : undefined;
}

// GET ?project=<folder> lists skills; add &path=<skill folder> to read its SKILL.md.
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const project = await projectParam(u.get("project"));
  const p = u.get("path");
  try {
    if (p) return Response.json({ content: await readSkillFile(p, project) });
    return Response.json(await listSkills(project));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}

type Body =
  | { action: "create"; scope: "user" | "project"; project?: string; name: string; description: string; body: string }
  | { action: "save"; path: string; content: string; project?: string }
  | { action: "toggle"; path: string; enabled: boolean; project?: string }
  | { action: "delete"; path: string; project?: string };

export async function POST(req: Request) {
  const b = (await req.json()) as Body;
  const project = await projectParam(b.project);
  try {
    switch (b.action) {
      case "create":
        if (b.scope === "project" && !project) throw new Error("Pick a project folder first.");
        return Response.json({ path: await createSkill({ ...b, project }) });
      case "save":
        await saveSkill(b.path, String(b.content ?? ""), project);
        return Response.json({ ok: true });
      case "toggle":
        return Response.json({ path: await setSkillEnabled(b.path, !!b.enabled, project) });
      case "delete":
        await deleteSkill(b.path, project);
        return Response.json({ ok: true });
    }
    return Response.json({ error: "bad action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
