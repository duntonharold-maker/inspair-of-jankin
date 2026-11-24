"use client";
import { useInView } from "@/lib/hooks";

const SCRIPT: ({ who: "me"; text: string } | { who: "tool"; name: string; detail: string } | { who: "ai"; text: string })[] = [
  { who: "me", text: "收藏这张图，提示词是 frosted glass weather icon, soft blue rim light --ar 1:1" },
  { who: "tool", name: "add_item", detail: "图标 · 玻璃拟态 · Midjourney v7" },
  { who: "ai", text: "已收藏「玻璃质感天气图标」，1–2 分钟后上线。" },
  { who: "me", text: "桌面上的 loader.mp4 也传上去，归到动效。" },
  { who: "tool", name: "prepare_upload", detail: "curl … /api/upload" },
  { who: "ai", text: "已上传「三点弹跳加载」。" },
  { who: "me", text: "找出所有带提示词的海报。" },
  { who: "tool", name: "search_items", detail: "category: poster · has_prompt: true" },
  { who: "ai", text: "找到 12 条，最新的是「瑞士网格排版」。" },
];

export default function McpSection() {
  const [ref, inView] = useInView<HTMLDivElement>("-20% 0px", true);
  return (
    <section id="mcp" className="mcp">
      <div className="mcp-copy">
        <p className="eyebrow">MCP</p>
        <h2 className="h-display">
          Feed it
          <br />
          through <span className="mcp-arrow">→</span> MCP
        </h2>
        <div className="mcp-notes">
          <p>把图片链接、SVG、Lottie 或本地文件交给你的智能体，它会填好标题、分类、标签和提示词，直接提交到 GitHub。</p>
          <p>支持 Claude、ChatGPT、Cursor 等任何支持远程 MCP 的客户端。</p>
        </div>
        <ul className="mcp-tools">
          {["add_item", "update_item", "delete_items", "search_items", "get_item", "prepare_upload", "list_categories", "upsert_category"].map(
            (t) => (
              <li key={t}>{t}</li>
            ),
          )}
        </ul>
      </div>
      <div ref={ref} className={`chat${inView ? " is-in" : ""}`} aria-label="通过 MCP 收藏的对话示例">
        <div className="chat-head">
          <span className="chat-dot" />
          inspair · 已连接
        </div>
        <ol className="chat-log">
          {SCRIPT.map((line, k) => (
            <li key={k} className={`chat-line chat-line--${line.who}`} style={{ transitionDelay: `${k * 220}ms` }}>
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
        <div className="chat-input">描述你想收藏的东西…</div>
      </div>
    </section>
  );
}
