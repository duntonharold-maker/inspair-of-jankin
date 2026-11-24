"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AgentsScreen from "./screens/Agents";
import CategoriesScreen from "./screens/Categories";
import CustomScreen from "./screens/Custom";
import DevicesScreen from "./screens/Devices";
import DistortScreen from "./screens/Distort";
import ExportScreen from "./screens/Export";
import HeroScreen from "./screens/Hero";
import LibraryScreen from "./screens/Library";
import ShortcutScreen from "./screens/Shortcut";
import type { Effect, StoryScene } from "./scene";
import { StoryContext, StoryStore } from "./store";
import { ANCHORS, MARKS, SCREENS, START, TOTAL, local } from "./timeline";
import type { Item, Site } from "@/lib/types";

function webglAvailable() {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

export default function Story({
  items,
  site,
  onOpen,
  onPickCategory,
}: {
  items: Item[];
  site: Site;
  onOpen: (id: string) => void;
  onPickCategory: (id: string) => void;
}) {
  const store = useMemo(() => new StoryStore(), []);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<StoryScene | null>(null);
  const [gl, setGl] = useState<"pending" | "on" | "off">("pending");

  // scroll position → story progress (in viewport heights) → CSS variables, scene and screens
  useEffect(() => {
    const root = rootRef.current!;
    const screens = SCREENS.map((s) => ({ id: s.id, el: root.querySelector<HTMLElement>(`[data-screen="${s.id}"]`) }));
    let frame = 0;
    const update = () => {
      frame = 0;
      const p = -root.getBoundingClientRect().top / store.vh;
      for (const { id, el } of screens) {
        if (!el) continue;
        const t = local(p, id);
        el.style.setProperty("--t", Math.min(2, Math.max(-1, t)).toFixed(4));
        const on = t > -0.02 && t < 1.02;
        if (el.dataset.on !== (on ? "1" : "0")) el.dataset.on = on ? "1" : "0";
      }
      root.style.setProperty("--p", p.toFixed(4));
      sceneRef.current?.setProgress(p);
      store.set(p);
    };
    // Phones resize the viewport whenever the address bar slides; only re-measure for real changes
    // (width, rotation) so the story doesn't jump under the reader's finger.
    let lastW = 0;
    const measure = (force = false) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (!force && w === lastW && Math.abs(h - store.vh) < 160) return;
      lastW = w;
      store.vh = h;
      root.style.setProperty("--vh", `${h}px`);
      update();
    };
    const onResize = () => measure();
    const onLoad = () => measure(true);
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    measure(true);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("load", onLoad);
    const settle = window.setTimeout(onLoad, 600);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("load", onLoad);
    };
  }, [store]);

  // the WebGL scene loads after first paint
  useEffect(() => {
    if (!webglAvailable()) {
      setGl("off");
      return;
    }
    let scene: StoryScene | null = null;
    let cancelled = false;
    import("./scene")
      .then(({ createStoryScene }) => {
        if (cancelled || !canvasRef.current) return;
        scene = createStoryScene(canvasRef.current, items);
        scene.setMarks(MARKS);
        scene.setProgress(store.p);
        scene.setEffect(store.effect.mode, store.effect.amount);
        sceneRef.current = scene;
        setGl("on");
      })
      .catch(() => setGl("off"));
    return () => {
      cancelled = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [items, store]);

  // clicking a card in the air or on the wall opens it
  useEffect(() => {
    if (gl !== "on") return;
    const root = rootRef.current!;
    const interactive = (el: EventTarget | null) => el instanceof Element && el.closest("a,button,input,label,.chat,.modal");
    const pickable = () => store.p < START.categories && !document.documentElement.classList.contains("is-locked");
    // Hover follows the pointer, and is re-checked while scrolling so cards that slide under a
    // still cursor light up too.
    let last: { x: number; y: number } | null = null;
    let frame = 0;
    const refresh = () => {
      frame = 0;
      const under = last && document.elementFromPoint(last.x, last.y);
      const hit = last && pickable() && !interactive(under) ? sceneRef.current?.pick(last.x, last.y) : null;
      sceneRef.current?.setHover(hit ? hit.index : -1);
      root.classList.toggle("is-pointing", Boolean(hit));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(refresh);
    };
    const onMove = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      schedule();
    };
    const onScroll = () => {
      if (last) schedule();
    };
    const onLeave = () => {
      last = null;
      schedule();
    };
    const onClick = (e: MouseEvent) => {
      if (!pickable() || interactive(e.target)) return;
      const hit = sceneRef.current?.pick(e.clientX, e.clientY);
      if (hit) onOpen(hit.id);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("click", onClick);
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("click", onClick);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
    };
  }, [gl, onOpen, store]);

  const onEffect = useCallback((mode: Effect, amount: number) => sceneRef.current?.setEffect(mode, amount), []);

  return (
    <StoryContext.Provider value={store}>
      <div ref={rootRef} className={`story gl-${gl}`} style={{ ["--total" as string]: TOTAL }}>
        {ANCHORS.map((a) => (
          <div key={a.id} id={a.id} className="story-anchor" style={{ ["--at" as string]: a.at }} />
        ))}
        <div className="story-stage">
          <HeroScreen site={site} count={items.length} />
          <LibraryScreen />
          <CategoriesScreen site={site} items={items} onPick={onPickCategory} />
          <ShortcutScreen />
          <CustomScreen items={items} />
          <DistortScreen onEffect={onEffect} />
          <AgentsScreen />
          <DevicesScreen items={items} site={site} />
          <ExportScreen items={items} />
          <canvas ref={canvasRef} className="story-scene" aria-hidden="true" />
        </div>
      </div>
    </StoryContext.Provider>
  );
}
