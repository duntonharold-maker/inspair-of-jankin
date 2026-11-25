"use client";
import { ArrowRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import MediaView from "@/components/MediaView";
import { animate, settled, spring, springToken, step, tune, type Spring } from "@/lib/spring";
import { local } from "../timeline";
import { useStoryValue } from "../store";
import TickRuler from "./TickRuler";
import type { Item, Site } from "@/lib/types";

/**
 * Where the pictures of a category sit (x, y, width in % of the picture area), by how many it has:
 * a category with two pieces shows two large ones rather than two lost in a field of empty slots.
 */
const LAYOUTS: { x: number; y: number; w: number }[][] = [
  [],
  [{ x: 18, y: 8, w: 56 }],
  [
    { x: 2, y: 4, w: 46 },
    { x: 52, y: 34, w: 42 },
  ],
  [
    { x: 0, y: 2, w: 40 },
    { x: 46, y: 12, w: 36 },
    { x: 20, y: 58, w: 30 },
  ],
  [
    { x: 0, y: 0, w: 36 },
    { x: 44, y: 6, w: 32 },
    { x: 10, y: 54, w: 30 },
    { x: 58, y: 50, w: 30 },
  ],
  [
    { x: 0, y: 0, w: 32 },
    { x: 40, y: 4, w: 28 },
    { x: 74, y: 22, w: 24 },
    { x: 8, y: 52, w: 28 },
    { x: 46, y: 56, w: 26 },
  ],
  [
    { x: 0, y: 0, w: 30 },
    { x: 36, y: 6, w: 26 },
    { x: 70, y: 0, w: 26 },
    { x: 6, y: 52, w: 26 },
    { x: 40, y: 50, w: 24 },
    { x: 72, y: 48, w: 24 },
  ],
];
const MOST = LAYOUTS.length - 1;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
/** How strongly a row shows at distance d (in rows) from the arrow: full there, dimming with distance
 * (as measured on premotio's list: 0.62 a row away, then a tenth less per row). */
const shows = (d: number) => (d < 1 ? 1 - 0.38 * smooth(d) : Math.max(0.16, 0.62 - 0.1 * (d - 1)));
/** How far a row's word stands aside for the arrow at distance d (0…1 of the arrow's room). The word the
 * arrow leaves eases back while the one it heads for eases out, across the whole move, so the two hand
 * over in step with the arrow (fitted to premotio's list; half way, each stands about 57% aside). */
const aside = (d: number) => 1 - smooth((d - 0.1) / 0.85);

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

  /* ---- the list: one place, gliding between rows, that every row reads its look from ---- */
  const list = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);
  const glide = useRef<{ place: Spring; stop?: () => void } | null>(null);

  const draw = useRef(() => {
    const ul = list.current;
    const g = glide.current;
    if (!ul || !g) return;
    const x = g.place.x;
    const rows = ul.querySelectorAll<HTMLElement>(".cats-item");
    const room = arrow.current?.offsetWidth ?? 0;
    rows.forEach((row, k) => {
      const d = Math.abs(k - x);
      const out = aside(d);
      row.style.opacity = shows(d).toFixed(3);
      const word = row.querySelector<HTMLElement>(".cats-word");
      if (word) word.style.transform = out > 0.001 ? `translateX(${(room * out).toFixed(2)}px)` : "";
      const count = row.querySelector<HTMLElement>(".cats-count");
      if (count) count.style.opacity = smooth(1 - Math.min(1, d * 1.6)).toFixed(3);
    });
    // the arrow rides between the rows' tops (measured on their list items: a transformed item, as
    // they are while they come in, is where its button's offsets start)
    const top = (k: number) => (rows[k]?.parentElement as HTMLElement | null)?.offsetTop ?? 0;
    const at = Math.max(0, Math.min(rows.length - 1, x));
    const i = Math.floor(at);
    const j = Math.min(rows.length - 1, i + 1);
    const y = top(i) + (top(j) - top(i)) * (at - i);
    if (arrow.current) arrow.current.style.transform = `translateY(${y.toFixed(2)}px)`;
  }).current;

  // first paint at rest on the chosen row; again when the type has loaded and the rows found their size
  useLayoutEffect(() => {
    glide.current ??= { place: spring(active) };
    draw();
    document.fonts?.ready.then(draw);
    window.addEventListener("resize", draw);
    return () => {
      window.removeEventListener("resize", draw);
      glide.current?.stop?.();
    };
    // (the place itself follows `active` below)
  }, [draw]);

  // a new row chosen: glide there, easing in and out without overshooting (a critically damped spring,
  // as fast as premotio's: half way in 0.19 s, nine tenths in 0.45 s)
  useEffect(() => {
    const g = glide.current;
    const ul = list.current;
    if (!g || !ul || g.place.t === active) return;
    tune(g.place, springToken(ul, "--spring-cats", [74, 17.2]));
    g.place.t = active;
    g.stop?.();
    g.stop = animate({ frame: (dt) => step(g.place, dt), render: draw, done: () => settled(g.place) });
  }, [active, draw]);

  /* ---- the pictures: the last set fades away as the new one comes in ---- */
  const [sets, setSets] = useState<{ id: string; leaving: boolean }[]>(() => (current ? [{ id: current.id, leaving: false }] : []));
  useEffect(() => {
    if (!current) return;
    setSets((was) => (was.some((s) => s.id === current.id && !s.leaving) ? was : [...was.filter((s) => s.id !== current.id).map((s) => ({ ...s, leaving: true })), { id: current.id, leaving: false }]));
    const t = window.setTimeout(() => setSets((was) => was.filter((s) => !s.leaving)), 520);
    return () => window.clearTimeout(t);
  }, [current]);

  return (
    <section data-screen="categories" data-on="0" className="scr scr-cats" aria-labelledby="cats-title">
      <h2 id="cats-title" className="sr-only">
        分类
      </h2>
      <div className="cats-body">
        <TickRuler className="cats-ruler" at={n > 1 ? active / (n - 1) : 0} />
        <div ref={list} className="cats-list" onMouseLeave={() => setHover(null)}>
          <span ref={arrow} className="cats-arrow" aria-hidden="true">
            <ArrowRight className="arrow" />
          </span>
          <ul>
          {cats.map((c, k) => (
            <li key={c.id} style={{ ["--k" as string]: k }}>
              <button
                className={`cats-item${k === active ? " is-active" : ""}`}
                aria-current={k === active || undefined}
                onClick={() => onPick(c.id)}
                onMouseEnter={() => setHover(k)}
                onFocus={() => setHover(k)}
              >
                <span className="cats-word">
                  {c.name}
                  <sup className="cats-count">
                    {c.label} · {byCat.get(c.id)?.length ?? 0}
                  </sup>
                </span>
              </button>
            </li>
          ))}
          </ul>
        </div>
        <div className="cats-thumbs" aria-hidden="true">
          {sets.map(({ id, leaving }) => {
            const pieces = (byCat.get(id) ?? []).slice(0, MOST);
            const layout = LAYOUTS[pieces.length] ?? [];
            return (
              <div key={id} className={`cats-set${leaving ? " is-leaving" : ""}`}>
                {pieces.length ? (
                  pieces.map((item, k) => {
                    const s = layout[k];
                    const ratio = item.media.width && item.media.height ? item.media.width / item.media.height : 0.75;
                    return (
                      <div
                        key={item.id}
                        className={`cats-thumb${item.media.cutout ? " is-cutout" : ""}`}
                        style={{
                          left: `${s.x}%`,
                          top: `${s.y}%`,
                          width: `${s.w}%`,
                          aspectRatio: String(Math.min(1.5, Math.max(0.62, ratio))),
                          animationDelay: leaving ? "0ms" : `${k * 60}ms`,
                        }}
                      >
                        <MediaView item={item} fit={item.media.cutout ? "contain" : "cover"} />
                      </div>
                    );
                  })
                ) : (
                  <p className="cats-empty">这个分类还空着</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
