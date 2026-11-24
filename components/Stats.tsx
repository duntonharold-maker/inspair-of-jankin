"use client";
import { useMemo, useState } from "react";
import Roll from "./Roll";
import { useInView } from "@/lib/hooks";
import type { Item, Site } from "@/lib/types";

export type Kind = "all" | "image" | "motion";
const isMotion = (i: Item) => i.media.type !== "image";

export default function Stats({
  items,
  site,
  onBrowse,
}: {
  items: Item[];
  site: Site;
  onBrowse: (f: { kind?: Kind; onlyPrompt?: boolean }) => void;
}) {
  const [recent, setRecent] = useState(false);
  const [ref, inView] = useInView<HTMLDivElement>("-20% 0px", true);

  const list = useMemo(() => {
    if (!recent) return items;
    const since = Date.now() - 30 * 24 * 3600 * 1000;
    return items.filter((i) => Date.parse(i.createdAt) >= since);
  }, [items, recent]);

  const label = (id: string) => site.categories.find((c) => c.id === id)?.label ?? id;
  const breakdown = (subset: Item[], key: (i: Item) => string | undefined) => {
    const m = new Map<string, number>();
    for (const i of subset) {
      const k = key(i);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 4);
  };

  const pictures = list.filter((i) => !isMotion(i));
  const motion = list.filter(isMotion);
  const prompted = list.filter((i) => i.prompt);

  const cards = [
    {
      eyebrow: "图片",
      title: "Pictures",
      count: pictures.length,
      unit: "张",
      rows: breakdown(pictures, (i) => label(i.category)),
      cta: "看图片",
      go: () => onBrowse({ kind: "image" }),
    },
    {
      eyebrow: "动效与界面",
      title: "Motion & UI",
      count: motion.length,
      unit: "个",
      rows: breakdown(motion, (i) => label(i.category)),
      cta: "看动效",
      go: () => onBrowse({ kind: "motion" }),
    },
    {
      eyebrow: "提示词",
      title: "Prompts",
      count: prompted.length,
      unit: "条",
      rows: breakdown(prompted, (i) => i.model),
      cta: "只看带提示词的",
      go: () => onBrowse({ onlyPrompt: true }),
      strong: true,
    },
  ];

  return (
    <section id="stats" className="stats">
      <h2 className="stats-title">
        Everything we kept,
        <br />
        before it
        <br />
        slipped away
      </h2>
      <p className="stats-sub">图片、动效和提示词，都在下面。</p>
      <div className="seg stats-toggle" role="radiogroup" aria-label="时间范围">
        <button role="radio" aria-checked={!recent} className={!recent ? "is-on" : ""} onClick={() => setRecent(false)}>
          全部
        </button>
        <button role="radio" aria-checked={recent} className={recent ? "is-on" : ""} onClick={() => setRecent(true)}>
          近 30 天
        </button>
      </div>
      <div ref={ref} className="stats-cards">
        {cards.map((c) => (
          <article key={c.title} className={`stat${c.strong ? " stat--strong" : ""}`}>
            <p className="eyebrow">{c.eyebrow}</p>
            <h3>{c.title}</h3>
            <p className="stat-num">
              <Roll value={c.count} live={inView} />
              <span className="stat-unit">{c.unit}</span>
            </p>
            <ul>
              {c.rows.length ? (
                c.rows.map(([k, n]) => (
                  <li key={k}>
                    <span>{k}</span>
                    <span>{n}</span>
                  </li>
                ))
              ) : (
                <li className="muted">还没有</li>
              )}
            </ul>
            <button className={`btn ${c.strong ? "btn--dark" : "btn--line"}`} onClick={c.go}>
              {c.cta} <span aria-hidden="true">→</span>
            </button>
          </article>
        ))}
      </div>
      <p className="stats-foot">数字随每一次收藏自动更新 · 收藏的作品版权归原作者所有</p>
    </section>
  );
}
