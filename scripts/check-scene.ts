/**
 * Walks the story's card scene in small steps of scrolling and checks, for screens from 4:3 to 2.4:1
 * and for phones, that:
 * - no card cuts through another on screen (cards in motion are drawn over one another in order, so
 *   only pairs with at least one card at rest count, as in the scene);
 * - no card jumps on screen from one step to the next;
 * - every card in the air has its room.
 *
 * Run it after changing components/story/choreo.ts or the story's timing:
 *   npm run check:scene
 */
import { createChoreo, easeInOut, LOOSE, newPose, phase, type Marks, type Pose } from "../components/story/choreo.ts";
import { MARKS } from "../components/story/timeline.ts";

// the scene's camera (scene.ts)
const WIDE = 30;
const LONG = 7;
const BASE_Z = 14;
const H = 2 * Math.tan((WIDE * Math.PI) / 360) * BASE_Z;
const STEP = 0.0025;

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

type Card = { c: V; u: V; v: V; n: V; hu: number; hv: number; corners: V[]; layer: number; alpha: number; box: number[] | null };

function cardOf(pose: Pose): Omit<Card, "box"> {
  const q = pose.quat;
  const qv: V = [q.x, q.y, q.z];
  const rot = (x: V): V => {
    const t = mul(cross(qv, x), 2);
    return add(add(x, mul(t, q.w)), cross(qv, t));
  };
  const u = rot([1, 0, 0]);
  const v = rot([0, 1, 0]);
  const n = rot([0, 0, 1]);
  const c: V = [pose.pos.x, pose.pos.y, pose.pos.z];
  const hu = 0.375 * pose.size;
  const hv = 0.5 * pose.size;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => add(c, add(mul(u, a * hu), mul(v, b * hv))));
  return { c, u, v, n, hu, hv, corners, layer: pose.layer, alpha: pose.alpha };
}

/**
 * Does card a cut through card r? Where a crosses r's plane it does so along a segment; the cards
 * cut through each other when part of that segment lies inside r (a hair inside, so cards that only
 * touch at an edge pass).
 */
function crosses(a: Card, r: Card) {
  const d = a.corners.map((p) => dot(sub(p, r.c), r.n));
  if (d.every((x) => x > 1e-9) || d.every((x) => x < -1e-9)) return false;
  const ends: V[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    if ((d[i] > 0) !== (d[j] > 0) && Math.abs(d[i] - d[j]) > 1e-12) {
      ends.push(add(a.corners[i], mul(sub(a.corners[j], a.corners[i]), d[i] / (d[i] - d[j]))));
    }
  }
  if (ends.length < 2) return false;
  // the segment in r's own coordinates, clipped to r (Liang–Barsky)
  const to2 = (p: V) => [dot(sub(p, r.c), r.u), dot(sub(p, r.c), r.v)];
  const [p0, p1] = [to2(ends[0]), to2(ends[1])];
  let t0 = 0;
  let t1 = 1;
  for (const [k, half] of [
    [0, r.hu * 0.995],
    [1, r.hv * 0.995],
  ] as const) {
    const delta = p1[k] - p0[k];
    for (const [q, lim] of [
      [-delta, p0[k] + half],
      [delta, half - p0[k]],
    ]) {
      if (Math.abs(q) < 1e-12) {
        if (lim < 0) return false;
      } else {
        const t = lim / q;
        if (q < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
    }
  }
  const length = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  return (t1 - t0) * length > 1e-4;
}

/** Two cards in one plane that overlap. */
function overlapInPlane(a: Card, b: Card) {
  if (Math.abs(Math.abs(dot(a.n, b.n)) - 1) > 1e-6 || Math.abs(dot(sub(b.c, a.c), a.n)) > 1e-4) return false;
  for (const axis of [a.u, a.v, b.u, b.v]) {
    const pa = a.corners.map((p) => dot(p, axis));
    const pb = b.corners.map((p) => dot(p, axis));
    if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6) return false;
  }
  return true;
}

function cut(a: Card, b: Card) {
  if (Math.hypot(...sub(a.c, b.c)) > a.hu + a.hv + b.hu + b.hv) return false;
  return crosses(a, b) || crosses(b, a) || overlapInPlane(a, b);
}

function check(aspect: number, mobile: boolean, marks: Marks) {
  const n = mobile ? 42 : 64;
  const choreo = createChoreo({ n, cols: mobile ? 7 : 8, mobile });
  choreo.setMarks(marks);
  choreo.layout(H * aspect, H);
  const problems: string[] = [];
  if (choreo.airShort > 0) problems.push(`two cards in the air are ${choreo.airShort.toFixed(3)} short of their room`);

  const pose = newPose();
  const cuts = new Map<string, [number, number]>();
  let prev: Card[] | null = null;
  for (let p = 0; p <= marks.exit[1]; p += STEP) {
    // the camera and the part of the screen the scene shows (scene.ts: setLens and uClip)
    const settle = easeInOut(phase(p, ...marks.settle));
    const fov = WIDE + (LONG - WIDE) * settle;
    const camZ = H / 2 / Math.tan((fov * Math.PI) / 360);
    const f = 1 / Math.tan((fov * Math.PI) / 360);
    const shown = mobile ? [-1, -1 + settle, 1, 1] : [-1, -1, 1 - settle, 1];
    const cards: Card[] = [];
    for (let k = 0; k < n; k++) {
      const card = cardOf(choreo.pose(k, p, pose)) as Card;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      card.box = [];
      for (const [x, y, z] of card.corners) {
        const d = camZ - z;
        if (d < 0.1) card.box = null;
        if (!card.box) break;
        x0 = Math.min(x0, (x * f) / aspect / d);
        x1 = Math.max(x1, (x * f) / aspect / d);
        y0 = Math.min(y0, (y * f) / d);
        y1 = Math.max(y1, (y * f) / d);
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
        const moved = Math.hypot(...sub(prev[k].c, cards[k].c));
        if (moved > H * 0.25 && (seen(prev[k]) || seen(cards[k]))) problems.push(`card ${k} jumps ${moved.toFixed(2)} at ${p.toFixed(3)}`);
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
  const problems = check(aspect, mobile, MARKS);
  console.log(`${problems.length ? "✗" : "✓"} ${name}${problems.length ? "" : ": no card cuts through another"}`);
  for (const line of problems.slice(0, 12)) console.log(`    ${line}`);
  if (problems.length > 12) console.log(`    … and ${problems.length - 12} more`);
  failed ||= problems.length > 0;
}
process.exit(failed ? 1 : 0);
