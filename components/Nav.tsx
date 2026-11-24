"use client";
import Mark from "./Mark";
import type { Site } from "@/lib/types";

export default function Nav({ site, onRandom }: { site: Site; onRandom?: () => void }) {
  return (
    <header className="nav">
      <a className="nav-brand" href="/" aria-label={`${site.name} 首页`}>
        <Mark />
        <span>{site.name}</span>
      </a>
      <nav className="nav-links" aria-label="页面导航">
        <a href="/#fresh">最新</a>
        <a href="/#categories">分类</a>
        <a href="/#all">全部</a>
        <a href="/#mcp">MCP</a>
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
