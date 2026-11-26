// Settings: where the site is and the key that lets this browser put pictures into its inbox.
const DEFAULT_SITE = "https://inspair-of-jankin.vercel.app";
const $ = (id) => document.getElementById(id);
const status = (text, kind = "") => {
  $("status").textContent = text;
  $("status").className = `status ${kind}`;
};

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

async function test(site, key) {
  $("save").disabled = true;
  status("正在连接…");
  try {
    const res = await fetch(`${site}/api/collect`, { headers: { Authorization: `Bearer ${key}` } });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) status("已保存，但密钥不对：和 Vercel 里的 COLLECT_SECRET 或 MCP_SECRET 对不上。", "bad");
    else if (res.status === 404) status("已保存，但这个网站上没有采集接口：网站需要先更新到支持插件的版本。", "bad");
    else if (!res.ok) status(`已保存，但网站返回了 ${res.status}：${data.error || "请稍后再试"}`, "bad");
    else status(`已连接「${data.site}」，收件箱里有 ${data.inbox} 张待整理。`, "ok");
  } catch {
    status("已保存，但连不上这个网址：检查地址是否正确、网站是否在线。", "bad");
  } finally {
    $("save").disabled = false;
  }
}
