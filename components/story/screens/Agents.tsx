"use client";
import { local } from "../timeline";
import { useStoryValue } from "../store";

type Line = { who: "me" | "ai"; text: string } | { who: "tool"; name: string; detail: string };

const SCRIPT: Line[] = [
  { who: "me", text: "收藏这张图，提示词是 frosted glass weather icon --ar 1:1" },
  { who: "tool", name: "add_item", detail: "图标 · 玻璃拟态 · Midjourney v7" },
  { who: "ai", text: "已收藏「玻璃质感天气图标」" },
  { who: "me", text: "桌面上的 loader.mp4 也传上去，归到动效" },
  { who: "tool", name: "prepare_upload", detail: "curl … /api/upload" },
  { who: "ai", text: "已上传「三点弹跳加载」" },
  { who: "me", text: "把红黑配色的海报都设为精选" },
  { who: "tool", name: "update_item ×3", detail: "featured: true" },
  { who: "ai", text: "3 张海报钉到了墙上" },
];

const TOASTS = ["Claude 收藏了「玻璃质感天气图标」", "Claude 上传了「三点弹跳加载」", "Claude 改了 3 条：设为精选"];

export default function AgentsScreen() {
  // how far the conversation has got, in lines (fractional = typing the next one)
  const at = useStoryValue((p) => {
    const t = local(p, "agents");
    return Math.round(Math.min(SCRIPT.length, Math.max(0, ((t - 0.14) / 0.72) * SCRIPT.length)) * 20) / 20;
  });
  const shown = Math.floor(at);
  const next = SCRIPT[shown];
  const typing = next && next.who === "me" ? next.text.slice(0, Math.floor((at - shown) * 1.6 * next.text.length)) : "";
  const toast = SCRIPT.slice(0, shown).filter((l) => l.who === "ai").length - 1;

  return (
    <section data-screen="agents" data-on="0" className="scr scr-agents" aria-labelledby="agents-title">
      <h2 id="agents-title" className="h-display agents-title">
        Feed it
        <br />
        through <span className="arrow">→</span> MCP
      </h2>
      <ul className="agents-clients" aria-label="支持的客户端">
        <li style={{ ["--x" as string]: "0%", ["--y" as string]: "0%" }}>Claude</li>
        <li style={{ ["--x" as string]: "62%", ["--y" as string]: "48%" }}>ChatGPT</li>
        <li style={{ ["--x" as string]: "150%", ["--y" as string]: "-10%" }}>Cursor</li>
      </ul>
      <div className="agents-notes">
        <p>它能直接往这里收藏、改分类、写提示词，你只管把东西丢给它。</p>
        <p>给它链接、文件和一句话就够了。</p>
      </div>

      <div className="chat" aria-label="通过 MCP 收藏的对话示例">
        <div className="chat-head">
          <span className="chat-app">inspair</span>
          <span className="muted">×</span>
          <span>Claude</span>
          <span className="chat-status">已连接</span>
        </div>
        <ol className="chat-log">
          {SCRIPT.slice(0, shown).map((line, k) => (
            <li key={k} className={`chat-line chat-line--${line.who}`}>
              {line.who === "tool" ? (
                <>
                  <span className="chat-tool">inspair / {line.name}</span>
                  <span className="chat-detail">{line.detail}</span>
                </>
              ) : (
                line.text
              )}
            </li>
          ))}
        </ol>
        <div className="chat-input">
          {typing ? <span>{typing}</span> : <span className="muted">描述你想收藏的东西…</span>}
          <i className="chat-caret" />
        </div>
      </div>

      <div className={`agents-toast${toast >= 0 ? " is-on" : ""}`} key={toast} aria-live="polite">
        {toast >= 0 && (
          <>
            <span>{TOASTS[Math.min(toast, TOASTS.length - 1)]}</span>
            <span className="muted">撤销</span>
            <span className="agents-cursor">Claude</span>
          </>
        )}
      </div>
    </section>
  );
}
