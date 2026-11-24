/**
 * MCP endpoint (Streamable HTTP).
 *   https://<site>/api/mcp/<MCP_SECRET>            ← for clients that only take a URL (claude.ai, ChatGPT)
 *   https://<site>/api/mcp + Authorization: Bearer <MCP_SECRET>   ← for Claude Code, Cursor, etc.
 */
import { createMcpHandler } from "mcp-handler";
import { isAuthorized } from "@/lib/auth";
import { MCP_INSTRUCTIONS, registerTools } from "@/lib/mcp";
import { originOf } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ secret?: string[] }> };

async function handle(req: Request, { params }: Params) {
  const { secret } = await params;
  if ((secret && secret.length > 1) || !isAuthorized(req, secret?.[0])) {
    return Response.json({ error: "Unauthorized. Use /api/mcp/<MCP_SECRET> or a Bearer token." }, { status: 401 });
  }
  const origin = originOf(req);
  const handler = createMcpHandler((server) => registerTools(server, { origin }), {
    serverInfo: { name: "inspair", version: "0.1.0" },
    instructions: MCP_INSTRUCTIONS,
  });
  return handler(req);
}

export { handle as GET, handle as POST, handle as DELETE };
