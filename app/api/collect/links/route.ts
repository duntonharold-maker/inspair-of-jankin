/**
 * POST /api/collect/links — the browser extension's 收藏这个网站: { url, title, siteName, description, icons,
 * excerpt, category, remark }. The site goes into the inbox with the page's own words; an agent writes its
 * pitch and strengths when it files it (update_link). Answers { ok, id, name, duplicate, inbox }.
 * Authorization: Bearer <COLLECT_SECRET or MCP_SECRET>.
 */
import { z } from "zod";
import { isCollectAuthorized } from "@/lib/auth";
import { collectLink } from "@/lib/links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Page = z.object({
  url: z.string().url().refine((u) => /^https?:/.test(u), "只能收藏 http(s) 网页。"),
  title: z.string().max(500).optional(),
  siteName: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  icons: z.array(z.string().max(2000)).max(8).optional(),
  excerpt: z.string().max(6000).optional(),
  category: z.string().max(40).optional(),
  remark: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  if (!isCollectAuthorized(req)) return Response.json({ error: "密钥不对：在插件设置里填 COLLECT_SECRET 或 MCP_SECRET。" }, { status: 401 });
  try {
    const page = Page.parse(await req.json().catch(() => ({})));
    const { result } = await collectLink(page);
    return Response.json({ ok: true, id: result.link.id, name: result.link.name, duplicate: result.duplicate, inbox: result.inbox });
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message ?? "内容不对。" : e instanceof Error ? e.message : String(e);
    return Response.json({ error: message }, { status: 400 });
  }
}
