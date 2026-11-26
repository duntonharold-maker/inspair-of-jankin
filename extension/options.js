// The inbox: every picture collected and not yet filed by Claude. Look at them, throw some away, make sets
// (shown as folders), rearrange a set. Connection settings sit behind the gear.
const DEFAULT_SITE = "https://inspair-of-jankin.vercel.app";
const $ = (id) => document.getElementById(id);

let conn = null; // { site, key } once the connection works
let items = []; // the inbox, newest first
let labels = new Map(); // category id → label
let filter = "all";
let picked = []; // ids in the order they were picked: the first is the cover
let openSet = null; // the id of the set shown in the set view
const urls = new Map(); // `${id}/${n}` → object URL of the small picture
const tiles = new Map(); // id → tile element, kept between renders so pictures don't reload

/* ------------------------------------------------------------------ site */

const api = (path, init = {}) =>
  fetch(`${conn.site}/api/collect${path}`, { ...init, headers: { Authorization: `Bearer ${conn.key}`, ...(init.headers || {}) } });

async function call(path, init) {
  const res = await api(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `网站返回了 ${res.status}`);
  return data;
}

/** A picture of the inbox as an object URL (the site only hands them out with the key). */
async function picture(id, n = 0, full = false) {
  const key = `${id}/${n}`;
  if (!full && urls.has(key)) return urls.get(key);
  const q = new URLSearchParams();
  if (full) q.set("full", "1");
  if (n) q.set("n", String(n));
  const res = await api(`/${encodeURIComponent(id)}${q.size ? `?${q}` : ""}`);
  if (!res.ok) throw new Error(`网站返回了 ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  if (!full) urls.set(key, url);
  return url;
}

/** Fill images a few at a time, in the order asked. */
const queue = [];
let running = 0;
function load(img, id, n = 0) {
  queue.push({ img, id, n });
  pump();
}
function pump() {
  while (running < 4 && queue.length) {
    const { img, id, n } = queue.shift();
    running++;
    picture(id, n)
      .then(async (url) => {
        img.src = url;
        await img.decode().catch(() => {});
        img.classList.add("ready");
      })
      .catch(() => {})
      .finally(() => {
        running--;
        pump();
      });
  }
}

/* ------------------------------------------------------------- settings */

const settings = $("settings");
const status = (text, kind = "") => {
  $("status").textContent = text;
  $("status").className = `status ${kind}`;
};
function showSettings(open) {
  settings.hidden = !open;
  $("gear").setAttribute("aria-expanded", String(open));
  if (open) $(conn ? "save" : $("key").value ? "save" : "key").focus({ preventScroll: true });
}
$("gear").addEventListener("click", () => showSettings(settings.hidden));
$("settings-close").addEventListener("click", () => {
  showSettings(false);
  $("gear").focus();
});
document.addEventListener("pointerdown", (e) => {
  if (!settings.hidden && !settings.contains(e.target) && !$("gear").contains(e.target)) showSettings(false);
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
  connect(site, key);
});

chrome.storage.local.get(["site", "key"]).then(({ site, key }) => {
  $("site").value = site || DEFAULT_SITE;
  $("key").value = key || "";
  $("brand").href = site || DEFAULT_SITE;
  if (key) connect(site || DEFAULT_SITE, key);
  else {
    $("empty").textContent = "填好网站地址和密钥后，收件箱会出现在这里。";
    $("empty").hidden = false;
    showSettings(true);
  }
});

/** Check the key and load the inbox; a problem opens the settings with what went wrong. */
async function connect(site, key, { quiet = false } = {}) {
  $("save").disabled = true;
  $("refresh").classList.add("spin");
  if (!quiet) status("正在连接…");
  try {
    const res = await fetch(`${site}/api/collect`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    let problem = "";
    if (res.status === 401) problem = "密钥不对：和 Vercel 里的 COLLECT_SECRET 或 MCP_SECRET 对不上。";
    else if (res.status === 404) problem = "这个网站上没有采集接口：网站需要先更新到支持插件的版本。";
    else if (!res.ok) problem = `网站返回了 ${res.status}：${data.error || "请稍后再试"}`;
    if (problem) throw new Error(problem);
    const first = !conn;
    conn = { site, key };
    $("brand").href = site;
    status(quiet ? "" : `已连接「${data.site}」`);
    $("gear").querySelector(".alert").hidden = true;
    labels = new Map((data.categories || []).map((c) => [c.id, c.label]));
    if (data.categories) chrome.storage.local.set({ categories: data.categories });
    items = data.items || [];
    if (first && !settings.hidden) showSettings(false);
    render();
  } catch (e) {
    const text = e instanceof TypeError ? "连不上这个网址：检查地址是否正确、网站是否在线。" : e.message;
    status(text, "bad");
    $("gear").querySelector(".alert").hidden = false;
    if (!quiet) showSettings(true);
  } finally {
    $("save").disabled = false;
    $("refresh").classList.remove("spin");
  }
}
const reload = () => conn && connect(conn.site, conn.key, { quiet: true });
$("refresh").addEventListener("click", reload);
// a picture just collected from a page shows up here without a reload
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "inspair:collected") reload();
});

/* --------------------------------------------------------------- inbox */

const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const isSet = (item) => (item.pictures || 1) > 1;
const shown = () =>
  items.filter((i) =>
    filter === "remark" ? i.remarks?.length : filter === "set" ? isSet(i) : filter === "none" ? !i.category : true,
  );

for (const b of document.querySelectorAll(".seg button")) {
  b.addEventListener("click", () => {
    filter = b.dataset.filter;
    for (const o of document.querySelectorAll(".seg button")) o.setAttribute("aria-pressed", String(o === b));
    render();
  });
}

function render() {
  // forget the pictures of items that are gone
  for (const [id, el] of tiles) if (!items.some((i) => i.id === id)) (tiles.delete(id), el.remove());
  for (const key of [...urls.keys()]) if (!items.some((i) => key.startsWith(`${i.id}/`))) (URL.revokeObjectURL(urls.get(key)), urls.delete(key));
  picked = picked.filter((id) => items.some((i) => i.id === id));
  if (openSet && !items.some((i) => i.id === openSet && isSet(i))) closeSet();
  if (openSet) renderSet();
  const list = shown();
  $("empty").textContent = items.length ? "没有图片" : "收件箱是空的";
  $("empty").hidden = list.length > 0;
  for (const item of list) {
    const old = tiles.get(item.id);
    if (!old || old.dataset.sig !== signature(item)) {
      const el = isSet(item) ? folderTile(item) : pictureTile(item);
      if (old) old.replaceWith(el);
      tiles.set(item.id, el);
    }
  }
  layout(list);
  showPicks();
  for (const id of landed) {
    const el = tiles.get(id);
    if (!el) continue;
    el.classList.remove("landed");
    void el.offsetWidth;
    el.classList.add("landed");
    setTimeout(() => el.classList.remove("landed"), 900);
  }
  landed.clear();
}
// what a tile shows; when it changes the tile is built again
const signature = (i) => JSON.stringify([i.title, i.category, i.source, i.pictures, i.remarks, i.sizes?.[0]]);

/** Masonry: each tile goes into the shortest column (estimated from the picture's shape). */
let lastCols = 0;
function layout(list = shown()) {
  const grid = $("grid");
  const width = grid.clientWidth || window.innerWidth;
  const n = Math.max(2, Math.min(6, Math.floor((width + 16) / (236 + 16))));
  lastCols = n;
  const cols = Array.from({ length: n }, () => Object.assign(document.createElement("div"), { className: "col" }));
  const heights = new Array(n).fill(0);
  for (const item of list) {
    const k = heights.indexOf(Math.min(...heights));
    const s = item.sizes?.[0] || {};
    heights[k] += isSet(item) ? 1.25 : (s.height && s.width ? s.height / s.width : 1) + 0.06;
    cols[k].append(tiles.get(item.id));
  }
  grid.replaceChildren(...cols);
}
new ResizeObserver(() => {
  const width = $("grid").clientWidth;
  const n = Math.max(2, Math.min(6, Math.floor((width + 16) / (236 + 16))));
  if (n !== lastCols && !$("inbox-view").hidden) layout();
}).observe($("grid"));

function pictureTile(item) {
  const el = $("tile").content.firstElementChild.cloneNode(true);
  el.dataset.id = item.id;
  el.dataset.sig = signature(item);
  const s = item.sizes?.[0] || {};
  const pic = el.querySelector(".pic");
  pic.style.aspectRatio = s.width && s.height ? `${s.width} / ${s.height}` : "1";
  pic.classList.toggle("cutout", Boolean(s.cutout));
  pic.setAttribute("aria-label", `查看大图：${item.title}`);
  pic.addEventListener("click", () => view(item, 0));
  load(pic.querySelector("img"), item.id, 0);
  el.querySelector(".dot").hidden = !item.remarks?.length;
  el.querySelector(".info-title").textContent = item.title;
  src(el.querySelector(".src"), item);
  wirePick(el, item);
  wireDrag(el, item);
  const del = el.querySelector(".del");
  del.setAttribute("aria-label", `删除：${item.title}`);
  armed(del, () => remove(item, el));
  return el;
}

function folderTile(item) {
  const el = $("folder").content.firstElementChild.cloneNode(true);
  el.dataset.id = item.id;
  el.dataset.sig = signature(item);
  const card = el.querySelector(".fcard");
  card.setAttribute("aria-label", `打开这一组：${item.title}，${item.pictures} 张`);
  card.addEventListener("click", () => showSet(item.id));
  // the cover leans a little towards the pointer
  card.addEventListener("pointermove", (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty("--px", `${(((e.clientX - r.left) / r.width) - 0.5) * 10}px`);
    card.style.setProperty("--py", `${(((e.clientY - r.top) / r.height) - 0.5) * 10}px`);
  });
  card.addEventListener("pointerleave", () => (card.style.removeProperty("--px"), card.style.removeProperty("--py")));
  const cover = el.querySelector(".fcover");
  cover.classList.toggle("cutout", Boolean(item.sizes?.[0]?.cutout));
  load(cover.querySelector("img"), item.id, 0);
  el.querySelector(".ftitle").textContent = item.title;
  const thumbs = el.querySelector(".fthumbs");
  for (let n = 1; n < Math.min(item.pictures, 4); n++) {
    const img = Object.assign(document.createElement("img"), { alt: "", decoding: "async", draggable: false });
    thumbs.append(img);
    load(img, item.id, n);
  }
  el.querySelector(".fcount").textContent = String(item.pictures);
  const label = labels.get(item.category);
  el.querySelector(".fcat-text").textContent = label || "";
  el.querySelector(".fcat .dot").hidden = !item.remarks?.length;
  wirePick(el, item);
  wireDrag(el, item);
  return el;
}

function src(a, item) {
  const h = item.source && /^https?:/.test(item.source) ? host(item.source) : "";
  const label = labels.get(item.category);
  const text = [label, h].filter(Boolean).join(" · ");
  if (!h) a.removeAttribute("href");
  else a.href = item.source;
  a.querySelector("span").textContent = text;
  a.hidden = !text;
  if (h) a.setAttribute("aria-label", `打开来源网页：${h}`);
}

/* ------------------------------------------------------------ picking */

function wirePick(el, item) {
  const pick = el.querySelector(".pick");
  pick.setAttribute("aria-label", `选中：${item.title}`);
  pick.addEventListener("click", () => {
    picked = picked.includes(item.id) ? picked.filter((x) => x !== item.id) : [...picked, item.id];
    showPicks();
  });
}

let grouping = false;
function showPicks() {
  for (const [id, el] of tiles) {
    const k = picked.indexOf(id);
    const pick = el.querySelector(".pick");
    pick.setAttribute("aria-pressed", String(k !== -1));
    pick.querySelector(".n").textContent = k === -1 ? "" : String(k + 1);
    el.classList.toggle("picked", k !== -1);
  }
  $("grid").classList.toggle("picking", picked.length > 0);
  $("bar").hidden = picked.length === 0 || Boolean(openSet);
  $("bar-group").disabled = picked.length < 2 || grouping;
  $("bar-status").textContent = picked.length ? `已选 ${picked.length} 张，第 1 张作封面` : "";
}
$("bar-cancel").addEventListener("click", () => {
  picked = [];
  showPicks();
});
$("bar-group").addEventListener("click", async () => {
  if (picked.length < 2 || !conn) return;
  grouping = true;
  showPicks();
  await merge(picked);
  grouping = false;
  showPicks();
});

/** Make one set of these (the first is the cover), animate the others into it, offer undo. */
async function merge(ids) {
  const intoSet = ids.length === 2 && isSetId(ids[0]);
  for (const id of ids.slice(1)) tiles.get(id)?.classList.add("joining");
  try {
    const data = await call("/group", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    picked = picked.filter((id) => !ids.includes(id));
    for (const id of ids) forget(id);
    landed.add(data.id);
    await connect(conn.site, conn.key, { quiet: true });
    toast(intoSet ? `放进了这一组，共 ${data.pictures} 张` : `合成了一组，共 ${data.pictures} 张`, data.undo);
  } catch (e) {
    for (const id of ids) tiles.get(id)?.classList.remove("joining");
    toast(`没合成：${e.message}`);
  }
}
const isSetId = (id) => isSet(items.find((i) => i.id === id) || {});

/* ------------------------------------------------- drag one onto another */

let dragged = null;
function wireDrag(el, item) {
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    dragged = item.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.title);
    requestAnimationFrame(() => el.classList.add("dragging"));
    $("grid").classList.add("drag-on");
  });
  el.addEventListener("dragend", () => {
    dragged = null;
    el.classList.remove("dragging");
    $("grid").classList.remove("drag-on");
    for (const t of document.querySelectorAll(".drop-target")) t.classList.remove("drop-target");
  });
  el.addEventListener("dragover", (e) => {
    if (!dragged || dragged === item.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    el.classList.add("drop-target");
  });
  el.addEventListener("dragleave", (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove("drop-target");
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("drop-target");
    const from = dragged;
    dragged = null;
    if (from && from !== item.id) merge([item.id, from]);
  });
}

/* ------------------------------------------------------------- delete */

/** First click arms the button (it opens into 删除), the second does it; it disarms itself after a moment. */
function armed(button, act) {
  button.addEventListener("click", () => {
    if (!button.classList.contains("armed")) {
      for (const other of document.querySelectorAll(".armed")) disarm(other);
      button.classList.add("armed");
      button.timer = setTimeout(() => disarm(button), 3000);
      return;
    }
    disarm(button);
    act();
  });
}
function disarm(button) {
  clearTimeout(button.timer);
  button.classList.remove("armed");
}

async function remove(item, el) {
  el?.classList.add("busy");
  try {
    await call(`/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    items = items.filter((i) => i.id !== item.id);
    if (el) {
      el.classList.add("gone");
      await new Promise((r) => setTimeout(r, 250));
    }
    if (openSet === item.id) closeSet();
    render();
    toast(`已删除「${item.title}」`);
  } catch (e) {
    el?.classList.remove("busy");
    toast(`没删掉：${e.message}`);
  }
}

/** A short note at the bottom; with an undo token it offers 撤销 for a while. */
let toastTimer;
let undoToken = null;
function toast(text, undo = null) {
  $("toast-text").textContent = text;
  undoToken = undo;
  $("toast-undo").hidden = !undo;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), undo ? 7000 : 3200);
}
$("toast-undo").addEventListener("click", async () => {
  const token = undoToken;
  if (!token) return;
  undoToken = null;
  $("toast-undo").hidden = true;
  try {
    const data = await call("/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    for (const id of data.restored || []) forget(id), landed.add(id);
    if (openSet && !(data.restored || []).includes(openSet)) closeSet();
    await connect(conn.site, conn.key, { quiet: true });
    toast("已撤销");
  } catch (e) {
    toast(e.message);
  }
});

/** Drop a tile and its cached pictures so it is built again from the site's answer. */
function forget(id) {
  for (const key of [...urls.keys()]) if (key.startsWith(`${id}/`)) (URL.revokeObjectURL(urls.get(key)), urls.delete(key));
  tiles.get(id)?.remove();
  tiles.delete(id);
}
/** Tiles that just came out of a change: they pop once when they appear. */
const landed = new Set();

/* ------------------------------------------------------------ a set */

function showSet(id) {
  openSet = id;
  $("inbox-view").hidden = true;
  $("set-view").hidden = false;
  renderSet();
  showPicks();
  window.scrollTo({ top: 0 });
  $("set-back").focus({ preventScroll: true });
}
function closeSet() {
  const id = openSet;
  openSet = null;
  $("set-view").hidden = true;
  $("inbox-view").hidden = false;
  showPicks();
  layout();
  tiles.get(id)?.querySelector(".fcard")?.focus({ preventScroll: true });
}
$("set-back").addEventListener("click", closeSet);

function renderSet() {
  const item = items.find((i) => i.id === openSet);
  if (!item) return;
  $("set-title").textContent = item.title;
  const label = labels.get(item.category);
  $("set-cat").textContent = label || "";
  $("set-cat").hidden = !label;
  const a = $("set-src");
  const h = item.source && /^https?:/.test(item.source) ? host(item.source) : "";
  a.hidden = !h;
  if (h) {
    a.href = item.source;
    a.querySelector("span").textContent = h;
  }
  $("set-remarks").replaceChildren(...(item.remarks || []).map((r) => Object.assign(document.createElement("li"), { textContent: r })));
  const row = $("set-row");
  row.replaceChildren();
  for (let n = 0; n < item.pictures; n++) {
    const el = $("set-pic").content.firstElementChild.cloneNode(true);
    const s = item.sizes?.[n] || {};
    const pic = el.querySelector(".pic");
    pic.style.aspectRatio = s.width && s.height ? `${s.width} / ${s.height}` : "1";
    pic.classList.toggle("cutout", Boolean(s.cutout));
    pic.setAttribute("aria-label", `查看第 ${n + 1} 张`);
    pic.addEventListener("click", () => view(item, n));
    load(pic.querySelector("img"), item.id, n);
    const cover = el.querySelector(".cover");
    if (n === 0) cover.remove();
    else cover.addEventListener("click", () => arrange(item, { order: moveTo(item.pictures, n, 0) }, "已换封面"));
    el.querySelector(".out").addEventListener("click", () => {
      el.classList.add("leaving");
      arrange(item, { split: [n] }, "已移出这一组", { onFail: () => el.classList.remove("leaving") });
    });
    wireReorder(el, item, n);
    row.append(el);
  }
}
/** Positions 0…count-1 with the picture at `from` moved to `to`. */
function moveTo(count, from, to) {
  const order = range(count).filter((k) => k !== from);
  order.splice(to, 0, from);
  return order;
}

/** In a set: drag a picture before or after another; the first place is the cover. */
let reordering = null;
function wireReorder(el, item, n) {
  el.draggable = true;
  const clear = () => el.classList.remove("insert-before", "insert-after");
  el.addEventListener("dragstart", (e) => {
    reordering = n;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(n));
    requestAnimationFrame(() => el.classList.add("dragging"));
  });
  el.addEventListener("dragend", () => {
    reordering = null;
    el.classList.remove("dragging");
    for (const m of document.querySelectorAll(".insert-before, .insert-after")) m.classList.remove("insert-before", "insert-after");
  });
  el.addEventListener("dragover", (e) => {
    if (reordering == null || reordering === n) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    el.classList.toggle("insert-after", after);
    el.classList.toggle("insert-before", !after);
  });
  el.addEventListener("dragleave", (e) => {
    if (!el.contains(e.relatedTarget)) clear();
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    const after = el.classList.contains("insert-after");
    clear();
    const from = reordering;
    reordering = null;
    if (from == null || from === n) return;
    // where it lands once it has left its own place
    let to = n + (after ? 1 : 0);
    if (from < to) to--;
    if (to === from) return;
    arrange(item, { order: moveTo(item.pictures, from, to) }, to === 0 ? "已换封面" : "已调整顺序");
  });
}
const range = (n) => Array.from({ length: n }, (_, k) => k);

$("set-split").addEventListener("click", () => {
  const item = items.find((i) => i.id === openSet);
  if (item) arrange(item, { order: [0], split: range(item.pictures).slice(1) }, `已拆开成 ${item.pictures} 张`, { back: true });
});
armed($("set-del"), () => {
  const item = items.find((i) => i.id === openSet);
  if (item) remove(item, null);
});

async function arrange(item, spec, done, { back = false, onFail } = {}) {
  try {
    const data = await call("/arrange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, ...spec }) });
    // pictures moved: what was cached under this set no longer matches
    forget(item.id);
    for (const id of data.split_out || []) landed.add(id);
    if (back) {
      landed.add(item.id);
      closeSet();
    }
    await connect(conn.site, conn.key, { quiet: true });
    toast(done, data.undo);
  } catch (e) {
    onFail?.();
    toast(e.message);
  }
}

/* ------------------------------------------------------------- viewer */

const viewer = $("viewer");
let viewing = 0;
let current = null; // { item, at }
async function view(item, at = 0) {
  const token = ++viewing;
  const count = item.pictures || 1;
  current = { item, at };
  const img = $("viewer-img");
  img.src = urls.get(`${item.id}/${at}`) || "";
  img.alt = count > 1 ? `${item.title}（第 ${at + 1} 张）` : item.title;
  img.classList.toggle("cutout", Boolean(item.sizes?.[at]?.cutout));
  $("viewer-title").textContent = item.title;
  $("viewer-count").hidden = count < 2;
  $("viewer-count").textContent = `${at + 1} / ${count}`;
  for (const [id, off] of [["viewer-prev", -1], ["viewer-next", 1]]) {
    $(id).hidden = count < 2;
    $(id).disabled = at + off < 0 || at + off >= count;
  }
  if (!viewer.open) viewer.showModal();
  try {
    const full = await picture(item.id, at, true);
    if (token === viewing) img.src = full;
  } catch {
    // the small copy stays up
  }
}
const flip = (off) => {
  if (!current) return;
  const at = current.at + off;
  if (at >= 0 && at < (current.item.pictures || 1)) view(current.item, at);
};
$("viewer-prev").addEventListener("click", () => flip(-1));
$("viewer-next").addEventListener("click", () => flip(1));
viewer.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") flip(-1);
  if (e.key === "ArrowRight") flip(1);
});
$("viewer-close").addEventListener("click", () => viewer.close());
viewer.addEventListener("click", (e) => e.target === viewer && viewer.close());
viewer.addEventListener("close", () => {
  viewing++;
  current = null;
});

// Esc: settings first, then the set view
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || viewer.open) return;
  if (!settings.hidden) {
    showSettings(false);
    $("gear").focus();
  } else if (openSet) closeSet();
});
