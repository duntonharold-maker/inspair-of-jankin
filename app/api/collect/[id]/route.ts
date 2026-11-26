/**
 * One picture in the inbox, for the browser extension's 收件箱 page.
 *
 *   GET    /api/collect/<id>          → the picture's small copy (800px wide, or the file itself when smaller)
 *   GET    /api/collect/<id>?full=1   → the picture as collected
 *   DELETE /api/collect/<id>          → throw it away (inbox pictures only)
 *
 * Inbox pictures aren't on the deployed site (collecting skips the build), so they are read from the store.
 * Authorization: Bearer <COLLECT_SECRET or MCP_SECRET>.
 */
import { isCollectAuthorized } from "@/lib/auth";
import { discardCollected } from "@/lib/ops";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
};
const unauthorized = () => Response.json({ error: "密钥不对：在插件设置里填 COLLECT_SECRET 或 MCP_SECRET。" }, { status: 401 });

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isCollectAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  const store = getStore();
  const { items } = await store.read();
  const item = items.find((i) => i.id === id && i.inbox);
  if (!item) return Response.json({ error: "收件箱里没有这张图片。" }, { status: 404 });
  const full = new URL(req.url).searchParams.has("full");
  const src = (!full && item.media.thumb) || item.media.src;
  const ext = src.split(".").pop()?.toLowerCase() ?? "";
  const body = await store.readFile(`public${src}`);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      // a picture's file never changes under its name
      "Cache-Control": "private, max-age=86400",
      // an SVG opened on its own must not run scripts
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isCollectAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  try {
    const { result } = await discardCollected([id]);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
