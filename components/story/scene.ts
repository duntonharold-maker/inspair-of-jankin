/**
 * The cards behind the story: they tumble in the air in the hero, gather into a turning ring,
 * unroll into a tilted wall on the left half, then leave. Everything is driven by the story
 * progress (in viewport heights).
 */
import {
  Euler,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type Texture,
} from "three";
import { cardTexture, type CardTexture } from "./textures";
import type { Item } from "@/lib/types";

export type SceneMarks = {
  gather: [number, number];
  unroll: [number, number];
  exit: [number, number];
};

export type StoryScene = {
  setProgress(p: number): void;
  setMarks(m: SceneMarks): void;
  /** The card under the pointer, if any. */
  pick(clientX: number, clientY: number): { id: string; index: number } | null;
  /** Lift one card (index from `pick`), or none with -1. */
  setHover(index: number): void;
  resize(): void;
  dispose(): void;
};

/* --------------------------------------------------------------- shaders */

const vertex = /* glsl */ `
uniform float uBend;
uniform float uWave;
uniform float uPhase;
uniform float uTime;
varying vec2 vUv;
varying float vShade;
void main() {
  vUv = uv;
  vec3 p = position;
  float x = p.x / 0.375;                      // -1 … 1 across the card
  p.z += uBend * (x * x - 0.4) * 0.16;        // curl like a sheet of paper
  p.z += uWave * sin(x * 2.4 + uTime * 1.7 + uPhase) * 0.05;
  vShade = 1.0 - 0.22 * clamp(abs(uBend), 0.0, 1.5) * abs(x);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const fragment = /* glsl */ `
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uAlpha;
uniform vec4 uClip;
uniform vec3 uPaper;
uniform vec3 uTint;
varying vec2 vUv;
varying float vShade;

float roundedBox(vec2 uv) {
  vec2 half_ = vec2(0.375, 0.5);
  vec2 q = abs((uv - 0.5) * vec2(0.75, 1.0)) - (half_ - 0.03);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.03;
}

void main() {
  if (gl_FragCoord.x < uClip.x || gl_FragCoord.y < uClip.y || gl_FragCoord.x > uClip.z || gl_FragCoord.y > uClip.w) discard;
  float d = roundedBox(vUv);
  float aa = fwidth(d);
  float shape = 1.0 - smoothstep(-aa, aa, d);
  if (shape <= 0.0) discard;

  vec3 colour = uPaper;
  if (uHasMap > 0.5) {
    // the back of a card shows its picture mirrored, like a print seen through thin paper
    vec2 uv = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);
    colour = texture2D(uMap, uv).rgb;
  }
#ifdef GHOST
  colour *= uTint;
#else
  if (!gl_FrontFacing) colour = mix(colour, uPaper, 0.18);
  colour *= vShade;
#endif
  gl_FragColor = vec4(colour, shape * uAlpha);
  #include <colorspace_fragment>
}`;

const SHADOW_SCALE = 1.18;

/** A soft shadow under each card on the wall, so white cards still read against the page. */
const shadowVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const shadowFragment = /* glsl */ `
uniform float uAlpha;
uniform vec4 uClip;
varying vec2 vUv;
float roundedBox(vec2 uv) {
  vec2 q = abs((uv - 0.5) * vec2(0.75, 1.0) * ${SHADOW_SCALE.toFixed(2)}) - (vec2(0.375, 0.5) - 0.03);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.03;
}
void main() {
  if (gl_FragCoord.x < uClip.x || gl_FragCoord.y < uClip.y || gl_FragCoord.x > uClip.z || gl_FragCoord.y > uClip.w) discard;
  float a = (1.0 - smoothstep(-0.02, 0.075, roundedBox(vUv))) * uAlpha;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(0.05, 0.05, 0.08, a);
}`;

/* ----------------------------------------------------------------- maths */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeInOut = (x: number) => {
  x = clamp01(x);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const phase = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const stagger = (t: number, s: number, spread = 0.45) => easeInOut((t - s * spread) / (1 - spread));

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spectrum from red through green to blue, softened toward white. */
function spectrum(t: number): [number, number, number] {
  const c = [0, 4, 2].map((o) => clamp01(Math.abs(((t * 4 + o) % 6) - 3) - 1));
  return [c[0] * 0.8 + 0.2, c[1] * 0.8 + 0.2, c[2] * 0.8 + 0.2];
}

const GHOSTS = 6;
const RING_FAN = 0.96; // radians off the tangent

type Card = {
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  ghosts: Mesh<PlaneGeometry, ShaderMaterial>[];
  shadow: Mesh<PlaneGeometry, ShaderMaterial>;
  item: Item;
  s: Record<"fx" | "fy" | "fz" | "rx" | "ry" | "rz" | "wx" | "wy" | "wz" | "fs" | "ph" | "sg" | "su", number>;
  prev: Vector3;
  vel: Vector3;
  fresh: boolean;
  off: Vector2;
  offVel: Vector2;
  alpha: number;
  hover: number;
};

/* ----------------------------------------------------------------- scene */

export function createStoryScene(canvas: HTMLCanvasElement, items: Item[]): StoryScene {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  // Wide lens for the cards in the air, long lens for the wall. Moving the camera back as the lens
  // narrows keeps everything at z = 0 the same size; only the perspective flattens.
  const WIDE = 30;
  const LONG = 7;
  const BASE_Z = 14;
  const camera = new PerspectiveCamera(WIDE, 1, 0.1, 200);
  camera.position.set(0, 0, BASE_Z);
  let lens = 0;
  const setLens = (l: number) => {
    if (Math.abs(l - lens) < 1e-4) return;
    lens = l;
    const fov = WIDE + (LONG - WIDE) * l;
    camera.fov = fov;
    camera.position.z = (viewH / 2) / Math.tan((fov * Math.PI) / 360);
    camera.updateProjectionMatrix();
  };

  const mobile = window.matchMedia("(max-width: 760px)").matches;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // enough cards for the wall to cover half the screen at any aspect from 4:3 to 2:1
  const N = mobile ? 42 : 64;
  const COLS = mobile ? 7 : 8;
  const geometry = new PlaneGeometry(0.75, 1, 24, 1);

  const shared = {
    uTime: { value: 0 },
    uClip: { value: new Vector4(0, 0, 1e5, 1e5) },
    uPaper: { value: new Vector3(0.97, 0.965, 0.955) },
  };

  const material = (ghost: boolean) =>
    new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      defines: ghost ? { GHOST: "" } : {},
      transparent: true,
      depthWrite: !ghost,
      depthTest: !ghost,
      side: 2, // DoubleSide
      uniforms: {
        ...shared,
        uMap: { value: null as Texture | null },
        uHasMap: { value: 0 },
        uAlpha: { value: 1 },
        uBend: { value: 0 },
        uWave: { value: 0 },
        uPhase: { value: 0 },
        uTint: { value: new Vector3(1, 1, 1) },
      },
    });

  // Featured first, then newest; repeat to fill every card.
  const pool = [...items.filter((i) => i.featured), ...items.filter((i) => !i.featured)];
  const rand = rng(7);
  const cards: Card[] = [];
  for (let k = 0; k < N; k++) {
    const item = pool[(k * 5) % Math.max(1, pool.length)];
    const mesh = new Mesh(geometry, material(false));
    mesh.renderOrder = 1;
    const ghosts = Array.from({ length: GHOSTS }, (_, g) => {
      const m = new Mesh(geometry, material(true));
      m.renderOrder = 2;
      const [r, gg, b] = spectrum(g / (GHOSTS - 1));
      m.material.uniforms.uTint.value.set(r, gg, b);
      m.visible = false;
      scene.add(m);
      return m;
    });
    scene.add(mesh);
    const shadow = new Mesh(
      geometry,
      new ShaderMaterial({
        vertexShader: shadowVertex,
        fragmentShader: shadowFragment,
        transparent: true,
        depthWrite: false,
        uniforms: { uAlpha: { value: 0 }, uClip: shared.uClip },
      }),
    );
    shadow.renderOrder = 0;
    shadow.visible = false;
    scene.add(shadow);
    const r = () => rand();
    const s = {
      fx: r(), fy: r(), fz: r(),
      rx: r() * 6.28, ry: r() * 6.28, rz: r() * 6.28,
      wx: (r() - 0.5) * 0.5, wy: (r() - 0.5) * 0.6, wz: (r() - 0.5) * 0.4,
      fs: 0.8 + r() * 0.5, ph: r() * 6.28, sg: r(), su: 0,
    };
    // the wall unrolls column by column, with a little noise
    s.su = clamp01(((k % COLS) / (COLS - 1)) * 0.8 + r() * 0.2);
    mesh.material.uniforms.uPhase.value = s.ph;
    cards.push({ mesh, ghosts, shadow, item, s, prev: new Vector3(), vel: new Vector3(), fresh: true, off: new Vector2(), offVel: new Vector2(), alpha: 0, hover: 0 });
  }

  // Textures: one per distinct item, shared by every card that shows it.
  const textures = new Map<string, CardTexture>();
  let disposed = false;
  (async () => {
    const distinct = [...new Set(cards.map((c) => c.item))];
    for (const item of distinct) {
      if (disposed) return;
      try {
        const t = await cardTexture(item, renderer);
        if (disposed) return t.dispose();
        textures.set(item.id, t);
        for (const c of cards.filter((c) => c.item === item)) {
          for (const m of [c.mesh, ...c.ghosts]) {
            m.material.uniforms.uMap.value = t.texture;
            m.material.uniforms.uHasMap.value = 1;
          }
        }
      } catch {
        /* that card stays blank paper */
      }
    }
  })();

  /* ---------------------------------------------------------- layout */

  let marks: SceneMarks = { gather: [0.6, 2.2], unroll: [2.9, 4.2], exit: [5, 5.8] };
  let progress = 0;
  let hovered = -1;
  let viewW = 1;
  let viewH = 1;
  let pxW = 1;
  let pxH = 1;

  const pointer = { x: 0, y: 0, vx: 0, vy: 0, inside: false };
  const tmpQ2 = new Quaternion();
  const tmpE = new Euler();
  const qTilt = new Quaternion().setFromEuler(new Euler(0.3, 0, 0));
  // Turned 23° in its own plane, then laid back 46°: on screen the rows rise ~17° and the
  // columns fall ~60°, as on premotio's wall.
  const qWall = new Quaternion().setFromEuler(new Euler(-0.8, 0, 0)).multiply(new Quaternion().setFromEuler(new Euler(0, 0, 0.41)));
  const v = new Vector3();
  const proj = new Vector3();

  function floatPose(c: Card, t: number, out: { p: Vector3; q: Quaternion; s: number }) {
    const { s } = c;
    const y = (((s.fy + t * 0.012) % 1) - 0.5) * viewH * 1.35;
    out.p.set(
      (s.fx - 0.5) * viewW * 1.15 + Math.sin(t * 0.11 + s.ph) * viewW * 0.02,
      y + Math.cos(t * 0.09 + s.ph * 1.3) * viewH * 0.03,
      -5 + s.fz * 7.5,
    );
    out.q.setFromEuler(tmpE.set(s.rx + t * s.wx, s.ry + t * s.wy, s.rz + t * s.wz));
    out.s = viewH * 0.15 * s.fs;
  }

  function ringPose(k: number, t: number, p: number, out: { p: Vector3; q: Quaternion; s: number }) {
    const a = (k / N) * Math.PI * 2 + t * 0.16 + p * 0.8;
    const R = mobile ? viewW * 0.36 : Math.min(viewH * 0.5, viewW * 0.27);
    out.p.set(Math.sin(a) * R, 0, Math.cos(a) * R).applyQuaternion(qTilt);
    out.p.y += mobile ? viewH * 0.06 : -viewH * 0.04;
    // Cards fanned 55° off the tangent, like a spread deck. Tangent cards wider than their spacing
    // would cut through their neighbours; past ~30° the sheets only overlap, never intersect.
    out.q.copy(qTilt).multiply(tmpQ2.setFromEuler(tmpE.set(0, a + RING_FAN, 0)));
    out.s = viewH * (mobile ? 0.15 : 0.215);
  }

  function wallPose(k: number, p: number, out: { p: Vector3; q: Quaternion; s: number }) {
    const rows = Math.ceil(N / COLS);
    const size = viewH * (mobile ? 0.2 : 0.28);
    const cellX = size * 0.75 * 1.08;
    const cellY = size * 1.1;
    const c = k % COLS;
    const r = Math.floor(k / COLS);
    const drift = Math.max(-0.45, Math.min(0.45, (p - marks.unroll[1]) * 0.35)) * cellX;
    out.p.set((c - (COLS - 1) / 2) * cellX + drift, ((rows - 1) / 2 - r) * cellY, 0).applyQuaternion(qWall);
    if (mobile) out.p.add(v.set(0, viewH * 0.26, 0));
    else out.p.add(v.set(-viewW * 0.25, 0, 0));
    out.q.copy(qWall);
    out.s = size;
  }

  const A = { p: new Vector3(), q: new Quaternion(), s: 1 };
  const B = { p: new Vector3(), q: new Quaternion(), s: 1 };

  /* ----------------------------------------------------------- frame */

  let last = performance.now();
  let raf = 0;
  let wasVisible = true;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const elapsed = Math.min(0.5, Math.max(1e-3, (now - last) / 1000));
    const dt = Math.min(0.05, elapsed);
    last = now;
    const t = still ? 0 : now / 1000;
    shared.uTime.value = t;
    const p = progress;

    const g = phase(p, ...marks.gather);
    const u = phase(p, ...marks.unroll);
    const x = phase(p, ...marks.exit);

    const anyVisible = x < 1;
    if (!anyVisible) {
      if (wasVisible) {
        renderer.clear();
        wasVisible = false;
      }
      return;
    }
    wasVisible = true;

    setLens(easeInOut(phase(p, marks.unroll[0] + (marks.unroll[1] - marks.unroll[0]) * 0.25, marks.unroll[1])));

    // clip the settled wall to the left half (or the top on phones)
    const settle = easeInOut(phase(p, marks.unroll[0] + (marks.unroll[1] - marks.unroll[0]) * 0.55, marks.unroll[1]));
    const clipOn = settle > 0 ? settle : 0;
    if (mobile) shared.uClip.value.set(0, pxH * 0.5 * clipOn, 1e5, 1e5);
    else shared.uClip.value.set(0, 0, pxW - (pxW * 0.5) * clipOn, 1e5);

    const stir = u < 0.5;
    for (let k = 0; k < N; k++) {
      const c = cards[k];
      let alpha = 1;
      let wave = 0;
      let landed = 0;
      {
        const gk = stagger(g, c.s.sg);
        floatPose(c, t, A);
        if (gk > 0) {
          ringPose(k, t, p, B);
          A.p.lerp(B.p, gk);
          A.p.z += Math.sin(gk * Math.PI) * 2.2;
          A.q.slerp(B.q, gk);
          A.s += (B.s - A.s) * gk;
        }
        const uk = stagger(u, c.s.su, 0.5);
        if (uk > 0) {
          wallPose(k, p, B);
          A.p.lerp(B.p, uk);
          A.p.z += Math.sin(uk * Math.PI) * 1.6;
          A.q.slerp(B.q, uk);
          A.s += (B.s - A.s) * uk;
        }
        landed = uk * uk;
        const xk = stagger(x, c.s.sg, 0.3);
        if (xk > 0) {
          A.p.y += viewH * 1.3 * xk;
          A.p.z -= 3 * xk;
          alpha = 1 - xk;
        }
        wave = (1 - gk) * 0.5 + gk * (1 - uk) * 0.18;
      }

      // pointer stir: a spring that the cursor's motion kicks
      if (stir && pointer.inside) {
        proj.copy(A.p).project(camera);
        const dx = (proj.x - pointer.x) * (pxW / pxH);
        const dy = proj.y - pointer.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.35) {
          const f = (1 - dist / 0.35) * 18;
          c.offVel.x += pointer.vx * f * dt;
          c.offVel.y += pointer.vy * f * dt;
        }
      }
      c.offVel.multiplyScalar(Math.exp(-dt * 3.2)).addScaledVector(c.off, -dt * 9);
      c.off.addScaledVector(c.offVel, dt);
      A.p.x += c.off.x * viewW * 0.5;
      A.p.y += c.off.y * viewH * 0.5;

      // hover: the card under the pointer rises toward the viewer and grows a little
      c.hover += ((k === hovered ? 1 : 0) - c.hover) * (1 - Math.exp(-dt / 0.09));
      if (c.hover > 0.001) {
        A.p.add(v.set(0, 0, 0.12 * A.s * c.hover).applyQuaternion(A.q));
        A.s *= 1 + 0.06 * c.hover;
      }

      c.mesh.position.copy(A.p);
      c.mesh.quaternion.copy(A.q);
      c.mesh.scale.setScalar(A.s);

      // shadow: a little below and behind the card, light from the upper right
      c.shadow.visible = landed > 0.01 && alpha > 0.01;
      if (c.shadow.visible) {
        const lift = 1 + c.hover * 1.6;
        c.shadow.position.copy(A.p).add(v.set(-0.02 * A.s * lift, -0.045 * A.s * lift, -0.03 * A.s - 0.12 * A.s * c.hover).applyQuaternion(A.q));
        c.shadow.quaternion.copy(A.q);
        c.shadow.scale.setScalar(A.s * (SHADOW_SCALE + 0.05 * c.hover));
        c.shadow.material.uniforms.uAlpha.value = (0.2 + 0.08 * c.hover) * landed * alpha;
      }
      c.mesh.visible = alpha > 0.002;
      c.alpha = alpha;

      // velocity in world units per second, smoothed over ~80 ms so slow frames don't exaggerate it
      if (c.fresh || alpha < 0.01) {
        c.prev.copy(A.p);
        c.vel.set(0, 0, 0);
        c.fresh = false;
      }
      v.copy(A.p).sub(c.prev).divideScalar(elapsed);
      c.vel.lerp(v, 1 - Math.exp(-elapsed / 0.08));
      c.prev.copy(A.p);
      const speed = c.vel.length();

      const u0 = c.mesh.material.uniforms;
      u0.uAlpha.value = alpha;
      u0.uBend.value = Math.min(1.2, speed / (viewH * 2.2)) + 0.12;
      u0.uWave.value = wave;

      // ghosts: spectral copies trailing along the motion
      const boost = 1 + (1 - g) * 1.6;
      const trail = Math.min(viewH * 0.16, speed * 0.028 * boost);
      const dir = v.copy(c.vel).normalize();
      const strength = clamp01((trail - viewH * 0.004) / (viewH * 0.05));
      for (let gi = 0; gi < GHOSTS; gi++) {
        const m = c.ghosts[gi];
        if (strength < 0.04 || !c.mesh.visible) {
          m.visible = false;
          continue;
        }
        const f = (gi + 1) / GHOSTS;
        m.visible = true;
        m.position.copy(A.p).addScaledVector(dir, -trail * f);
        m.quaternion.copy(A.q);
        m.scale.setScalar(A.s * (1 + f * 0.04));
        const gu = m.material.uniforms;
        gu.uAlpha.value = alpha * strength * 0.2 * (1 - f * 0.8);
        gu.uBend.value = u0.uBend.value;
        gu.uWave.value = u0.uWave.value;
        gu.uPhase.value = u0.uPhase.value;
      }
    }

    pointer.vx *= 0.8;
    pointer.vy *= 0.8;
    for (const tex of textures.values()) tex.tick?.();
    renderer.render(scene, camera);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    viewH = 2 * Math.tan((WIDE * Math.PI) / 360) * BASE_Z;
    viewW = viewH * camera.aspect;
    const l = lens;
    lens = -1;
    setLens(l);
    pxW = w * dpr;
    pxH = h * dpr;
  }

  const onMove = (e: PointerEvent) => {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -(e.clientY / window.innerHeight) * 2 + 1;
    if (pointer.inside) {
      pointer.vx = pointer.vx * 0.5 + (nx - pointer.x) * 30;
      pointer.vy = pointer.vy * 0.5 + (ny - pointer.y) * 30;
    }
    pointer.x = nx;
    pointer.y = ny;
    pointer.inside = true;
  };
  const onLeave = () => (pointer.inside = false);

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerleave", onLeave);
  raf = requestAnimationFrame(frame);

  const raycaster = new Raycaster();
  const ndc = new Vector2();

  return {
    setProgress(p) {
      progress = p;
    },
    setMarks(m) {
      marks = m;
    },
    pick(clientX, clientY) {
      ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
      const clip = shared.uClip.value;
      const dpr = renderer.getPixelRatio();
      const fx = clientX * dpr;
      const fy = (window.innerHeight - clientY) * dpr;
      if (fx < clip.x || fy < clip.y || fx > clip.z || fy > clip.w) return null;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(
        cards.filter((c) => c.mesh.visible && c.alpha > 0.6).map((c) => c.mesh),
        false,
      );
      const hit = hits[0]?.object;
      const index = hit ? cards.findIndex((c) => c.mesh === hit) : -1;
      return index >= 0 ? { id: cards[index].item.id, index } : null;
    },
    setHover(index) {
      hovered = index;
    },
    resize,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      for (const t of textures.values()) t.dispose();
      for (const c of cards) {
        c.mesh.material.dispose();
        c.shadow.material.dispose();
        for (const g of c.ghosts) g.material.dispose();
      }
      geometry.dispose();
      renderer.dispose();
    },
  };
}
