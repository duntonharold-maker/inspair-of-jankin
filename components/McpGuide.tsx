"use client";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useCopy } from "@/lib/hooks";
import CopyButton from "./CopyButton";

/** Shown instead of the real secret: the repo and the site are public. */
const SECRET = "<MCP_SECRET>";

type Client = { id: string; name: string; steps: string[]; code: string; lang: string };

function clients(base: string): Client[] {
  const withSecret = `${base}/api/mcp/${SECRET}`;
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      steps: [
        `在终端运行下面这条命令，把 ${SECRET} 换成你的密钥。`,
        "启动 claude 后输入 /mcp，看到 inspair 显示已连接就可以用了。",
      ],
      code: `claude mcp add --transport http inspair ${base}/api/mcp --header "Authorization: Bearer ${SECRET}"`,
      lang: "终端命令",
    },
    {
      id: "claude-app",
      name: "Claude 网页版 / 桌面版",
      steps: [
        "打开「自定义 → 连接器」，点「添加 → 添加自定义连接器」，名称填 inspair。",
        `网址填下面这一行，把 ${SECRET} 换成你的密钥；登录方式选「不需要登录」，请求头和 OAuth 留空，保存。`,
        "在对话框左下角「+ → 连接器」里打开 inspair。",
      ],
      code: withSecret,
      lang: "连接器网址",
    },
    {
      id: "cursor",
      name: "Cursor",
      steps: [
        "打开「设置 → MCP」，或直接编辑 ~/.cursor/mcp.json。",
        `加入下面这段配置并保存，把 ${SECRET} 换成你的密钥。`,
        "回到设置里，inspair 旁边亮绿灯就是连上了。",
      ],
      code: JSON.stringify(
        { mcpServers: { inspair: { url: `${base}/api/mcp`, headers: { Authorization: `Bearer ${SECRET}` } } } },
        null,
        2,
      ),
      lang: "mcp.json",
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      steps: [
        "打开「设置 → 应用与连接器 → 高级设置」，开启开发者模式。",
        "点「创建」，名称填 inspair，MCP 服务地址填下面这一行，认证方式选「无认证」。",
        "新建对话时，在工具里选上 inspair。",
      ],
      code: withSecret,
      lang: "MCP 服务地址",
    },
    {
      id: "other",
      name: "其他客户端",
      steps: [
        "支持远程 MCP（Streamable HTTP）的客户端：直接填带密钥的网址。",
        "只能运行本地命令（stdio）的客户端：用 mcp-remote 转接，配置如下。",
        "本地开发（npm run dev）时，地址是 http://localhost:3000/api/mcp，不需要密钥。",
      ],
      code: JSON.stringify({ mcpServers: { inspair: { command: "npx", args: ["-y", "mcp-remote", withSecret] } } }, null, 2),
      lang: "配置文件",
    },
  ];
}

const ASKS = [
  "收藏这张图 https://…/a.png，归到海报，提示词是 …，模型 Midjourney v7",
  "把这段 SVG 存成一个动效图标：<svg …>",
  "把我桌面上的 loader.mp4 传上去，归到动效",
  "看一遍所有图标和动效，按画面重新分类，把意思重复的标签合并，先给我看方案",
  "找出所有带提示词的海报",
  "删除所有带「示例」标签的条目",
];

const TOOLS = [
  "list_categories",
  "search_items",
  "get_item",
  "view_items",
  "add_item",
  "update_item",
  "organize_items",
  "delete_items",
  "prepare_upload",
  "upsert_category",
];

export default function McpGuide({ siteUrl }: { siteUrl: string | null }) {
  const base = siteUrl ?? "https://你的域名";
  const list = clients(base);
  const [active, setActive] = useState(list[0].id);
  const { copied, copy } = useCopy();
  const client = list.find((c) => c.id === active) ?? list[0];

  return (
    <section id="mcp" className="guide band-dark" aria-labelledby="guide-title">
      <div className="guide-inner">
      <header className="guide-head">
        <p className="eyebrow">MCP 连接指南</p>
        <h2 id="guide-title" className="h-display">
          Connect any
          <br />
          agent <ArrowRight className="arrow" /> MCP
        </h2>
        <p className="guide-sub">
          用任何支持 MCP 的智能体管理这个网站：收藏图片和动效、记提示词、改分类、批量整理。改动会提交到 GitHub，1–2 分钟后网站更新。
        </p>
      </header>

      <div className="guide-grid">
          <section className="guide-step guide-s1" aria-labelledby="step-1">
            <span className="guide-num">01</span>
            <h3 id="step-1">服务地址</h3>
            <p className="guide-text">只能填网址的客户端（Claude 网页版、ChatGPT）用第一种；能加请求头的（Claude Code、Cursor）用第二种。</p>
            <div className="guide-field">
              <span className="guide-label">带密钥的网址</span>
              <code className="guide-code guide-code--line">{`${base}/api/mcp/${SECRET}`}</code>
              <CopyButton text={`${base}/api/mcp/${SECRET}`} what="带密钥的网址" />
            </div>
            <div className="guide-field">
              <span className="guide-label">网址 + 请求头</span>
              <code className="guide-code guide-code--line">{`${base}/api/mcp`}</code>
              <CopyButton text={`${base}/api/mcp`} what="网址" />
              <code className="guide-code guide-code--line">{`Authorization: Bearer ${SECRET}`}</code>
              <CopyButton text={`Authorization: Bearer ${SECRET}`} what="请求头" />
            </div>
            <p className="guide-note">
              密钥是你在 Vercel 项目「Settings → Environment Variables」里设置的 <code>MCP_SECRET</code>。带密钥的网址相当于密码，不要发给别人；泄露了就在 Vercel 里换一个，再重新部署。
            </p>
          </section>

          <section className="guide-step guide-s3" aria-labelledby="step-3">
            <span className="guide-num">03</span>
            <h3 id="step-3">连上之后，这样跟它说</h3>
            <ul className="guide-asks">
              {ASKS.map((a, k) => (
                <li key={a}>
                  <button className="ask" onClick={() => copy(a, `ask-${k}`)}>
                    <span>{a}</span>
                    <span className="ask-hint">{copied === `ask-${k}` ? "已复制" : "复制"}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="guide-note">上传本地文件需要能运行命令的智能体（如 Claude Code）；其他客户端请给图片的直接链接。</p>
            <ul className="guide-tools" aria-label="可用的工具">
              {TOOLS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>

        <section className="guide-step guide-client" aria-labelledby="step-2">
          <span className="guide-num">02</span>
          <h3 id="step-2">在你的智能体里添加</h3>
          <div className="seg seg--line guide-tabs" role="tablist" aria-label="选择客户端">
            {list.map((c) => (
              <button
                key={c.id}
                role="tab"
                id={`tab-${c.id}`}
                aria-selected={c.id === client.id}
                aria-controls="guide-panel"
                className={c.id === client.id ? "is-on" : ""}
                onClick={() => setActive(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div id="guide-panel" role="tabpanel" aria-labelledby={`tab-${client.id}`} className="guide-panel" key={client.id}>
            <ol className="guide-steps">
              {client.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <div className="guide-block">
              <div className="guide-block-bar">
                <span>{client.lang}</span>
                <CopyButton key={client.id} text={client.code} what={client.lang} />
              </div>
              <pre className="guide-code guide-code--block">{client.code}</pre>
            </div>
          </div>
        </section>
      </div>
      </div>
    </section>
  );
}
