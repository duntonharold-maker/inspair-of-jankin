"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";

/** Story progress shared with every screen without re-rendering React on each frame. */
export class StoryStore {
  p = 0;
  vh = 900;
  private subs = new Set<(p: number) => void>();
  set(p: number) {
    this.p = p;
    for (const fn of this.subs) fn(p);
  }
  subscribe(fn: (p: number) => void) {
    this.subs.add(fn);
    fn(this.p);
    return () => void this.subs.delete(fn);
  }
}

export const StoryContext = createContext<StoryStore | null>(null);

export function useStory() {
  const s = useContext(StoryContext);
  if (!s) throw new Error("useStory outside <Story>");
  return s;
}

/** Re-renders only when the derived value changes. */
export function useStoryValue<T>(derive: (p: number) => T): T {
  const store = useStory();
  const [value, setValue] = useState(() => derive(store.p));
  const deriveRef = useRef(derive);
  deriveRef.current = derive;
  useEffect(() => store.subscribe((p) => setValue(deriveRef.current(p))), [store]);
  return value;
}

/** Runs a callback on every progress change (for direct DOM writes). */
export function useStoryFrame(fn: (p: number) => void) {
  const store = useStory();
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => store.subscribe((p) => fnRef.current(p)), [store]);
}
