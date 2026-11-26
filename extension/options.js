// Settings (where the site is, the key that lets this browser use its inbox) and the inbox itself:
// every picture collected and not yet filed by Claude, to look at and throw away.
const DEFAULT_SITE = "https://inspair-of-jankin.vercel.app";
const $ = (id) => document.getElementById(id);
const status = (text, kind = "") => {
  $("status").textContent = text;
  $("status").className = `status ${kind}`;
};
let conn = null; // { site, key } once the connection works
let labels = new Map(); // category id → label
const urls = new Set(); // object URLs of pictures on screen, freed on each refresh

chrome.storage.local.get(["site", "key"]).then(({ site, key }) => {
  $("site").value = site || DEFAULT_SITE;
  $("key").value = key || "";
  if (key) test(site || DEFAULT_SITE, key);
});

$("reveal").addEventListener("click", () => {
  const shown = $("reveal").getAttribute("aria-pressed") !== "true";
  $("reveal").setAttribute("aria-pressed", String(shown));
  $("reveal").setAttribute("aria-label", shown ? "隐藏密钥" : "显示密钥");
  $("key").type = shown ? "text" : "password";
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  let site = $("site").value.trim().replace(/\/+$/, "");
  const key = $("key").value.trim();
  if (!/^https?:\/\/[^/]+/.test(site)) return status("网站地址要以 https:// 开头，例如 " + DEFAULT_SITE, "bad");
  if (!key) return status("请填写密钥。", "bad");
  site = new URL(site).origin;
  $("site").value = site;
  await chrome.storage.local.set({ site, key });
  test(site, key);
});

$("refresh").addEventListener("click", () => conn && test(conn.site, conn.key));
// a picture just collected from a page shows up here without a reload
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "inspair:collected" && conn) test(conn.site, conn.key, { quiet: true });
});

async function test(site, key, { quiet = false } = {}) {
  $("save").disabled = true;
  $("refresh").classList.add("spin");
  if (!quiet) status("正在连接…");
  try {
    const res = await fetch(`${site}/api/collect`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) status("已保存，但密钥不对：和 Vercel 里的 COLLECT_SECRET 或 MCP_SECRET 对不上。", "bad");
    else if (res.status === 404) status("已保存，但这个网站上没有采集接口：网站需要先更新到支持插件的版本。", "bad");
    else if (!res.ok) status(`已保存，但网站返回了 ${res.status}：${data.error || "请稍后再试"}`, "bad");
    else {
      conn = { site, key };
      labels = new Map((data.categories || []).map((c) => [c.id, c.label]));
      // the box shown when collecting offers these
      if (data.categories) chrome.storage.local.set({ categories: data.categories });
      status(`已连接「${data.site}」。`, "ok");
      render(data.items || [], data.inbox);
      return;
    }
    conn = null;
    $("inbox").hidden = true;
  } catch {
    status("已保存，但连不上这个网址：检查地址是否正确、网站是否在线。", "bad");
  } finally {
    $("save").disabled = false;
    $("refresh").classList.remove("spin");
  }
}

/* ------------------------------------------------------------------ inbox */

const api = (path, init = {}) => fetch(`${conn.site}/api/collect${path}`, { ...init, headers: { Authorization: `Bearer ${conn.key}` } });
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** A picture of the inbox as an object URL (the site only hands them out with the key). */
async function picture(id, full = false) {
  const res = await api(`/${encodeURIComponent(id)}${full ? "?full=1" : ""}`);
  if (!res.ok) throw new Error(`网站返回了 ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  urls.add(url);
  return url;
}

/** Load the small pictures a few at a time, top of the grid first. */
function loadAll(jobs) {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { id, img } = jobs[next++];
      try {
        img.src = await picture(id);
        await img.decode().catch(() => {});
        img.classList.add("ready");
      } catch {
        img.alt = "图片没加载出来";
      }
    }
  };
  for (let i = 0; i < 4; i++) worker();
}

function setCount(n) {
  $("count").textContent = n ? String(n) : "";
  $("empty").hidden = n > 0;
}

function render(items, total) {
  for (const u of urls) URL.revokeObjectURL(u);
  urls.clear();
  $("inbox").hidden = false;
  const grid = $("grid");
  grid.replaceChildren();
  setCount(total ?? items.length);
  const jobs = [];
  for (const item of items) {
    const tile = $("tile").content.firstElementChild.cloneNode(true);
    tile.dataset.id = item.id;
    tile.classList.toggle("cutout", Boolean(item.cutout));
    const pic = tile.querySelector(".pic");
    const img = pic.querySelector("img");
    if (item.width && item.height) (img.width = item.width), (img.height = item.height);
    pic.setAttribute("aria-label", `查看大图：${item.title}`);
    pic.addEventListener("click", () => view(item));
    tile.querySelector(".title").textContent = item.title;
    // what was said and picked while collecting
    const remark = tile.querySelector(".remark");
    if (item.remark) remark.textContent = `「${item.remark}」`;
    else remark.remove();
    const cat = tile.querySelector(".cat");
    if (item.category && labels.has(item.category)) cat.textContent = labels.get(item.category);
    else cat.remove();
    const src = tile.querySelector(".src");
    if (item.source && /^https?:/.test(item.source)) {
      src.href = item.source;
      src.querySelector("span").textContent = host(item.source);
      src.setAttribute("aria-label", `打开来源网页：${host(item.source)}`);
    } else src.remove();
    const del = tile.querySelector(".del");
    del.setAttribute("aria-label", `删除：${item.title}`);
    del.addEventListener("click", () => remove(item, tile, del));
    grid.append(tile);
    jobs.push({ id: item.id, img });
  }
  loadAll(jobs);
}

/** First click arms the button, the second throws the picture away; it disarms itself after a moment. */
async function remove(item, tile, del) {
  if (!del.classList.contains("armed")) {
    for (const other of document.querySelectorAll(".del.armed")) disarm(other);
    del.classList.add("armed");
    del.querySelector("span").textContent = "确认删除";
    del.setAttribute("aria-label", `再点一次删除：${item.title}`);
    del.timer = setTimeout(() => disarm(del), 3000);
    return;
  }
  clearTimeout(del.timer);
  tile.classList.add("busy");
  try {
    const res = await api(`/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `网站返回了 ${res.status}`);
    // move focus somewhere sensible before the tile goes
    const next = tile.nextElementSibling || tile.previousElementSibling;
    (next?.querySelector(".pic") || $("refresh")).focus({ preventScroll: true });
    tile.classList.add("gone");
    setTimeout(() => tile.remove(), 250);
    setCount(data.inbox);
    status(`已删除「${item.title}」。`, "ok");
  } catch (e) {
    tile.classList.remove("busy");
    disarm(del);
    status(`没删掉：${e instanceof Error ? e.message : e}`, "bad");
  }
}

function disarm(del) {
  clearTimeout(del.timer);
  del.classList.remove("armed");
  del.querySelector("span").textContent = "删除";
  del.setAttribute("aria-label", del.getAttribute("aria-label").replace(/^再点一次删除/, "删除"));
}

/* ----------------------------------------------------------------- viewer */

const viewer = $("viewer");
let viewing = 0;
async function view(item) {
  const token = ++viewing;
  const img = $("viewer-img");
  const small = document.querySelector(`.tile[data-id="${CSS.escape(item.id)}"] img`);
  img.src = small?.src || "";
  img.alt = item.title;
  img.classList.toggle("cutout", Boolean(item.cutout));
  $("viewer-title").textContent = item.title;
  viewer.showModal();
  try {
    const full = await picture(item.id, true);
    if (token === viewing) img.src = full;
  } catch {
    // the small copy stays up
  }
}
$("viewer-close").addEventListener("click", () => viewer.close());
// a click on the dark backdrop (the dialog box itself, outside the picture) closes it
viewer.addEventListener("click", (e) => e.target === viewer && viewer.close());
viewer.addEventListener("close", () => viewing++);
