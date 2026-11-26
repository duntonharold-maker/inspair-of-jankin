/**
 * inspair 采集: right-click a picture on any page → 「收藏到 inspair」. The browser fetches the picture
 * itself (so sites that only serve their images to their own pages still work), at its largest size,
 * and sends it with the page it came from to the site's /api/collect. There it waits in the inbox, off
 * the site, until Claude gives it a title, category, tags and a note.
 */
const DEFAULT_SITE = "https://inspair-of-jankin.vercel.app";
const MENU = "inspair-collect";
/** What one request to the site may carry (Vercel takes about 4.5 MB); larger pictures are shrunk. */
const LIMIT = 4 * 1024 * 1024;

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.contextMenus.removeAll();
  // everywhere, not only on <img>: many sites cover their pictures with a layer or paint them as backgrounds
  chrome.contextMenus.create({ id: MENU, title: "收藏到 inspair", contexts: ["image", "page", "link", "frame", "video"] });
  const { key } = await chrome.storage.local.get("key");
  if (reason === "install" && !key) chrome.runtime.openOptionsPage();
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU) collect(info, tab);
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

/** Collect the picture a context-menu click was on, or the one found under the pointer. */
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
  let shown = info.mediaType === "image" && info.srcUrl ? info.srcUrl : null;
  let page = shown ? await describe(tabId, frameId, shown) : await pickAt(tabId, frameId);
  if (!shown) shown = page.src;
  if (!shown) {
    await say(tabId, { state: "error", text: "这里没找到图片", sub: "在图片正上方右键再试；视频和画在 canvas 里的图暂时采不了。" });
    return;
  }
  await say(tabId, { state: "busy", text: "正在收藏…", thumb: shown });
  try {
    const pageUrl = info.pageUrl || tab?.url || "";
    const candidates = largest(page.best || shown);
    const picture = await download(candidates, pageUrl, tabId, frameId);
    const form = new FormData();
    if (picture) form.append("file", picture.blob, fileName(picture.url, picture.blob.type));
    const address = picture?.url || candidates[0];
    if (/^https?:/.test(address)) form.append("image_url", address);
    if (/^https?:/.test(pageUrl)) form.append("page_url", pageUrl);
    form.append("page_title", page.title || tab?.title || "");
    form.append("alt", page.alt || "");
    const res = await fetch(`${site}/api/collect`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `网站返回了 ${res.status}`);
    await say(tabId, {
      state: "done",
      text: data.duplicate ? "这张之前收藏过了" : "已收进收件箱",
      sub: `收件箱里有 ${data.inbox} 张等 Claude 整理`,
      thumb: shown,
    });
  } catch (e) {
    await say(tabId, { state: "error", text: "没收藏成功", sub: e instanceof Error ? e.message : String(e), thumb: shown });
  }
}
// for tests: the same entry point without the menu
self.collect = collect;

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
  } catch {
    const badge = { busy: "…", done: "✓", error: "!" }[message.state];
    chrome.action.setBadgeBackgroundColor({ color: message.state === "error" ? "#FC734D" : "#0297DE" });
    chrome.action.setBadgeText({ text: badge });
    if (message.state !== "busy") setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
  }
}

/** Runs in the page: a small card in the corner, in its own shadow root so the page's styles can't reach it. */
function showToast({ state, text, sub, thumb }) {
  // Lucide shapes: check, circle-alert, loader-circle, x
  const icons = {
    done: '<path d="M20 6 9 17l-5-5"/>',
    error: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    busy: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  let host = document.getElementById("inspair-collect-toast");
  if (!host) {
    host = document.createElement("div");
    host.id = "inspair-collect-toast";
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;";
    host.attachShadow({ mode: "open" });
    (document.body || document.documentElement).appendChild(host);
  }
  clearTimeout(host._timer);
  const root = host.shadowRoot;
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .t { --ink: #02070a; --fg: #eef3f6; --muted: #8796a0; --blue: #0297de; --coral: #fc734d;
        display: flex; align-items: center; gap: 12px; width: 320px; max-width: calc(100vw - 40px); box-sizing: border-box;
        padding: 10px 10px 10px 10px; border-radius: 14px; background: var(--ink); color: var(--fg);
        box-shadow: 0 18px 40px -16px rgba(2, 7, 10, 0.55), 0 0 0 1px rgba(238, 243, 246, 0.06);
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
        animation: in 0.32s cubic-bezier(0.22, 1, 0.36, 1) both; }
      @keyframes in { from { opacity: 0; transform: translateY(10px) scale(0.98); } }
      .pic { position: relative; flex: none; width: 44px; height: 44px; border-radius: 9px; overflow: hidden; background: #1a2026; }
      .pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .pic img[hidden] { display: none; }
      .mark { position: absolute; right: -2px; bottom: -2px; width: 20px; height: 20px; border-radius: 50%;
        display: grid; place-items: center; color: var(--ink); background: var(--blue); box-shadow: 0 0 0 2px var(--ink); }
      .error .mark { background: var(--coral); }
      .busy .mark { background: var(--ink); color: var(--fg); }
      .mark svg { width: 12px; height: 12px; }
      .busy .mark svg { animation: spin 0.8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .words { flex: 1; min-width: 0; }
      .text { font-weight: 600; }
      .sub { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
      button { flex: none; align-self: flex-start; display: grid; place-items: center; width: 26px; height: 26px; padding: 0;
        border: 0; border-radius: 999px; background: transparent; color: var(--muted); cursor: pointer;
        transition: background-color 0.2s cubic-bezier(0.22, 1, 0.36, 1), color 0.2s cubic-bezier(0.22, 1, 0.36, 1), transform 0.1s; }
      button svg { width: 15px; height: 15px; }
      @media (hover: hover) { button:hover { background: rgba(238, 243, 246, 0.1); color: var(--fg); } }
      button:active { transform: scale(0.96); }
      button:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) { .t, .busy .mark svg { animation: none; } }
    </style>
    <div class="t ${state}" role="status">
      <div class="pic"><img alt="" hidden><span class="mark">${svg(state)}</span></div>
      <div class="words"><div class="text"></div><div class="sub"></div></div>
      <button type="button" aria-label="关闭">${svg("close")}</button>
    </div>`;
  const img = root.querySelector("img");
  if (thumb && /^https?:/.test(thumb)) {
    img.src = thumb;
    img.hidden = false;
  }
  root.querySelector(".text").textContent = text || "";
  root.querySelector(".sub").textContent = sub || "";
  root.querySelector("button").addEventListener("click", () => host.remove());
  if (state !== "busy") host._timer = setTimeout(() => host.remove(), state === "error" ? 7000 : 3500);
}
