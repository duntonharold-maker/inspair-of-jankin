/**
 * The light the cards are seen through: the scene is drawn into a picture first, then drawn out along
 * rays from the middle of the screen and split into its colours, red at one end of each ray and blue
 * at the other. The rays are long towards the frame's edges, around the ring while it stands, and
 * wherever the pointer has just passed; elsewhere the picture is left sharp.
 *
 * The canvas stays see-through around the cards (the page and its words show beneath), so each
 * colour's coverage is folded onto the page's own colour, which is what lies beneath almost everywhere.
 */
import {
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from "three";

/** How many points of the pointer's recent path draw the wake, and how long each lasts (seconds). */
export const WAKE_POINTS = 8;
const WAKE_FADES = 0.35;

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragment = (taps: number) => /* glsl */ `
precision highp float;
uniform sampler2D uScene;
uniform vec2 uSize;       // the drawing's size in pixels
uniform float uPixel;     // pixels per CSS pixel
uniform vec2 uCentre;     // where the rays start, in pixels
uniform vec2 uRing;       // the ring's radius on screen and the width of the band around it, in pixels
uniform float uPrism;     // how strongly the band around the ring is drawn out
uniform float uEdges;     // how strongly the frame's edges are drawn out
uniform float uRush;      // 0 at rest, 1 while the page scrolls fast
uniform vec3 uPage;       // the page's colour beneath the canvas, linear
uniform vec3 uWakeAt[${WAKE_POINTS}];   // x, y in pixels, strength
uniform vec2 uWakeWay[${WAKE_POINTS}];  // velocity in pixels a second
uniform float uWakeRadius;
varying vec2 vUv;

// how much of each colour a sample a share t along its ray gives: red first, blue last, a little white throughout
vec3 hue(float t) {
  vec3 c = vec3(1.0 - smoothstep(0.05, 0.6, t), 1.0 - abs(t - 0.5) * 2.0, smoothstep(0.4, 0.95, t));
  return 0.18 + 0.82 * max(c, 0.0);
}

float toSrgb(float c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

// premultiplied linear colour and per-colour coverage, folded onto the page's colour, out as premultiplied sRGB
vec4 finish(vec3 colour, vec3 cover) {
  float a = max(max(cover.r, cover.g), cover.b);
  if (a <= 0.0005) return vec4(0.0);
  vec3 c = (colour + uPage * (a - cover)) / a;
  return vec4(toSrgb(c.r) * a, toSrgb(c.g) * a, toSrgb(c.b) * a, a);
}

void main() {
  vec2 p = vUv * uSize;
  vec2 fromCentre = p - uCentre;
  float dist = length(fromCentre);
  vec2 out_ = dist > 0.0 ? fromCentre / dist : vec2(0.0);
  float shorter = min(uSize.x, uSize.y);

  // a band around the ring, longest just outside it
  float across = (dist - uRing.x) / max(uRing.y, 1.0);
  float band = uPrism * exp(-(across - 0.35) * (across - 0.35) * 3.0);
  // the frame's edges
  vec2 e = abs(vUv * 2.0 - 1.0);
  float edge = uEdges * smoothstep(0.76, 1.0, max(e.x, e.y));
  vec2 stretch = out_ * (uRing.y * band * 0.28 + shorter * edge * 0.05) * (1.0 + 1.2 * uRush);

  // the pointer's wake: the picture is drawn out along the way the pointer went, and pushed a little
  vec2 flow = vec2(0.0);
  for (int i = 0; i < ${WAKE_POINTS}; i++) {
    vec2 d = p - uWakeAt[i].xy;
    flow += uWakeWay[i] * uWakeAt[i].z * exp(-dot(d, d) / (uWakeRadius * uWakeRadius));
  }
  float speed = length(flow);
  if (speed > 1.0) {
    vec2 way = flow / speed;
    stretch += (dot(way, out_) < 0.0 ? -way : way) * min(speed * 0.03, shorter * 0.035);
    p -= flow * 0.01;
  }

  float reach = length(stretch);
  if (reach < 0.75 * uPixel) {
    vec4 s = texture2D(uScene, p / uSize);
    gl_FragColor = finish(s.rgb, vec3(s.a));
    return;
  }
  vec2 along = stretch / reach;
  // each pixel starts its samples at its own offset, so the steps show as fine grain, not bands
  float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float count = clamp(ceil(reach / (3.0 * uPixel)), 4.0, ${taps.toFixed(1)});
  vec3 colour = vec3(0.0);
  vec3 cover = vec3(0.0);
  vec3 total = vec3(0.0);
  for (int i = 0; i < ${taps}; i++) {
    if (float(i) >= count) break;
    float t = (float(i) + grain) / count;
    vec4 s = texture2D(uScene, (p + along * reach * (t - 0.5)) / uSize);
    vec3 k = hue(t);
    colour += s.rgb * k;
    cover += s.a * k;
    total += k;
  }
  gl_FragColor = finish(colour / total, cover / total);
}`;

/** The page's colour (--bg in app/globals.css) in linear light. */
function pageColour() {
  const css = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(css)?.[1] ?? "f2f5f7";
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return new Vector3(...[0, 2, 4].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)));
}

export type Rays = ReturnType<typeof createRays>;

export function createRays(renderer: WebGLRenderer, { mobile }: { mobile: boolean }) {
  const float = renderer.extensions.has("EXT_color_buffer_float");
  const target = new WebGLRenderTarget(1, 1, {
    type: float ? HalfFloatType : UnsignedByteType,
    samples: 4,
    depthBuffer: true,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  const wakeAt = Array.from({ length: WAKE_POINTS }, () => new Vector3());
  const wakeWay = Array.from({ length: WAKE_POINTS }, () => new Vector2());
  const material = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment(mobile ? 8 : 16),
    depthTest: false,
    depthWrite: false,
    transparent: false,
    uniforms: {
      uScene: { value: target.texture },
      uSize: { value: new Vector2(1, 1) },
      uPixel: { value: 1 },
      uCentre: { value: new Vector2() },
      uRing: { value: new Vector2(1, 1) },
      uPrism: { value: 0 },
      uEdges: { value: 1 },
      uRush: { value: 0 },
      uPage: { value: pageColour() },
      uWakeAt: { value: wakeAt },
      uWakeWay: { value: wakeWay },
      uWakeRadius: { value: 40 },
    },
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const screen = new Scene();
  screen.add(quad);
  const flat = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // the pointer's recent path, newest last
  const trail: { x: number; y: number; vx: number; vy: number; at: number }[] = [];

  return {
    /** Size of the drawing in pixels, and pixels per CSS pixel. */
    resize(width: number, height: number, pixel: number) {
      target.setSize(width, height);
      const u = material.uniforms;
      u.uSize.value.set(width, height);
      u.uPixel.value = pixel;
      u.uWakeRadius.value = 0.05 * Math.min(width, height);
    },
    /** A pointer sample, in the drawing's pixels (y up) and pixels a second. */
    stir(x: number, y: number, vx: number, vy: number, now: number) {
      trail.push({ x, y, vx, vy, at: now });
      if (trail.length > WAKE_POINTS) trail.shift();
    },
    /** Where the rays start and the ring they ring, in pixels; how strong each part is. */
    set(o: { centre: Vector2; ring: Vector2; prism: number; edges: number; rush: number }) {
      const u = material.uniforms;
      u.uCentre.value.copy(o.centre);
      u.uRing.value.copy(o.ring);
      u.uPrism.value = o.prism;
      u.uEdges.value = o.edges;
      u.uRush.value = o.rush;
    },
    /** Draw the scene through the rays onto the canvas. */
    render(scene: Scene, camera: Camera, now: number, still: boolean) {
      for (let i = 0; i < WAKE_POINTS; i++) {
        const s = trail[i];
        const live = s && !still ? Math.exp(-(now - s.at) / 1000 / WAKE_FADES) : 0;
        wakeAt[i].set(s?.x ?? -1e5, s?.y ?? -1e5, live > 0.02 ? live : 0);
        wakeWay[i].set(s?.vx ?? 0, s?.vy ?? 0);
      }
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(screen, flat);
    },
    dispose() {
      target.dispose();
      material.dispose();
      quad.geometry.dispose();
    },
  };
}
