"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Footer from "./Footer";
import Gallery, { type Kind } from "./Gallery";
import McpGuide from "./McpGuide";
import Modal from "./Modal";
import Nav from "./Nav";
import Story from "./story/Story";
import { scrollToId } from "@/lib/scroll";
import type { Item, Site } from "@/lib/types";

export default function Home({
  items,
  site,
  repoUrl,
  siteUrl,
}: {
  items: Item[];
  site: Site;
  repoUrl?: string;
  siteUrl: string | null;
}) {
  const [category, setCategory] = useState("all");
  const [kind, setKind] = useState<Kind>("all");
  const [onlyPrompt, setOnlyPrompt] = useState(false);
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

  /** Mirrors the open item in ?i=… so links can be shared. Returns false where history is locked (embedded previews). */
  const setUrl = (id: string | null, mode: "push" | "replace") => {
    try {
      const url = new URL(location.href);
      if (id) url.searchParams.set("i", id);
      else url.searchParams.delete("i");
      history[mode === "push" ? "pushState" : "replaceState"](history.state, "", url);
      return true;
    } catch {
      return false;
    }
  };

  const open = useCallback((id: string) => {
    if (pushed.current) setUrl(id, "replace");
    else pushed.current = setUrl(id, "push");
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
    setKind("all");
    scrollToId("all");
  }, []);

  const random = useCallback(() => {
    if (items.length) open(items[Math.floor(Math.random() * items.length)].id);
  }, [items, open]);

  return (
    <>
      <Nav site={site} onRandom={items.length ? random : undefined} />
      <main>
        <Story items={items} site={site} onOpen={open} onPickCategory={pickCategory} />
        <Gallery
          site={site}
          items={items}
          category={category}
          setCategory={setCategory}
          kind={kind}
          setKind={setKind}
          onlyPrompt={onlyPrompt}
          setOnlyPrompt={setOnlyPrompt}
          onOpen={open}
          onListChange={setList}
        />
        <McpGuide siteUrl={siteUrl} />
      </main>
      <Footer site={site} repoUrl={repoUrl} />
      {openItem && <Modal item={openItem} site={site} onClose={close} onPrev={nav.prev} onNext={nav.next} />}
    </>
  );
}
