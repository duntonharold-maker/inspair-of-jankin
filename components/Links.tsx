"use client";
import { ArrowUpRight, Check, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import TabPill from "./TabPill";
import { PRICE_LABEL, type Link, type Site } from "@/lib/types";

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Saved websites by category: what each is, its main strengths, its price, and what I thought of it. */
export default function Links({ site, links }: { site: Site; links: Link[] }) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const cats = site.linkCategories;

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of links) m.set(l.category, (m.get(l.category) ?? 0) + 1);
    return m;
  }, [links]);

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return links.filter((l) => {
      if (category !== "all" && l.category !== category) return false;
      if (!words.length) return true;
      const label = cats.find((c) => c.id === l.category)?.label;
      const hay = [l.name, l.url, l.pitch, l.note, label, ...l.pros, ...l.tags].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [links, cats, category, query]);

  // all categories: one section each, in the categories' order
  const groups = (category === "all" ? cats : cats.filter((c) => c.id === category))
    .map((c) => ({ cat: c, list: shown.filter((l) => l.category === c.id) }))
    .filter((g) => g.list.length);

  return (
    <section className="gallery links">
      <header className="gallery-head">
        <h1 className="h-display">
          Links<sup className="gallery-total">{shown.length}</sup>
        </h1>
        <div className="toolbar">
          <label className="search">
            <Search />
            <input
              ref={field}
              type="search"
              placeholder="搜网站、优势、标签…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="搜索"
            />
            {query && (
              <button
                type="button"
                className="search-clear"
                aria-label="清空搜索"
                onClick={() => {
                  setQuery("");
                  field.current?.focus();
                }}
              >
                <X />
              </button>
            )}
          </label>
        </div>
        <div className="chips tabs-track" role="tablist" aria-label="分类筛选">
          <TabPill watch={category} />
          <button role="tab" aria-selected={category === "all"} className="chip-btn" onClick={() => setCategory("all")}>
            全部 <span>{links.length}</span>
          </button>
          {cats.map((c) => (
            <button key={c.id} role="tab" aria-selected={category === c.id} className="chip-btn" onClick={() => setCategory(c.id)}>
              {c.label} <span>{counts.get(c.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </header>

      {groups.length ? (
        groups.map(({ cat, list }) => (
          <section key={cat.id} className="links-group" aria-labelledby={`links-${cat.id}`}>
            {category === "all" && (
              <h2 id={`links-${cat.id}`} className="links-group-title">
                {cat.label}
                <span>{list.length}</span>
              </h2>
            )}
            <ul className="links-grid">
              {list.map((l) => (
                <li key={l.id}>
                  <LinkCard link={l} />
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <div className="gallery-empty">
          <p>{links.length ? "没有符合条件的网站。" : "还没有收藏网站。"}</p>
          <p className="muted">
            {links.length ? "换个关键词或分类试试。" : "在任意网页上右键「收藏这个网站」，或者跟 Claude 说「收藏 https://… 」。"}
          </p>
        </div>
      )}
    </section>
  );
}

function LinkCard({ link }: { link: Link }) {
  const domain = domainOf(link.url);
  return (
    <a className="link-card" href={link.url} target="_blank" rel="noopener noreferrer">
      <span className="link-card-top">
        {link.icon ? (
          <img className="link-icon" src={link.icon} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="link-icon link-icon--letter" aria-hidden>
            {link.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="link-who">
          <span className="link-name">{link.name}</span>
          <span className="link-domain">{domain}</span>
        </span>
        <span className="link-go" aria-hidden>
          <ArrowUpRight className="ic-out" />
        </span>
      </span>
      {link.pitch && <span className="link-pitch">{link.pitch}</span>}
      {link.pros.length > 0 && (
        <span className="link-pros">
          {link.pros.map((p) => (
            <span key={p} className="link-pro">
              <Check />
              <span>{p}</span>
            </span>
          ))}
        </span>
      )}
      {(link.price || link.tags.length > 0 || link.note) && (
        <span className="link-foot">
          {link.price && <span className={`link-price${link.price === "paid" ? " is-paid" : ""}`}>{PRICE_LABEL[link.price]}</span>}
          {link.tags.map((t) => (
            <span key={t} className="link-tag">
              #{t}
            </span>
          ))}
          {link.note && <span className="link-note">{link.note}</span>}
        </span>
      )}
    </a>
  );
}
