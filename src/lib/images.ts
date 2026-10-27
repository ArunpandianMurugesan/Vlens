import type { ImageInput } from "./types";

const TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024; // the API's per-image limit
const MAX_COUNT = 10;

// Checks images from a request body; returns an error message or the clean list.
export function parseImages(v: unknown): { images: ImageInput[] } | { error: string } {
  if (v === undefined) return { images: [] };
  if (!Array.isArray(v) || v.length > MAX_COUNT) return { error: `Attach up to ${MAX_COUNT} images.` };
  for (const im of v) {
    if (!im || !TYPES.has(im.mediaType) || typeof im.data !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(im.data))
      return { error: "Images must be PNG, JPEG, GIF or WebP." };
    if ((im.data.length * 3) / 4 > MAX_BYTES) return { error: "Each image must be under 5 MB." };
  }
  return { images: v.map((im) => ({ mediaType: im.mediaType, data: im.data })) };
}

export const imageBlocks = (images: ImageInput[]) =>
  images.map((im) => ({ kind: "image" as const, src: `data:${im.mediaType};base64,${im.data}` }));
