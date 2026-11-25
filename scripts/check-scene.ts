/**
 * Walks the story's card scene in small steps of scrolling and checks, for screens from 4:3 to 2.4:1
 * and for phones, that:
 * - no card cuts through another on screen, as the scene draws them: through each card's own lens and
 *   at its own depth (cards in motion are drawn over one another in order, so only pairs with at least
 *   one card at rest count);
 * - no card jumps on screen from one step to the next (more than 15% of the screen in one step).
 * The first screen, where the cards drift on a clock, is walked at several moments of that clock.
 *
 * Run it after changing components/story/choreo.ts or the story's timing:
 *   npm run check:scene
 */
import { Vector3 } from "three";
import { createChoreo, distanceFor, easeInOut, LONG_FOV, LOOSE, newPose, phase, toShared, type Marks, type Pose } from "../components/story/choreo.ts";
import { MARKS } from "../components/story/timeline.ts";

const H = 7.5; // the scene's world height at z = 0 (scene.ts)
const BASE = distanceFor(LONG_FOV, H);
const FOCAL = 1 / Math.tan((LONG_FOV * Math.PI) / 360);
const STEP = 0.0025;
const CLOCKS = [0, 37.3, 141.9];

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => mul(a, 1 / (Math.hypot(...a) || 1));

/** A card as drawn: its corners where the shared camera sees them. */
type Card = { corners: V[]; c: V; reach: number; layer: number; alpha: number; box: number[] | null };

const shared = new Vector3();
function cardOf(pose: Pose): Card {
  const q = pose.quat;
  const qv: V = [q.x, q.y, q.z];
  const rot = (x: V): V => {
    const t = mul(cross(qv, x), 2);
    return add(add(x, mul(t, q.w)), cross(qv, t));
  };
  const u = rot([1, 0, 0]);
  const v = rot([0, 1, 0]);
  const centre: V = [pose.pos.x, pose.pos.y, pose.pos.z];
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => {
    const p = add(centre, add(mul(u, a * 0.375 * pose.size), mul(v, b * 0.5 * pose.size)));
    toShared(p[0], p[1], p[2], pose.lens, pose.depth, BASE, shared);
    return [shared.x, shared.y, shared.z] as V;
  });
  const c = mul(corners.reduce((s, p) => add(s, p), [0, 0, 0] as V), 0.25);
  const reach = Math.max(...corners.map((p) => Math.hypot(...sub(p, c))));
  return { corners, c, reach, layer: pose.layer, alpha: pose.alpha, box: null };
}

function frameOf(q: V[]) {
  const c = mul(q.reduce((s, p) => add(s, p), [0, 0, 0] as V), 0.25);
  const n = norm(cross(sub(q[2], q[0]), sub(q[3], q[1])));
  const u = norm(sub(add(q[1], q[2]), add(q[0], q[3])));
  return { c, n, u, v: cross(n, u) };
}

/**
 * Does card a cut through card r? Where a crosses r's plane it does so along a segment; the cards cut
 * through each other when part of that segment lies inside r (a hair inside, so cards that only touch
 * at an edge pass).
 */
function crosses(a: Card, r: Card) {
  const f = frameOf(r.corners);
  const d = a.corners.map((p) => dot(sub(p, f.c), f.n));
  if (d.every((x) => x > 1e-9) || d.every((x) => x < -1e-9)) return false;
  const ends: V[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    if ((d[i] > 0) !== (d[j] > 0) && Math.abs(d[i] - d[j]) > 1e-12) {
      ends.push(add(a.corners[i], mul(sub(a.corners[j], a.corners[i]), d[i] / (d[i] - d[j]))));
    }
  }
  if (ends.length < 2) return false;
  const to2 = (p: V) => [dot(sub(p, f.c), f.u), dot(sub(p, f.c), f.v)];
  const [p0, p1] = [to2(ends[0]), to2(ends[1])];
  const poly = r.corners.map(to2);
  let area = 0;
  for (let i = 0; i < 4; i++) area += poly[i][0] * poly[(i + 1) % 4][1] - poly[(i + 1) % 4][0] * poly[i][1];
  const turn = area > 0 ? 1 : -1;
  const tol = 0.005 * Math.min(...poly.map((e, i) => Math.hypot(poly[(i + 1) % 4][0] - e[0], poly[(i + 1) % 4][1] - e[1])));
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    const e0 = poly[i];
    const e1 = poly[(i + 1) % 4];
    const len = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]) || 1;
    const nx = (-(e1[1] - e0[1]) * turn) / len;
    const ny = ((e1[0] - e0[0]) * turn) / len;
    const at = nx * (p0[0] - e0[0]) + ny * (p0[1] - e0[1]) - tol;
    const den = nx * (p1[0] - p0[0]) + ny * (p1[1] - p0[1]);
    if (Math.abs(den) < 1e-12) {
      if (at < 0) return false;
    } else {
      const t = -at / den;
      if (den > 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  return (t1 - t0) * Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 1e-4;
}

/** Two cards in one plane that overlap. */
function overlapInPlane(a: Card, b: Card) {
  const fa = frameOf(a.corners);
  const fb = frameOf(b.corners);
  if (Math.abs(Math.abs(dot(fa.n, fb.n)) - 1) > 1e-5 || Math.abs(dot(sub(fb.c, fa.c), fa.n)) > 1e-3) return false;
  // separating axes: the normals of every edge, within the plane
  const axes = [a, b].flatMap((card) => card.corners.map((p, i) => norm(cross(fa.n, sub(card.corners[(i + 1) % 4], p)))));
  for (const axis of axes) {
    const pa = a.corners.map((p) => dot(p, axis));
    const pb = b.corners.map((p) => dot(p, axis));
    if (Math.max(...pa) <= Math.min(...pb) + 1e-3 || Math.max(...pb) <= Math.min(...pa) + 1e-3) return false;
  }
  return true;
}

function cut(a: Card, b: Card) {
  if (Math.hypot(...sub(a.c, b.c)) > a.reach + b.reach) return false;
  return crosses(a, b) || crosses(b, a) || overlapInPlane(a, b);
}

function check(aspect: number, mobile: boolean, marks: Marks, clock: number, until: number) {
  const n = mobile ? 42 : 64;
  const choreo = createChoreo({ n, cols: mobile ? 7 : 8, mobile });
  choreo.setMarks(marks);
  choreo.layout(H * aspect, H);
  const problems: string[] = [];
  const pose = newPose();
  const cuts = new Map<string, [number, number]>();
  let prev: Card[] | null = null;
  for (let p = 0; p <= until; p += STEP) {
    // the part of the screen the scene shows (scene.ts: uClip)
    const settle = easeInOut(phase(p, ...marks.settle));
    const shown = mobile ? [-1, -1 + settle, 1, 1] : [-1, -1, 1 - settle, 1];
    const cards: Card[] = [];
    for (let k = 0; k < n; k++) {
      const card = cardOf(choreo.pose(k, p, pose, clock));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      card.box = [];
      for (const [x, y, z] of card.corners) {
        const d = BASE - z;
        if (d < 0.5) card.box = null;
        if (!card.box) break;
        x0 = Math.min(x0, (x * FOCAL) / aspect / d);
        x1 = Math.max(x1, (x * FOCAL) / aspect / d);
        y0 = Math.min(y0, (y * FOCAL) / d);
        y1 = Math.max(y1, (y * FOCAL) / d);
      }
      if (card.box) card.box = [x0, y0, x1, y1];
      cards.push(card);
    }
    const seen = (c: Card) => c.alpha > 0.02 && c.box !== null && c.box[2] > shown[0] && c.box[0] < shown[2] && c.box[3] > shown[1] && c.box[1] < shown[3];
    for (let i = 0; i < n; i++) {
      if (!seen(cards[i])) continue;
      for (let j = i + 1; j < n; j++) {
        if (!seen(cards[j]) || (cards[i].layer === LOOSE && cards[j].layer === LOOSE)) continue;
        if (!cut(cards[i], cards[j])) continue;
        const key = `cards ${i} and ${j}`;
        const span = cuts.get(key);
        cuts.set(key, span ? [span[0], p] : [p, p]);
      }
    }
    if (prev) {
      for (let k = 0; k < n; k++) {
        // how far it moved on screen (its depth as drawn may change fast: that only orders the cards)
        const [a, b] = [prev[k].box, cards[k].box];
        if (!a || !b) continue;
        const moved = Math.hypot((a[0] + a[2] - b[0] - b[2]) / 2, (a[1] + a[3] - b[1] - b[3]) / 2);
        if (moved > 0.3 && (seen(prev[k]) || seen(cards[k]))) problems.push(`card ${k} jumps ${moved.toFixed(2)} of the screen at ${p.toFixed(3)}`);
      }
    }
    prev = cards;
  }
  for (const [key, [a, b]] of cuts) problems.push(`${key} cut through each other from ${a.toFixed(3)} to ${b.toFixed(3)}`);
  return problems;
}

let failed = false;
const screens: [string, number, boolean][] = [
  ["4:3", 4 / 3, false],
  ["16:10", 1.6, false],
  ["16:9", 16 / 9, false],
  ["2:1", 2, false],
  ["2.4:1", 2.4, false],
  ["phone 390×844", 390 / 844, true],
  ["phone 3:5", 0.6, true],
  ["tablet 3:4", 0.75, true],
];
for (const [name, aspect, mobile] of screens) {
  const problems = check(aspect, mobile, MARKS, CLOCKS[0], MARKS.exit[1]);
  // the drift only matters until the cards have left the air
  for (const clock of CLOCKS.slice(1)) problems.push(...check(aspect, mobile, MARKS, clock, MARKS.gather[1]).map((l) => `(drift at ${clock}s) ${l}`));
  console.log(`${problems.length ? "✗" : "✓"} ${name}${problems.length ? "" : ": no card cuts through another"}`);
  for (const line of problems.slice(0, 12)) console.log(`    ${line}`);
  if (problems.length > 12) console.log(`    … and ${problems.length - 12} more`);
  failed ||= problems.length > 0;
}
process.exit(failed ? 1 : 0);
