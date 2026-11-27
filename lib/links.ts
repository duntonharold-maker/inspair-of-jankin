/**
 * Saved websites (/links): what a site is, its main strengths, its price, and what I thought of it.
 * Shared by the MCP tools (add, update, search, delete) and the browser extension's 收藏这个网站, which
 * puts a site into the inbox with the page's own text for whoever files it.
 */
import sharp from "sharp";
import { z } from "zod";
import { newId } from "./ops";
import { MEDIA_DIR, getStore, type Snapshot } from "./store";
import { LINK_PRICES, type Link, type Site } from "./types";

const text = (max: number) => z.string().trim().max(max);

export const LinkFields = z.object({
  url: z.string().url().describe("The site's address, e.g. https://mobbin.com"),
  name: text(80).min(1).optional().describe("The site's name, e.g. Mobbin (defaults to its domain)"),
  category: z.string().describe("Link category id — list_categories shows link_categories"),
  pitch: text(120).optional().describe("One line on what it is, in Chinese, e.g. 「真实 App 和网站的界面截图库」"),
  pros: z
    .array(text(120).min(1))
    .max(6)
    .optional()
    .describe("Its main strengths: 3–5 concrete points in Chinese, each one line, from what the site actually offers"),
  price: z.enum(LINK_PRICES).optional().describe("free, freemium (free with paid plans) or paid"),
  tags: z.array(text(30)).max(8).optional(),
  note: text(1000).optional().describe("What the user said about it, in their own words"),
});
export type LinkFieldsInput = z.infer<typeof LinkFields>;

/** One address per site page: no fragment, no tracking parameters, no trailing slash. */
export function normalizeUrl(raw: string) {
  const u = new URL(raw);
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|fbclid|gclid|spm)/i.test(k)) u.searchParams.delete(k);
  u.hostname = u.hostname.toLowerCase();
  const s = u.toString();
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
export const domainOf = (raw: string) => {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
};

const iconPath = (id: string) => ({ repoPath: `${MEDIA_DIR}/link-${id}.png`, src: `/media/link-${id}.png` });

/** The site's icon as a 128px PNG: icons the page names first, then its touch icon, then a favicon service. */
async function iconFor(url: string, hints: string[] = []) {
  const { origin, hostname } = new URL(url);
  const tries = [
    ...hints.filter((h) => /^https?:/.test(h) && !/\.ico(\?|$)/i.test(h)),
    `${origin}/apple-touch-icon.png`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`,
  ];
  for (const at of tries) {
    try {
      const res = await fetch(at, { redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0 (compatible; inspair-bot/1.0)" } });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 2 * 1024 * 1024) continue;
      const img = sharp(buf, { density: 300 });
      const meta = await img.metadata();
      if (!meta.width || meta.width < 16) continue;
      return await img.resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    } catch {
      // try the next one
    }
  }
  return null;
}

function assertLinkCategory(site: Site, id: string) {
  if (!site.linkCategories.some((c) => c.id === id)) {
    const list = site.linkCategories.map((c) => `${c.id} (${c.label})`).join(", ");
    throw new Error(`Unknown link category "${id}". Valid ids: ${list}. Use upsert_link_category to add one.`);
  }
}

const sameSite = (snap: Snapshot, url: string) => {
  const key = normalizeUrl(url);
  return snap.links.find((l) => normalizeUrl(l.url) === key);
};

const takenIds = (snap: Snapshot) => new Set([...snap.items.map((i) => i.id), ...snap.links.map((l) => l.id)]);

/** Saves a website straight onto /links (an agent who has looked at it writes pitch and pros). */
export async function addLink(fields: LinkFieldsInput) {
  const store = getStore();
  const now = new Date();
  const icon = await iconFor(fields.url);
  return store.mutate((snap) => {
    assertLinkCategory(snap.site, fields.category);
    const same = sameSite(snap, fields.url);
    if (same) throw new Error(`Already saved as "${same.name}" (${same.id}). Use update_link to change it.`);
    const taken = takenIds(snap);
    let id = newId(now);
    while (taken.has(id)) id = newId(now);
    const at = iconPath(id);
    const link: Link = {
      id,
      url: normalizeUrl(fields.url),
      name: fields.name || domainOf(fields.url),
      category: fields.category,
      ...(fields.pitch ? { pitch: fields.pitch } : {}),
      pros: fields.pros ?? [],
      ...(fields.price ? { price: fields.price } : {}),
      tags: fields.tags ?? [],
      ...(fields.note ? { note: fields.note } : {}),
      ...(icon ? { icon: at.src } : {}),
      createdAt: now.toISOString(),
    };
    return {
      links: [link, ...snap.links],
      addFiles: icon ? [{ path: at.repoPath, content: icon }] : [],
      message: `inspair: add link "${link.name}" (${id})`,
      result: link,
    };
  });
}

export const LinkUpdate = LinkFields.partial().extend({
  id: z.string(),
  inbox: z.literal(false).optional().describe("Files an inbox link onto /links (it needs a category)"),
}).strict();

/** Changes a saved website; `inbox: false` files one collected with the extension. */
export async function updateLink(spec: z.infer<typeof LinkUpdate>) {
  const store = getStore();
  const { id, inbox, ...fields } = spec;
  return store.mutate((snap) => {
    const old = snap.links.find((l) => l.id === id);
    if (!old) throw new Error(`No link with id "${id}".`);
    if (fields.category) assertLinkCategory(snap.site, fields.category);
    const next: Link = { ...old, updatedAt: new Date().toISOString() };
    if (fields.url) next.url = normalizeUrl(fields.url);
    if (fields.name) next.name = fields.name;
    if (fields.category) next.category = fields.category;
    if (fields.pros) next.pros = fields.pros;
    if (fields.tags) next.tags = fields.tags;
    if (fields.price) next.price = fields.price;
    for (const k of ["pitch", "note"] as const) {
      if (fields[k] === undefined) continue;
      if (fields[k]) next[k] = fields[k];
      else delete next[k];
    }
    if (old.inbox && inbox === false) {
      if (!snap.site.linkCategories.some((c) => c.id === next.category)) throw new Error(`"${id}" needs a category before it can be filed.`);
      delete next.inbox;
      delete next.excerpt; // the page text was only for writing this up
    }
    return {
      links: snap.links.map((l) => (l === old ? next : l)),
      message: `inspair: update link "${next.name}" (${id})`,
      result: next,
    };
  });
}

/** Removes saved websites (and their icons). `collect`: from the extension's inbox page, inbox only. */
export async function deleteLinks(ids: string[], { collect = false } = {}) {
  const store = getStore();
  return store.mutate((snap) => {
    const gone = snap.links.filter((l) => ids.includes(l.id) && (!collect || l.inbox));
    if (!gone.length) throw new Error(collect ? "收件箱里没有这个网站，可能已经整理上线或删掉了。" : `No links found for: ${ids.join(", ")}`);
    const left = snap.links.filter((l) => !gone.includes(l));
    return {
      links: left,
      deleteFiles: gone.flatMap((l) => (l.icon ? [`public${l.icon}`] : [])),
      message: `inspair: ${collect ? "collect discard" : "delete"} ${gone.length} link(s) (${gone.map((l) => l.id).join(", ")})`,
      result: { deleted: gone.map((l) => l.id), inbox: left.filter((l) => l.inbox).length },
    };
  });
}

/** What the extension knows about a page it saves. */
export type CollectedPage = {
  url: string;
  title?: string;
  siteName?: string;
  description?: string;
  icons?: string[];
  /** Headings and opening text of the page. */
  excerpt?: string;
  category?: string;
  remark?: string;
};

const clip = (s: string | undefined, n: number) => (s ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

/**
 * Puts a website into the inbox with the page's own words, for an agent to write its pitch and strengths
 * when it files it. The same site saved again returns the link already made.
 * The commit message starts "inspair: collect", which tells Vercel it needs no deploy.
 */
export async function collectLink(page: CollectedPage) {
  const store = getStore();
  const now = new Date();
  const url = normalizeUrl(page.url);
  const icon = await iconFor(url, page.icons);
  return store.mutate((snap) => {
    const inbox = snap.links.filter((l) => l.inbox).length;
    const same = sameSite(snap, url);
    if (same) return { message: "", result: { link: same, duplicate: true, inbox } };
    const taken = takenIds(snap);
    let id = newId(now);
    while (taken.has(id)) id = newId(now);
    const at = iconPath(id);
    // "Mobbin — UI & UX design inspiration" → Mobbin
    const name = clip(page.siteName, 60) || clip(page.title?.split(/\s[|–—·-]\s/)[0], 60) || domainOf(url);
    const excerpt = [page.title && `标题：${clip(page.title, 200)}`, page.description && `简介：${clip(page.description, 400)}`, clip(page.excerpt, 1600)]
      .filter(Boolean)
      .join("\n");
    const link: Link = {
      id,
      url,
      name,
      category: page.category && snap.site.linkCategories.some((c) => c.id === page.category) ? page.category : "",
      pros: [],
      tags: [],
      ...(page.remark?.trim() ? { note: clip(page.remark, 300) } : {}),
      ...(icon ? { icon: at.src } : {}),
      ...(excerpt ? { excerpt } : {}),
      inbox: true,
      createdAt: now.toISOString(),
    };
    return {
      links: [link, ...snap.links],
      addFiles: icon ? [{ path: at.repoPath, content: icon }] : [],
      message: `inspair: collect link "${name}" (${id})`,
      result: { link, duplicate: false, inbox: inbox + 1 },
    };
  });
}

export function searchLinks(snap: Snapshot, q: { query?: string; category?: string; inbox?: boolean; limit?: number }) {
  const words = (q.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const label = (id: string) => snap.site.linkCategories.find((c) => c.id === id)?.label ?? "";
  const list = snap.links.filter((l) => {
    if (Boolean(l.inbox) !== Boolean(q.inbox)) return false;
    if (q.category && l.category !== q.category) return false;
    const hay = [l.name, l.url, l.pitch, l.note, label(l.category), ...l.pros, ...l.tags].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return { total: list.length, links: list.slice(0, q.limit ?? 50) };
}

export async function upsertLinkCategory(cat: { id: string; label: string }) {
  const store = getStore();
  return store.mutate((snap) => {
    const linkCategories = [...snap.site.linkCategories];
    const i = linkCategories.findIndex((c) => c.id === cat.id);
    if (i === -1) linkCategories.push(cat);
    else linkCategories[i] = cat;
    return { site: { ...snap.site, linkCategories }, message: `inspair: ${i === -1 ? "add" : "update"} link category ${cat.id}`, result: linkCategories };
  });
}
