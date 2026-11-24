"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Site } from "@/lib/types";

const WORDS = ["keeping", "remixing", "prompting", "animating"];

function Rotator() {
  const [i, setI] = useState(0);
  const [width, setWidth] = useState<number>();
  const measure = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % WORDS.length), 2600);
    return () => clearInterval(t);
  }, []);

  useLayoutEffect(() => {
    if (measure.current) setWidth(measure.current.offsetWidth);
  }, [i]);

  const word = WORDS[i];
  return (
    <span className="rotator" style={{ width }} aria-live="polite">
      <span ref={measure} className="rotator-measure" aria-hidden="true">
        {word}
      </span>
      <span key={word} className="rotator-word" aria-label={word}>
        {[...word].map((ch, k) => (
          <span key={k} className="rotator-ch" style={{ animationDelay: `${k * 28}ms` }} aria-hidden="true">
            {ch}
          </span>
        ))}
      </span>
    </span>
  );
}

export default function Hero({ site, count }: { site: Site; count: number }) {
  return (
    <section className="hero" aria-label="介绍">
      <h1 className="hero-title">
        <span className="hero-left reveal">
          Found it
          <br />
          somewhere
        </span>
        <span className="hero-right reveal" style={{ animationDelay: "120ms" }}>
          Worth
          <br />
          <span className="paren">(</span>
          <Rotator />
          <span className="paren">)</span>
        </span>
      </h1>
      <div className="hero-notes">
        <p className="reveal" style={{ animationDelay: "300ms" }}>
          {site.owner} 的灵感集合
          <br />
          图片、带动效的 UI，以及生成它们的提示词
        </p>
        <p className="reveal" style={{ animationDelay: "420ms" }}>
          由智能体通过 MCP 收藏
          <br />
          每一次改动都提交到 GitHub
        </p>
        <p className="reveal hero-count" style={{ animationDelay: "540ms" }}>
          已收藏 {count} 条
        </p>
      </div>
    </section>
  );
}
