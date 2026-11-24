"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Categories from "./Categories";
import Footer from "./Footer";
import Gallery from "./Gallery";
import Hero from "./Hero";
import McpSection from "./McpSection";
import Modal from "./Modal";
import Nav from "./Nav";
import Wall from "./Wall";
import { scrollToId } from "@/lib/scroll";
import type { Item, Site } from "@/lib/types";

export default function Home({ items, site, repoUrl }: { items: Item[]; site: Site; repoUrl?: string }) {
  const [category, setCategory] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [list, setList] = useState<Item[]>(items);
  const pushed = useRef(false);

  useEffect(() => {
    const sync = () => {
      setOpenId(new URLSearchParams(location.search).get("i"));
      pushed.current = false;
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const setUrl = (id: string | null, mode: "push" | "replace") => {
    const url = new URL(location.href);
    if (id) url.searchParams.set("i", id);
    else url.searchParams.delete("i");
    history[mode === "push" ? "pushState" : "replaceState"](history.state, "", url);
  };

  const open = useCallback((id: string) => {
    setUrl(id, pushed.current ? "replace" : "push");
    pushed.current = true;
    setOpenId(id);
  }, []);

  const close = useCallback(() => {
    if (pushed.current) history.back();
    else setUrl(null, "replace");
    pushed.current = false;
    setOpenId(null);
  }, []);

  const openItem = useMemo(() => items.find((i) => i.id === openId) ?? null, [items, openId]);
  const nav = useMemo(() => {
    const seq = list.some((i) => i.id === openId) ? list : items;
    const k = seq.findIndex((i) => i.id === openId);
    const go = (id: string) => () => {
      setUrl(id, "replace");
      setOpenId(id);
    };
    return {
      prev: k > 0 ? go(seq[k - 1].id) : undefined,
      next: k >= 0 && k < seq.length - 1 ? go(seq[k + 1].id) : undefined,
    };
  }, [list, items, openId]);

  const pickCategory = useCallback((id: string) => {
    setCategory(id);
    scrollToId("all");
  }, []);

  const random = useCallback(() => {
    if (items.length) open(items[Math.floor(Math.random() * items.length)].id);
  }, [items, open]);

  return (
    <>
      <Nav site={site} onRandom={items.length ? random : undefined} />
      <main>
        <Hero site={site} count={items.length} />
        <Wall items={items} onOpen={open} />
        <Categories site={site} items={items} onPick={pickCategory} />
        <Gallery
          site={site}
          items={items}
          category={category}
          setCategory={setCategory}
          onOpen={open}
          onListChange={setList}
        />
        <McpSection />
      </main>
      <Footer site={site} repoUrl={repoUrl} />
      {openItem && <Modal item={openItem} site={site} onClose={close} onPrev={nav.prev} onNext={nav.next} />}
    </>
  );
}
