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

/** Where a media file's smaller copy goes: next to it, as <name>.thumb.webp. */
function thumbPath(p: { repoPath: string; src: string }) {
  const swap = (s: string) => s.replace(/\.[a-z0-9]+$/i, ".thumb.webp");
  return { repoPath: swap(p.repoPath), src: swap(p.src) };
}

/** A media file and its smaller copy, if it has one, to write. */
function mediaFiles(at: { repoPath: string; src: string }, media: Ingested) {
  const thumb = media.thumb ? thumbPath(at) : null;
  return {
    media: { src: at.src, ...media.media, ...(thumb && { thumb: thumb.src }) },
    files: [{ path: at.repoPath, content: media.buffer }, ...(thumb ? [{ path: thumb.repoPath, content: media.thumb! }] : [])],
  };
}

/** Every file of an item's media, to delete. */
const filesOf = (m: Item["media"]) => [repoPathOf(m.src), ...(m.thumb ? [repoPathOf(m.thumb)] : [])];

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

/** Thrown when an item with the id given to addItem exists already (a repeated upload). */
export class AlreadyAdded extends Error {
  constructor(public item: Item) {
    super(`Item ${item.id} was already added.`);
  }
}

/** Adds an item. `fixedId` (from an upload token) makes a repeated upload find the item it made. */
export async function addItem(fields: ItemFieldsInput, media: Ingested, fixedId?: string) {
  const store = getStore();
  const now = new Date();
  return store.mutate((snap) => {
    assertCategory(snap.site, fields.category);
    const made = fixedId ? snap.items.find((i) => i.id === fixedId) : undefined;
    if (made) throw new AlreadyAdded(made);
    let id = fixedId ?? newId(now);
    while (!fixedId && snap.items.some((i) => i.id === id)) id = newId(now);
    const stored = mediaFiles(mediaPath(id, media.ext), media);
    const item = {
      id,
      ...applyFields({ tags: [] }, fields),
      media: stored.media,
      createdAt: now.toISOString(),
    } as Item;
    return {
      items: [item, ...snap.items],
      addFiles: stored.files,
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
    if (next.inbox && fields.category) delete next.inbox; // a category files an inbox item
    const addFiles = [];
    const deleteFiles = [];
    if (media) {
      const stored = mediaFiles(mediaPath(id, media.ext, randomBytes(2).toString("hex")), media);
      next.media = stored.media;
      addFiles.push(...stored.files);
      deleteFiles.push(...filesOf(old.media));
    } else if (fields.width || fields.height) {
      next.media = { ...old.media, width: fields.width ?? old.media.width, height: fields.height ?? old.media.height };
    }
    const items = [...snap.items];
    items[idx] = next;
    return { items, addFiles, deleteFiles, message: `inspair: update "${next.title}" (${id})`, result: next };
  });
}

/** What the browser extension knows about a picture it collects. */
export type Collected = {
  pageUrl?: string;
  pageTitle?: string;
  imageUrl?: string;
  alt?: string;
  /** What the collector said about it when collecting, e.g. 这个按钮动效好看. */
  remark?: string;
  /** The category the collector guessed when collecting; the picture still waits in the inbox. */
  category?: string;
};

/** The line of an inbox picture's note that holds what the collector said. */
export const REMARK = "我的想法：";

const clip = (s: string | undefined, n: number) => (s ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

/**
 * Puts a picture collected from a web page into the inbox: stored and committed, but kept off the site
 * until an agent looks at it and gives it a title, category, tags and a note (organize_items). The same
 * picture collected again (same image address) returns the item already made.
 * The commit message starts "inspair: collect", which tells Vercel it needs no deploy.
 */
export async function collectItem(media: Ingested, from: Collected) {
  const store = getStore();
  const now = new Date();
  return store.mutate((snap) => {
    const same = from.imageUrl ? snap.items.find((i) => i.imageUrl === from.imageUrl) : undefined;
    if (same) return { message: "", result: { item: same, duplicate: true, inbox: snap.items.filter((i) => i.inbox).length } };
    let id = newId(now);
    while (snap.items.some((i) => i.id === id)) id = newId(now);
    const stored = mediaFiles(mediaPath(id, media.ext), media);
    const title = clip(from.alt, 80) || clip(from.pageTitle, 80) || "未命名";
    const note = [
      from.remark && `${REMARK}${clip(from.remark, 300)}`,
      from.pageTitle && `采集自「${clip(from.pageTitle, 200)}」`,
      from.alt && `图片说明：${clip(from.alt, 300)}`,
    ]
      .filter(Boolean)
      .join("\n");
    const item = {
      id,
      title,
      // a guess made while collecting; the picture stays in the inbox until it is filed
      category: from.category && snap.site.categories.some((c) => c.id === from.category) ? from.category : "",
      tags: [],
      media: stored.media,
      ...(from.pageUrl || from.imageUrl ? { source: from.pageUrl || from.imageUrl } : {}),
      ...(note ? { note } : {}),
      ...(from.imageUrl ? { imageUrl: from.imageUrl } : {}),
      inbox: true,
      createdAt: now.toISOString(),
    } as Item;
    return {
      items: [item, ...snap.items],
      addFiles: stored.files,
      message: `inspair: collect "${title}" (${id})`,
      result: { item, duplicate: false, inbox: snap.items.filter((i) => i.inbox).length + 1 },
    };
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
      deleteFiles: gone.flatMap((i) => filesOf(i.media)),
      message: `inspair: delete ${gone.length} item(s)`,
      result: { deleted: gone.map((i) => i.id), missing },
    };
  });
}

/**
 * Throw away pictures still waiting in the inbox (the browser extension's 收件箱 page). Filed items can't be
 * removed this way. The commit message starts "inspair: collect", so Vercel skips the build: the site never
 * showed them.
 */
export async function discardCollected(ids: string[]) {
  const store = getStore();
  return store.mutate((snap) => {
    const gone = snap.items.filter((i) => ids.includes(i.id) && i.inbox);
    if (!gone.length) throw new Error("收件箱里没有这些图片，可能已经整理上线或删掉了。");
    const left = snap.items.filter((i) => !gone.includes(i));
    return {
      items: left,
      deleteFiles: gone.flatMap((i) => filesOf(i.media)),
      message: `inspair: collect discard ${gone.length} picture(s) (${gone.map((i) => i.id).join(", ")})`,
      result: { deleted: gone.map((i) => i.id), inbox: left.filter((i) => i.inbox).length },
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
  q: { query?: string; category?: string; tag?: string; has_prompt?: boolean; inbox?: boolean; limit?: number; offset?: number },
) {
  if (q.category) assertCategory(snap.site, q.category);
  const needle = q.query?.trim().toLowerCase();
  const names = new Map(snap.site.categories.map((c) => [c.id, `${c.name}\n${c.label}`]));
  const hits = snap.items.filter((i) => {
    if (Boolean(i.inbox) !== Boolean(q.inbox)) return false;
    if (q.category && i.category !== q.category) return false;
    if (q.tag && !i.tags.includes(q.tag)) return false;
    if (q.has_prompt && !i.prompt) return false;
    if (needle) {
      const hay = [i.title, i.prompt, i.negativePrompt, i.note, i.model, i.source, i.id, names.get(i.category), ...i.tags]
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

/* ------------------------------------------------------------- organizing */

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .describe("#rrggbb");

export const OrganizeInput = z.object({
  changes: z
    .array(
      z.object({
        id: z.string(),
        category: z.string().optional(),
        title: text(200).min(1).optional(),
        tags: z.array(text(40)).max(20).optional().describe("Replaces all tags of the item"),
        add_tags: z.array(text(40)).max(20).optional(),
        remove_tags: z.array(text(40)).max(20).optional(),
        note: text(4000).optional().describe("Replaces the note; empty string clears it"),
        color: hex.optional(),
        featured: z.boolean().optional(),
        inbox: z
          .literal(false)
          .optional()
          .describe("Files an inbox item; giving it a category does the same"),
      }).strict(),
    )
    .max(300)
    .default([])
    .describe("Per-item edits"),
  rename_tags: z
    .array(z.object({ from: text(40).min(1), to: text(40).describe('New name; "" removes the tag everywhere') }).strict())
    .max(100)
    .default([])
    .describe("Rename or merge a tag on every item that has it"),
  new_categories: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        name: z.string().min(1).max(30),
        label: z.string().min(1).max(12),
      }).strict(),
    )
    .max(20)
    .default([])
    .describe("Categories to create (or rename) before the edits are applied"),
  dry_run: z
    .boolean()
    .default(true)
    .describe("true (default): only return the plan, change nothing. false: write everything in one commit."),
});
export type OrganizeSpec = z.infer<typeof OrganizeInput>;

type Diff = { id: string; title: string; changes: Record<string, unknown> };

/** Works out what an organize request would do, without writing anything. */
export function planOrganize(snap: Snapshot, spec: OrganizeSpec) {
  const errors: string[] = [];
  const categories = snap.site.categories.map((c) => ({ ...c }));
  for (const nc of spec.new_categories) {
    const i = categories.findIndex((c) => c.id === nc.id);
    if (i === -1) categories.push(nc);
    else categories[i] = nc;
  }
  const valid = new Set(categories.map((c) => c.id));
  const now = new Date().toISOString();
  const items = snap.items.map((i) => ({ ...i, tags: [...i.tags] }));
  const byId = new Map(items.map((i) => [i.id, i]));

  for (const { from, to } of spec.rename_tags) {
    for (const item of items) {
      if (!item.tags.includes(from)) continue;
      item.tags = cleanTags(item.tags.map((t) => (t === from ? to : t)).filter(Boolean));
    }
  }

  const seen = new Set<string>();
  for (const ch of spec.changes) {
    const item = byId.get(ch.id);
    if (!item) {
      errors.push(`No item with id "${ch.id}".`);
      continue;
    }
    if (seen.has(ch.id)) errors.push(`Item "${ch.id}" appears more than once in changes; merge them.`);
    seen.add(ch.id);
    if (ch.category !== undefined) {
      if (!valid.has(ch.category)) errors.push(`Unknown category "${ch.category}" for "${ch.id}". Add it in new_categories.`);
      else item.category = ch.category;
    }
    if (ch.title !== undefined) item.title = ch.title;
    if (ch.tags) item.tags = cleanTags(ch.tags);
    if (ch.add_tags) item.tags = cleanTags([...item.tags, ...ch.add_tags]);
    if (ch.remove_tags) item.tags = item.tags.filter((t) => !ch.remove_tags!.includes(t));
    if (ch.note !== undefined) {
      if (ch.note) item.note = ch.note;
      else delete item.note;
    }
    if (ch.color !== undefined) item.color = ch.color;
    if (ch.featured !== undefined) {
      if (ch.featured) item.featured = true;
      else delete item.featured;
    }
    // an inbox item is filed by giving it a category (or inbox: false with the category it has)
    if (item.inbox && (ch.category !== undefined || ch.inbox === false)) {
      if (valid.has(item.category)) delete item.inbox;
      else errors.push(`"${ch.id}" is in the inbox: give it a category to file it.`);
    }
  }

  const diffs: Diff[] = [];
  snap.items.forEach((before, k) => {
    const after = items[k];
    const changes: Record<string, unknown> = {};
    if (before.category !== after.category) changes.category = [before.category, after.category];
    if (before.title !== after.title) changes.title = [before.title, after.title];
    const added = after.tags.filter((t) => !before.tags.includes(t));
    const removed = before.tags.filter((t) => !after.tags.includes(t));
    if (added.length) changes.tags_added = added;
    if (removed.length) changes.tags_removed = removed;
    if ((before.note ?? "") !== (after.note ?? "")) changes.note = [before.note ?? "", after.note ?? ""];
    if (before.color !== after.color) changes.color = [before.color, after.color];
    if (Boolean(before.featured) !== Boolean(after.featured)) changes.featured = [Boolean(before.featured), Boolean(after.featured)];
    if (before.inbox && !after.inbox) changes.filed = "out of the inbox, onto the site";
    if (Object.keys(changes).length) {
      after.updatedAt = now;
      diffs.push({ id: after.id, title: after.title, changes });
    }
  });

  const siteChanged = JSON.stringify(categories) !== JSON.stringify(snap.site.categories);
  return {
    errors,
    diffs,
    items,
    site: siteChanged ? { ...snap.site, categories } : undefined,
    newCategories: categories.filter((c) => !snap.site.categories.some((o) => o.id === c.id)),
  };
}

/** Plans the request; unless it is a dry run, writes every change in a single commit. */
export async function organizeItems(spec: OrganizeSpec) {
  if (!spec.changes.length && !spec.rename_tags.length && !spec.new_categories.length)
    throw new Error("Nothing to do: pass changes: [{ id, …fields }], rename_tags: [{ from, to }] or new_categories.");
  const store = getStore();
  if (spec.dry_run) {
    const plan = planOrganize(await store.read(), spec);
    return { applied: false, ...summary(plan) };
  }
  const { result, commit } = await store.mutate((snap) => {
    const plan = planOrganize(snap, spec);
    if (plan.errors.length) throw new Error(`Nothing was changed:\n- ${plan.errors.join("\n- ")}`);
    return {
      items: plan.diffs.length ? plan.items : undefined,
      site: plan.site,
      message: `inspair: organize ${plan.diffs.length} item(s)`,
      result: summary(plan),
    };
  });
  return { applied: true, commit, ...result };
}

function summary(plan: ReturnType<typeof planOrganize>) {
  return {
    items_changed: plan.diffs.length,
    categories_added: plan.newCategories,
    errors: plan.errors,
    changes: plan.diffs,
  };
}
