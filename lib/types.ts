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
});
export type Media = z.infer<typeof MediaSchema>;

export const ItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  media: MediaSchema,
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
