import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createUploadToken } from "./auth";
import { preview } from "./media";
import {
  ArrangeInput,
  ItemFields,
  MediaInput,
  OrganizeInput,
  addItem,
  arrangeSet,
  deleteItems,
  groupItems,
  loadMedia,
  moveMediaToBlob,
  newId,
  organizeItems,
  search,
  updateItem,
  upsertCategory,
} from "./ops";
import { LinkFields, LinkUpdate, addLink, deleteLinks, searchLinks, updateLink, upsertLinkCategory } from "./links";
import { getStore } from "./store";
import { picturesOf, type Item } from "./types";

export const MCP_INSTRUCTIONS = `This server manages "inspair", a personal inspiration library of images and animated UI (icons, loaders, micro-interactions), each optionally with the prompt that generated it.

Workflow:
- Call list_categories first to learn valid category ids and existing tags.
- Image or video on the web → add_item with media_url (a direct file URL, not a web page).
- SVG icon or Lottie animation as text → add_item with media_text.
- A file on the user's disk and you can run shell commands → prepare_upload, then run the returned curl command.
- A design shown over several pictures (a preview, then details) is ONE item, a set: add_item with the
  cover as media_url and the rest, in order, as more_media_urls. The detail view flips through them.
- Always record the generation prompt verbatim in "prompt" when the user gives one, and the model/tool in "model".
- Changes are committed to GitHub; the public site shows them after the next deploy (usually 1–2 minutes).

Websites worth keeping (the /links page, separate from the pictures; never on the home page):
- add_link with the address, a link category (list_categories → link_categories), a one-line pitch of
  what the site is, 3–5 concrete strengths ("pros") from what it actually offers, its price (free /
  freemium / paid) and a few tags — all in Chinese, product names kept. Look at the site first (fetch the
  page) so the strengths are true; the user's own words go in "note".
- update_link changes one; search_links finds them; delete_links removes them (confirm first).

Sets (several pictures of one design in one item): search results show "pictures" when there is more
than one; view_items with all_pictures: true shows each. group_items makes one set of several items (the
first is the cover; preview with dry_run, apply when the user agrees). arrange_group reorders a set,
changes its cover, takes pictures out as items of their own (split) or drops pictures.

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
   A picture from an image generator may already carry its prompt, model and parameters (and the author in
   the note): keep them as they are; the note can say what the prompt does well.
   Giving an inbox picture a category files it onto the site. Show the plan (dry_run) first; apply after
   the user agrees. Pictures that aren't worth keeping can be deleted with delete_items instead.
   Several inbox pictures of one design (same page, a preview and its details) belong together: propose
   group_items for them first (cover first), then file the set.
4. Websites saved with the extension wait in the inbox too: search_links with inbox: true shows each with
   the page's own text (excerpt) and whatever the user said (note). For each, propose name, link category,
   pitch, pros, price and tags (open the site when the excerpt is thin), show the plan, then apply with
   update_link and inbox: false, which puts it on /links. Keep the user's note as it is.`;

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
    ...(item.gallery?.length ? { pictures: picturesOf(item).length } : {}),
    prompt: item.prompt && item.prompt.length > 160 ? item.prompt.slice(0, 160) + "…" : item.prompt,
    model: item.model,
    ...(item.inbox ? { inbox: true, source: item.source, note: item.note } : { url: `${ctx.origin}/i/${item.id}` }),
    created_at: item.createdAt,
  };
}

function full(item: Item, ctx: Ctx) {
  // an inbox picture has no page yet, and its file goes live with the deploy that files it
  if (item.inbox) return item;
  return {
    ...item,
    url: `${ctx.origin}/i/${item.id}`,
    media_url: `${ctx.origin}${item.media.src}`,
    ...(item.gallery?.length ? { more_media_urls: item.gallery.map((m) => `${ctx.origin}${m.src}`) } : {}),
  };
}

export function registerTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    "list_categories",
    {
      title: "List categories and tags",
      description: "Lists the valid category ids (with Chinese labels and item counts), the most used tags, how many collected pictures wait in the inbox, and the link categories of saved websites (with counts and how many sites wait in the inbox).",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(async () => {
        const { items: all, site, links } = await getStore().read();
        const items = all.filter((i) => !i.inbox);
        const filed = links.filter((l) => !l.inbox);
        const tagCounts = new Map<string, number>();
        for (const i of items) for (const t of i.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
        return {
          total_items: items.length,
          inbox: all.length - items.length,
          categories: site.categories.map((c) => ({ ...c, count: items.filter((i) => i.category === c.id).length })),
          top_tags: [...tagCounts].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([tag, count]) => ({ tag, count })),
          link_categories: site.linkCategories.map((c) => ({ ...c, count: filed.filter((l) => l.category === c.id).length })),
          links_inbox: links.length - filed.length,
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
        "Adds an image or animated UI piece. Provide exactly one media source: media_url (direct file URL), media_text (SVG markup / Lottie JSON) or media_base64 (small files only). For a file on local disk use prepare_upload instead. A design shown over several pictures is one item: give the cover as the media source and the others, in order, as more_media_urls.",
      inputSchema: ItemFields.extend(MediaInput.shape)
        .extend({
          more_media_urls: z
            .array(z.string().url())
            .max(20)
            .optional()
            .describe("The rest of a set, in order after the cover: direct file URLs of images, GIFs or videos"),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (args) =>
      guard(async () => {
        const media = await loadMedia(args, args);
        if (!media) throw new Error("A media source is required: media_url, media_text or media_base64.");
        const more = [];
        for (const url of args.more_media_urls ?? []) more.push((await loadMedia({ media_url: url }))!);
        const { result } = await addItem(args, media, undefined, more);
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
        "Returns a small picture of each item (first frame for GIFs and SVG animations) with its title, category and tags, so you can judge what it shows. Videos and Lottie files come back as a short description instead. For a set, only the cover unless all_pictures is true (at most 10 pictures per call).",
      inputSchema: z.object({
        ids: z.array(z.string()).min(1).max(10),
        all_pictures: z.boolean().optional().describe("Show every picture of a set, not only its cover"),
        size: z.number().int().min(128).max(1024).optional().describe("Longest side of the picture in px (default 512)"),
      }).strict(),
      annotations: { readOnlyHint: true },
    },
    async ({ ids, size, all_pictures }) => {
      try {
        const store = getStore();
        const { items, site } = await store.read();
        const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
        let shown = 0;
        for (const id of ids) {
          const item = items.find((i) => i.id === id);
          if (!item) {
            content.push({ type: "text", text: `${id}: not found` });
            continue;
          }
          const cat = site.categories.find((c) => c.id === item.category);
          const pics = picturesOf(item);
          const where = item.inbox
            ? `收件箱（待整理${item.category ? `，采集时选了 ${item.category}` : ""}）`
            : `${item.category}${cat ? `（${cat.label}）` : ""}`;
          content.push({
            type: "text",
            text: `${item.id} · 「${item.title}」 · ${where} · tags: ${item.tags.join(", ") || "—"} · ${item.media.type}${
              pics.length > 1 ? ` · a set of ${pics.length} pictures${all_pictures ? "" : " (cover shown)"}` : ""
            }`,
          });
          for (const [k, media] of (all_pictures ? pics : pics.slice(0, 1)).entries()) {
            if (shown >= 10) {
              content.push({ type: "text", text: "(10 pictures shown; ask again for the rest)" });
              break;
            }
            if (all_pictures && pics.length > 1) content.push({ type: "text", text: `picture ${k}${k === 0 ? " (cover)" : ""}` });
            try {
              const pic = await preview(await store.readFile(`public${media.src}`), media.type, size ?? 512);
              content.push("note" in pic ? { type: "text", text: pic.note } : { type: "image", data: pic.data, mimeType: pic.mimeType });
              shown++;
            } catch (e) {
              content.push({ type: "text", text: `(could not load the media: ${e instanceof Error ? e.message : String(e)})` });
            }
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
    "group_items",
    {
      title: "Make a set of several items",
      description:
        "Makes ONE item of several that show the same design (a preview and its details): the first id is the cover and keeps its title, category, prompt and note; the pictures of the others follow in the order given, their tags are merged, and those items are removed (their pictures live on in the set). Defaults to dry_run=true, which only returns the plan. Show it to the user and call again with dry_run=false once they agree.",
      inputSchema: z.object({
        ids: z.array(z.string()).min(2).max(30).describe("The cover first, then the others in order"),
        dry_run: z.boolean().default(true),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ ids, dry_run }) =>
      guard(async () => {
        const out = await groupItems(ids, { dryRun: dry_run });
        return out.applied
          ? { ...out, note: liveNote() }
          : { ...out, note: "Dry run — nothing was changed. Call again with dry_run: false to apply." };
      }),
  );

  server.registerTool(
    "arrange_group",
    {
      title: "Reorder or split a set",
      description:
        "For an item with several pictures: reorder them or pick another cover (order), take pictures out as items of their own (split), or drop pictures (leave them out of order). Pictures are counted from 0, the cover; view_items with all_pictures shows them numbered.",
      inputSchema: ArrangeInput,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    (spec) =>
      guard(async () => {
        const out = await arrangeSet(spec);
        return { ...out, note: liveNote() };
      }),
  );

  server.registerTool(
    "move_media_to_blob",
    {
      title: "Move media out of the repository",
      description:
        "Maintenance, only when the user asks: moves the media files still kept in the repository (public/media) into the connected Blob store and removes them from the repository in one commit. Nothing on the site changes: the same /media/… addresses are then served from the store. dry_run (default) only counts the files.",
      inputSchema: z.object({ dry_run: z.boolean().default(true) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ dry_run }) =>
      guard(async () => {
        const out = await moveMediaToBlob({ dryRun: dry_run });
        return out.applied ? { ...out, note: liveNote() } : { ...out, note: "Dry run — call again with dry_run: false to move them." };
      }),
  );

  server.registerTool(
    "add_link",
    {
      title: "Save a website",
      description:
        "Saves a website onto the /links page (not the home page) with a one-line pitch, its main strengths, price and tags. Its icon is fetched automatically. Look at the site first so the strengths are accurate.",
      inputSchema: LinkFields.strict(),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (args) =>
      guard(async () => {
        const { result } = await addLink(args);
        return { added: result, page: `${ctx.origin}/links`, note: liveNote() };
      }),
  );

  server.registerTool(
    "update_link",
    {
      title: "Change a saved website",
      description:
        "Changes a saved website: only the fields passed change (empty string clears pitch or note; pros and tags replace the lists). inbox: false files a website collected with the browser extension onto /links.",
      inputSchema: LinkUpdate,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (args) =>
      guard(async () => {
        const { result } = await updateLink(args);
        return { updated: result, note: liveNote() };
      }),
  );

  server.registerTool(
    "search_links",
    {
      title: "Search saved websites",
      description:
        "Searches saved websites by text (name, address, pitch, strengths, tags, note) and link category. inbox: true lists the ones collected with the extension and not filed yet, with the page text taken when they were saved (excerpt).",
      inputSchema: z.object({
        query: z.string().optional(),
        category: z.string().optional(),
        inbox: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }).strict(),
      annotations: { readOnlyHint: true },
    },
    (q) =>
      guard(async () => {
        const out = searchLinks(await getStore().read(), q);
        return { total: out.total, links: out.links.map((l) => (l.inbox ? l : (({ excerpt: _e, ...rest }) => rest)(l))) };
      }),
  );

  server.registerTool(
    "delete_links",
    {
      title: "Delete saved websites",
      description: "Permanently removes saved websites. Confirm with the user before calling.",
      inputSchema: z.object({ ids: z.array(z.string()).min(1).max(100) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ ids }) =>
      guard(async () => {
        const { result } = await deleteLinks(ids);
        return { ...result, note: liveNote() };
      }),
  );

  server.registerTool(
    "upsert_link_category",
    {
      title: "Add or rename a link category",
      description: "Adds a category for saved websites, or renames one (matched by id).",
      inputSchema: z.object({
        id: z.string().regex(/^[a-z0-9-]+$/).describe('Lowercase id, e.g. "fonts"'),
        label: z.string().min(1).max(12).describe("Chinese label, e.g. 字体"),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (cat) =>
      guard(async () => {
        const { result } = await upsertLinkCategory(cat);
        return { link_categories: result, note: liveNote() };
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
