/**
 * File upload for agents with a shell (and for scripts / iOS Shortcuts).
 *
 *   curl -F token=<from prepare_upload> -F file=@shot.png https://<site>/api/upload
 *   curl -H "Authorization: Bearer $MCP_SECRET" -F 'meta={"title":"…","category":"icon"}' -F file=@icon.svg https://<site>/api/upload
 */
import { isAuthorized, readUploadToken } from "@/lib/auth";
import { ingest } from "@/lib/media";
import { ItemFields, addItem, updateItem } from "@/lib/ops";
import { originOf } from "@/lib/origin";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Payload = { item_id?: string; fields?: Record<string, unknown> };

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: 'Missing "file" field.' }, { status: 400 });

    let payload: Payload;
    const token = form.get("token");
    if (typeof token === "string" && token) {
      payload = readUploadToken(token) as Payload;
    } else if (isAuthorized(req)) {
      const meta = form.get("meta");
      payload = typeof meta === "string" && meta ? JSON.parse(meta) : {};
      if (!payload.item_id && !payload.fields) payload = { fields: payload as Record<string, unknown> };
    } else {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const fields = ItemFields.partial().parse(payload.fields ?? {});
    const media = await ingest(Buffer.from(await file.arrayBuffer()), {
      filename: file.name,
      width: fields.width,
      height: fields.height,
    });
    const { result } = payload.item_id
      ? await updateItem(payload.item_id, fields, media)
      : await addItem(ItemFields.parse(fields), media);

    const origin = originOf(req);
    return Response.json({
      ok: true,
      id: result.id,
      title: result.title,
      url: `${origin}/i/${result.id}`,
      media_url: `${origin}${result.media.src}`,
      note:
        getStore().mode === "github"
          ? "Committed to GitHub; live after the next deploy (1–2 minutes)."
          : "Saved locally.",
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
