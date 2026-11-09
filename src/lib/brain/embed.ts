import "server-only";
import path from "node:path";
import { DATA_DIR } from "../paths";

// Text -> meaning vector, with a small open model on this Mac (transformers.js +
// onnxruntime, CPU). Nothing leaves the Mac. The model downloads once (~34 MB) into
// Vlens's data folder, loads when the brain is used, and unloads after a while idle.
const MODEL = "Xenova/bge-small-en-v1.5";
export const DIMS = 384;
const IDLE_MS = 10 * 60_000;

type Extractor = (text: string | string[], o: { pooling: "cls" | "mean"; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;
const g = globalThis as { lensEmbed?: Promise<Extractor> | null; lensEmbedTimer?: ReturnType<typeof setTimeout> };

async function load(): Promise<Extractor> {
  const t = await import("@huggingface/transformers");
  t.env.cacheDir = path.join(DATA_DIR, "brain", "models");
  t.env.allowLocalModels = true;
  const p = await t.pipeline("feature-extraction", MODEL, { dtype: "q8" });
  return p as unknown as Extractor;
}

function model(): Promise<Extractor> {
  g.lensEmbed ??= load().catch((e) => {
    g.lensEmbed = null;
    throw e;
  });
  clearTimeout(g.lensEmbedTimer);
  g.lensEmbedTimer = setTimeout(() => (g.lensEmbed = null), IDLE_MS); // let it go when the brain is quiet
  return g.lensEmbed;
}

// bge models search best when the question (not the stored text) gets this prefix.
const QUERY = "Represent this sentence for searching relevant passages: ";

export async function embed(texts: string[], kind: "doc" | "query" = "doc"): Promise<number[][]> {
  if (!texts.length) return [];
  const m = await model();
  const out = await m(kind === "query" ? texts.map((t) => QUERY + t) : texts, { pooling: "cls", normalize: true });
  const v: number[][] = [];
  for (let i = 0; i < texts.length; i++) v.push(Array.from(out.data.slice(i * DIMS, (i + 1) * DIMS)));
  return v;
}

// Both vectors are normalized, so the dot product is the cosine similarity.
export const similarity = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
