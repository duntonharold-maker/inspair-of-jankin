/** Operations shared by the MCP tools and the upload endpoint. */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { fetchMedia, ingest, type Ingested } from "./media";
import { MEDIA_DIR, getStore, type Snapshot } from "./store";
import type { Item, Site } from "./types";

/* ------------------------------------------------------------- input schemas */

const text = (max: number) => z.string().trim().max(max);

export const ItemFields = z.object({
  title: text(200).min(1).describe("Short title, e.g. 「玻璃质感天气图标」"),
  category: z.string().describe("Category id — call list_categories to see the valid ids"),
  tags: z.array(text(40)).max(20).optional().describe("Free-form tags, e.g. [\"玻璃拟态\", \"蓝紫\"]"),
  prompt: text(8000).optional().describe("The generation prompt, verbatim"),
  negative_prompt: text(4000).optional(),
  model: text(120).optional().describe("Tool or model, e.g. Midjourney v7, GPT Image, Flux, Jimeng"),
  params: text(500).optional().describe("Extra parameters, e.g. --ar 3:4 --stylize 250"),
  source: text(1000).optional().describe("Where it was found (URL or text)"),
  note: text(4000).optional().describe("Why it is worth keeping / what to learn from it"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe("Accent colour as #rrggbb"),
  featured: z.boolean().optional().describe("Pin to the card wall on the home page"),
  width: z.number().int().positive().optional().describe("Media width in px (only needed for videos)"),
  height: z.number().int().positive().optional().describe("Media height in px (only needed for videos)"),
});
export type ItemFieldsInput = z.infer<typeof ItemFields>;

export const MediaInput = z.object({
  media_url: z.string().optional().describe("Direct URL of an image / GIF / video / SVG / Lottie JSON to download"),
  media_text: z
    .string()
    .optional()
    .describe("Inline SVG markup or Lottie JSON text — ideal for animated icons"),
  media_base64: z.string().optional().describe("Base64 file content. Only for small files (< 1 MB)."),
  file_name: z.string().optional().describe("Original file name, helps detect the type"),
});
export type MediaInputT = z.infer<typeof MediaInput>;

/* ------------------------------------------------------------------ helpers */

export function newId(now = new Date()) {
  const d = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `${d}-${randomBytes(4).readUInt32BE(0).toString(36).padStart(6, "0").slice(-6)}`;
}

function cleanTags(tags?: string[]) {
  const seen = new Set<string>();
  return (tags ?? []).map((t) => t.trim()).filter((t) => t && !seen.has(t) && seen.add(t));
}

function assertCategory(site: Site, id: string) {
  if (!site.categories.some((c) => c.id === id)) {
    const list = site.categories.map((c) => `${c.id} (${c.label})`).join(", ");
    throw new Error(`Unknown category "${id}". Valid ids: ${list}. Use upsert_category to add a new one.`);
  }
}

export async function loadMedia(input: MediaInputT, size?: { width?: number; height?: number }) {
  const sources = [input.media_url, input.media_text, input.media_base64].filter(Boolean);
  if (sources.length === 0) return null;
  if (sources.length > 1) throw new Error("Give only one of media_url, media_text, media_base64.");
  let buffer: Buffer;
  let filename = input.file_name;
  if (input.media_url) {
    const got = await fetchMedia(input.media_url);
    buffer = got.buffer;
    filename ??= got.filename;
  } else if (input.media_text) {
    buffer = Buffer.from(input.media_text, "utf8");
  } else {
    buffer = Buffer.from(input.media_base64!.replace(/^data:[^,]*,/, ""), "base64");
  }
  return ingest(buffer, { filename, ...size });
}

function mediaPath(id: string, ext: string, version?: string) {
  const name = version ? `${id}-${version}.${ext}` : `${id}.${ext}`;
  return { repoPath: `${MEDIA_DIR}/${name}`, src: `/media/${name}` };
}

const repoPathOf = (src: string) => `public${src}`;

function applyFields(base: Partial<Item>, f: Partial<ItemFieldsInput>): Partial<Item> {
  const out: Partial<Item> = { ...base };
  const set = <K extends keyof Item>(k: K, v: Item[K] | undefined) => {
    if (v === undefined) return;
    if (typeof v === "string" && v === "") delete out[k];
    else out[k] = v;
  };
  set("title", f.title);
  set("category", f.category);
  if (f.tags) out.tags = cleanTags(f.tags);
  set("prompt", f.prompt);
  set("negativePrompt", f.negative_prompt);
  set("model", f.model);
  set("params", f.params);
  set("source", f.source);
  set("note", f.note);
  set("color", f.color);
  if (f.featured !== undefined) out.featured = f.featured || undefined;
  return out;
}

/* --------------------------------------------------------------- operations */

export async function addItem(fields: ItemFieldsInput, media: Ingested) {
  const store = getStore();
  const now = new Date();
  return store.mutate((snap) => {
    assertCategory(snap.site, fields.category);
    let id = newId(now);
    while (snap.items.some((i) => i.id === id)) id = newId(now);
    const { repoPath, src } = mediaPath(id, media.ext);
    const item = {
      id,
      ...applyFields({ tags: [] }, fields),
      media: { src, ...media.media },
      createdAt: now.toISOString(),
    } as Item;
    return {
      items: [item, ...snap.items],
      addFiles: [{ path: repoPath, content: media.buffer }],
      message: `inspair: add "${item.title}" (${id})`,
      result: item,
    };
  });
}

export async function updateItem(id: string, fields: Partial<ItemFieldsInput>, media: Ingested | null) {
  const store = getStore();
  return store.mutate((snap) => {
    const idx = snap.items.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error(`No item with id "${id}".`);
    if (fields.category) assertCategory(snap.site, fields.category);
    const old = snap.items[idx];
    const next = { ...applyFields(old, fields), updatedAt: new Date().toISOString() } as Item;
    const addFiles = [];
    const deleteFiles = [];
    if (media) {
      const { repoPath, src } = mediaPath(id, media.ext, randomBytes(2).toString("hex"));
      next.media = { src, ...media.media };
      addFiles.push({ path: repoPath, content: media.buffer });
      deleteFiles.push(repoPathOf(old.media.src));
    } else if (fields.width || fields.height) {
      next.media = { ...old.media, width: fields.width ?? old.media.width, height: fields.height ?? old.media.height };
    }
    const items = [...snap.items];
    items[idx] = next;
    return { items, addFiles, deleteFiles, message: `inspair: update "${next.title}" (${id})`, result: next };
  });
}

export async function deleteItems(ids: string[]) {
  const store = getStore();
  return store.mutate((snap) => {
    const gone = snap.items.filter((i) => ids.includes(i.id));
    const missing = ids.filter((id) => !gone.some((i) => i.id === id));
    if (!gone.length) throw new Error(`No items found for: ${ids.join(", ")}`);
    return {
      items: snap.items.filter((i) => !ids.includes(i.id)),
      deleteFiles: gone.map((i) => repoPathOf(i.media.src)),
      message: `inspair: delete ${gone.length} item(s)`,
      result: { deleted: gone.map((i) => i.id), missing },
    };
  });
}

export async function upsertCategory(cat: { id: string; name: string; label: string }) {
  const store = getStore();
  return store.mutate((snap) => {
    const categories = [...snap.site.categories];
    const idx = categories.findIndex((c) => c.id === cat.id);
    if (idx === -1) categories.push(cat);
    else categories[idx] = cat;
    return {
      site: { ...snap.site, categories },
      message: `inspair: ${idx === -1 ? "add" : "update"} category ${cat.id}`,
      result: categories,
    };
  });
}

export function search(
  snap: Snapshot,
  q: { query?: string; category?: string; tag?: string; has_prompt?: boolean; limit?: number; offset?: number },
) {
  const needle = q.query?.trim().toLowerCase();
  const hits = snap.items.filter((i) => {
    if (q.category && i.category !== q.category) return false;
    if (q.tag && !i.tags.includes(q.tag)) return false;
    if (q.has_prompt && !i.prompt) return false;
    if (needle) {
      const hay = [i.title, i.prompt, i.negativePrompt, i.note, i.model, i.source, i.id, ...i.tags]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 20;
  return { total: hits.length, items: hits.slice(offset, offset + limit) };
}
