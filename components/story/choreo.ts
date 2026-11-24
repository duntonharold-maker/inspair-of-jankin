/**
 * Where every card of the story scene is, as a function of the scroll position alone: when the page
 * stops, so do the cards.
 *
 * The paths are laid out so that no two cards ever pass through each other:
 * - In the air each card keeps a sphere of room around itself. They all rise together as the page
 *   scrolls, and leave through the top of the screen highest first, so none catches up with another.
 * - In the ring every card stands upright on its own slot. Cards in their slots never touch at any
 *   height (every card's plane holds the ring's axis), so a card only ever slides up or down its slot
 *   while it is level with the others: the cards drop into the ring from above the screen, and later
 *   rise out of it before they fly.
 * - The cards leave the ring back first, rise clear of it and fly up to a wall laid out above it, one
 *   row after another. Each lands on its cell from straight above, already lying in the wall's plane,
 *   so it cannot cut into the cards that have landed around it.
 * - The full wall then moves to its place as one piece, and later leaves card by card along a path
 *   that lifts each card off the wall's plane.
 */
import { Euler, Quaternion, Vector3 } from "three";

export type Marks = {
  /** the cards leave the air and drop into the ring */
  gather: [number, number];
  /** the cards leave the ring for the wall */
  unroll: [number, number];
  /** the finished wall moves to the left half, and the lens narrows */
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

export type Pose = {
  pos: Vector3;
  quat: Quaternion;
  size: number;
  alpha: number;
  /** FLOAT, RING, FLIGHT or WALL */
  mode: number;
  /** 0 → 1 as the card comes to rest on the wall */
  landed: number;
  /** 0 → 1 along a flight from the ring to the wall */
  flight: number;
  /** SOLID or LOOSE */
  layer: number;
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
});

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

/** Card shape: 0.75 wide for 1 tall; half its diagonal. */
const HALF_DIAGONAL = 0.625;
/** Room kept around each card in the air beyond its own half diagonal, for the pointer's stir. */
const AIR_ROOM = 0.22;
/** How far the cards in the air rise per viewport height of scrolling, and when they leave. */
const RISE = 0.25;
const LEAVE_SPREAD = 0.32;
const LEAVE_TAKES = 0.3;
const LEAVE_HEIGHT = 1.7;
/** How long one card takes to drop into the ring, and from how high (in viewport heights). */
const DROP_TAKES = 0.32;
const DROP_FROM = 0.78;
/** How far the ring turns over the gathering, in radians. */
const SPIN = 1.1;
/** Cards on the ring are fanned this far off the tangent, like a spread deck. */
export const RING_FAN = 0.96;
const RING_TILT = 0.3;
/** One card's trip from the ring to the wall, in viewport heights of scrolling. */
const FLIGHT_TAKES = 0.2;
/** Share of the trip spent rising straight out of the slot. */
const RISE_SHARE = 0.26;
/** How far above its cell a landing card starts its final drop (in card heights). */
const APPROACH = 0.9;
/** The wall while it is filling: level rows, laid back this far, and this much smaller. */
const STAGE_LAY = 0.8;
const STAGE_SCALE = 0.72;
/** The finished wall: turned in its own plane, then laid back (as on premotio). */
const WALL_TURN = 0.41;
const WALL_LAY = 0.8;

export type Choreo = ReturnType<typeof createChoreo>;

export function createChoreo({ n, cols, mobile }: { n: number; cols: number; mobile: boolean }) {
  const rows = Math.ceil(n / cols);
  const rand = rng(7);
  const seeds = Array.from({ length: n }, () => ({
    rx: rand() * TAU,
    ry: rand() * TAU,
    rz: rand() * TAU,
    wx: (rand() - 0.5) * 1.2,
    wy: (rand() - 0.5) * 1.4,
    wz: (rand() - 0.5) * 0.9,
    fs: 0.8 + rand() * 0.5,
    ph: rand() * TAU,
    sg: rand(),
  }));

  let W = 1;
  let H = 1;
  let marks: Marks = { gather: [1, 2.6], unroll: [3, 4], settle: [3.95, 4.55], exit: [5.5, 6.3] };

  const tmpQ = new Quaternion();
  const tmpE = new Euler();
  const v = new Vector3();

  /* ------------------------------------------------------------ the air */

  // Card k leaves the air k-th (highest first) and drops into slot k.
  const air = Array.from({ length: n }, () => new Vector3());
  const airSize = new Float32Array(n);
  let airShort = 0; // how far the closest pair falls short of their room (0 when every card has its room)

  function placeAir() {
    const r = rng(31);
    const span = mobile ? { x: 1.2, y: 1.45, z0: -0.85, z1: 0.3 } : { x: 1.15, y: 1.35, z0: -0.67, z1: 0.33 };
    const placed: { c: Vector3; room: number; fs: number }[] = [];
    airShort = 0;
    for (let k = 0; k < n; k++) {
      const fs = seeds[k].fs;
      const size = H * (mobile ? 0.12 : 0.15) * fs;
      const room = size * HALF_DIAGONAL + AIR_ROOM;
      let best = new Vector3();
      let bestGap = -Infinity;
      for (let tries = 0; tries < 600; tries++) {
        const c = new Vector3((r() - 0.5) * W * span.x, (r() - 0.5) * H * span.y, H * (span.z0 + r() * (span.z1 - span.z0)));
        let gap = Infinity;
        for (const q of placed) gap = Math.min(gap, c.distanceTo(q.c) - q.room - room);
        if (gap > bestGap) {
          bestGap = gap;
          best = c;
        }
        if (gap > 0) break;
      }
      if (bestGap < 0) airShort = Math.max(airShort, -bestGap);
      placed.push({ c: best, room, fs });
    }
    // highest first, so that cards leaving upward never catch up with one another
    placed.sort((a, b) => b.c.y - a.c.y);
    placed.forEach((q, k) => {
      air[k].copy(q.c);
      airSize[k] = H * (mobile ? 0.12 : 0.15) * q.fs;
    });
  }

  const leaves = (k: number) => marks.gather[0] + (k / Math.max(1, n - 1)) * LEAVE_SPREAD;

  function airPose(k: number, p: number, out: Pose) {
    const s = seeds[k];
    const t0 = leaves(k);
    out.pos.copy(air[k]);
    const leaving = phase(p, t0, t0 + LEAVE_TAKES);
    out.pos.y += H * (RISE * p + LEAVE_HEIGHT * easeIn(leaving));
    out.quat.setFromEuler(tmpE.set(s.rx + p * s.wx, s.ry + p * s.wy, s.rz + p * s.wz));
    out.size = airSize[k];
    out.mode = FLOAT;
    // on its way out it may pass the first cards dropping into the ring
    out.layer = leaving > 0 ? LOOSE : SOLID;
  }

  /* ------------------------------------------------------------ the ring */

  const ring = {
    c: new Vector3(),
    R: 1,
    size: 1,
    tilt: new Quaternion().setFromEuler(new Euler(RING_TILT, 0, 0)),
    axis: new Vector3(),
    /** highest point of any card on the ring */
    top: 0,
    /** the back of the ring, where the cards leave from */
    back: new Vector3(),
  };

  function placeRing() {
    ring.R = mobile ? W * 0.36 : Math.min(H * 0.44, W * 0.27);
    ring.c.set(0, mobile ? H * 0.02 : -H * 0.17, 0);
    ring.size = H * (mobile ? 0.15 : 0.215);
    ring.axis.set(0, 1, 0).applyQuaternion(ring.tilt);
    ring.back.set(0, 0, -ring.R).applyQuaternion(ring.tilt).add(ring.c);
    let top = -Infinity;
    const p = newPose();
    for (let k = 0; k < 64; k++) {
      slot((k / 64) * n, 0, 0, p);
      for (const [cx, cy] of CORNERS) {
        v.set(cx * 0.375, cy * 0.5, 0).multiplyScalar(p.size).applyQuaternion(p.quat).add(p.pos);
        top = Math.max(top, v.y);
      }
    }
    ring.top = top;
  }

  const spin = (p: number) => SPIN * easeInOut(phase(p, marks.gather[0], marks.unroll[0]));

  /** A card on slot k (a fractional k is allowed), raised h along the ring's axis. */
  function slot(k: number, h: number, p: number, out: Pose) {
    const a = (k / n) * TAU + spin(p);
    out.pos.set(Math.sin(a) * ring.R, h, Math.cos(a) * ring.R).applyQuaternion(ring.tilt).add(ring.c);
    out.quat.copy(ring.tilt).multiply(tmpQ.setFromEuler(tmpE.set(0, a + RING_FAN, 0)));
    out.size = ring.size;
    out.mode = RING;
    out.layer = h > 1e-6 ? LOOSE : SOLID;
  }

  /** When card k starts to drop into the ring. */
  const drops = (k: number) => {
    const [g0, g1] = marks.gather;
    const first = g0 + LEAVE_TAKES + 0.04;
    return first + (k / Math.max(1, n - 1)) * (g1 - DROP_TAKES - first);
  };

  /* ------------------------------------------------------------ the wall */

  type Frame = { c: Vector3; q: Quaternion; scale: number };
  const stage: Frame = { c: new Vector3(), q: new Quaternion().setFromEuler(new Euler(-STAGE_LAY, 0, 0)), scale: mobile ? STAGE_SCALE * 0.7 : STAGE_SCALE };
  const final: Frame = {
    c: new Vector3(),
    q: new Quaternion().setFromEuler(new Euler(-WALL_LAY, 0, 0)).multiply(new Quaternion().setFromEuler(new Euler(0, 0, WALL_TURN))),
    scale: 1,
  };
  const frame: Frame = { c: new Vector3(), q: new Quaternion(), scale: 1 };
  const cell = { x: 1, y: 1, size: 1 };

  function placeWall() {
    cell.size = H * (mobile ? 0.2 : 0.28);
    cell.x = cell.size * 0.75 * 1.08;
    cell.y = cell.size * 1.1;
    if (mobile) final.c.set(0, H * 0.26, 0);
    else final.c.set(-W * 0.25, 0, 0);
    // While it fills, the wall's nearest row hangs just above the back of the ring and the rows
    // climb away from the viewer.
    const half = (cell.size * stage.scale) / 2;
    const nearest = v.set(0, ring.top + cell.size * 0.32 + half * Math.cos(STAGE_LAY), ring.back.z - half * Math.sin(STAGE_LAY));
    const toCentre = new Vector3(0, ((rows - 1) / 2) * cell.y * stage.scale, 0).applyQuaternion(stage.q);
    stage.c.copy(nearest).add(toCentre);
  }

  function frameAt(p: number) {
    const e = easeInOut(phase(p, ...marks.settle));
    frame.c.lerpVectors(stage.c, final.c, e);
    frame.q.slerpQuaternions(stage.q, final.q, e);
    frame.scale = stage.scale + (final.scale - stage.scale) * e;
  }

  const wallNormal = new Vector3();

  function cellPose(k: number, p: number, out: Pose) {
    const r = route[k];
    const settled = marks.settle[1];
    const drift = Math.max(-0.45, Math.min(0.45, (p - settled) * 0.35)) * cell.x;
    out.pos
      .set((r.col - (cols - 1) / 2) * cell.x + (p > settled ? drift : 0), ((rows - 1) / 2 - r.row) * cell.y, 0)
      .multiplyScalar(frame.scale)
      .applyQuaternion(frame.q)
      .add(frame.c);
    out.quat.copy(frame.q);
    out.size = cell.size * frame.scale;
    out.mode = WALL;
    out.layer = SOLID;
  }

  /* ---------------------------------------------------------- the routes */

  // The cards leave the ring back first, one side and then the other, and fill the wall one row after
  // another from the row nearest the ring. Within a row the cards keep their left-to-right order, so
  // the paths fan out without crossing.
  const route = Array.from({ length: n }, () => ({ order: 0, row: 0, col: 0 }));
  {
    const settledSpin = SPIN;
    const back = (((Math.round(((Math.PI - settledSpin) / TAU) * n) % n) + n) % n);
    const order = [back];
    for (let i = 1; order.length < n; i++) {
      order.push((back + i) % n);
      if (order.length < n) order.push((back - i + n) % n);
    }
    const xOf = (k: number) => Math.sin((k / n) * TAU + settledSpin);
    for (let g = 0; g * cols < n; g++) {
      const group = order.slice(g * cols, (g + 1) * cols);
      const sorted = [...group].sort((a, b) => xOf(a) - xOf(b));
      const pad = Math.floor((cols - group.length) / 2);
      sorted.forEach((k, i) => {
        route[k].row = rows - 1 - g;
        route[k].col = pad + i;
      });
      group.forEach((k, i) => (route[k].order = g * cols + i));
    }
  }

  /** Where in the story card k sets off from the ring. */
  const departs = (k: number) => {
    const [u0, u1] = marks.unroll;
    return u0 + (route[k].order / Math.max(1, n - 1)) * (u1 - FLIGHT_TAKES - u0);
  };

  const A = newPose();
  const B = newPose();
  const b1 = new Vector3();
  const b2 = new Vector3();

  function flightPose(k: number, s: number, p: number, out: Pose) {
    // quick off the mark, long and gentle into the cell
    const t = 1 - (1 - s) ** 4 * (1 + 4 * s);
    const climb = ring.size * 1.12; // the card's foot clears the ring's top before it leaves its slot
    if (t < RISE_SHARE) {
      slot(k, (climb * t) / RISE_SHARE, p, out);
      out.mode = RING;
      out.flight = 0;
      return;
    }
    const u = (t - RISE_SHARE) / (1 - RISE_SHARE);
    slot(k, climb, p, A);
    cellPose(k, p, B);
    wallNormal.set(0, 0, 1).applyQuaternion(frame.q);
    // a cubic Bézier that leaves the slot along the ring's axis at the same speed it rose, and ends
    // falling straight onto the cell along the wall's normal
    const lead = (climb * (1 - RISE_SHARE)) / (3 * RISE_SHARE);
    b1.copy(A.pos).addScaledVector(ring.axis, lead);
    b2.copy(B.pos).addScaledVector(wallNormal, APPROACH * B.size);
    const w0 = (1 - u) ** 3;
    const w1 = 3 * (1 - u) ** 2 * u;
    const w2 = 3 * (1 - u) * u * u;
    const w3 = u ** 3;
    out.pos
      .copy(A.pos)
      .multiplyScalar(w0)
      .addScaledVector(b1, w1)
      .addScaledVector(b2, w2)
      .addScaledVector(B.pos, w3);
    const turn = easeInOut(phase(u, 0.18, 0.75));
    out.quat.slerpQuaternions(A.quat, B.quat, turn);
    out.size = A.size + (B.size - A.size) * turn;
    out.mode = FLIGHT;
    out.layer = LOOSE;
    out.flight = u;
  }

  /* ----------------------------------------------------------- the pose */

  function pose(k: number, p: number, out: Pose) {
    out.alpha = 1;
    out.landed = 0;
    out.flight = 0;
    frameAt(p);
    const left = leaves(k) + LEAVE_TAKES;
    const sets = departs(k);
    if (p < left) {
      airPose(k, p, out);
    } else if (p < sets) {
      const d = drops(k);
      slot(k, H * DROP_FROM * (1 - easeInOut(phase(p, d, d + DROP_TAKES))), p, out);
    } else if (p < sets + FLIGHT_TAKES) {
      flightPose(k, (p - sets) / FLIGHT_TAKES, p, out);
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
  function freeAxis(k: number, p: number, mode: number, out: Vector3) {
    if (mode === RING) return out.copy(ring.axis);
    if (mode === WALL) {
      frameAt(p);
      return out.set(0, 0, 1).applyQuaternion(frame.q);
    }
    return out.set(0, 0, 0);
  }

  function layout(viewW: number, viewH: number) {
    W = viewW;
    H = viewH;
    placeAir();
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
    },
    get marks() {
      return marks;
    },
    pose,
    freeAxis,
    /** The wall cell (row, column) card k ends up on. */
    cellOf: (k: number) => ({ row: route[k].row, col: route[k].col }),
    /** How far the closest pair of cards in the air falls short of the room they need (0 is good). */
    get airShort() {
      return airShort;
    },
    debug: { ring, stage, final, cell, departs, drops, leaves },
  };
}

const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
