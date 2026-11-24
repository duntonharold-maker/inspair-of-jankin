import Home from "@/components/Home";
import { getContent } from "@/lib/content";
import { siteUrl } from "@/lib/origin";
import { repoUrl } from "@/lib/repo";

export default function Page() {
  const { items, site } = getContent();
  return <Home items={items} site={site} repoUrl={repoUrl()} siteUrl={siteUrl()} />;
}
