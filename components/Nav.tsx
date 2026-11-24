"use client";
import { useEffect, useState } from "react";
import Mark from "./Mark";
import type { Site } from "@/lib/types";

/** Slides away while you scroll down and comes back as soon as you pause or scroll up. */
function useHideOnScroll() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let timer = 0;
    const onScroll = () => {
      const y = window.scrollY;
      if (y > 120 && y > last + 2) setHidden(true);
      else if (y < last - 2 || y <= 120) setHidden(false);
      last = y;
      clearTimeout(timer);
      timer = window.setTimeout(() => setHidden(false), 700);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, []);
  return hidden;
}

export default function Nav({ site, onRandom }: { site: Site; onRandom?: () => void }) {
  const hidden = useHideOnScroll();
  return (
    <header className={`nav${hidden ? " is-hidden" : ""}`}>
      <a className="nav-brand" href="/" aria-label={`${site.name} 首页`}>
        <Mark />
        <span>{site.name}</span>
      </a>
      <nav className="nav-links" aria-label="页面导航">
        <a href="/#fresh">最新</a>
        <a href="/#categories">分类</a>
        <a href="/#all">全部</a>
      </nav>
      {onRandom ? (
        <button className="btn btn--dark nav-cta" onClick={onRandom}>
          随便看看 <span aria-hidden="true">→</span>
        </button>
      ) : (
        <a className="btn btn--dark nav-cta" href="/#all">
          全部灵感 <span aria-hidden="true">→</span>
        </a>
      )}
    </header>
  );
}
