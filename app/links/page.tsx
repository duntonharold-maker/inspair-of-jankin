import type { Metadata } from "next";
import Footer from "@/components/Footer";
import Links from "@/components/Links";
import Nav from "@/components/Nav";
import { getContent, getLinks } from "@/lib/content";
import { repoUrl } from "@/lib/repo";

export const metadata: Metadata = { title: "网站", description: "收藏的设计网站：它是做什么的、强在哪里。" };

export default function LinksPage() {
  const { site } = getContent();
  return (
    <>
      <Nav site={site} current="links" />
      <Links site={site} links={getLinks()} />
      <Footer site={site} repoUrl={repoUrl()} />
    </>
  );
}
