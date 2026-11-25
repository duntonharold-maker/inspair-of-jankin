"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { animate, settled, spring, springToken, step, tune, type Spring } from "@/lib/spring";
import { writeClipboard } from "@/lib/hooks";

/** How long the button says it copied before rolling back (ms). */
const HOLD = 1800;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Copy button (after designbookmark.com's): pressing it copies `text`; the copy icon shrinks and turns
 * away while a check pops in, the word rolls up from `label` to `done` and the button's width springs
 * to fit it. After a moment it rolls back. The springs are --spring-copy-roll, --spring-copy-icon and
 * --spring-copy-width in app/globals.css.
 */
export default function CopyButton({ text, label = "复制", done = "已复制", what }: { text: string; label?: string; done?: string; what?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const iconCopy = useRef<SVGSVGElement>(null);
  const iconDone = useRef<SVGSVGElement>(null);
  const roll = useRef<HTMLSpanElement>(null);
  const words = useRef<HTMLSpanElement>(null);
  const first = useRef<HTMLElement>(null);
  const second = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const m = useRef<{ roll: Spring; icon: Spring; width: Spring; stop?: () => void; timer?: number } | null>(null);

  const render = () => {
    const s = m.current;
    if (!s || !roll.current || !words.current || !iconCopy.current || !iconDone.current || !first.current) return;
    roll.current.style.width = `${s.width.x.toFixed(2)}px`;
    words.current.style.transform = `translateY(${(-first.current.offsetHeight * s.roll.x).toFixed(2)}px)`;
    const i = clamp(s.icon.x, -0.2, 1.2);
    const turned = clamp(i, 0, 1);
    iconCopy.current.style.opacity = clamp(1 - i * 1.6, 0, 1).toFixed(3);
    iconCopy.current.style.transform = `scale(${(1 - 0.5 * turned).toFixed(3)}) rotate(${(-40 * turned).toFixed(1)}deg)`;
    iconDone.current.style.opacity = clamp(i * 1.6 - 0.4, 0, 1).toFixed(3);
    iconDone.current.style.transform = `scale(${(0.4 + 0.6 * i).toFixed(3)})`;
  };

  const run = () => {
    const s = m.current!;
    s.stop?.();
    s.stop = animate({
      frame(dt) {
        step(s.roll, dt);
        step(s.icon, dt);
        step(s.width, dt);
      },
      render,
      done: () => settled(s.roll) && settled(s.icon) && settled(s.width),
    });
  };

  // start at rest, the roll as wide as the first word (again once the fonts have arrived)
  useLayoutEffect(() => {
    const fit = () => {
      const w = (m.current?.roll.t ? second.current : first.current)?.offsetWidth ?? 0;
      if (!m.current) m.current = { roll: spring(0), icon: spring(0), width: spring(w) };
      else if (settled(m.current.width)) m.current.width.x = m.current.width.t = w;
      render();
    };
    fit();
    document.fonts?.ready.then(fit);
    return () => {
      m.current?.stop?.();
      window.clearTimeout(m.current?.timer);
    };
  }, []);

  const press = () => {
    const s = m.current;
    const el = button.current;
    if (!s || !el || !first.current || !second.current) return;
    writeClipboard(text);
    tune(s.roll, springToken(el, "--spring-copy-roll", [260, 20]));
    tune(s.icon, springToken(el, "--spring-copy-icon", [420, 18]));
    tune(s.width, springToken(el, "--spring-copy-width", [300, 24]));
    s.roll.t = 1;
    s.icon.t = 1;
    s.width.t = second.current.offsetWidth;
    setCopied(true);
    run();
    window.clearTimeout(s.timer);
    s.timer = window.setTimeout(() => {
      s.roll.t = 0;
      s.icon.t = 0;
      s.width.t = first.current?.offsetWidth ?? s.width.t;
      setCopied(false);
      run();
    }, HOLD);
  };

  return (
    <button ref={button} type="button" className="copy-btn" onClick={press} aria-label={`${label}：${what ?? text}`}>
      <span className="copy-ic" aria-hidden="true">
        <svg ref={iconCopy} viewBox="0 0 24 24">
          <rect x="8.5" y="8.5" width="11" height="11" rx="3" />
          <path d="M15.5 8.5V7a2.5 2.5 0 0 0-2.5-2.5H7A2.5 2.5 0 0 0 4.5 7v6A2.5 2.5 0 0 0 7 15.5h1.5" />
        </svg>
        <svg ref={iconDone} className="copy-done" viewBox="0 0 24 24">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <span ref={roll} className="copy-roll" aria-hidden="true">
        <span ref={words} className="copy-words">
          <b ref={first}>{label}</b>
          <b ref={second}>{done}</b>
        </span>
      </span>
      <span className="sr-only" role="status">
        {copied ? done : ""}
      </span>
    </button>
  );
}
