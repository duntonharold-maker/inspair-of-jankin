"use client";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import MediaView from "./MediaView";
import { useCopy, useFramed } from "@/lib/hooks";
import type { Item, Site } from "@/lib/types";

const TYPE_LABEL = { image: "图片", video: "视频", svg: "SVG", lottie: "Lottie" } as const;

export default function ItemDetail({ item, site }: { item: Item; site: Site }) {
  const { copied, copy } = useCopy();
  // in a frame (the artifact viewer) a link to the file can't be opened and nothing can be downloaded
  const inFrame = useFramed();
  const cat = site.categories.find((c) => c.id === item.category);
  const date = item.createdAt.slice(0, 10).replaceAll("-", ".");
  const isUrl = /^https?:\/\//i.test(item.source ?? "");
  let host = item.source;
  if (isUrl) {
    try {
      host = new URL(item.source!).host.replace(/^www\./, "");
    } catch {}
  }
  const ext = item.media.src.split(".").pop()?.toUpperCase();
  const dims = item.media.width && item.media.height ? ` · ${item.media.width}×${item.media.height}` : "";

  return (
    <div className="detail">
      <div className="detail-stage" style={item.color ? { ["--glow" as string]: item.color } : undefined}>
        <MediaView item={item} fit="contain" eager controls={item.media.type === "video"} />
      </div>
      <aside className="detail-info" data-lenis-prevent>
        <p className="eyebrow">
          {cat ? `${cat.name} · ${cat.label}` : item.category} · {date}
        </p>
        <h2 className="detail-title">{item.title}</h2>
        {item.tags.length > 0 && (
          <ul className="tags">
            {item.tags.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}

        {item.prompt ? (
          <section className="prompt">
            <header>
              <span className="prompt-label">Prompt</span>
              {item.model && <span className="prompt-model">{item.model}</span>}
              <button className="prompt-copy" onClick={() => copy(item.prompt!, "prompt")}>
                {copied === "prompt" ? "已复制" : "复制"}
              </button>
            </header>
            <p className="prompt-text">{item.prompt}</p>
            {item.params && <code className="prompt-params">{item.params}</code>}
            {item.negativePrompt && (
              <details className="prompt-neg">
                <summary>
                  <ChevronRight className="ic-fold" />
                  Negative prompt
                </summary>
                <p>{item.negativePrompt}</p>
              </details>
            )}
          </section>
        ) : item.model ? (
          <p className="muted">工具：{item.model}</p>
        ) : null}

        {item.note && (
          <section className="detail-note">
            <h3>笔记</h3>
            <p>{item.note}</p>
          </section>
        )}

        <dl className="facts">
          <div>
            <dt>格式</dt>
            <dd>
              {TYPE_LABEL[item.media.type]}
              {item.media.type === "image" || item.media.type === "video" ? ` (${ext})` : ""}
              {dims}
            </dd>
          </div>
          {item.color && (
            <div>
              <dt>主色</dt>
              <dd>
                <span className="swatch" style={{ background: item.color }} />
                {item.color}
              </dd>
            </div>
          )}
          {item.source && (
            <div>
              <dt>出处</dt>
              <dd>
                {isUrl ? (
                  <a href={item.source} target="_blank" rel="noopener noreferrer">
                    {host}
                    <ArrowUpRight className="ic-out" />
                  </a>
                ) : (
                  item.source
                )}
              </dd>
            </div>
          )}
          <div>
            <dt>ID</dt>
            <dd className="mono">{item.id}</dd>
          </div>
        </dl>

        <div className="detail-actions">
          <button className="btn btn--line" onClick={() => copy(`${location.origin}/i/${item.id}`, "link")}>
            {copied === "link" ? "已复制链接" : "复制链接"}
          </button>
          {!inFrame && (
            <a className="btn btn--line" href={item.media.src} target="_blank" rel="noopener">
              原文件 <ArrowUpRight className="ic-out" />
            </a>
          )}
        </div>
      </aside>
    </div>
  );
}
