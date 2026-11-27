/**
 * /media/<name> for files kept in the Blob store (lib/blob.ts). next.config.ts rewrites /media/* here only
 * when public/media has no such file, so older media is still served as static files. Answers are cached
 * for good: a file's name never changes for other content.
 */
import { blobGet, blobUrl, typeOf } from "@/lib/blob";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const name = path.join("/");
  if (!name || name.includes("..")) return new Response("Not found", { status: 404 });
  // videos play from the store's CDN, which answers the range requests players use to seek (Safari won't
  // play a video without them)
  if (/\.(mp4|webm|mov)$/i.test(name)) {
    const url = await blobUrl(`public/media/${name}`);
    if (!url) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(null, { status: 308, headers: { Location: url, "Cache-Control": "public, max-age=31536000, immutable" } });
  }
  const got = await blobGet(`public/media/${name}`);
  if (!got) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(got.stream, {
    headers: {
      "Content-Type": got.type || typeOf(name),
      ...(got.size ? { "Content-Length": String(got.size) } : {}),
      "Cache-Control": "public, max-age=31536000, immutable",
      // as for the static files: an SVG opened on its own runs nothing
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; font-src data:; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
