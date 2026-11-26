/**
 * Where the browser extension sends what it collects (extension/).
 *
 *   GET  /api/collect   → checks the key, lists the pictures waiting in the inbox (newest first)
 *   POST /api/collect   → multipart form: file (the picture, fetched by the browser) and/or image_url,
 *                         plus page_url, page_title and alt. The picture goes into the inbox, off the site
 *                         until an agent files it (organize_items).
 *
 * The pictures themselves, and throwing one away: /api/collect/[id].
 *
 * Authorization: Bearer <COLLECT_SECRET or MCP_SECRET>.
 */
import { isCollectAuthorized } from "@/lib/auth";
import { fetchMedia, ingest } from "@/lib/media";
import { collectItem } from "@/lib/ops";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const unauthorized = () => Response.json({ error: "密钥不对：在插件设置里填 COLLECT_SECRET 或 MCP_SECRET。" }, { status: 401 });
const text = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export async function GET(req: Request) {
  if (!isCollectAuthorized(req)) return unauthorized();
  const { items, site } = await getStore().read();
  const inbox = items
    .filter((i) => i.inbox)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((i) => ({
      id: i.id,
      title: i.title,
      source: i.source,
      createdAt: i.createdAt,
      width: i.media.width,
      height: i.media.height,
      cutout: i.media.cutout,
    }));
  return Response.json({ ok: true, site: site.name, inbox: inbox.length, items: inbox });
}

export async function POST(req: Request) {
  if (!isCollectAuthorized(req)) return unauthorized();
  try {
    const form = await req.formData();
    const file = form.get("file");
    const from = {
      imageUrl: text(form.get("image_url")),
      pageUrl: text(form.get("page_url")),
      pageTitle: text(form.get("page_title")),
      alt: text(form.get("alt")),
    };
    let buffer: Buffer;
    let filename: string | undefined;
    if (file instanceof File && file.size) {
      buffer = Buffer.from(await file.arrayBuffer());
      filename = file.name;
    } else if (from.imageUrl) {
      ({ buffer, filename } = await fetchMedia(from.imageUrl));
    } else {
      return Response.json({ error: "没有收到图片：需要 file 或 image_url。" }, { status: 400 });
    }
    const media = await ingest(buffer, { filename });
    const { result } = await collectItem(media, from);
    return Response.json({
      ok: true,
      id: result.item.id,
      title: result.item.title,
      duplicate: result.duplicate,
      inbox: result.inbox,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
