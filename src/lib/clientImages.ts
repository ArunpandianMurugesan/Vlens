"use client";

import type { ImageInput } from "./types";

export interface Attachment extends ImageInput {
  id: string;
  preview: string; // data: URL for the thumbnail
  name: string;
}

const OK_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
// Bigger images get scaled down anyway by the API; this keeps uploads small and fast.
const MAX_SIDE = 1568;
const MAX_BYTES = 3.75 * 1024 * 1024;

const readAsDataURL = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = src;
  });

// Turns a pasted or dropped file into something we can send: a supported
// type, at most MAX_SIDE pixels on its long side, and under the size limit.
export async function toAttachment(file: File): Promise<Attachment> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name || "That file"} isn't an image.`);
  const original = await readAsDataURL(file);
  const img = await loadImage(original);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const fits = scale === 1 && file.size <= MAX_BYTES && OK_TYPES.has(file.type);

  let dataUrl = original;
  // GIFs are kept as they are when they fit, so animations survive.
  if (!fits && !(file.type === "image/gif" && file.size <= MAX_BYTES)) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL("image/png");
    if ((dataUrl.length * 3) / 4 > MAX_BYTES) dataUrl = canvas.toDataURL("image/jpeg", 0.88);
  }

  const [, mediaType, data] = dataUrl.match(/^data:(image\/[a-z]+);base64,(.*)$/) ?? [];
  if (!data || !OK_TYPES.has(mediaType)) throw new Error("Couldn't read that image.");
  return { id: crypto.randomUUID(), mediaType: mediaType as ImageInput["mediaType"], data, preview: dataUrl, name: file.name || "pasted image" };
}
