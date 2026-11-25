"use client";
import { useEffect, useRef, useState, type RefObject } from "react";

/** Calls `cb` with 0…1 while a tall section scrolls past a full-height sticky child. */
export function useSectionProgress(ref: RefObject<HTMLElement | null>, cb: (p: number) => void) {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = Math.max(1, r.height - window.innerHeight);
      cbRef.current(Math.min(1, Math.max(0, -r.top / span)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref]);
}

export function useInView<T extends Element>(rootMargin = "200px", once = false) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setInView(e.isIntersecting);
        if (once && e.isIntersecting) io.disconnect();
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin, once]);
  return [ref, inView] as const;
}

/** Put text on the clipboard, falling back to a hidden text area where the clipboard API is refused. */
/**
 * Whether the page runs inside someone else's frame, as when the artifact viewer previews the site.
 * There the address can't carry ?i=… and a link to one of the site's files can't be opened, so the
 * page keeps those to itself.
 */
export function framed() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** framed(), read after hydration so the server's markup and the first client render agree. */
export function useFramed() {
  const [inFrame, setInFrame] = useState(false);
  useEffect(() => setInFrame(framed()), []);
  return inFrame;
}

export async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, key = "default") => {
    await writeClipboard(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
  };
  return { copied, copy };
}
