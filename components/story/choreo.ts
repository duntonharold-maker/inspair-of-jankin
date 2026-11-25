/**
 * Where every card of the story scene is.
 *
 * On the first screen the cards drift in the air on a clock, as premotio's do. From the first scroll
 * into the ring onward every pose is a function of the scroll position alone, so the cards stand still
 * whenever the page does.
 *
 * Each card is seen through its own lens and drawn at its own depth (see `toShared`): the ring and the
 * forming wall share the wide lens, the settled wall narrows to the long one, and the wall is drawn
 * behind the ring although the two overlap where they stand. That is how premotio lets cards fly from
 * one composition into another without ever cutting through each other.
 *
 * The paths keep cards at rest apart:
 * - In the ring every card stands nearly radial on its own slot, like the spokes of a pinwheel, and a
 *   card only slides up or down its slot while it is level with the others: cards drop into the ring
 *   from above the screen, and later rise out of it while the ring carries them on.
 * - The ring turns counterclockwise; the cards leave from its back one after another, lie down as the
 *   ring carries them to the left, then fly to the wall at the upper left, filling it from the far
 *   corner to the near one. Each lands on its cell from straight in front of it, already lying in the
 *   wall's plane, so it cannot cut into the cards that have landed around it.
 * Moving cards are drawn after the cards at rest, farthest first, so moving cards may cross one another.
 */
import { Euler, Quaternion, Vector3 } from "three";

export type Marks = {
  /** the cards leave the air and drop into the ring */
  gather: [number, number];
  /** the cards leave the ring for the wall */
  unroll: [number, number];
  /** the wall's lens narrows and the picture is cut to the left half */
  settle: [number, number];
  /** the wall leaves */
  exit: [number, number];
};

export const FLOAT = 0;
export const RING = 1;
export const FLIGHT = 2;
export const WALL = 3;

/** Cards at rest are drawn with the depth buffer; moving ones after them, farthest first, over each other. */
export const SOLID = 0;
export const LOOSE = 1;

/** The lenses (vertical field of view in degrees): wide for the air and the ring, long for the settled wall. */
export const WIDE_FOV = 30;
export const LONG_FOV = 7;
/** How far from z = 0 a camera with this field of view stands for z = 0 to show `height` world units. */
export const distanceFor = (fov: number, height: number) => height / 2 / Math.tan((fov * Math.PI) / 360);

export type Pose = {
  pos: Vector3;
  quat: Quaternion;
  size: number;
  alpha: number;
  /** FLOAT, RING, FLIGHT or WALL */
  mode: number;
  /** 0 → 1 as the card comes to rest on the wall */
  landed: number;
  /** 0 → 1 along the flight from the ring to the wall */
  flight: number;
  /** SOLID or LOOSE */
  layer: number;
  /** the card's own camera: how far from z = 0 it stands (world units) */
  lens: number;
  /** how far behind its place the card is drawn (world units), so the wall stays behind the ring */
  depth: number;
};

export const newPose = (): Pose => ({
  pos: new Vector3(),
  quat: new Quaternion(),
  size: 1,
  alpha: 1,
  mode: FLOAT,
  landed: 0,
  flight: 0,
  layer: SOLID,
  lens: 14,
  depth: 0,
});

/**
 * Where a point of a card seen through its own lens has to be for one shared camera, `base` world
 * units from z = 0, to show it in the same place on screen; its depth there is z − depth.
 */
export function toShared(x: number, y: number, z: number, lens: number, depth: number, base: number, out: Vector3) {
  const za = z - depth;
  const s = (lens * (base - za)) / (base * Math.max(lens - z, 0.05));
  return out.set(x * s, y * s, za);
}

/* ----------------------------------------------------------------- maths */

const TAU = Math.PI * 2;
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const easeInOut = (x: number) => {
  x = clamp01(x);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const easeIn = (x: number) => {
  x = clamp01(x);
  return x * x * x;
};
export const phase = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
/** 0 → 1, easing in over the first `t` and out over the last `t`, at an even pace between. */
function ramp(x: number, t = 0.18) {
  const n = 1 / (1 - t);
  const r = (e: number) => n * t * (e ** 3 - e ** 4 / 2);
  x = clamp01(x);
  return x < t ? r(x / t) : x > 1 - t ? 1 - r((1 - x) / t) : n * (x - t / 2);
}

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ----------------------------------------------------------------- tuning */

/** The air: how fast the cards rise on their own, and over how many screen heights before they come round. */
const DRIFT = 0.012;
const DRIFT_SPAN = 1.6;
/** When the cards leave the air (spread over this much scrolling), how long each takes, and how far it rises. */
const LEAVE_SPREAD = 0.32;
const LEAVE_TAKES = 0.3;
const LEAVE_HEIGHT = 1.9;
/** How long one card takes to drop into the ring, and from how high (in screen heights). */
const DROP_TAKES = 0.32;
const DROP_FROM = 0.95;
/** How far the ring turns while the cards gather, in radians. */
const SPIN_GATHER = 1.1;
/** Cards on the ring are turned this far off the tangent: nearly radial, like a pinwheel's spokes. */
export const RING_FAN = 1.3;
const RING_TILT = 0.28;
/** Where on the ring the cards leave: the back right, where their faces show. */
const LEAVE_AT = Math.PI - 0.9;
/** One card's trip from the ring to the wall, in screen heights of scrolling: rising out of its slot,
 * lying down as the ring carries it on, riding on above the ring (the cards there make a band that
 * follows the ring round, as on premotio), flying to its cell. */
const RISE_TAKES = 0.07;
const TURN_TAKES = 0.06;
const RIDE_TAKES = 0.08;
const FLY_TAKES = 0.2;
export const TRIP = RISE_TAKES + TURN_TAKES + RIDE_TAKES + FLY_TAKES;
/** How far in front of its cell a landing card starts its final approach (in card heights). */
const APPROACH = 0.9;
/** The wall: turned in its own plane, then laid back (as on premotio). */
const WALL_TURN = 0.41;
const WALL_LAY = 0.8;
/** How far behind its place the wall is drawn, so the ring always stays in front of it. */
const WALL_BEHIND = 12;

export type Choreo = ReturnType<typeof createChoreo>;

export function createChoreo({ n, cols, mobile }: { n: number; cols: number; mobile: boolean }) {
  const rows = Math.ceil(n / cols);
  const rand = rng(7);
  const seeds = Array.from({ length: n }, () => ({
    fx: rand(),
    fy: rand(),
    fz: rand(),
    rx: rand() * TAU,
    ry: rand() * TAU,
    rz: rand() * TAU,
    wx: (rand() - 0.5) * 0.5,
    wy: (rand() - 0.5) * 0.6,
    wz: (rand() - 0.5) * 0.4,
    fs: 0.8 + rand() * 0.5,
    ph: rand() * TAU,
    sg: rand(),
  }));

  let W = 1;
  let H = 1;
  let WIDE = distanceFor(WIDE_FOV, 7.5);
  let marks: Marks = { gather: [1, 2.6], unroll: [2.9, 4.05], settle: [3.95, 4.45], exit: [5.5, 6.3] };

  const tmpQ = new Quaternion();
  const tmpE = new Euler();
  const v = new Vector3();

  /* ------------------------------------------------------------ the air */

  const leaves = (k: number) => marks.gather[0] + (k / Math.max(1, n - 1)) * LEAVE_SPREAD;

  /** Card k in the air; `clock` is the drift's own time in seconds, which stops once the page scrolls on. */
  function airPose(k: number, p: number, clock: number, out: Pose) {
    const s = seeds[k];
    const t0 = leaves(k);
    const leaving = phase(p, t0, t0 + LEAVE_TAKES);
    const y = ((((s.fy + clock * DRIFT) % 1) + 1) % 1 - 0.5) * H * DRIFT_SPAN;
    out.pos.set(
      (s.fx - 0.5) * W * 1.15 + Math.sin(clock * 0.11 + s.ph) * W * 0.02,
      y + Math.cos(clock * 0.09 + s.ph * 1.3) * H * 0.03 + H * LEAVE_HEIGHT * easeIn(leaving),
      H * (-0.67 + s.fz),
    );
    out.quat.setFromEuler(tmpE.set(s.rx + clock * s.wx, s.ry + clock * s.wy, s.rz + clock * s.wz));
    out.size = H * (mobile ? 0.12 : 0.15) * s.fs;
    out.mode = FLOAT;
    out.layer = LOOSE;
    out.lens = WIDE;
    out.depth = 0;
  }

  /* ------------------------------------------------------------ the ring */

  const ring = {
    c: new Vector3(),
    R: 1,
    size: 1,
    tilt: new Quaternion().setFromEuler(new Euler(RING_TILT, 0, 0)),
    axis: new Vector3(),
  };

  function placeRing() {
    ring.R = mobile ? W * 0.2 : H * 0.27;
    ring.size = H * (mobile ? 0.17 : 0.29);
    ring.axis.set(0, 1, 0).applyQuaternion(ring.tilt);
    // centre the ring's picture a little below the middle of the screen (as on premotio)
    const target = mobile ? 0.02 * H : -0.06 * H;
    ring.c.set(0, 0, 0);
    const p = newPose();
    for (let pass = 0; pass < 3; pass++) {
      let top = -Infinity;
      let bottom = Infinity;
      for (let k = 0; k < 64; k++) {
        slot((k / 64) * n, 0, -1, p);
        for (const [cx, cy] of CORNERS) {
          v.set(cx * 0.375, cy * 0.5, 0).multiplyScalar(p.size).applyQuaternion(p.quat).add(p.pos);
          const y = (v.y * WIDE) / (WIDE - v.z);
          top = Math.max(top, y);
          bottom = Math.min(bottom, y);
        }
      }
      ring.c.y += target - (top + bottom) / 2;
    }
  }

  /** How far the ring has turned: a little while the cards gather, then once round as they leave. */
  const spin = (p: number) =>
    p < 0 ? 0 : SPIN_GATHER * easeInOut(phase(p, marks.gather[0], marks.unroll[0])) + TAU * ramp(phase(p, marks.unroll[0], leftLast()));

  /** A card on slot k (a fractional k is allowed), raised h along the ring's axis. */
  function slot(k: number, h: number, p: number, out: Pose) {
    const a = (k / n) * TAU + spin(p);
    out.pos.set(Math.sin(a) * ring.R, h, Math.cos(a) * ring.R).applyQuaternion(ring.tilt).add(ring.c);
    out.quat.copy(ring.tilt).multiply(tmpQ.setFromEuler(tmpE.set(0, a + RING_FAN, 0)));
    out.size = ring.size;
    out.mode = RING;
    out.layer = h > 1e-6 ? LOOSE : SOLID;
    out.lens = WIDE;
    out.depth = 0;
    return a;
  }

  /** When card k starts to drop into the ring. */
  const drops = (k: number) => {
    const [g0, g1] = marks.gather;
    const first = g0 + LEAVE_TAKES + 0.04;
    return first + (k / Math.max(1, n - 1)) * (g1 - DROP_TAKES - first);
  };

  /* ------------------------------------------------------------ the wall */

  const wall = {
    c: new Vector3(),
    /** where it stands when the first card reaches it: far back, above the ring */
    from: new Vector3(),
    /** where it ends up */
    to: new Vector3(),
    q: new Quaternion().setFromEuler(new Euler(-WALL_LAY, 0, 0)).multiply(new Quaternion().setFromEuler(new Euler(0, 0, WALL_TURN))),
    normal: new Vector3(),
    size: 1,
    x: 1,
    y: 1,
  };
  wall.normal.set(0, 0, 1).applyQuaternion(wall.q);

  function placeWall() {
    wall.size = H * (mobile ? 0.2 : 0.28);
    wall.x = wall.size * 0.75 * 1.08;
    wall.y = wall.size * 1.1;
    if (mobile) wall.to.set(0, H * 0.26, 0);
    else wall.to.set(-W * 0.25, 0, 0);
    // It fills far back, so that its far corner, which the first cards reach, sits just above the
    // ring; it comes forward into place as it fills, as premotio's camera pushes in.
    wall.from.copy(wall.to).add(v.set(mobile ? 0 : W * 0.55, -H * 0.32, -H * 1.6));
  }

  function wallAt(p: number) {
    wall.c.lerpVectors(wall.from, wall.to, easeInOut(phase(p, marks.unroll[0] + 0.1, marks.unroll[1] + 0.05)));
  }

  /** The wall's lens: wide while it fills, narrowing to the long one as it settles. */
  const wallLens = (p: number) => distanceFor(WIDE_FOV + (LONG_FOV - WIDE_FOV) * easeInOut(phase(p, ...marks.settle)), H);

  const cellLocal = (row: number, col: number, out: Vector3) =>
    out.set((col - (cols - 1) / 2) * 0.75 * 1.08, ((rows - 1) / 2 - row) * 1.1, 0);

  function cellPose(k: number, p: number, out: Pose) {
    const r = route[k];
    const settled = marks.settle[1];
    const drift = p > settled ? Math.max(-0.45, Math.min(0.45, (p - settled) * 0.35)) * wall.x : 0;
    wallAt(p);
    cellLocal(r.row, r.col, out.pos).multiplyScalar(wall.size);
    out.pos.x += drift;
    out.pos.applyQuaternion(wall.q).add(wall.c);
    out.quat.copy(wall.q);
    out.size = wall.size;
    out.mode = WALL;
    out.layer = SOLID;
    out.lens = wallLens(p);
    out.depth = WALL_BEHIND;
  }

  /* ---------------------------------------------------------- the routes */

  // The ring turns once round while the cards leave; each leaves as its slot passes LEAVE_AT. The
  // wall fills in that order from its farthest cell (top left) to its nearest.
  const route = Array.from({ length: n }, () => ({ order: 0, row: 0, col: 0, sweep: 0, departs: 0 }));
  {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * TAU + SPIN_GATHER;
      route[k].sweep = ((((LEAVE_AT - a0) % TAU) + TAU) % TAU) / TAU; // share of the turn before slot k leaves
    }
    const order = [...Array(n).keys()].sort((a, b) => route[a].sweep - route[b].sweep);
    const cells: { row: number; col: number; z: number; x: number }[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (cells.length >= n) break;
        const c = cellLocal(row, col, new Vector3()).applyQuaternion(wall.q);
        cells.push({ row, col, z: c.z, x: c.x });
      }
    }
    cells.sort((a, b) => a.z - b.z || a.x - b.x);
    order.forEach((k, j) => {
      route[k].order = j;
      route[k].row = cells[j].row;
      route[k].col = cells[j].col;
    });
  }

  /** When the last card sets off. */
  const leftLast = () => marks.unroll[1] - TRIP;

  function timeRoutes() {
    const [u0] = marks.unroll;
    for (const r of route) {
      // the scroll position at which the ring's turn reaches this slot's share
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (ramp(mid) < r.sweep) lo = mid;
        else hi = mid;
      }
      r.departs = u0 + lo * (leftLast() - u0);
    }
  }
  timeRoutes();

  const A = newPose();
  const B = newPose();
  const b1 = new Vector3();
  const b2 = new Vector3();
  const tangent = new Vector3();

  const hinge = new Vector3();
  /** Card k riding its slot with its foot at climb − size / 2, turned share f of the way into the wall's plane. */
  function lieBack(k: number, climb: number, f: number, p: number, out: Pose) {
    const a = slot(k, climb, p, out);
    hinge.copy(ring.axis).multiplyScalar(-out.size / 2).add(out.pos);
    out.quat.slerp(wall.q, f);
    out.pos.copy(hinge).addScaledVector(v.set(0, 1, 0).applyQuaternion(out.quat), out.size / 2);
    out.mode = FLIGHT;
    out.layer = LOOSE;
    return a;
  }

  function tripPose(k: number, p: number, out: Pose) {
    const r = route[k];
    const d = p - r.departs;
    const climb = ring.size * 1.22; // its foot clears the ring's top before it turns
    if (d < RISE_TAKES) {
      // rising straight up its slot as the ring carries it on
      slot(k, climb * easeInOut(d / RISE_TAKES), p, out);
      out.flight = 0;
      return;
    }
    if (d < RISE_TAKES + TURN_TAKES + RIDE_TAKES) {
      // still riding the ring, lying back into the wall's plane like a door falling open, hinged at
      // its foot, which stays clear of the ring's top; then riding on, lying down
      lieBack(k, climb, easeInOut((d - RISE_TAKES) / TURN_TAKES), p, out);
      out.flight = 0;
      return;
    }
    // flying from where the ring let it go to its cell, which it reaches from straight in front
    const start = r.departs + RISE_TAKES + TURN_TAKES + RIDE_TAKES;
    const u = clamp01((p - start) / FLY_TAKES);
    const a = lieBack(k, climb, 1, start, A);
    tangent.set(Math.cos(a), 0, -Math.sin(a)).applyQuaternion(ring.tilt);
    cellPose(k, p, B);
    b1.copy(A.pos).addScaledVector(tangent, ring.R * 0.45).addScaledVector(ring.axis, ring.size * 0.3);
    b2.copy(B.pos).addScaledVector(wall.normal, APPROACH * B.size);
    const t = 1 - (1 - u) ** 2.2; // leaves at the ring's pace, settles gently
    const w0 = (1 - t) ** 3;
    const w1 = 3 * (1 - t) ** 2 * t;
    const w2 = 3 * (1 - t) * t * t;
    const w3 = t ** 3;
    out.pos.copy(A.pos).multiplyScalar(w0).addScaledVector(b1, w1).addScaledVector(b2, w2).addScaledVector(B.pos, w3);
    out.quat.copy(wall.q);
    const grow = easeInOut(u);
    out.size = A.size + (B.size - A.size) * grow;
    out.lens = distanceFor(WIDE_FOV + (fovOf(B.lens) - WIDE_FOV) * grow, H);
    out.depth = WALL_BEHIND * easeInOut(phase(u, 0, 0.3)); // behind the ring before it can cross it
    out.mode = FLIGHT;
    out.layer = LOOSE;
    out.flight = u;
  }

  const fovOf = (distance: number) => (Math.atan(H / 2 / distance) * 360) / Math.PI;

  /* ----------------------------------------------------------- the pose */

  /** Card k at scroll position p; `clock` drives the drift in the air (seconds, frozen once scrolling on). */
  function pose(k: number, p: number, out: Pose, clock = 0) {
    out.alpha = 1;
    out.landed = 0;
    out.flight = 0;
    const left = leaves(k) + LEAVE_TAKES;
    const r = route[k];
    if (p < left) {
      airPose(k, p, clock, out);
    } else if (p < r.departs) {
      const d = drops(k);
      slot(k, H * DROP_FROM * (1 - easeInOut(phase(p, d, d + DROP_TAKES))), p, out);
    } else if (p < r.departs + TRIP) {
      tripPose(k, p, out);
    } else {
      cellPose(k, p, out);
      out.landed = 1;
      // leaving: each card rises off the wall's plane at its own moment
      const x = easeInOut((phase(p, ...marks.exit) - seeds[k].sg * 0.3) / 0.7);
      if (x > 0) {
        out.pos.y += H * 1.3 * x;
        out.pos.z -= 3 * x;
        out.alpha = 1 - x;
      }
    }
    return out;
  }

  /** The direction a card may be nudged (by the pointer or a hover) without touching its neighbours. */
  function freeAxis(mode: number, quat: Quaternion, out: Vector3) {
    if (mode === RING) return out.copy(ring.axis);
    return out.set(0, 0, 1).applyQuaternion(quat);
  }

  function layout(viewW: number, viewH: number) {
    W = viewW;
    H = viewH;
    WIDE = distanceFor(WIDE_FOV, H);
    placeRing();
    placeWall();
  }

  return {
    n,
    rows,
    cols,
    layout,
    setMarks(m: Marks) {
      marks = m;
      timeRoutes();
    },
    get marks() {
      return marks;
    },
    pose,
    freeAxis,
    /** The wall cell (row, column) card k ends up on. */
    cellOf: (k: number) => ({ row: route[k].row, col: route[k].col }),
    /** The ring: its centre, radius and card size in world units (it stands at z = 0, seen through the wide lens). */
    ring: { centre: ring.c, get radius() { return ring.R; }, get size() { return ring.size; } },
    debug: { ring, wall, route, drops, leaves },
  };
}

const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
