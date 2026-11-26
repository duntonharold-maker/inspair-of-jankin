/**
 * POST /api/collect/group  { ids: [cover, …] } → makes one set of several inbox pictures (the extension's
 * 收件箱 page, 合成一组). The first keeps its title and category; the others' pictures follow in order.
 * Authorization: Bearer <COLLECT_SECRET or MCP_SECRET>.
 */
import { isCollectAuthorized } from "@/lib/auth";
import { groupItems } from "@/lib/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isCollectAuthorized(req)) return Response.json({ error: "密钥不对：在插件设置里填 COLLECT_SECRET 或 MCP_SECRET。" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === "string").slice(0, 50) : [];
    const result = await groupItems(ids, { collect: true });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
