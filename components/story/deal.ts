/**
 * Who shows what: which picture each of the story's cards shows (scene.ts).
 */
import { Vector3 } from "three";
import { LONG_FOV, distanceFor, newPose, toShared, type createChoreo } from "./choreo.ts";
import { MARKS } from "./timeline.ts";
import { picturesOf, type Item } from "../../lib/types.ts";

type Choreo = ReturnType<typeof createChoreo>;

/**
 * Which picture each card shows. Featured items first, then the newest. The cards that can be seen once
 * the wall has settled come first, the most prominent (near the middle of what shows) taking the newest,
 * so no picture shows twice there. Then the other pictures of sets (each still opens its own item), and
 * only when the library has fewer pictures than there are cards, repeats: on cards the settled wall
 * hides, each as far round the ring (where every card shows at once) from its other copies as it can be.
 * It depends on nothing but the library and the screen's shape, so every visit deals the same.
 */
export function deal(items: Item[], choreo: Choreo, n: number, mobile: boolean, aspect: number): (Item | undefined)[] {
  const ranked = [...items].sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || b.createdAt.localeCompare(a.createdAt));
  // a picture of a set shows as its item with that picture
  const faces: Item[] = [...ranked, ...ranked.flatMap((i) => picturesOf(i).slice(1).map((media) => ({ ...i, media })))];
  const out: (Item | undefined)[] = new Array(n).fill(undefined);
  if (!faces.length) return out;

  // where each card is on screen once the wall has settled (the left half, or the top half on a phone)
  const H = 7.5;
  const base = distanceFor(LONG_FOV, H);
  const focal = 1 / Math.tan((LONG_FOV * Math.PI) / 360);
  choreo.setMarks(MARKS);
  choreo.layout(H * aspect, H);
  const pose = newPose();
  const corner = new Vector3();
  const seen = (k: number) => {
    choreo.pose(k, MARKS.settle[1] + 0.3, pose, 0);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [a, b] of [[-0.375, -0.5], [0.375, -0.5], [0.375, 0.5], [-0.375, 0.5]]) {
      corner.set(a * pose.size, b * pose.size, 0).applyQuaternion(pose.quat).add(pose.pos);
      toShared(corner.x, corner.y, corner.z, pose.lens, pose.depth, base, corner);
      const d = base - corner.z;
      if (d < 0.5) return null;
      const x = (corner.x * focal) / aspect / d;
      const y = (corner.y * focal) / d;
      x0 = Math.min(x0, x), x1 = Math.max(x1, x), y0 = Math.min(y0, y), y1 = Math.max(y1, y);
    }
    const [l, b, r, t] = mobile ? [-1, 0, 1, 1] : [-1, -1, 0, 1];
    if (x1 < l || x0 > r || y1 < b || y0 > t) return null;
    // how far from the most prominent spot: the middle of what shows, a little towards the words
    const [cx, cy] = mobile ? [0, 0.45] : [-0.4, 0.05];
    return Math.hypot((x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy);
  };
  const where = Array.from({ length: n }, (_, k) => ({ k, far: seen(k) }));
  const order = [
    ...where.filter((w) => w.far !== null).sort((a, b) => a.far! - b.far!),
    ...where.filter((w) => w.far === null),
  ].map((w) => w.k);

  // every picture once, the most prominent cards first
  order.forEach((k, j) => {
    if (j < faces.length) out[k] = faces[j];
  });
  // repeats for the cards left: as far round the ring from the item's other copies as possible,
  // the least shown first, then the freshest
  const ringGap = (a: number, b: number) => Math.min(Math.abs(a - b), n - Math.abs(a - b));
  const copies = new Map<string, number[]>();
  out.forEach((f, k) => f && copies.set(f.id, [...(copies.get(f.id) ?? []), k]));
  for (const k of order.slice(faces.length)) {
    let best: Item | undefined;
    let bestScore = -Infinity;
    ranked.forEach((item, rank) => {
      const at = copies.get(item.id) ?? [];
      const gap = at.length ? Math.min(...at.map((c) => ringGap(c, k))) : n;
      const score = gap * 1000 - at.length * 100 - rank;
      if (score > bestScore) (bestScore = score), (best = item);
    });
    out[k] = best;
    if (best) copies.set(best.id, [...(copies.get(best.id) ?? []), k]);
  }
  return out;
}
