"use client";
import { useEffect, useMemo, useState } from "react";
import Card, { ratioOf } from "./Card";
import type { Kind } from "./Stats";
import type { Item, Site } from "@/lib/types";

const PAGE = 40;

function useColumnCount() {
  const [n, setN] = useState(4);
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      setN(w >= 1400 ? 5 : w >= 1040 ? 4 : w >= 720 ? 3 : 2);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  return n;
}

export default function Gallery({
  site,
  items,
  category,
  setCategory,
  kind,
  setKind,
  onlyPrompt,
  setOnlyPrompt,
  onOpen,
  onListChange,
}: {
  site: Site;
  items: Item[];
  category: string;
  setCategory: (id: string) => void;
  kind: Kind;
  setKind: (k: Kind) => void;
  onlyPrompt: boolean;
  setOnlyPrompt: (v: boolean) => void;
  onOpen: (id: string) => void;
  onListChange: (list: Item[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [oldest, setOldest] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const cols = useColumnCount();

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.category, (m.get(i.category) ?? 0) + 1);
    return m;
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((i) => {
      if (category !== "all" && i.category !== category) return false;
      if (kind === "image" && i.media.type !== "image") return false;
      if (kind === "motion" && i.media.type === "image") return false;
      if (onlyPrompt && !i.prompt) return false;
      if (!q) return true;
      return [i.title, i.prompt, i.note, i.model, ...i.tags].some((s) => s?.toLowerCase().includes(q));
    });
    return oldest ? list.reverse() : list;
  }, [items, category, kind, onlyPrompt, query, oldest]);

  useEffect(() => onListChange(filtered), [filtered, onListChange]);
  useEffect(() => setLimit(PAGE), [category, kind, onlyPrompt, query, oldest]);

  const columns = useMemo(() => {
    const out: Item[][] = Array.from({ length: cols }, () => []);
    const heights = new Array(cols).fill(0);
    for (const item of filtered.slice(0, limit)) {
      const k = heights.indexOf(Math.min(...heights));
      out[k].push(item);
      heights[k] += 1 / Math.min(2.2, Math.max(0.45, ratioOf(item))) + 0.18;
    }
    return out;
  }, [filtered, limit, cols]);

  const catOf = (id: string) => site.categories.find((c) => c.id === id);

  return (
    <section id="all" className="gallery">
      <header className="gallery-head">
        <h2 className="h-display">
          Everything<sup className="gallery-total">{filtered.length}</sup>
        </h2>
        <div className="toolbar">
          <label className="search">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              placeholder="搜索标题、提示词、标签…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="搜索"
            />
          </label>
          <div className="seg seg--line" role="radiogroup" aria-label="类型">
            {(
              [
                ["all", "全部类型"],
                ["image", "图片"],
                ["motion", "动效与界面"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? "is-on" : ""} onClick={() => setKind(k)}>
                {label}
              </button>
            ))}
          </div>
          <button className={`toggle${onlyPrompt ? " is-on" : ""}`} onClick={() => setOnlyPrompt(!onlyPrompt)} aria-pressed={onlyPrompt}>
            只看带提示词
          </button>
          <button className="toggle" onClick={() => setOldest((v) => !v)}>
            {oldest ? "最早在前" : "最新在前"}
          </button>
        </div>
        <div className="chips" role="tablist" aria-label="分类筛选">
          <button role="tab" aria-selected={category === "all"} className="chip-btn" onClick={() => setCategory("all")}>
            全部 <span>{items.length}</span>
          </button>
          {site.categories.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={category === c.id}
              className="chip-btn"
              onClick={() => setCategory(c.id)}
            >
              {c.label} <span>{counts.get(c.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </header>

      {filtered.length ? (
        <div className="masonry" style={{ ["--cols" as string]: cols }}>
          {columns.map((col, k) => (
            <div key={k} className="masonry-col">
              {col.map((item) => (
                <Card key={item.id} item={item} category={catOf(item.category)} onOpen={onOpen} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="gallery-empty">
          <p>{items.length ? "没有符合条件的灵感。" : "还没有收藏任何东西。"}</p>
          <p className="muted">{items.length ? "换个关键词或分类试试。" : "让你的智能体通过 MCP 收藏第一张吧。"}</p>
        </div>
      )}

      {filtered.length > limit && (
        <div className="gallery-more">
          <button className="btn btn--line" onClick={() => setLimit((n) => n + PAGE)}>
            加载更多（还有 {filtered.length - limit} 条）
          </button>
        </div>
      )}
    </section>
  );
}
