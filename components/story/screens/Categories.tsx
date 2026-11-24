"use client";
import { useMemo, useState } from "react";
import MediaView from "@/components/MediaView";
import { local } from "../timeline";
import { useStoryValue } from "../store";
import TickRuler from "./TickRuler";
import type { Item, Site } from "@/lib/types";

// spread over the whole area even when a category has only two or three pieces
const SLOTS = [
  { x: 38, y: 6, w: 19 },
  { x: 70, y: 38, w: 17 },
  { x: 14, y: 52, w: 15 },
  { x: 82, y: 2, w: 13 },
  { x: 46, y: 70, w: 16 },
  { x: 2, y: 18, w: 12 },
  { x: 88, y: 74, w: 10 },
  { x: 26, y: 34, w: 11 },
  { x: 62, y: 12, w: 10 },
];

export default function CategoriesScreen({ site, items, onPick }: { site: Site; items: Item[]; onPick: (id: string) => void }) {
  const cats = site.categories;
  const n = cats.length;
  const scrolled = useStoryValue((p) => {
    const t = local(p, "categories");
    return Math.min(n - 1, Math.max(0, Math.floor(((t - 0.08) / 0.82) * n)));
  });
  const [hover, setHover] = useState<number | null>(null);
  const active = hover ?? scrolled;

  const byCat = useMemo(() => {
    const m = new Map<string, Item[]>(cats.map((c) => [c.id, []]));
    for (const i of items) m.get(i.category)?.push(i);
    return m;
  }, [cats, items]);
  const current = cats[active];
  const thumbs = (current && byCat.get(current.id)?.slice(0, SLOTS.length)) || [];

  return (
    <section data-screen="categories" data-on="0" className="scr scr-cats" aria-labelledby="cats-title">
      <h2 id="cats-title" className="sr-only">
        分类
      </h2>
      <div className="cats-body">
        <TickRuler className="cats-ruler" at={n > 1 ? active / (n - 1) : 0} />
        <ul className="cats-list" onMouseLeave={() => setHover(null)}>
          {cats.map((c, k) => (
            <li key={c.id} style={{ ["--k" as string]: k }}>
              <button
                className={`cats-item${k === active ? " is-active" : ""}`}
                style={{ ["--d" as string]: Math.abs(k - active) }}
                onClick={() => onPick(c.id)}
                onMouseEnter={() => setHover(k)}
                onFocus={() => setHover(k)}
              >
                <span className="cats-arrow" aria-hidden="true">
                  →
                </span>
                <span>{c.name}</span>
                <sup className="cats-count">
                  {c.label} · {byCat.get(c.id)?.length ?? 0}
                </sup>
              </button>
            </li>
          ))}
        </ul>
        <div className="cats-thumbs" key={current?.id} aria-hidden="true">
          {thumbs.length ? (
            thumbs.map((item, k) => {
              const s = SLOTS[k];
              const ratio = item.media.width && item.media.height ? item.media.width / item.media.height : 0.75;
              return (
                <div
                  key={item.id}
                  className="cats-thumb"
                  style={{
                    left: `${s.x}%`,
                    top: `${s.y}%`,
                    width: `${s.w}%`,
                    aspectRatio: String(Math.min(1.5, Math.max(0.62, ratio))),
                    animationDelay: `${k * 45}ms`,
                  }}
                >
                  <MediaView item={item} />
                </div>
              );
            })
          ) : (
            <p className="cats-empty">这个分类还空着</p>
          )}
        </div>
      </div>
    </section>
  );
}
