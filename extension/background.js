/**
 * inspair 采集: right-click a picture on any page → 「收藏到 inspair」. The browser fetches the picture
 * itself (so sites that only serve their images to their own pages still work), at its largest size,
 * and sends it with the page it came from to the site's /api/collect. There it waits in the inbox, off
 * the site, until Claude gives it a title, category, tags and a note.
 */
const DEFAULT_SITE = "https://inspair-of-jankin.vercel.app";
const MENU = "inspair-collect";
const MENU_SITE = "inspair-site";
/** What one request to the site may carry (Vercel takes about 4.5 MB); larger pictures are shrunk. */
const LIMIT = 4 * 1024 * 1024;
/** How long after collecting a picture the box offers to add the next one to its set. */
const CHAIN_MS = 15 * 60 * 1000;

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.contextMenus.removeAll();
  // everywhere, not only on <img>: many sites cover their pictures with a layer or paint them as backgrounds
  chrome.contextMenus.create({ id: MENU, title: "收藏到 inspair", contexts: ["image", "page", "link", "frame", "video"] });
  // the page itself, for /links: what the site is and what it is good at
  chrome.contextMenus.create({ id: MENU_SITE, title: "收藏这个网站", contexts: ["page", "image", "link", "frame", "video", "selection"] });
  const { key } = await chrome.storage.local.get("key");
  if (reason === "install" && !key) chrome.runtime.openOptionsPage();
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU) collect(info, tab);
  if (info.menuItemId === MENU_SITE) collectSite(tab);
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
// the box in the page: 收藏 (with what was said) or Esc
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "inspair:send")
    send(msg.token, msg.job, sender.tab?.id, { remark: msg.remark, category: msg.category, groupWith: msg.groupWith });
  if (msg?.type === "inspair:cancel") pending.delete(msg.token);
  if (msg?.type === "inspair:send-link") sendSite(msg.page, sender.tab?.id, { remark: msg.remark, category: msg.category });
});

/** Pictures being fetched while the box waits for a word and a category, by token. */
const pending = new Map();

/**
 * Right-click → 「收藏到 inspair」: find the picture (the one clicked, or the one under the pointer when a layer
 * covers it), start fetching it, and ask in the page for a line about it and a rough category. 收藏 sends it.
 */
async function collect(info, tab) {
  const tabId = tab?.id;
  const frameId = info.frameId ?? 0;
  const { site = DEFAULT_SITE, key = "" } = await chrome.storage.local.get(["site", "key"]);
  if (!key) {
    await say(tabId, { state: "error", text: "还没填密钥", sub: "已打开插件设置，填好网站和密钥再试。" });
    chrome.runtime.openOptionsPage();
    return;
  }
  // the browser saw an image: take it; otherwise look under the pointer (covered pictures, backgrounds)
  const clicked = info.mediaType === "image" && info.srcUrl ? info.srcUrl : null;
  const page = clicked ? await describe(tabId, frameId, clicked) : await pickAt(tabId, frameId);
  const shown = clicked || page.src;
  if (!shown) {
    await say(tabId, { state: "error", text: "这里没找到图片", sub: "在图片正上方右键再试；视频和画在 canvas 里的图暂时采不了。" });
    return;
  }
  const job = { shown, best: page.best || shown, pageUrl: info.pageUrl || tab?.url || "", title: page.title || tab?.title || "", alt: page.alt || "", frameId };
  const token = crypto.randomUUID();
  pending.set(token, fetchPicture(job, tabId));
  const categories = await categoriesOf(site, key);
  // 「接上一张」: the picture collected last, if it was a little while ago, can take this one into its set
  const { last } = await chrome.storage.session.get("last");
  const chain = last && Date.now() - last.at < CHAIN_MS ? last : null;
  const asked = await say(tabId, { state: "ask", text: "收藏到 inspair", sub: job.alt || job.title, thumb: shown, token, job, categories, chain });
  // pages the extension can't draw on (the web store, browser pages): collect straight away
  if (!asked) send(token, job, tabId, {});
}
// for tests: the same entry points without the menu and the box
self.collect = collect;
self.send = send;

/* ------------------------------------------------------------ 收藏这个网站 */

/** Right-click → 「收藏这个网站」: read what the page says about itself, ask for a category and a line, send. */
async function collectSite(tab) {
  const tabId = tab?.id;
  const { site = DEFAULT_SITE, key = "" } = await chrome.storage.local.get(["site", "key"]);
  if (!key) {
    await say(tabId, { state: "error", text: "还没填密钥", sub: "已打开插件设置，填好网站和密钥再试。" });
    chrome.runtime.openOptionsPage();
    return;
  }
  let page = { url: tab?.url || "", title: tab?.title || "" };
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: readPage });
    if (result?.url) page = result;
  } catch {
    // a page the extension can't read (browser pages, the web store): its address and title are enough
  }
  if (!/^https?:/.test(page.url)) {
    await say(tabId, { state: "error", text: "这个页面收藏不了", sub: "只能收藏 http 或 https 开头的网页。" });
    return;
  }
  const categories = await linkCategoriesOf(site, key);
  const host = new URL(page.url).hostname.replace(/^www\./, "");
  const asked = await say(tabId, { state: "ask", text: "收藏这个网站", sub: page.siteName || host, thumb: page.icons?.[0], token: crypto.randomUUID(), page, categories });
  if (!asked) sendSite(page, tabId, {});
}
self.collectSite = collectSite;

/** Runs in the page: its address, names, description, icons, and the text that says what it offers. */
function readPage() {
  const meta = (sel) => document.querySelector(sel)?.getAttribute("content")?.trim() || "";
  const abs = (u) => {
    try {
      return new URL(u, location.href).href;
    } catch {
      return "";
    }
  };
  // the biggest icons first
  const icons = [...document.querySelectorAll('link[rel~="icon"], link[rel~="apple-touch-icon"], link[rel="mask-icon"]')]
    .map((l) => ({ href: abs(l.getAttribute("href") || ""), size: parseInt((l.getAttribute("sizes") || "0").split("x")[0], 10) || (l.rel.includes("apple") ? 180 : 0) }))
    .filter((i) => i.href)
    .sort((a, b) => b.size - a.size)
    .map((i) => i.href);
  const seen = new Set();
  const lines = [];
  for (const el of document.querySelectorAll("h1, h2, h3, main p, header p, section p, li")) {
    const t = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (t.length < 4 || t.length > 240 || seen.has(t)) continue;
    seen.add(t);
    lines.push(/^H/.test(el.tagName) ? `# ${t}` : t);
    if (lines.join("\n").length > 1800) break;
  }
  return {
    url: abs(document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "") || location.href,
    title: document.title,
    siteName: meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]'),
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    icons: icons.slice(0, 4),
    excerpt: lines.join("\n").slice(0, 1800),
  };
}

async function sendSite(page, tabId, { remark = "", category = "" } = {}) {
  const { site = DEFAULT_SITE, key = "" } = await chrome.storage.local.get(["site", "key"]);
  const icon = page.icons?.[0];
  await say(tabId, { state: "busy", text: "正在收藏…", sub: remark, thumb: icon });
  try {
    const res = await fetch(`${site}/api/collect/links`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...page, remark: remark.trim() || undefined, category: category || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `网站返回了 ${res.status}`);
    chrome.runtime.sendMessage({ type: "inspair:collected" }).catch(() => {});
    await say(tabId, {
      state: "done",
      text: data.duplicate ? "这个网站之前收藏过了" : "已收进收件箱",
      sub: data.duplicate ? data.name : `收件箱里有 ${data.inbox} 个网站等 Claude 写好优势`,
      thumb: icon,
    });
  } catch (e) {
    await say(tabId, { state: "error", text: "没收藏成功", sub: e instanceof Error ? e.message : String(e), thumb: icon });
  }
}

/** The link categories for the box, remembered and refreshed like the picture categories. */
async function linkCategoriesOf(site, key) {
  const { linkCategories } = await chrome.storage.local.get("linkCategories");
  const refresh = fetch(`${site}/api/collect`, { headers: { Authorization: `Bearer ${key}` } })
    .then((r) => (r.ok ? r.json() : {}))
    .then((d) => (d.linkCategories ? chrome.storage.local.set({ linkCategories: d.linkCategories }).then(() => d.linkCategories) : linkCategories))
    .catch(() => linkCategories);
  return linkCategories?.length ? linkCategories : await refresh;
}

/** The site's categories for the box, remembered between collections and refreshed in the background. */
async function categoriesOf(site, key) {
  const { categories } = await chrome.storage.local.get("categories");
  const refresh = fetch(`${site}/api/collect`, { headers: { Authorization: `Bearer ${key}` } })
    .then((r) => (r.ok ? r.json() : {}))
    .then((d) => (d.categories ? chrome.storage.local.set({ categories: d.categories }).then(() => d.categories) : categories))
    .catch(() => categories);
  return categories?.length ? categories : await refresh;
}

/** The picture at its largest size, fetched the way its page would (see download). */
function fetchPicture(job, tabId) {
  const candidates = largest(job.best);
  const run = download(candidates, job.pageUrl, tabId, job.frameId)
    .then((picture) => ({ candidates, picture }))
    .catch(() => ({ candidates, picture: null }));
  return run;
}

/** Send the picture, with what was said about it, to the site's inbox. */
async function send(token, job, tabId, { remark = "", category = "", groupWith = "" } = {}) {
  const { site = DEFAULT_SITE, key = "" } = await chrome.storage.local.get(["site", "key"]);
  await say(tabId, { state: "busy", text: "正在收藏…", sub: remark, thumb: job.shown });
  try {
    // the service worker may have been asleep while the box was open: then fetch the picture again
    const { candidates, picture } = await (pending.get(token) ?? fetchPicture(job, tabId));
    pending.delete(token);
    const form = new FormData();
    if (picture) form.append("file", picture.blob, fileName(picture.url, picture.blob.type));
    const address = picture?.url || candidates[0];
    if (/^https?:/.test(address)) form.append("image_url", address);
    if (/^https?:/.test(job.pageUrl)) form.append("page_url", job.pageUrl);
    form.append("page_title", job.title || "");
    form.append("alt", job.alt || "");
    if (remark.trim()) form.append("remark", remark.trim());
    if (category) form.append("category", category);
    if (groupWith) form.append("group_with", groupWith);
    const res = await fetch(`${site}/api/collect`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `网站返回了 ${res.status}`);
    // an open 收件箱 page refreshes itself
    chrome.runtime.sendMessage({ type: "inspair:collected" }).catch(() => {});
    const set = !data.duplicate && data.pictures > 1;
    if (!data.duplicate) await chrome.storage.session.set({ last: { id: data.id, title: data.title, thumb: job.shown, pictures: data.pictures, at: Date.now() } });
    await say(tabId, {
      state: "done",
      text: data.duplicate ? "这张之前收藏过了" : set ? `已加到这一组，共 ${data.pictures} 张` : "已收进收件箱",
      sub: set ? `「${data.title}」` : `收件箱里有 ${data.inbox} 张等 Claude 整理`,
      thumb: job.shown,
    });
  } catch (e) {
    await say(tabId, { state: "error", text: "没收藏成功", sub: e instanceof Error ? e.message : String(e), thumb: job.shown });
  }
}

/** The picture under the last right-click, found in the page (picker.js remembered where that was). */
async function pickAt(tabId, frameId) {
  if (tabId == null) return {};
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: findPicture });
    return result || {};
  } catch {
    return {};
  }
}

/**
 * Runs in the page: every picture at the right-clicked spot, through any layers laid over it, topmost first:
 * <img> (also ones that ignore the pointer), a video's poster, a CSS background, inside open shadow roots too.
 * Tiny ones (icons, avatars under 40px) only count when nothing bigger is there.
 */
function findPicture() {
  const point = window.__inspairPoint;
  if (!point || Date.now() - point.at > 60000) return {};
  const { x, y } = point;
  const abs = (u) => {
    try {
      return new URL(u, location.href).href;
    } catch {
      return u;
    }
  };
  const background = (el) => {
    const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(getComputedStyle(el).backgroundImage || "");
    return m && !m[1].startsWith("data:image/svg") ? abs(m[1]) : null;
  };
  const inside = (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  const stack = [];
  const walk = (root) => {
    for (const el of root.elementsFromPoint(x, y)) {
      if (stack.includes(el)) continue;
      stack.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  const found = [];
  const add = (el, src, depth) => {
    if (!src || found.some((f) => f.el === el)) return;
    const r = el.getBoundingClientRect();
    found.push({ el, src, depth, big: r.width >= 40 && r.height >= 40, area: r.width * r.height });
  };
  stack.forEach((el, depth) => {
    if (el instanceof HTMLImageElement) add(el, el.currentSrc || el.src, depth);
    else if (el instanceof HTMLVideoElement && el.poster) add(el, abs(el.poster), depth);
    else add(el, background(el), depth);
  });
  // pictures set to ignore the pointer don't show up in the stack: find them by their box
  for (const img of document.images) {
    if (!inside(img.getBoundingClientRect())) continue;
    const holder = stack.findIndex((el) => el.contains(img));
    add(img, img.currentSrc || img.src, holder === -1 ? stack.length : holder + 0.5);
  }
  found.sort((a, b) => b.big - a.big || a.depth - b.depth || b.area - a.area);
  const pick = found[0];
  if (!pick) return { title: document.title };
  let best = null;
  let bestSize = 0;
  if (pick.el instanceof HTMLImageElement) {
    const sets = [pick.el.getAttribute("srcset"), ...[...(pick.el.closest("picture")?.querySelectorAll("source") || [])].map((s) => s.getAttribute("srcset"))];
    for (const set of sets)
      for (const part of (set || "").split(/,\s+/)) {
        const [url, d = ""] = part.trim().split(/\s+/);
        const size = d.endsWith("w") ? parseFloat(d) : d.endsWith("x") ? parseFloat(d) * 1000 : 1;
        if (url && size > bestSize) (bestSize = size), (best = abs(url));
      }
  }
  return { src: pick.src, best, alt: pick.el.alt || pick.el.title || pick.el.getAttribute("aria-label") || "", title: document.title };
}

/** The picture's description, its largest source (srcset, <picture>) and the page title, read in the page. */
async function describe(tabId, frameId, src) {
  if (tabId == null) return {};
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: readImage, args: [src] });
    return result || {};
  } catch {
    return {};
  }
}

function readImage(src) {
  const abs = (u) => {
    try {
      return new URL(u, location.href).href;
    } catch {
      return u;
    }
  };
  const img = [...document.images].find((i) => i.currentSrc === src || i.src === src) || null;
  let best = null;
  let bestSize = 0;
  const consider = (set) => {
    for (const part of (set || "").split(/,\s+/)) {
      const [url, d = ""] = part.trim().split(/\s+/);
      if (!url) continue;
      const size = d.endsWith("w") ? parseFloat(d) : d.endsWith("x") ? parseFloat(d) * 1000 : 1;
      if (size > bestSize) {
        bestSize = size;
        best = abs(url);
      }
    }
  };
  if (img) {
    consider(img.getAttribute("srcset"));
    const picture = img.closest("picture");
    if (picture) for (const s of picture.querySelectorAll("source")) consider(s.getAttribute("srcset"));
  }
  return { best, alt: (img && (img.alt || img.title)) || "", title: document.title };
}

/** Addresses to try for a picture, largest first: sites that serve smaller copies get their original. */
function largest(url) {
  const out = [];
  try {
    const u = new URL(url);
    if (u.hostname === "i.pinimg.com") {
      // Pinterest: /236x/, /474x/, /736x/ … → /originals/ (the original may be a PNG behind a JPG copy)
      const m = u.pathname.match(/^\/(?:\d+x\d*|originals)\/(.+)\.(\w+)$/);
      if (m) for (const ext of [m[2], "png", "jpg", "webp", "gif"]) out.push(`https://i.pinimg.com/originals/${m[1]}.${ext}`);
    } else if (u.hostname === "pbs.twimg.com" && u.pathname.startsWith("/media/")) {
      u.searchParams.set("name", "orig");
      out.push(u.href);
    } else if (u.hostname === "cdn.dribbble.com") {
      u.search = "";
      out.push(u.href);
    } else if (u.hostname.endsWith("huaban.com")) {
      // 花瓣: <key>_fw658webp, _sq236 … are sized copies of <key>
      const m = u.pathname.match(/^\/([^/_]+)_[a-z]{2}\d+/);
      if (m) out.push(`${u.origin}/${m[1]}`);
    } else if (u.hostname.endsWith("xhscdn.com") && u.href.includes("!")) {
      // 小红书: …/<key>!nd_dft_wlteh_webp_3 is a processed copy; without the suffix, the upload
      out.push(u.href.split("!")[0]);
    }
  } catch {
    /* not a URL we know how to enlarge */
  }
  out.push(url);
  return [...new Set(out)];
}

/** Fetch the first address that answers with a picture, as the page would (its address as referrer). */
async function download(candidates, referer, tabId, frameId) {
  for (const url of candidates) {
    try {
      let blob;
      if (url.startsWith("blob:")) blob = await fromPage(url, tabId, frameId);
      else {
        const res = await withReferer(url, referer, () => fetch(url, { credentials: "include" }));
        const type = res.headers.get("content-type") || "";
        if (!res.ok || !/^(image|video)\//.test(type)) continue;
        blob = await res.blob();
      }
      if (!blob) continue;
      const fit = await shrink(blob);
      return fit ? { blob: fit, url } : null; // too big to send and can't be shrunk: let the site fetch it
    } catch {
      /* try the next address */
    }
  }
  return null;
}

/** A page's blob: address can only be read inside that page. */
async function fromPage(url, tabId, frameId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func: async (u) => {
      const b = await (await fetch(u)).blob();
      return await new Promise((ok) => {
        const r = new FileReader();
        r.onload = () => ok(r.result);
        r.readAsDataURL(b);
      });
    },
    args: [url],
  });
  return result ? await (await fetch(result)).blob() : null;
}

let nextRule = 1;
/** Sites that only hand their pictures to their own pages check the referrer: send the page's. */
async function withReferer(url, referer, run) {
  if (!/^https?:/.test(referer || "") || !/^https?:/.test(url)) return run();
  const id = nextRule++;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id,
          priority: 1,
          action: { type: "modifyHeaders", requestHeaders: [{ header: "Referer", operation: "set", value: referer }] },
          condition: {
            regexFilter: "^" + url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
            tabIds: [chrome.tabs.TAB_ID_NONE],
            resourceTypes: ["xmlhttprequest", "other"],
          },
        },
      ],
    });
  } catch {
    return run(); // an address too long for a rule: fetch without
  }
  try {
    return await run();
  } finally {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] });
  }
}

/** Keep a picture under the limit: re-encode stills as WebP at most 2560px wide; animations go as they are. */
async function shrink(blob) {
  if (blob.size <= LIMIT) return blob;
  if (!/^image\/(png|jpeg|webp|avif|bmp)$/.test(blob.type)) return null;
  const bitmap = await createImageBitmap(blob);
  let scale = Math.min(1, 2560 / bitmap.width);
  for (const quality of [0.9, 0.82, 0.75]) {
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = await canvas.convertToBlob({ type: "image/webp", quality });
    if (out.size <= LIMIT) return out;
    scale *= 0.8;
  }
  return null;
}

function fileName(url, type) {
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm" }[type];
  let base = "picture";
  try {
    base = decodeURIComponent(new URL(url).pathname.split("/").pop() || base).replace(/\.\w+$/, "") || base;
  } catch {
    /* keep "picture" */
  }
  return ext ? `${base}.${ext}` : base;
}

/** Tell the reader how it went, in the page (or on the toolbar icon where pages can't be touched). */
async function say(tabId, message) {
  try {
    if (tabId == null) throw new Error("no tab");
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: showToast, args: [message] });
    return true;
  } catch {
    if (message.state === "ask") return false;
    const badge = { busy: "…", done: "✓", error: "!" }[message.state];
    chrome.action.setBadgeBackgroundColor({ color: message.state === "error" ? "#FC734D" : "#0297DE" });
    chrome.action.setBadgeText({ text: badge });
    if (message.state !== "busy") setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
    return false;
  }
}

/**
 * Runs in the page: a small card in the corner, in its own shadow root so the page's styles can't reach it.
 * state "ask" is the box shown right after 收藏到 inspair: a rough category and a line about the picture,
 * sent with 收藏 (or Enter); Esc or the close button drops it. The other states report how sending went.
 */
function showToast({ state, text, sub, thumb, token, job, categories, chain, page }) {
  // Lucide shapes: check, circle-alert, loader-circle, x, bookmark-plus
  const icons = {
    done: '<path d="M20 6 9 17l-5-5"/>',
    error: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    busy: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    ask: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><line x1="12" x2="12" y1="7" y2="13"/><line x1="15" x2="9" y1="10" y2="10"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  let host = document.getElementById("inspair-collect-toast");
  // a box still waiting for an answer when another picture is collected: that one is dropped
  if (host?._token && host._token !== token) chrome.runtime.sendMessage({ type: "inspair:cancel", token: host._token }).catch(() => {});
  if (!host) {
    host = document.createElement("div");
    host.id = "inspair-collect-toast";
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;";
    host.attachShadow({ mode: "open" });
    // keys typed in the box are the box's: the page's shortcuts must not see them
    for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, (e) => e.stopPropagation());
    (document.body || document.documentElement).appendChild(host);
  }
  clearTimeout(host._timer);
  host._token = state === "ask" ? token : null;
  const ease = "cubic-bezier(0.22, 1, 0.36, 1)";
  const root = host.shadowRoot;
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .t { --ink: #02070a; --fg: #eef3f6; --muted: #8796a0; --blue: #0297de; --coral: #fc734d; --line: rgba(238, 243, 246, 0.14);
        width: 340px; max-width: calc(100vw - 40px); box-sizing: border-box;
        padding: 10px; border-radius: 14px; background: var(--ink); color: var(--fg);
        box-shadow: 0 18px 40px -16px rgba(2, 7, 10, 0.55), 0 0 0 1px rgba(238, 243, 246, 0.06);
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
        animation: in 0.32s ${ease} both; }
      .t.again { animation: none; }
      @keyframes in { from { opacity: 0; transform: translateY(10px) scale(0.98); } }
      .row { display: flex; align-items: center; gap: 12px; }
      .pic { position: relative; flex: none; width: 44px; height: 44px; border-radius: 9px; overflow: hidden; background: #1a2026; }
      .pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .pic img[hidden] { display: none; }
      .mark { position: absolute; right: -2px; bottom: -2px; width: 20px; height: 20px; border-radius: 50%;
        display: grid; place-items: center; color: var(--ink); background: var(--blue); box-shadow: 0 0 0 2px var(--ink); }
      .error .mark { background: var(--coral); }
      .busy .mark, .ask .mark { background: var(--ink); color: var(--fg); }
      .mark svg { width: 12px; height: 12px; }
      .busy .mark svg { animation: spin 0.8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .words { flex: 1; min-width: 0; }
      .text { font-weight: 600; }
      .sub { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
      .ask .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      button { font: inherit; cursor: pointer; transition: background-color 0.2s ${ease}, color 0.2s ${ease}, border-color 0.2s ${ease}, transform 0.1s; }
      button:active { transform: scale(0.96); }
      button:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
      .x { flex: none; align-self: flex-start; display: grid; place-items: center; width: 26px; height: 26px; padding: 0;
        border: 0; border-radius: 999px; background: transparent; color: var(--muted); }
      .x svg { width: 15px; height: 15px; }
      form { margin: 12px 0 0; display: grid; gap: 10px; }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; border: 0; }
      .chip { height: 28px; padding: 0 11px; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: var(--fg); font-size: 12px; }
      .chip[aria-pressed="true"] { background: var(--blue); border-color: var(--blue); color: var(--ink); font-weight: 600; }
      .chain { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; padding: 6px 10px 6px 6px; border: 1px solid var(--line); border-radius: 10px;
        background: transparent; color: var(--fg); text-align: left; font-size: 12px; }
      .chain img { flex: none; width: 28px; height: 28px; border-radius: 6px; object-fit: cover; background: #1a2026; }
      .chain b { display: block; font-weight: 600; }
      .chain .of { display: block; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .chain .tick { flex: none; margin-left: auto; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--line); display: grid; place-items: center; color: transparent; }
      .chain .tick svg { width: 12px; height: 12px; }
      .chain > span:not(.tick) { min-width: 0; }
      .chain[aria-pressed="true"] { border-color: var(--blue); background: rgba(2, 151, 222, 0.14); }
      .chain[aria-pressed="true"] .tick { background: var(--blue); border-color: var(--blue); color: var(--ink); }
      .chained .chips { display: none; }
      .say { display: flex; gap: 6px; }
      input { flex: 1; min-width: 0; height: 36px; box-sizing: border-box; padding: 0 12px; border: 1px solid transparent; border-radius: 10px;
        background: rgba(238, 243, 246, 0.08); color: var(--fg); font: inherit; outline: none;
        transition: border-color 0.2s ${ease}, background-color 0.2s ${ease}; }
      input::placeholder { color: var(--muted); }
      input:focus { border-color: var(--blue); background: rgba(238, 243, 246, 0.04); }
      .go { flex: none; height: 36px; padding: 0 14px; border: 0; border-radius: 10px; background: var(--blue); color: var(--ink); font-weight: 600; }
      @media (hover: hover) {
        .x:hover { background: rgba(238, 243, 246, 0.1); color: var(--fg); }
        .chip:hover, .chain:hover { border-color: var(--blue); }
        .chip[aria-pressed="true"]:hover { background: #33abe5; }
        .go:hover { background: #33abe5; transform: translateY(-1px); }
        .go:active { transform: scale(0.97); }
      }
      @media (prefers-reduced-motion: reduce) { .t, .busy .mark svg { animation: none; } button, input { transition-duration: 0.01ms; } }
    </style>
    <div class="t ${state}${host._shown ? " again" : ""}" role="${state === "ask" ? "dialog" : "status"}" aria-label="${state === "ask" ? "收藏到 inspair" : ""}">
      <div class="row">
        <div class="pic"><img alt="" hidden><span class="mark">${svg(state)}</span></div>
        <div class="words"><div class="text"></div><div class="sub"></div></div>
        <button class="x" type="button" aria-label="${state === "ask" ? "不收藏了" : "关闭"}">${svg("close")}</button>
      </div>
      ${state === "ask" ? `
      <form>
        ${chain ? `<button class="chain" type="button" aria-pressed="false"><img alt=""><span><b>接上一张</b><span class="of"></span></span><span class="tick">${svg("done")}</span></button>` : ""}
        <fieldset class="chips" aria-label="大概是哪一类"></fieldset>
        <div class="say">
          <input name="remark" maxlength="300" autocomplete="off" placeholder="${page ? "说一句，比如：找竞品流程先来这里" : "说一句，比如：这个按钮动效好看"}" aria-label="${page ? "说一句这个网站" : "说一句这张图"}">
          <button class="go" type="submit">收藏</button>
        </div>
      </form>` : ""}
    </div>`;
  host._shown = true;
  const img = root.querySelector("img");
  if (thumb && /^https?:/.test(thumb)) {
    img.src = thumb;
    img.hidden = false;
  }
  root.querySelector(".text").textContent = text || "";
  root.querySelector(".sub").textContent = sub || "";
  const gone = () => {
    if (host._token) chrome.runtime.sendMessage({ type: "inspair:cancel", token: host._token }).catch(() => {});
    host.remove();
  };
  root.querySelector(".x").addEventListener("click", gone);
  if (state !== "ask") {
    if (state !== "busy") host._timer = setTimeout(() => host.remove(), state === "error" ? 7000 : 3500);
    return;
  }
  // the box: pick a category (or none), say something (or nothing), 收藏
  let category = "";
  const chips = root.querySelector(".chips");
  for (const c of categories || []) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = c.label;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      category = category === c.id ? "" : c.id;
      for (const other of chips.children) other.setAttribute("aria-pressed", String(other === b && category === c.id));
    });
    chips.append(b);
  }
  if (!chips.children.length) chips.remove();
  // 「接上一张」: this picture joins the set of the one collected last (whose category it then shares)
  let groupWith = "";
  const link = root.querySelector(".chain");
  if (link) {
    if (/^https?:/.test(chain.thumb || "")) link.querySelector("img").src = chain.thumb;
    else link.querySelector("img").remove();
    link.querySelector(".of").textContent = `加到「${chain.title}」${chain.pictures > 1 ? `，现有 ${chain.pictures} 张` : ""}`;
    link.addEventListener("click", () => {
      groupWith = groupWith ? "" : chain.id;
      link.setAttribute("aria-pressed", String(Boolean(groupWith)));
      root.querySelector("form").classList.toggle("chained", Boolean(groupWith));
    });
  }
  const input = root.querySelector("input");
  root.querySelector(".t").addEventListener("keydown", (e) => {
    if (e.key === "Escape") gone();
  });
  root.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    host._token = null;
    if (page) chrome.runtime.sendMessage({ type: "inspair:send-link", page, remark: input.value, category }).catch(() => {});
    else chrome.runtime.sendMessage({ type: "inspair:send", token, job, remark: input.value, category: groupWith ? "" : category, groupWith }).catch(() => {});
  });
  input.focus({ preventScroll: true });
}
