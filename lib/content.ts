/** Build-time content for the pages. JSON is bundled at build time, so nothing reads the disk at runtime. */
import itemsJson from "@/content/items.json";
import siteJson from "@/content/site.json";
import { ItemSchema, SiteSchema, type Item, type Site } from "./types";

// pictures still in the inbox (collected, not filed yet) stay off the site
const items = ItemSchema.array()
  .parse(itemsJson)
  .filter((i) => !i.inbox)
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const site = SiteSchema.parse(siteJson);

export function getContent(): { items: Item[]; site: Site } {
  return { items, site };
}
