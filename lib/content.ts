/** Build-time content for the pages. JSON is bundled at build time, so nothing reads the disk at runtime. */
import itemsJson from "@/content/items.json";
import siteJson from "@/content/site.json";
import { ItemSchema, SiteSchema, type Item, type Site } from "./types";

const items = ItemSchema.array()
  .parse(itemsJson)
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const site = SiteSchema.parse(siteJson);

export function getContent(): { items: Item[]; site: Site } {
  return { items, site };
}
