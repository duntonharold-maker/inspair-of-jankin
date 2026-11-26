import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createUploadToken } from "./auth";
import { preview } from "./media";
import { ItemFields, MediaInput, OrganizeInput, addItem, deleteItems, loadMedia, newId, organizeItems, search, updateItem, upsertCategory } from "./ops";
import { getStore } from "./store";
import type { Item } from "./types";

export const MCP_INSTRUCTIONS = `This server manages "inspair", a personal inspiration library of images and animated UI (icons, loaders, micro-interactions), each optionally with the prompt that generated it.

Workflow:
- Call list_categories first to learn valid category ids and existing tags.
- Image or video on the web → add_item with media_url (a direct file URL, not a web page).
- SVG icon or Lottie animation as text → add_item with media_text.
- A file on the user's disk and you can run shell commands → prepare_upload, then run the returned curl command.
- Always record the generation prompt verbatim in "prompt" when the user gives one, and the model/tool in "model".
- Changes are committed to GitHub; the public site shows them after the next deploy (usually 1–2 minutes).

Organizing the library (re-categorising, retagging, merging duplicate tags):
1. list_categories and search_items to see what is there.
2. view_items to look at the pictures themselves (up to 10 per call) — judge by what you see, not only by titles.
3. organize_items with dry_run true (the default) to get the plan; show it to the user.
4. Only after the user agrees, call organize_items again with the same edits and dry_run false.
   Everything is written in one commit, so prefer one organize_items call over many update_item calls.

The inbox (when the user says 整理收件箱 / sort the inbox):
Pictures collected with the browser extension wait in the inbox, off the site, with a rough title, the
page they came from as source, and a note naming that page. Some also carry what the user said while
collecting: a category they picked (a rough guess: keep it unless the picture clearly belongs elsewhere)
and a note line starting "我的想法：" (their own words on what caught their eye). To file them:
1. search_items with inbox: true (and list_categories for the categories and the tags already in use).
2. view_items to look at each picture; get_item when you need its source or note.
3. organize_items, one change per picture: a short descriptive title (Chinese, keeping product or brand
   names), a category, tags in the library's existing wording, a note on what is worth learning from it
   (replacing the collected note, keeping the designer or studio if the page names one; when there is a
   "我的想法" line, build the note on that point — say what makes it work — and leave out the label), and a colour.
   Giving an inbox picture a category files it onto the site. Show the plan (dry_run) first; apply after
   the user agrees. Pictures that aren't worth keeping can be deleted with delete_items instead.`;

type Ctx = { origin: string };

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({
  content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

async function guard<T>(fn: () => Promise<T>) {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

function liveNote() {
  return getStore().mode === "github"
    ? "Committed to GitHub. The site shows it after Vercel redeploys (usually 1–2 minutes)."
    : "Saved to the local working tree.";
}

function brief(item: Item, ctx: Ctx) {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    tags: item.tags,
    media_type: item.media.type,
    prompt: item.prompt && item.prompt.length > 160 ? item.prompt.slice(0, 160) + "…" : item.prompt,
    model: item.model,
    ...(item.inbox ? { inbox: true, source: item.source, note: item.note } : { url: `${ctx.origin}/i/${item.id}` }),
    created_at: item.createdAt,
  };
}

function full(item: Item, ctx: Ctx) {
  // an inbox picture has no page yet, and its file goes live with the deploy that files it
  if (item.inbox) return item;
  return { ...item, url: `${ctx.origin}/i/${item.id}`, media_url: `${ctx.origin}${item.media.src}` };
}

export function registerTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    "list_categories",
    {
      title: "List categories and tags",
      description: "Lists the valid category ids (with Chinese labels and item counts), the most used tags, and how many collected pictures wait in the inbox.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(async () => {
        const { items: all, site } = await getStore().read();
        const items = all.filter((i) => !i.inbox);
        const tagCounts = new Map<string, number>();
        for (const i of items) for (const t of i.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
        return {
          total_items: items.length,
          inbox: all.length - items.length,
          categories: site.categories.map((c) => ({ ...c, count: items.filter((i) => i.category === c.id).length })),
          top_tags: [...tagCounts].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([tag, count]) => ({ tag, count })),
        };
      }),
  );

  server.registerTool(
    "search_items",
    {
      title: "Search the library",
      description: "Searches items by text (title, prompt, tags, notes, model, category name), category id, tag or whether a prompt exists. Newest first.",
      inputSchema: z.object({
        query: z.string().optional(),
        category: z.string().optional(),
        tag: z.string().optional(),
        has_prompt: z.boolean().optional(),
        inbox: z
          .boolean()
          .optional()
          .describe("true: only the pictures waiting in the inbox (collected with the browser extension, not on the site yet). Otherwise inbox pictures are left out."),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }).strict(),
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guard(async () => {
        const res = search(await getStore().read(), args);
        return { total: res.total, items: res.items.map((i) => brief(i, ctx)) };
      }),
  );

  server.registerTool(
    "get_item",
    {
      title: "Get one item",
      description: "Returns every field of one item, including the full prompt.",
      inputSchema: z.object({ id: z.string() }).strict(),
      annotations: { readOnlyHint: true },
    },
    ({ id }) =>
      guard(async () => {
        const item = (await getStore().read()).items.find((i) => i.id === id);
        if (!item) throw new Error(`No item with id "${id}".`);
        return full(item, ctx);
      }),
  );

  server.registerTool(
    "add_item",
    {
      title: "Add an item",
      description:
        "Adds an image or animated UI piece. Provide exactly one media source: media_url (direct file URL), media_text (SVG markup / Lottie JSON) or media_base64 (small files only). For a file on local disk use prepare_upload instead.",
      inputSchema: ItemFields.extend(MediaInput.shape).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (args) =>
      guard(async () => {
        const media = await loadMedia(args, args);
        if (!media) throw new Error("A media source is required: media_url, media_text or media_base64.");
        const { result } = await addItem(args, media);
        return { added: full(result, ctx), note: liveNote() };
      }),
  );

  server.registerTool(
    "update_item",
    {
      title: "Update an item",
      description:
        "Changes fields of an existing item. Only the fields you pass are changed; pass an empty string to clear a text field. Passing a media source replaces the media file.",
      inputSchema: z.object({ id: z.string() }).extend(ItemFields.partial().shape).extend(MediaInput.shape).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ id, ...args }) =>
      guard(async () => {
        const media = await loadMedia(args, args);
        const { result } = await updateItem(id, args, media);
        return { updated: full(result, ctx), note: liveNote() };
      }),
  );

  server.registerTool(
    "delete_items",
    {
      title: "Delete items",
      description: "Permanently removes items and their media files. Confirm with the user before calling.",
      inputSchema: z.object({ ids: z.array(z.string()).min(1).max(200) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ ids }) =>
      guard(async () => {
        const { result } = await deleteItems(ids);
        return { ...result, note: liveNote() };
      }),
  );

  server.registerTool(
    "prepare_upload",
    {
      title: "Upload a local file",
      description:
        "For files on the user's disk. Returns a curl command (valid 30 minutes) that uploads the file and creates the item with these fields in one step. Run it in a shell; running it again is safe, as it returns the item already made instead of adding another. To replace the media of an existing item, pass item_id instead of the item fields.",
      inputSchema: z
        .object({
          file_path: z.string().optional().describe("Local path of the file, used to fill in the command"),
          item_id: z.string().optional().describe("Existing item whose media should be replaced"),
        })
        .extend(ItemFields.partial().shape).strict(),
      annotations: { readOnlyHint: true },
    },
    ({ file_path, item_id, ...fields }) =>
      guard(async () => {
        if (!item_id) {
          if (!fields.title || !fields.category) throw new Error("title and category are required (or pass item_id).");
          const { site } = await getStore().read();
          if (!site.categories.some((c) => c.id === fields.category))
            throw new Error(`Unknown category "${fields.category}". Call list_categories.`);
        }
        // a new item's id is fixed now, so a repeated upload finds the item it already made
        const token = createUploadToken({ item_id, fields, new_id: item_id ? undefined : newId() });
        const file = file_path ? file_path.replace(/'/g, `'\\''`) : "/path/to/file";
        return {
          command: `curl -sS -F 'token=${token}' -F 'file=@${file}' ${ctx.origin}/api/upload`,
          expires_in_minutes: 30,
          limits: "Max ~4 MB per upload on Vercel. Large PNG/JPEG are converted to WebP automatically.",
        };
      }),
  );

  server.registerTool(
    "view_items",
    {
      title: "Look at items",
      description:
        "Returns a small picture of each item (first frame for GIFs and SVG animations) with its title, category and tags, so you can judge what it shows. Videos and Lottie files come back as a short description instead.",
      inputSchema: z.object({
        ids: z.array(z.string()).min(1).max(10),
        size: z.number().int().min(128).max(1024).optional().describe("Longest side of the picture in px (default 512)"),
      }).strict(),
      annotations: { readOnlyHint: true },
    },
    async ({ ids, size }) => {
      try {
        const store = getStore();
        const { items, site } = await store.read();
        const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
        for (const id of ids) {
          const item = items.find((i) => i.id === id);
          if (!item) {
            content.push({ type: "text", text: `${id}: not found` });
            continue;
          }
          const cat = site.categories.find((c) => c.id === item.category);
          content.push({
            type: "text",
            text: `${item.id} · 「${item.title}」 · ${item.inbox ? "收件箱（待整理）" : `${item.category}${cat ? `（${cat.label}）` : ""}`} · tags: ${item.tags.join(", ") || "—"} · ${item.media.type}`,
          });
          try {
            const pic = await preview(await store.readFile(`public${item.media.src}`), item.media.type, size ?? 512);
            content.push("note" in pic ? { type: "text", text: pic.note } : { type: "image", data: pic.data, mimeType: pic.mimeType });
          } catch (e) {
            content.push({ type: "text", text: `(could not load the media: ${e instanceof Error ? e.message : String(e)})` });
          }
        }
        return { content };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "organize_items",
    {
      title: "Organize many items at once",
      description:
        "Batch edits: change category, title, tags (replace / add / remove), note, colour or featured on many items, rename or merge tags across the whole library, and create categories — all in ONE commit. Giving an inbox picture a category files it onto the site. Defaults to dry_run=true, which only returns the plan (before → after for every item) and changes nothing. Show the plan to the user and call again with dry_run=false once they agree.",
      inputSchema: OrganizeInput.strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (spec) =>
      guard(async () => {
        const out = await organizeItems(spec);
        return out.applied
          ? { ...out, note: liveNote() }
          : { ...out, note: "Dry run — nothing was changed. Call again with dry_run: false to apply." };
      }),
  );

  server.registerTool(
    "upsert_category",
    {
      title: "Add or rename a category",
      description: "Adds a new category or renames an existing one (matched by id).",
      inputSchema: z.object({
        id: z.string().regex(/^[a-z0-9-]+$/).describe("Lowercase id, e.g. \"loader\""),
        name: z.string().min(1).max(30).describe("English display name for the big type list, e.g. \"Loaders\""),
        label: z.string().min(1).max(12).describe("Chinese label, e.g. \"加载动画\""),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (cat) =>
      guard(async () => {
        const { result } = await upsertCategory(cat);
        return { categories: result, note: liveNote() };
      }),
  );
}
