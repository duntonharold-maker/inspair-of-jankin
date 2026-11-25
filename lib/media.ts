/**
 * Turns raw bytes into a stored media file: detects the format, reads the size,
 * shrinks large still images to WebP, and strips scripts out of SVGs.
 */
import { imageSize } from "image-size";
import type { Media, MediaType } from "./types";

export const MAX_FETCH_BYTES = 20 * 1024 * 1024;

export type Ingested = { buffer: Buffer; ext: string; media: Omit<Media, "src"> };

type Detected = { type: MediaType; ext: string; animated?: boolean };

function startsWith(buf: Buffer, bytes: number[], offset = 0) {
  return bytes.every((b, i) => buf[offset + i] === b);
}

function hasApngChunk(buf: Buffer) {
  const idat = buf.indexOf("IDAT");
  const actl = buf.indexOf("acTL");
  return actl !== -1 && (idat === -1 || actl < idat);
}

function detect(buf: Buffer, hint = ""): Detected {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return { type: "image", ext: "png", animated: hasApngChunk(buf) };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { type: "image", ext: "jpg" };
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return { type: "image", ext: "gif", animated: true };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP")
    return { type: "image", ext: "webp", animated: true /* may be; never re-encode */ };
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { type: "video", ext: "webm" };
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (brand === "avif" || brand === "avis") return { type: "image", ext: "avif", animated: true };
    if (brand === "qt  ") return { type: "video", ext: "mov" };
    return { type: "video", ext: "mp4" };
  }
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]))
    throw new Error("dotLottie (.lottie) files are not supported yet — export the animation as Lottie JSON instead.");

  const head = buf.subarray(0, 2048).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head) || /\.svg$/i.test(hint))
    return { type: "svg", ext: "svg" };
  if (head.startsWith("{")) return { type: "lottie", ext: "json" };
  throw new Error(
    "Unrecognised file type. Supported: PNG, JPEG, GIF, WebP, AVIF, SVG, MP4, WebM, MOV and Lottie JSON.",
  );
}

export function sanitizeSvg(svg: string) {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script[^>]*\/>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, "$1#");
}

async function shrink(buf: Buffer) {
  try {
    const { default: sharp } = await import("sharp");
    const out = await sharp(buf)
      .rotate()
      .resize({ width: 2560, withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer({ resolveWithObject: true });
    return { buffer: out.data, width: out.info.width, height: out.info.height };
  } catch {
    return null; // keep the original if sharp is unavailable
  }
}

const hex = (rgb: number[]) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/**
 * The colour a picture or SVG fills its own ground with, read just inside the middle of each of its four
 * edges: an icon drawn on a rounded tile leaves its corners clear, but the edges' midpoints are the tile.
 * Undefined when the four disagree (most photographs) or show through.
 */
async function groundOf(buffer: Buffer, type: "image" | "svg") {
  try {
    const { default: sharp } = await import("sharp");
    const { data, info } = await sharp(buffer, type === "svg" ? { density: 72 } : { animated: false })
      .resize({ width: 96, height: 96, fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height, inset = 2;
    const at = (x: number, y: number) => [...data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
    const points = [at(w >> 1, inset), at(w >> 1, h - 1 - inset), at(inset, h >> 1), at(w - 1 - inset, h >> 1)];
    if (points.some((p) => p[3] < 250)) return undefined;
    for (let c = 0; c < 3; c++) {
      const v = points.map((p) => p[c]);
      if (Math.max(...v) - Math.min(...v) > 6) return undefined;
    }
    return hex([0, 1, 2].map((c) => points.reduce((sum, p) => sum + p[c], 0) / points.length));
  } catch {
    return undefined;
  }
}

/** A Lottie animation's backdrop: a solid layer the size of the whole composition, if it has one. */
function lottieGround(json: { w?: number; h?: number; layers?: unknown }) {
  const layers = (json.layers ?? []) as { ty?: number; sc?: string; sw?: number; sh?: number }[];
  const solid = layers.find((l) => l.ty === 1 && l.sc && (l.sw ?? 0) >= (json.w ?? 1) && (l.sh ?? 0) >= (json.h ?? 1));
  return solid?.sc && /^#[0-9a-f]{6}$/i.test(solid.sc) ? solid.sc.toLowerCase() : undefined;
}

export async function ingest(
  input: Buffer,
  opts: { filename?: string; width?: number; height?: number } = {},
): Promise<Ingested> {
  if (!input.length) throw new Error("The file is empty.");
  const kind = detect(input, opts.filename);
  let buffer = input;
  let ext = kind.ext;
  let width = opts.width;
  let height = opts.height;
  let background: string | undefined;

  if (kind.type === "image") {
    try {
      const size = imageSize(new Uint8Array(buffer));
      width ??= size.width;
      height ??= size.height;
      if (size.orientation && size.orientation >= 5) [width, height] = [height, width];
    } catch {
      /* size stays unknown */
    }
    const still = (ext === "png" && !kind.animated) || ext === "jpg";
    if (still && (buffer.length > 600 * 1024 || (width ?? 0) > 2560)) {
      const small = await shrink(buffer);
      if (small && small.buffer.length < buffer.length) {
        buffer = small.buffer;
        ext = "webp";
        width = small.width;
        height = small.height;
      }
    }
    background = await groundOf(buffer, "image");
  } else if (kind.type === "svg") {
    const clean = sanitizeSvg(buffer.toString("utf8"));
    buffer = Buffer.from(clean, "utf8");
    try {
      const size = imageSize(new Uint8Array(buffer));
      width ??= size.width;
      height ??= size.height;
    } catch {
      /* size stays unknown */
    }
    background = await groundOf(buffer, "svg");
  } else if (kind.type === "lottie") {
    let json: { w?: number; h?: number; layers?: unknown };
    try {
      json = JSON.parse(buffer.toString("utf8"));
    } catch {
      throw new Error("The JSON file could not be parsed.");
    }
    if (!Array.isArray(json.layers)) throw new Error("This JSON is not a Lottie animation (no layers).");
    width ??= json.w;
    height ??= json.h;
    background = lottieGround(json);
    buffer = Buffer.from(JSON.stringify(json), "utf8");
  }

  const round = (n?: number) => (n && n > 0 ? Math.round(n) : undefined);
  return { buffer, ext, media: { type: kind.type, width: round(width), height: round(height), ...(background && { background }) } };
}

export async function fetchMedia(url: string): Promise<{ buffer: Buffer; filename: string }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http(s) URLs can be fetched.");
  const res = await fetch(u, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; inspair-bot/1.0)", Accept: "image/*,video/*,application/json,*/*" },
  });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_FETCH_BYTES) throw new Error(`File is larger than ${MAX_FETCH_BYTES / 1048576} MB.`);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FETCH_BYTES) {
      await reader.cancel();
      throw new Error(`File is larger than ${MAX_FETCH_BYTES / 1048576} MB.`);
    }
    chunks.push(value);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) throw new Error("That URL is a web page, not a media file. Pass the direct image/video URL.");
  return { buffer: Buffer.concat(chunks), filename: u.pathname.split("/").pop() || "" };
}

export type Preview = { data: string; mimeType: "image/jpeg" } | { note: string };

/**
 * A small still of an item for an agent to look at. Images and SVGs become a JPEG (first frame,
 * on white); videos and Lottie files cannot be rendered here, so they get a short description.
 */
export async function preview(buffer: Buffer, type: MediaType, max = 512): Promise<Preview> {
  if (type === "video") return { note: "视频文件，这里无法生成预览图，请参考标题、标签和笔记。" };
  if (type === "lottie") {
    try {
      const j = JSON.parse(buffer.toString("utf8")) as { w?: number; h?: number; fr?: number; ip?: number; op?: number; nm?: string; layers?: { nm?: string }[] };
      const frames = (j.op ?? 0) - (j.ip ?? 0);
      const secs = j.fr ? (frames / j.fr).toFixed(1) : "?";
      const layers = (j.layers ?? []).map((l) => l.nm).filter(Boolean).slice(0, 12).join("、");
      return { note: `Lottie 动画「${j.nm ?? ""}」，${j.w}×${j.h}，约 ${secs} 秒，图层：${layers || "未命名"}。这里无法渲染画面。` };
    } catch {
      return { note: "Lottie 动画，无法解析。" };
    }
  }
  const { default: sharp } = await import("sharp");
  const out = await sharp(buffer, type === "svg" ? { density: 192 } : { animated: false })
    .rotate()
    .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { data: out.toString("base64"), mimeType: "image/jpeg" };
}
