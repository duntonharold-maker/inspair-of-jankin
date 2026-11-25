/**
 * Springs, after the shared engine of designbookmark.com's motion studies: each spring pulls x toward
 * its target t with stiffness k and damping c, stepped four times a frame (frames capped at 1/30 s).
 * With reduced motion every spring is critically damped, so it lands without overshooting.
 * The loop only runs while something is still moving.
 */
export type Spring = { x: number; v: number; t: number; k: number; c: number };

export const spring = (x: number, k = 400, c = 30): Spring => ({ x, v: 0, t: x, k, c });

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Set a spring's stiffness and damping, as a [stiffness, damping] pair. */
export function tune(s: Spring, [k, c]: [number, number]) {
  s.k = k;
  s.c = reduced() ? 2 * Math.sqrt(k) : c;
}

export function step(s: Spring, dt: number) {
  const a = -s.k * (s.x - s.t) - s.c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
}

export const settled = (s: Spring) => Math.abs(s.x - s.t) < 0.01 && Math.abs(s.v) < 0.01;

/** A "stiffness damping" pair from a CSS custom property, e.g. --spring-tab-lead: 620 40. */
export function springToken(el: Element, name: string, fallback: [number, number]): [number, number] {
  const [k, c] = getComputedStyle(el).getPropertyValue(name).trim().split(/\s+/).map(Number);
  return Number.isFinite(k) && Number.isFinite(c) ? [k, c] : fallback;
}

type Mover = { frame(dt: number): void; render(): void; done(): boolean };
const movers = new Set<Mover>();
let raf = 0;
let last = 0;

function loop(now: number) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  for (const m of movers) {
    for (let i = 0; i < 4; i++) m.frame(dt / 4);
    m.render();
    if (m.done()) movers.delete(m);
  }
  raf = movers.size ? requestAnimationFrame(loop) : 0;
}

/** Run a mover every frame until it reports it is done. */
export function animate(m: Mover) {
  movers.add(m);
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  return () => movers.delete(m);
}
