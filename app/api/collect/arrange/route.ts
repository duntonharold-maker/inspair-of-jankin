/**
 * POST /api/collect/arrange  { id, order?, split? } → rearranges a set still in the inbox (the extension's
 * 收件箱 page): a new cover (order), pictures taken out as pictures of their own (split), or the whole set
 * taken apart (order [0], split the rest). Positions count from 0, the cover.
 * Authorization: Bearer <COLLECT_SECRET or MCP_SECRET>.
 */
import { isCollectAuthorized } from "@/lib/auth";
import { ArrangeInput, arrangeSet } from "@/lib/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isCollectAuthorized(req)) return Response.json({ error: "密钥不对：在插件设置里填 COLLECT_SECRET 或 MCP_SECRET。" }, { status: 401 });
  try {
    const spec = ArrangeInput.parse(await req.json().catch(() => ({})));
    const result = await arrangeSet(spec, { collect: true });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: message }, { status: 400 });
  }
}
