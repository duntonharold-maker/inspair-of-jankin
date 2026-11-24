"use client";
import { useMemo, useRef, useState } from "react";
import MediaView from "./MediaView";
import { useSectionProgress } from "@/lib/hooks";
import type { Item, Site } from "@/lib/types";

/** Scattered slots for the floating thumbnails: left/top in %, width in % of the area. */
const SLOTS = [
  { x: 30, y: 2, w: 18 },
  { x: 56, y: 8, w: 22 },
  { x: 84, y: 0, w: 15 },
  { x: 34, y: 34, w: 19 },
  { x: 76, y: 38, w: 16 },
  { x: 2, y: 56, w: 16 },
  { x: 30, y: 70, w: 13 },
  { x: 52, y: 62, w: 20 },
];

export default function Categories({
  site,
  items,
  onPick,
}: {
  site: Site;
  items: Item[];
  onPick: (id: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const cats = site.categories;
  const [active, setActive] = useState(0);

  useSectionProgress(ref, (p) => setActive(Math.min(cats.length - 1, Math.floor(p * cats.length))));

  const byCat = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const c of cats) m.set(c.id, []);
    for (const i of items) m.get(i.category)?.push(i);
    return m;
  }, [cats, items]);

  const current = cats[active];
  const thumbs = (current && byCat.get(current.id)?.slice(0, SLOTS.length)) || [];

  return (
    <section ref={ref} id="categories" className="cats-section" style={{ ["--n" as string]: cats.length }}>
      <div className="cats-sticky">
        <p className="eyebrow">分类</p>
        <ul className="cats-list">
          {cats.map((c, k) => {
            const n = byCat.get(c.id)?.length ?? 0;
            return (
              <li key={c.id}>
                <button
                  className={`cats-item${k === active ? " is-active" : ""}`}
                  style={{ ["--d" as string]: Math.abs(k - active) }}
                  onClick={() => onPick(c.id)}
                  onMouseEnter={() => setActive(k)}
                  onFocus={() => setActive(k)}
                >
                  <span className="cats-arrow" aria-hidden="true">
                    →
                  </span>
                  <span className="cats-name">{c.name}</span>
                  <sup className="cats-count">
                    {c.label} · {n}
                  </sup>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="cats-thumbs" key={current?.id} aria-hidden="true">
          {thumbs.length ? (
            thumbs.map((item, k) => {
              const s = SLOTS[k];
              const ratio = item.media.width && item.media.height ? item.media.width / item.media.height : 0.8;
              return (
                <div
                  key={item.id}
                  className="cats-thumb"
                  style={{
                    left: `${s.x}%`,
                    top: `${s.y}%`,
                    width: `${s.w}%`,
                    aspectRatio: String(Math.min(1.6, Math.max(0.6, ratio))),
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
