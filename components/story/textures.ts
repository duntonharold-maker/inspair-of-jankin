/**
 * Turns any library item into a 3:4 card picture for the WebGL scene.
 * Images and SVGs are drawn once; videos and Lottie animations redraw every frame.
 */
import { CanvasTexture, SRGBColorSpace, type WebGLRenderer } from "three";
import type { Item } from "@/lib/types";

export type CardTexture = { texture: CanvasTexture; tick?: () => void; dispose: () => void };

const W = 480;
const H = 640;

function cover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number) {
  const s = Math.max(W / sw, H / sh);
  ctx.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s);
}

function contain(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, pad = 0) {
  const s = Math.min((W - pad * 2) / sw, (H - pad * 2) / sh);
  ctx.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

function background(item: Item) {
  // Icons and Lottie files carry their own artwork on a transparent ground.
  return item.media.type === "svg" || item.media.type === "lottie" ? "#ffffff" : item.color || "#e4eaee";
}

export async function cardTexture(item: Item, renderer: WebGLRenderer): Promise<CardTexture> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const paint = () => {
    ctx.fillStyle = background(item);
    ctx.fillRect(0, 0, W, H);
  };
  paint();

  const { type, src } = item.media;

  if (type === "image" || type === "svg") {
    try {
      const img = await loadImage(src);
      const iw = img.naturalWidth || item.media.width || W;
      const ih = img.naturalHeight || item.media.height || H;
      if (type === "svg") contain(ctx, img, iw, ih);
      else cover(ctx, img, iw, ih);
    } catch {
      /* keep the plain colour card */
    }
    texture.needsUpdate = true;
    return { texture, dispose: () => texture.dispose() };
  }

  if (type === "video") {
    const video = document.createElement("video");
    video.src = src;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.play().catch(() => {});
    return {
      texture,
      tick: () => {
        if (video.readyState >= 2) {
          paint();
          cover(ctx, video, video.videoWidth, video.videoHeight);
          texture.needsUpdate = true;
        }
      },
      dispose: () => {
        video.pause();
        video.removeAttribute("src");
        texture.dispose();
      },
    };
  }

  // Lottie: play it into an offscreen canvas and copy each frame onto the card.
  const off = document.createElement("canvas");
  off.width = item.media.width || 512;
  off.height = item.media.height || 512;
  const offCtx = off.getContext("2d")!;
  const { default: lottie } = await import("lottie-web/build/player/lottie_light_canvas");
  const anim = lottie.loadAnimation({
    renderer: "canvas",
    loop: true,
    autoplay: true,
    path: src,
    rendererSettings: { context: offCtx, clearCanvas: true, preserveAspectRatio: "xMidYMid meet" },
  } as Parameters<typeof lottie.loadAnimation>[0]);
  return {
    texture,
    tick: () => {
      paint();
      contain(ctx, off, off.width, off.height, 40);
      texture.needsUpdate = true;
    },
    dispose: () => {
      anim.destroy();
      texture.dispose();
    },
  };
}
