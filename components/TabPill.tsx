"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { animate, settled, spring, springToken, step, tune, type Spring } from "@/lib/spring";

/**
 * Tab pill (after designbookmark.com's): the selected item's fill is one pill that slides to the newly
 * selected item. Each edge rides its own spring; the edge facing the move is stiff and the other soft,
 * so the pill stretches toward the new item and then pulls its tail in.
 *
 * Put it as the first child of a `.tabs-track` whose items mark the selected one with
 * aria-selected="true" or aria-checked="true"; `watch` is whatever changes when the selection does.
 * The springs are --spring-tab-lead and --spring-tab-trail in app/globals.css.
 */
export default function TabPill({ watch }: { watch: unknown }) {
  const ref = useRef<HTMLSpanElement>(null);
  const edges = useRef<{ left: Spring; right: Spring; placed: boolean; stop?: () => void } | null>(null);

  // runs on the client only; the server leaves the selected item its own fill (see .tabs-track.is-live)
  const place = useRef((snap: boolean) => {
    const pill = ref.current;
    const track = pill?.parentElement;
    if (!pill || !track) return;
    const target = track.querySelector<HTMLElement>(':scope > [aria-selected="true"], :scope > [aria-checked="true"]');
    if (!target) {
      pill.style.opacity = "0";
      return;
    }
    pill.style.opacity = "";
    const e = (edges.current ??= { left: spring(0), right: spring(0), placed: false });
    const render = () => {
      pill.style.transform = `translateX(${e.left.x.toFixed(2)}px)`;
      pill.style.width = `${Math.max(0, e.right.x - e.left.x).toFixed(2)}px`;
    };
    const from = target.offsetLeft;
    const to = from + target.offsetWidth;
    pill.style.top = `${target.offsetTop}px`;
    pill.style.height = `${target.offsetHeight}px`;
    // the edge facing the move leads, the other trails
    const lead = springToken(track, "--spring-tab-lead", [620, 40]);
    const trail = springToken(track, "--spring-tab-trail", [170, 19]);
    if (from > e.left.t) {
      tune(e.right, lead);
      tune(e.left, trail);
    } else {
      tune(e.left, lead);
      tune(e.right, trail);
    }
    e.left.t = from;
    e.right.t = to;
    e.stop?.();
    if (snap || !e.placed) {
      e.left.x = from;
      e.right.x = to;
      e.left.v = e.right.v = 0;
      e.placed = true;
      render();
      track.classList.add("is-live");
      return;
    }
    // on a narrow screen the track scrolls: bring the chosen item fully into view
    if (track.scrollWidth > track.clientWidth + 1) {
      const pad = 8;
      const left = track.scrollLeft;
      const want = Math.min(Math.max(left, to + pad - track.clientWidth), from - pad);
      if (Math.abs(want - left) > 1) track.scrollTo({ left: want, behavior: "smooth" });
    }
    e.stop = animate({
      frame(dt) {
        step(e.left, dt);
        step(e.right, dt);
      },
      render,
      done: () => settled(e.left) && settled(e.right),
    });
  }).current;

  // a new selection: slide there
  useLayoutEffect(() => place(false), [watch, place]);

  // the items change size (fonts arrive, counts change, the window narrows): jump to the new place
  useEffect(() => {
    const track = ref.current?.parentElement;
    if (!track) return;
    const observer = new ResizeObserver(() => place(true));
    observer.observe(track);
    for (const item of track.children) if (item !== ref.current) observer.observe(item);
    return () => {
      observer.disconnect();
      edges.current?.stop?.();
    };
  }, [place]);

  return <span ref={ref} className="tab-pill" aria-hidden="true" />;
}
