"use client";
import { ArrowUpRight, ChevronLeft, ChevronRight, Film } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import MediaView from "./MediaView";
import { useCopy, useFramed } from "@/lib/hooks";
import { picturesOf, type Item, type Site } from "@/lib/types";

const TYPE_LABEL = { image: "图片", video: "视频", svg: "SVG", lottie: "Lottie" } as const;

/** `heading` is the title's level: h1 on the item's own page, h2 inside the modal over the home page. */
export default function ItemDetail({ item, site, heading: Title = "h2" }: { item: Item; site: Site; heading?: "h1" | "h2" }) {
  const { copied, copy } = useCopy();
  const Sub = Title === "h1" ? "h2" : "h3";
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
  // a set flips through its pictures here; the facts and 原文件 follow the one shown
  const pictures = picturesOf(item);
  const [at, setAt] = useState(0);
  const media = pictures[at] ?? item.media;
  const ext = media.src.split(".").pop()?.toUpperCase();
  const dims = media.width && media.height ? ` · ${media.width}×${media.height}` : "";
  const isSet = pictures.length > 1;
  const go = (k: number) => setAt(Math.max(0, Math.min(pictures.length - 1, k)));

  // ← → flip through the set first; at either end they fall through to the modal, which moves to the
  // neighbouring item (a capturing listener on window runs before the modal's own)
  const atRef = useRef(at);
  atRef.current = at;
  useEffect(() => {
    if (!isSet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, video, [contenteditable]")) return;
      const next = atRef.current + (e.key === "ArrowRight" ? 1 : -1);
      if (next < 0 || next >= pictures.length) return;
      e.preventDefault();
      e.stopPropagation();
      setAt(next);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isSet, pictures.length]);

  // a swipe across the picture flips it on touch screens
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (isSet && e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const from = swipe.current;
    swipe.current = null;
    if (!from) return;
    const dx = e.clientX - from.x;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(e.clientY - from.y) * 1.5) go(at + (dx < 0 ? 1 : -1));
  };

  return (
    <div className="detail">
      <div
        className={`detail-stage${isSet ? " is-set" : ""}`}
        style={item.color ? { ["--glow" as string]: item.color } : undefined}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
      >
        <MediaView key={media.src} item={{ ...item, media }} fit="contain" eager controls={media.type === "video"} />
        {isSet && (
          <>
            <p className="stage-count" aria-live="polite">
              {at + 1} / {pictures.length}
            </p>
            <button className="icon-btn stage-prev" onClick={() => go(at - 1)} disabled={at === 0} aria-label="这一组的上一张">
              <ChevronLeft />
            </button>
            <button className="icon-btn stage-next" onClick={() => go(at + 1)} disabled={at === pictures.length - 1} aria-label="这一组的下一张">
              <ChevronRight />
            </button>
            <div className="stage-thumbs" role="group" aria-label="这一组的图片">
              {pictures.map((m, k) => (
                <button
                  key={m.src}
                  className={`stage-thumb${m.cutout ? " is-cutout" : ""}`}
                  aria-current={k === at ? "true" : undefined}
                  aria-label={`第 ${k + 1} 张`}
                  onClick={() => setAt(k)}
                >
                  {m.type === "video" || m.type === "lottie" ? <Film /> : <img src={m.thumb ?? m.src} alt="" loading="lazy" decoding="async" draggable={false} />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <aside className="detail-info" data-lenis-prevent>
        <p className="eyebrow">
          {cat ? `${cat.name} · ${cat.label}` : item.category} · {date}
        </p>
        <Title className="detail-title">{item.title}</Title>
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
            <Sub>笔记</Sub>
            <p>{item.note}</p>
          </section>
        )}

        <dl className="facts">
          <div>
            <dt>格式</dt>
            <dd>
              {TYPE_LABEL[media.type]}
              {media.type === "image" || media.type === "video" ? ` (${ext})` : ""}
              {dims}
              {isSet ? ` · 共 ${pictures.length} 张` : ""}
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
            <a className="btn btn--line" href={media.src} target="_blank" rel="noopener">
              原文件 <ArrowUpRight className="ic-out" />
            </a>
          )}
        </div>
      </aside>
    </div>
  );
}
