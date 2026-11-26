/**
 * POST /api/collect/undo  { token } → puts the inbox back as it was before a change made on the extension's
 * 收件箱 page (making a set, taking it apart, rearranging it). The token comes with that change's answer
 * and is valid 15 minutes; a change made after it makes it refuse.
 * Authorization: Bearer <COLLECT_SECRET or MCP_SECRET>.
 */
import { isCollectAuthorized } from "@/lib/auth";
import { undoCollected } from "@/lib/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isCollectAuthorized(req)) return Response.json({ error: "密钥不对：在插件设置里填 COLLECT_SECRET 或 MCP_SECRET。" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.token !== "string") throw new Error("撤销不了。");
    return Response.json({ ok: true, ...(await undoCollected(body.token)) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
