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
      if (!quiet) status(`已连接「${data.site}」。`, "ok");
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
async function picture(id, full = false, n = 0) {
  const query = new URLSearchParams();
  if (full) query.set("full", "1");
  if (n) query.set("n", String(n));
  const res = await api(`/${encodeURIComponent(id)}${query.size ? `?${query}` : ""}`);
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
  picked = picked.filter((id) => items.some((i) => i.id === id));
  const jobs = [];
  for (const item of items) {
    const tile = $("tile").content.firstElementChild.cloneNode(true);
    tile.dataset.id = item.id;
    tile.classList.toggle("cutout", Boolean(item.cutout));
    const pic = tile.querySelector(".pic");
    const img = pic.querySelector("img");
    if (item.width && item.height) (img.width = item.width), (img.height = item.height);
    const many = (item.pictures || 1) > 1;
    pic.setAttribute("aria-label", `查看大图：${item.title}${many ? `（一组 ${item.pictures} 张）` : ""}`);
    if (many) {
      const n = pic.querySelector(".n");
      n.hidden = false;
      n.textContent = `${item.pictures} 张`;
    }
    const pick = tile.querySelector(".pick");
    pick.setAttribute("aria-label", `选中：${item.title}`);
    pick.addEventListener("click", () => togglePick(item.id));
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
  showPicks();
}

/* ------------------------------------------------------------ making sets */

let picked = []; // ids in the order they were picked: the first is the cover
let grouping = false;

function togglePick(id) {
  picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
  showPicks();
}

function showPicks() {
  for (const tile of $("grid").children) {
    const k = picked.indexOf(tile.dataset.id);
    const pick = tile.querySelector(".pick");
    pick.setAttribute("aria-pressed", String(k !== -1));
    pick.querySelector("span").textContent = k === -1 ? "" : String(k + 1);
    tile.classList.toggle("picked", k !== -1);
  }
  $("grid").classList.toggle("picking", picked.length > 0);
  $("bar").hidden = picked.length === 0;
  $("bar-text").textContent = picked.length < 2 ? "再选几张，先选的那张作封面" : `已选 ${picked.length} 张，第 1 张作封面`;
  $("bar-group").disabled = picked.length < 2 || grouping;
}

$("bar-cancel").addEventListener("click", () => {
  picked = [];
  showPicks();
});

$("bar-group").addEventListener("click", async () => {
  if (picked.length < 2 || !conn) return;
  grouping = true;
  showPicks();
  $("bar-text").textContent = "正在合成…";
  try {
    const res = await fetch(`${conn.site}/api/collect/group`, {
      method: "POST",
      headers: { Authorization: `Bearer ${conn.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ids: picked }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `网站返回了 ${res.status}`);
    picked = [];
    status(`已合成一组：「${data.title}」，共 ${data.pictures} 张。`, "ok");
    await test(conn.site, conn.key, { quiet: true });
    $("grid").querySelector(`.tile[data-id="${CSS.escape(data.id)}"] .pic`)?.focus({ preventScroll: true });
  } catch (e) {
    status(`没合成：${e instanceof Error ? e.message : e}`, "bad");
  } finally {
    grouping = false;
    showPicks();
  }
});

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
let shown = null; // { item, at }
async function view(item, at = 0) {
  const token = ++viewing;
  const count = item.pictures || 1;
  shown = { item, at };
  const img = $("viewer-img");
  const small = at === 0 ? document.querySelector(`.tile[data-id="${CSS.escape(item.id)}"] img`) : null;
  img.src = small?.src || "";
  img.alt = count > 1 ? `${item.title}（第 ${at + 1} 张）` : item.title;
  img.classList.toggle("cutout", at === 0 && Boolean(item.cutout));
  $("viewer-title").textContent = item.title;
  $("viewer-count").hidden = count < 2;
  $("viewer-count").textContent = `${at + 1} / ${count}`;
  for (const [id, off] of [["viewer-prev", -1], ["viewer-next", 1]]) {
    $(id).hidden = count < 2;
    $(id).disabled = at + off < 0 || at + off >= count;
  }
  if (!viewer.open) viewer.showModal();
  try {
    const full = await picture(item.id, true, at);
    if (token === viewing) img.src = full;
  } catch {
    // the small copy stays up
  }
}
const flip = (off) => {
  if (!shown) return;
  const at = shown.at + off;
  if (at >= 0 && at < (shown.item.pictures || 1)) view(shown.item, at);
};
$("viewer-prev").addEventListener("click", () => flip(-1));
$("viewer-next").addEventListener("click", () => flip(1));
viewer.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") flip(-1);
  if (e.key === "ArrowRight") flip(1);
});
$("viewer-close").addEventListener("click", () => viewer.close());
// a click on the dark backdrop (the dialog box itself, outside the picture) closes it
viewer.addEventListener("click", (e) => e.target === viewer && viewer.close());
viewer.addEventListener("close", () => {
  viewing++;
  shown = null;
});
