/**
 * DELETE /api/collect/links/<id> → throws away a website still in the inbox (the extension's inbox page).
 * Authorization: Bearer <COLLECT_SECRET or MCP_SECRET>.
 */
import { isCollectAuthorized } from "@/lib/auth";
import { deleteLinks } from "@/lib/links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isCollectAuthorized(req)) return Response.json({ error: "密钥不对：在插件设置里填 COLLECT_SECRET 或 MCP_SECRET。" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const { result } = await deleteLinks([id], { collect: true });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
