"use client";
import { useEffect, useRef } from "react";
import { local } from "../timeline";
import { useStoryFrame } from "../store";

const LINE = "Save the spark. Close the (forty) tabs";

/** One long line that rides across the screen; letters drop into place as they come in from the right. */
export default function ShortcutScreen() {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const offsets = useRef<number[]>([]);
  const width = useRef(0);

  useEffect(() => {
    const measure = () => {
      const el = titleRef.current;
      if (!el) return;
      const prev = el.style.transform;
      el.style.transform = "none";
      const left = el.getBoundingClientRect().left;
      offsets.current = [...el.querySelectorAll<HTMLElement>(".sc-ch")].map((c) => {
        const r = c.getBoundingClientRect();
        return r.left - left + r.width / 2;
      });
      width.current = el.scrollWidth;
      el.style.transform = prev;
    };
    measure();
    document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useStoryFrame((p) => {
    const el = titleRef.current;
    if (!el) return;
    const t = local(p, "shortcut");
    if (t < -0.1 || t > 1.1) return;
    const vw = window.innerWidth;
    const k = Math.min(1, Math.max(0, (t - 0.04) / 0.9));
    const x = vw * 0.92 - k * (width.current + vw * 0.4);
    el.style.transform = `translate3d(${x}px, 0, 0)`;
    const chars = el.children;
    for (let i = 0; i < chars.length; i++) {
      const sx = x + (offsets.current[i] ?? 0);
      const d = Math.min(1, Math.max(0, (sx - vw * 0.5) / (vw * 0.4)));
      const e = d * d;
      const c = chars[i] as HTMLElement;
      c.style.transform = `translate3d(0, ${(e * 0.55).toFixed(3)}em, 0) rotate(${(e * 14).toFixed(2)}deg)`;
      c.style.opacity = (1 - e * 0.9).toFixed(3);
    }
  });

  return (
    <section data-screen="shortcut" data-on="0" className="scr scr-short" aria-label={LINE}>
      <h2 ref={titleRef} className="short-title" aria-hidden="true">
        {[...LINE].map((ch, i) => (
          <span key={i} className={`sc-ch${"()".includes(ch) ? " paren" : ""}`}>
            {ch === " " ? " " : ch}
          </span>
        ))}
      </h2>
    </section>
  );
}
