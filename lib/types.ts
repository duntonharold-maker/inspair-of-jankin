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

export const SiteSchema = z.object({
  name: z.string(),
  owner: z.string(),
  description: z.string(),
  categories: z.array(CategorySchema),
});
export type Site = z.infer<typeof SiteSchema>;

/** Every picture of an item: the cover, then the rest of its set. */
export const picturesOf = (item: Pick<Item, "media" | "gallery">): Media[] => [item.media, ...(item.gallery ?? [])];
