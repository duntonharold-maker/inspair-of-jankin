"use client";
import { useMemo, useRef } from "react";
import MediaView from "./MediaView";
import { useSectionProgress } from "@/lib/hooks";
import { scrollToId } from "@/lib/scroll";
import type { Item } from "@/lib/types";

const COLS = 5;
const TILES = 30;

/** A tilted, slowly drifting wall of the newest and featured pieces. */
export default function Wall({ items, onOpen }: { items: Item[]; onOpen: (id: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);

  useSectionProgress(ref, (p) => planeRef.current?.style.setProperty("--p", p.toFixed(4)));

  const tiles = useMemo(() => {
    const pool = [...items.filter((i) => i.featured), ...items.filter((i) => !i.featured)].slice(0, 24);
    if (!pool.length) return [];
    return Array.from({ length: TILES }, (_, k) => pool[(k * 7) % pool.length]);
  }, [items]);

  return (
    <section ref={ref} id="fresh" className="wall-section">
      <div className="wall-sticky">
        <div className="wall-stage" aria-hidden={tiles.length === 0}>
          <div ref={planeRef} className="wall-plane">
            {Array.from({ length: COLS }, (_, c) => (
              <div key={c} className="wall-col" style={{ ["--dir" as string]: c % 2 ? 1 : -1 }}>
                {(tiles.length ? tiles.filter((_, k) => k % COLS === c) : Array.from({ length: TILES / COLS })).map(
                  (item, k) =>
                    item ? (
                      <button
                        key={k}
                        className="wall-tile"
                        onClick={() => onOpen((item as Item).id)}
                        aria-label={(item as Item).title}
                        tabIndex={-1}
                      >
                        <MediaView item={item as Item} />
                      </button>
                    ) : (
                      <div key={k} className="wall-tile wall-tile--empty" />
                    ),
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="wall-copy">
          <h2 className="h-display">
            Fresh from
            <br />
            the stash
          </h2>
          <div className="wall-notes">
            <p>最近收进来的图片和动效，精选的会钉在这面墙上。</p>
            <p>点开任意一张，就能看到它的提示词、模型和出处。</p>
          </div>
          <button className="btn btn--dark" onClick={() => scrollToId("all")}>
            浏览全部 <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}
