import { z } from "zod";

export const MEDIA_TYPES = ["image", "video", "svg", "lottie"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const MediaSchema = z.object({
  /** Public path, e.g. /media/20261124-k3x9qa.webp */
  src: z.string(),
  type: z.enum(MEDIA_TYPES),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** True when the piece doesn't cover its whole frame: its corners or edges are clear, as with an icon on
   * a rounded tile, a sticker or an animation without a backdrop. Worked out when it is added. Such a piece
   * is shown whole, with room around it on a plain stage, so its own outline stays as it was designed;
   * anything else fills its card. */
  cutout: z.boolean().optional(),
  /** Public path of a smaller copy of a still picture (800px wide WebP), made when it is added. Cards and
   * the scene show it; the detail view shows the full file. */
  thumb: z.string().optional(),
  /** A picture of a set (Item.gallery) collected from a web page: its own address there, to spot it twice. */
  imageUrl: z.string().optional(),
  /** What this picture was on its own before it joined a set (title, note, category…), so taking it out of
   * the set gives it back as it was. */
  origin: z
    .object({
      title: z.string(),
      category: z.string().optional(),
      tags: z.array(z.string()).optional(),
      note: z.string().optional(),
      source: z.string().optional(),
      color: z.string().optional(),
      createdAt: z.string().optional(),
    })
    .optional(),
});
export type Media = z.infer<typeof MediaSchema>;

export const ItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  /** The cover: what cards, categories and the scene show. */
  media: MediaSchema,
  /** The rest of a set (a design shown over several pictures: a preview, then the details), in order after
   * the cover. The detail view flips through all of them. */
  gallery: z.array(MediaSchema).optional(),
  /** The prompt used to generate this piece, if any. */
  prompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  /** Tool / model, e.g. "Midjourney v7", "GPT Image", "Flux 1.1 Pro". */
  model: z.string().optional(),
  /** Extra parameters, e.g. "--ar 3:4 --stylize 250". */
  params: z.string().optional(),
  /** Where it was found. */
  source: z.string().optional(),
  note: z.string().optional(),
  /** Accent color as hex, e.g. #c8102e. */
  color: z.string().optional(),
  featured: z.boolean().optional(),
  /** Collected with the browser extension and not filed yet: kept out of the site (category may be "")
   * until an agent gives it a category, which files it. */
  inbox: z.boolean().optional(),
  /** The picture's own address when it was collected from a web page, to spot it being collected twice. */
  imageUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});
export type Item = z.infer<typeof ItemSchema>;

export const CategorySchema = z.object({
  /** Stable id used in items, e.g. "icon". */
  id: z.string(),
  /** Display name in the big type list, e.g. "Icons". */
  name: z.string(),
  /** Short Chinese label, e.g. "图标". */
  label: z.string(),
});
export type Category = z.infer<typeof CategorySchema>;

export const LinkCategorySchema = z.object({ id: z.string(), label: z.string() });
export type LinkCategory = z.infer<typeof LinkCategorySchema>;

export const SiteSchema = z.object({
  name: z.string(),
  owner: z.string(),
  description: z.string(),
  categories: z.array(CategorySchema),
  /** The categories of saved websites (content/links.json), shown on /links. */
  linkCategories: z.array(LinkCategorySchema).default([]),
});
export type Site = z.infer<typeof SiteSchema>;

/** Every picture of an item: the cover, then the rest of its set. */
export const picturesOf = (item: Pick<Item, "media" | "gallery">): Media[] => [item.media, ...(item.gallery ?? [])];

export const LINK_PRICES = ["free", "freemium", "paid"] as const;
export const PRICE_LABEL = { free: "免费", freemium: "部分付费", paid: "付费" } as const;

/** A website worth keeping (/links): what it is, what it is good at, and what I thought of it. */
export const LinkSchema = z.object({
  id: z.string(),
  url: z.string(),
  name: z.string(),
  /** A link category id (site.linkCategories); may be "" while the link waits in the inbox. */
  category: z.string(),
  /** One line: what the site is, e.g. 「真实 App 和网站的界面截图库」. */
  pitch: z.string().optional(),
  /** Its main strengths, 3–5 concrete points. */
  pros: z.array(z.string()).default([]),
  price: z.enum(LINK_PRICES).optional(),
  tags: z.array(z.string()).default([]),
  /** What I said about it (my own words). */
  note: z.string().optional(),
  /** Public path of its icon, e.g. /media/link-20261127-abc123.png */
  icon: z.string().optional(),
  /** Text taken from the page when it was collected (title, description, headings), for whoever files it. */
  excerpt: z.string().optional(),
  /** Collected with the browser extension and not filed yet: kept off /links. */
  inbox: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});
export type Link = z.infer<typeof LinkSchema>;
