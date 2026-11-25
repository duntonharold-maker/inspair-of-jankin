/**
 * The cards behind the story: they drift in the air on the first screen, drop into a ring, leave it
 * counterclockwise for a tilted wall at the upper left, then go. Where each card is comes from
 * `choreo.ts`; this file draws them, each through its own lens, and adds the pointer's stir, hover and
 * the motion trails.
 */
import {
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type Texture,
} from "three";
import { cardTexture, type CardTexture } from "./textures";
import { createRays } from "./rays";
import {
  FLIGHT,
  FLOAT,
  LONG_FOV,
  LOOSE,
  RING,
  SOLID,
  WALL,
  clamp01,
  createChoreo,
  distanceFor,
  easeInOut,
  newPose,
  phase,
  rng,
  toShared,
  type Marks,
} from "./choreo";
import type { Item } from "@/lib/types";

export type SceneMarks = Marks;

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

/**
 * Every card is seen through its own lens (uLens: how far its camera stands from z = 0) and drawn
 * uDepth further back; the shared camera stands uBase away. Same sum as `toShared` in choreo.ts.
 */
const lensChunk = /* glsl */ `
uniform float uLens;
uniform float uDepth;
uniform float uBase;
vec4 throughLens(vec3 local) {
  vec4 w = modelMatrix * vec4(local, 1.0);
  float za = w.z - uDepth;
  float s = uLens * (uBase - za) / (uBase * max(uLens - w.z, 0.05));
  return projectionMatrix * viewMatrix * vec4(w.xy * s, za, 1.0);
}`;

const vertex = /* glsl */ `
uniform float uBend;
uniform float uWave;
uniform float uPhase;
varying vec2 vUv;
varying float vShade;
${lensChunk}
void main() {
  vUv = uv;
  vec3 p = position;
  float x = p.x / 0.375;                      // -1 … 1 across the card
  p.z += uBend * (x * x - 0.4) * 0.16;        // curl like a sheet of paper
  p.z += uWave * sin(x * 2.4 + uPhase) * 0.05;
  vShade = 1.0 - 0.22 * clamp(abs(uBend), 0.0, 1.5) * abs(x);
  gl_Position = throughLens(p);
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
${lensChunk}
void main() {
  vUv = uv;
  gl_Position = throughLens(position);
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
  gl_FragColor = vec4(0.008, 0.027, 0.039, a); // 午夜冷黑
}`;

/** Trail tint from 珊瑚橘 (nearest the card) to 电光蓝 (the far end), softened toward white. */
const CORAL: [number, number, number] = [0.988, 0.451, 0.302];
const BLUE: [number, number, number] = [0.008, 0.592, 0.871];
function trailTint(t: number): [number, number, number] {
  return [0, 1, 2].map((i) => 0.3 + 0.7 * (CORAL[i] + (BLUE[i] - CORAL[i]) * t)) as [number, number, number];
}

const GHOSTS = 6;
/** How far the pointer may push a card in the air. */
const STIR_MOST = 0.25;

type Card = {
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  ghosts: Mesh<PlaneGeometry, ShaderMaterial>[];
  shadow: Mesh<PlaneGeometry, ShaderMaterial>;
  item: Item;
  ph: number;
  prev: Vector3;
  vel: Vector3;
  fresh: boolean;
  off: Vector2;
  offVel: Vector2;
  alpha: number;
  hover: number;
  /** where the card is before the hover lifts it: what the pointer is tested against */
  rest: Vector3;
  restSize: number;
  lens: number;
  depth: number;
  /** its depth as drawn, for ordering the moving cards */
  drawnZ: number;
  loose: boolean;
};

/* ----------------------------------------------------------------- scene */

export function createStoryScene(canvas: HTMLCanvasElement, items: Item[]): StoryScene {
  // The scene is drawn into a picture (with its own antialiasing) and then through the rays onto the canvas.
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  // One shared camera with the long lens; each card brings its own lens through its shader.
  const camera = new PerspectiveCamera(LONG_FOV, 1, 0.5, 400);

  const mobile = window.matchMedia("(max-width: 760px)").matches;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // enough cards for the wall to cover half the screen at any aspect from 4:3 to 2:1
  const N = mobile ? 42 : 64;
  const COLS = mobile ? 7 : 8;
  const choreo = createChoreo({ n: N, cols: COLS, mobile });
  const rays = createRays(renderer, { mobile });
  const geometry = new PlaneGeometry(0.75, 1, 24, 1);

  const shared = {
    uClip: { value: new Vector4(0, 0, 1e5, 1e5) },
    uPaper: { value: new Vector3(0.957, 0.969, 0.976) },
    uBase: { value: 60 },
  };
  const lensUniforms = () => ({ uLens: { value: 14 }, uDepth: { value: 0 } });

  const material = (ghost: boolean) =>
    new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      defines: ghost ? { GHOST: "" } : {},
      transparent: true,
      depthWrite: !ghost,
      side: 2, // DoubleSide
      uniforms: {
        ...shared,
        ...lensUniforms(),
        uMap: { value: null as Texture | null },
        uHasMap: { value: 0 },
        uAlpha: { value: 1 },
        uBend: { value: 0 },
        uWave: { value: 0 },
        uPhase: { value: 0 },
        uTint: { value: new Vector3(1, 1, 1) },
      },
    });

  // Featured first, then newest. Pictures follow the card's cell on the wall, so neighbours differ.
  const pool = [...items.filter((i) => i.featured), ...items.filter((i) => !i.featured)];
  const rand = rng(11);
  const cards: Card[] = [];
  for (let k = 0; k < N; k++) {
    const { row, col } = choreo.cellOf(k);
    const item = pool[((row * COLS + col) * 5) % Math.max(1, pool.length)];
    const mesh = new Mesh(geometry, material(false));
    mesh.renderOrder = 1;
    mesh.frustumCulled = false; // its lens moves it on screen, so three cannot tell where it is
    const ghosts = Array.from({ length: GHOSTS }, (_, g) => {
      const m = new Mesh(geometry, material(true));
      m.renderOrder = 1000;
      m.frustumCulled = false;
      const [r, gg, b] = trailTint(g / (GHOSTS - 1));
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
        uniforms: { uAlpha: { value: 0 }, uClip: shared.uClip, uBase: shared.uBase, ...lensUniforms() },
      }),
    );
    shadow.renderOrder = 0;
    shadow.visible = false;
    shadow.frustumCulled = false;
    scene.add(shadow);
    cards.push({
      mesh,
      ghosts,
      shadow,
      item,
      ph: rand() * Math.PI * 2,
      prev: new Vector3(),
      vel: new Vector3(),
      fresh: true,
      off: new Vector2(),
      offVel: new Vector2(),
      alpha: 0,
      hover: 0,
      rest: new Vector3(),
      restSize: 1,
      lens: 14,
      depth: 0,
      drawnZ: 0,
      loose: false,
    });
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

  /* ----------------------------------------------------------- frame */

  let progress = 0;
  let hovered = -1;
  let viewW = 1;
  let viewH = 1;
  let pxW = 1;
  let pxH = 1;
  let base = 60;
  // the drift's own clock: it runs on the first screen and stops as the page scrolls into the ring
  let clock = 0;

  const pointer = { x: 0, y: 0, vx: 0, vy: 0, inside: false };
  const P = newPose();
  const v = new Vector3();
  const axis = new Vector3();
  const onScreen = new Vector3();

  /** Where a point of a card (seen through its lens) shows on screen, in normalised device coordinates. */
  const screenOf = (point: Vector3, lens: number, depth: number, out: Vector3) =>
    toShared(point.x, point.y, point.z, lens, depth, base, out).project(camera);

  let last = performance.now();
  let raf = 0;
  let wasVisible = true;
  const loose: Card[] = [];
  let lastP = 0;
  let rush = 0;
  const raysAt = { centre: new Vector2(), ring: new Vector2(), prism: 0, edges: 1, rush: 0 };

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const elapsed = Math.min(0.5, Math.max(1e-3, (now - last) / 1000));
    const dt = Math.min(0.05, elapsed);
    last = now;
    const p = progress;
    const marks = choreo.marks;

    if (phase(p, ...marks.exit) >= 1) {
      if (wasVisible) {
        renderer.setRenderTarget(null);
        renderer.clear();
        wasVisible = false;
      }
      return;
    }
    wasVisible = true;

    const drifting = still ? 0 : 1 - phase(p, marks.gather[0] - 0.35, marks.gather[0]);
    clock += dt * drifting;

    // the wall settles: the picture is cut to the left half (top on phones)
    const settle = easeInOut(phase(p, ...marks.settle));
    if (mobile) shared.uClip.value.set(0, pxH * 0.5 * settle, 1e5, 1e5);
    else shared.uClip.value.set(0, 0, pxW - pxW * 0.5 * settle, 1e5);

    const restingRing = p < marks.unroll[0];
    const gathered = phase(p, ...marks.gather);
    loose.length = 0;
    for (let k = 0; k < N; k++) {
      const c = cards[k];
      choreo.pose(k, p, P, clock);

      // The pointer's stir, a spring the cursor's motion kicks: cards in the air are pushed across the
      // screen, cards on the ring only up or down their slot.
      const air = P.mode === FLOAT && p < marks.gather[0];
      const onRing = P.mode === RING && P.layer === SOLID && restingRing;
      if ((air || onRing) && pointer.inside && !still) {
        screenOf(P.pos, P.lens, P.depth, onScreen);
        const dx = (onScreen.x - pointer.x) * (pxW / pxH);
        const dy = onScreen.y - pointer.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.35) {
          const f = (1 - dist / 0.35) * 18;
          c.offVel.x += pointer.vx * f * dt;
          c.offVel.y += pointer.vy * f * dt;
        }
      }
      c.offVel.multiplyScalar(Math.exp(-dt * 3.2)).addScaledVector(c.off, -dt * 9);
      c.off.addScaledVector(c.offVel, dt);
      if (air) {
        v.set(c.off.x * viewW * 0.5, c.off.y * viewH * 0.5, 0);
        if (v.length() > STIR_MOST) v.setLength(STIR_MOST);
        P.pos.add(v);
      } else if (onRing) {
        choreo.freeAxis(RING, P.quat, axis);
        P.pos.addScaledVector(axis, Math.max(-0.4, Math.min(0.4, c.off.y * viewH * 0.5)));
      }

      // Hover: the card under the pointer rises toward the viewer. On the ring it rises along its slot;
      // in the air and on the wall it lifts off its own face (on the wall it grows into the gap).
      c.rest.copy(P.pos);
      c.restSize = P.size;
      const canHover = air || onRing || P.mode === WALL;
      c.hover += ((k === hovered && canHover ? 1 : 0) - c.hover) * (1 - Math.exp(-dt / 0.09));
      if (c.hover > 0.001) {
        choreo.freeAxis(P.mode, P.quat, axis);
        P.pos.addScaledVector(axis, 0.12 * P.size * c.hover);
        if (P.mode !== RING) P.size *= 1 + 0.06 * c.hover;
      }

      c.mesh.position.copy(P.pos);
      c.mesh.quaternion.copy(P.quat);
      c.mesh.scale.setScalar(P.size);
      c.lens = P.lens;
      c.depth = P.depth;
      c.drawnZ = P.pos.z - P.depth;
      const u0 = c.mesh.material.uniforms;
      u0.uLens.value = P.lens;
      u0.uDepth.value = P.depth;
      // cards at rest share the depth buffer; moving ones are drawn after them, farthest first
      c.loose = P.layer === LOOSE;
      c.mesh.material.depthWrite = !c.loose;
      if (c.loose) loose.push(c);
      else c.mesh.renderOrder = 1;

      // shadow: a little below and behind the card, light from the upper right
      const alpha = P.alpha;
      c.shadow.visible = P.landed > 0.01 && alpha > 0.01;
      if (c.shadow.visible) {
        const lift = 1 + c.hover * 1.6;
        c.shadow.position.copy(P.pos).add(v.set(-0.02 * P.size * lift, -0.045 * P.size * lift, -0.03 * P.size - 0.12 * P.size * c.hover).applyQuaternion(P.quat));
        c.shadow.quaternion.copy(P.quat);
        c.shadow.scale.setScalar(P.size * (SHADOW_SCALE + 0.05 * c.hover));
        const su = c.shadow.material.uniforms;
        su.uAlpha.value = (0.2 + 0.08 * c.hover) * P.landed * alpha;
        su.uLens.value = P.lens;
        su.uDepth.value = P.depth;
      }
      c.mesh.visible = alpha > 0.002;
      c.alpha = alpha;

      // velocity in world units per second, smoothed over ~80 ms so slow frames don't exaggerate it
      if (c.fresh || alpha < 0.01) {
        c.prev.copy(P.pos);
        c.vel.set(0, 0, 0);
        c.fresh = false;
      }
      v.copy(P.pos).sub(c.prev).divideScalar(elapsed);
      c.vel.lerp(v, 1 - Math.exp(-elapsed / 0.08));
      c.prev.copy(P.pos);
      const speed = c.vel.length();

      // Paper curl from speed, only where it cannot reach a neighbour: in the air, and in flight once
      // clear of the ring. Cards on the ring stay flat; cards on the wall keep a slight curl.
      const inAir = P.mode === FLOAT;
      const curl = Math.min(1.2, speed / (viewH * 2.2));
      u0.uAlpha.value = alpha;
      u0.uBend.value = inAir ? 0.12 + Math.min(0.35, curl) : P.mode === FLIGHT && P.flight > 0.12 ? curl : P.mode === WALL ? 0.12 : 0;
      u0.uWave.value = inAir ? 0.5 : 0;
      u0.uPhase.value = c.ph + clock * 1.7 + p * 2.4;

      // ghosts: spectral copies trailing along the motion
      const boost = 1 + (1 - gathered) * 1.6;
      const trail = Math.min(viewH * 0.16, speed * 0.028 * boost);
      const dir = v.copy(c.vel).normalize();
      const strength = still || !c.loose ? 0 : clamp01((trail - viewH * 0.004) / (viewH * 0.05));
      for (let gi = 0; gi < GHOSTS; gi++) {
        const m = c.ghosts[gi];
        if (strength < 0.04 || !c.mesh.visible) {
          m.visible = false;
          continue;
        }
        const f = (gi + 1) / GHOSTS;
        m.visible = true;
        m.position.copy(P.pos).addScaledVector(dir, -trail * f);
        m.quaternion.copy(P.quat);
        m.scale.setScalar(P.size * (1 + f * 0.04));
        const gu = m.material.uniforms;
        gu.uAlpha.value = alpha * strength * 0.2 * (1 - f * 0.8);
        gu.uBend.value = u0.uBend.value;
        gu.uWave.value = u0.uWave.value;
        gu.uPhase.value = u0.uPhase.value;
        gu.uLens.value = P.lens;
        gu.uDepth.value = P.depth;
      }
    }

    // the moving cards, farthest first
    loose.sort((a, b) => a.drawnZ - b.drawnZ);
    loose.forEach((c, i) => (c.mesh.renderOrder = 2 + i));

    pointer.vx *= 0.8;
    pointer.vy *= 0.8;
    for (const tex of textures.values()) tex.tick?.();

    // The rays: always towards the frame's edges, around the ring while it stands, longer while the
    // page scrolls fast.
    const rate = Math.abs(p - lastP) / elapsed; // screen heights a second
    lastP = p;
    rush += (Math.min(1, rate * 0.6) - rush) * (1 - Math.exp(-elapsed / 0.15));
    const perUnit = pxH / viewH;
    const ring = choreo.ring;
    raysAt.centre.set(pxW / 2 + ring.centre.x * perUnit, pxH / 2 + ring.centre.y * perUnit);
    raysAt.ring.set((ring.radius + ring.size * 0.375) * perUnit, ring.radius * 0.8 * perUnit);
    raysAt.prism = phase(p, marks.gather[0] + 0.6, marks.gather[1]) * (1 - phase(p, marks.unroll[0] + 0.15, marks.unroll[1] - 0.25));
    // strong in the air, as on premotio's first screen; gentler on the ring; slight on the settled wall
    raysAt.edges = 1 - 0.5 * phase(p, marks.gather[0], marks.gather[1]) - 0.2 * settle;
    raysAt.rush = still ? 0 : rush;
    rays.set(raysAt);
    rays.render(scene, camera, now, still);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    viewH = 7.5;
    viewW = viewH * camera.aspect;
    base = distanceFor(LONG_FOV, viewH);
    shared.uBase.value = base;
    camera.position.set(0, 0, base);
    camera.updateProjectionMatrix();
    choreo.layout(viewW, viewH);
    const size = renderer.getDrawingBufferSize(new Vector2());
    pxW = size.x;
    pxH = size.y;
    rays.resize(pxW, pxH, dpr);
  }

  let lastMove: { x: number; y: number; at: number } | null = null;
  const onMove = (e: PointerEvent) => {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -(e.clientY / window.innerHeight) * 2 + 1;
    // the wake, in the drawing's pixels (y up)
    const dpr = renderer.getPixelRatio();
    const at = performance.now();
    const x = e.clientX * dpr;
    const y = (window.innerHeight - e.clientY) * dpr;
    if (lastMove && at > lastMove.at) {
      const s = 1000 / (at - lastMove.at);
      const vx = (x - lastMove.x) * s;
      const vy = (y - lastMove.y) * s;
      if (Math.hypot(vx, vy) > 12 * dpr) rays.stir(x, y, vx, vy, at);
    }
    lastMove = { x, y, at };
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

  // Picking by hand: three's raycaster cannot see the lens each card is drawn through.
  const corner = new Vector3();
  const quad = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  const CORNERS: [number, number][] = [
    [-0.375, -0.5],
    [0.375, -0.5],
    [0.375, 0.5],
    [-0.375, 0.5],
  ];
  const inside = (x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (Math.abs(cross) < 1e-12) continue;
      const s = Math.sign(cross);
      if (sign && s !== sign) return false;
      sign = s;
    }
    return true;
  };

  return {
    setProgress(p) {
      progress = p;
    },
    setMarks(m) {
      choreo.setMarks(m);
    },
    pick(clientX, clientY) {
      const x = (clientX / window.innerWidth) * 2 - 1;
      const y = -(clientY / window.innerHeight) * 2 + 1;
      const clip = shared.uClip.value;
      const dpr = renderer.getPixelRatio();
      const fx = clientX * dpr;
      const fy = (window.innerHeight - clientY) * dpr;
      if (fx < clip.x || fy < clip.y || fx > clip.z || fy > clip.w) return null;
      // the hovered card is tested where it rests, not where the hover has lifted it: otherwise a
      // pointer near its edge would lose it as it rises, and it would bob up and down
      let best = -1;
      let bestZ = -Infinity;
      for (let k = 0; k < N; k++) {
        const c = cards[k];
        if (!c.mesh.visible || c.alpha <= 0.6) continue;
        const pos = k === hovered ? c.rest : c.mesh.position;
        const size = k === hovered ? c.restSize : c.mesh.scale.x;
        CORNERS.forEach(([cx, cy], i) => {
          corner.set(cx * size, cy * size, 0).applyQuaternion(c.mesh.quaternion).add(pos);
          screenOf(corner, c.lens, c.depth, quad[i]);
        });
        if (!inside(x, y)) continue;
        const z = pos.z - c.depth + (c.loose ? 1e-3 : 0);
        if (z > bestZ) {
          bestZ = z;
          best = k;
        }
      }
      return best >= 0 ? { id: cards[best].item.id, index: best } : null;
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
      rays.dispose();
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
