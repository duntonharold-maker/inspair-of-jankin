/**
 * Turns raw bytes into a stored media file: detects the format, reads the size,
 * shrinks large still images to WebP, and strips scripts out of SVGs.
 */
import { imageSize } from "image-size";
import type { Media, MediaType } from "./types";

export const MAX_FETCH_BYTES = 20 * 1024 * 1024;
/** Videos may be larger: a minute of 1080p is about 30 MB. */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** `thumb`: a still picture's smaller copy, or a video's poster. `small`: a video's lighter copy for cards. */
export type Ingested = { buffer: Buffer; ext: string; media: Omit<Media, "src" | "thumb" | "small">; thumb?: Buffer; small?: Buffer };

/** Width of the copy cards show (enough for the widest card on a 2x screen). */
export const THUMB_WIDTH = 800;

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

/** The gentlest corner a card has: 0.625rem on the widest cards (about 330px), as a share of their width. */
const CARD_CORNER = 0.03;

/**
 * Whether a picture or SVG covers its whole frame, so that it can fill a card: drawn at 256px, it must
 * be opaque along its edges, and any clear corners must be no deeper than the card's own rounding cuts
 * away (then the card hides exactly what is clear, and the piece keeps its outline). An icon on a rounder
 * tile, a sticker or a line drawing on a clear ground doesn't: it has an outline of its own, which a card
 * must neither crop nor paint over.
 */
async function coversFrame(buffer: Buffer, type: "image" | "svg") {
  try {
    const { default: sharp } = await import("sharp");
    const image = sharp(buffer, type === "svg" ? { density: 72 } : { animated: false });
    if (type === "image" && !(await image.metadata()).hasAlpha) return true;
    const S = 256;
    const { data } = await image.resize({ width: S, height: S, fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const clear = (x: number, y: number) => data[(y * S + x) * 4 + 3] < 250;
    // along the edges, away from the corners: nothing clear
    const corner = Math.round(S * 0.15);
    for (let t = corner; t < S - corner; t++) if (clear(t, 1) || clear(t, S - 2) || clear(1, t) || clear(S - 2, t)) return false;
    // at each corner: a radius r leaves (1 - 1/√2)·r clear along the diagonal, that is 0.207·r pixel steps
    const allowed = 0.207 * CARD_CORNER * S;
    for (const [x0, y0, dx, dy] of [[0, 0, 1, 1], [S - 1, 0, -1, 1], [0, S - 1, 1, -1], [S - 1, S - 1, -1, -1]]) {
      let d = 0;
      while (d < S / 2 && clear(x0 + dx * d, y0 + dy * d)) d++;
      if (d > allowed + 0.5) return false;
    }
    return true;
  } catch {
    return true;
  }
}

/** Whether a Lottie animation paints its whole composition: it has a solid layer at least that size. */
function lottieCoversFrame(json: { w?: number; h?: number; layers?: unknown }) {
  const layers = (json.layers ?? []) as { ty?: number; sw?: number; sh?: number }[];
  return layers.some((l) => l.ty === 1 && (l.sw ?? 0) >= (json.w ?? 1) && (l.sh ?? 0) >= (json.h ?? 1));
}

/** A smaller copy of a still picture for cards and the scene; none for animations or pictures already small. */
async function thumbnail(buffer: Buffer, width?: number) {
  if (!width || width <= THUMB_WIDTH) return undefined;
  try {
    const { default: sharp } = await import("sharp");
    if (((await sharp(buffer, { animated: true }).metadata()).pages ?? 1) > 1) return undefined;
    return await sharp(buffer).rotate().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  } catch {
    return undefined;
  }
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
  let cutout = false;
  let thumb: Buffer | undefined;

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
    cutout = !(await coversFrame(buffer, "image"));
    thumb = await thumbnail(buffer, width);
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
    cutout = !(await coversFrame(buffer, "svg"));
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
    cutout = !lottieCoversFrame(json);
    buffer = Buffer.from(JSON.stringify(json), "utf8");
  }

  let duration: number | undefined;
  if (kind.type === "video") {
    const info = mp4Info(buffer);
    width ??= info.width;
    height ??= info.height;
    duration = info.duration;
  }

  const round = (n?: number) => (n && n > 0 ? Math.round(n) : undefined);
  return {
    buffer,
    ext,
    thumb,
    media: { type: kind.type, width: round(width), height: round(height), ...(cutout && { cutout }), ...(duration && { duration }) },
  };
}

/**
 * An MP4's picture size and length, read from its boxes (moov → mvhd, trak → tkhd). Unknown for other
 * containers or files that keep moov somewhere unusual.
 */
export function mp4Info(buf: Buffer): { width?: number; height?: number; duration?: number } {
  const out: { width?: number; height?: number; duration?: number } = {};
  const walk = (start: number, end: number) => {
    for (let at = start; at + 8 <= end; ) {
      let size = buf.readUInt32BE(at);
      const type = buf.subarray(at + 4, at + 8).toString("latin1");
      let head = 8;
      if (size === 1) {
        if (at + 16 > end) return;
        size = Number(buf.readBigUInt64BE(at + 8));
        head = 16;
      } else if (size === 0) size = end - at;
      if (size < head || at + size > end) return;
      const body = at + head;
      if (type === "moov" || type === "trak") walk(body, at + size);
      else if (type === "mvhd") {
        const v1 = buf[body] === 1;
        const scale = buf.readUInt32BE(body + (v1 ? 20 : 12));
        const length = v1 ? Number(buf.readBigUInt64BE(body + 24)) : buf.readUInt32BE(body + 16);
        if (scale) out.duration = Math.round((length / scale) * 10) / 10;
      } else if (type === "tkhd" && !out.width) {
        // the last 8 bytes are width and height, 16.16 fixed point; sound tracks have 0
        const w = buf.readUInt32BE(at + size - 8) / 65536;
        const h = buf.readUInt32BE(at + size - 4) / 65536;
        if (w && h) Object.assign(out, { width: Math.round(w), height: Math.round(h) });
      }
      at += size;
    }
  };
  try {
    walk(0, buf.length);
  } catch {
    /* a box we couldn't read: keep what we have */
  }
  return out;
}

/** The poster of a video as a WebP for cards and the scene, no wider than a card needs. */
async function posterOf(buffer: Buffer) {
  try {
    const { default: sharp } = await import("sharp");
    const image = sharp(buffer).rotate();
    const { width, height } = await image.metadata();
    const webp = await image.resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return { webp, width, height };
  } catch {
    return null;
  }
}

/**
 * A video from the web: the file itself, a lighter copy for cards (when the site offers one, as X does with
 * its smaller sizes) and a poster. Size and length come from the caller when it knows them, else from the file.
 */
export async function ingestVideo(src: {
  url: string;
  smallUrl?: string;
  posterUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
}): Promise<Ingested> {
  const [main, small, poster] = await Promise.all([
    fetchMedia(src.url, MAX_VIDEO_BYTES),
    src.smallUrl && src.smallUrl !== src.url ? fetchMedia(src.smallUrl, MAX_VIDEO_BYTES).catch(() => null) : null,
    src.posterUrl ? fetchMedia(src.posterUrl).catch(() => null) : null,
  ]);
  const got = await ingest(main.buffer, { filename: main.filename, width: src.width, height: src.height });
  if (got.media.type !== "video") throw new Error("这个地址不是视频文件。");
  const still = poster && (await posterOf(poster.buffer));
  const smallOk = small && detect(small.buffer).type === "video" && small.buffer.length < got.buffer.length;
  return {
    ...got,
    media: {
      ...got.media,
      width: got.media.width ?? still?.width,
      height: got.media.height ?? still?.height,
      ...(src.duration ? { duration: Math.round(src.duration * 10) / 10 } : {}),
    },
    ...(still ? { thumb: still.webp } : {}),
    ...(smallOk ? { small: small.buffer } : {}),
  };
}

export async function fetchMedia(url: string, max = MAX_FETCH_BYTES): Promise<{ buffer: Buffer; filename: string }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http(s) URLs can be fetched.");
  const res = await fetch(u, {
    redirect: "follow",
    signal: AbortSignal.timeout(max > MAX_FETCH_BYTES ? 50_000 : 30_000),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; inspair-bot/1.0)", Accept: "image/*,video/*,application/json,*/*" },
  });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > max) throw new Error(`File is larger than ${max / 1048576} MB.`);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error(`File is larger than ${max / 1048576} MB.`);
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
