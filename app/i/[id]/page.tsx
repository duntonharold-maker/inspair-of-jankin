import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Footer from "@/components/Footer";
import ItemDetail from "@/components/ItemDetail";
import Nav from "@/components/Nav";
import { getContent } from "@/lib/content";
import { repoUrl } from "@/lib/repo";

export const dynamicParams = false;

export function generateStaticParams() {
  return getContent().items.map((i) => ({ id: i.id }));
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const item = getContent().items.find((i) => i.id === id);
  if (!item) return {};
  const desc = item.note || item.prompt || item.tags.join(" · ");
  return {
    title: item.title,
    description: desc?.slice(0, 160),
    openGraph: item.media.type === "image" ? { images: [item.media.src] } : undefined,
  };
}

export default async function ItemPage({ params }: Props) {
  const { id } = await params;
  const { items, site } = getContent();
  const item = items.find((i) => i.id === id);
  if (!item) notFound();
  return (
    <>
      <Nav site={site} />
      <main className="item-page">
        <a className="back" href="/#all">
          <ArrowLeft className="ic-back" />
          返回全部
        </a>
        <ItemDetail item={item} site={site} heading="h1" />
      </main>
      <Footer site={site} repoUrl={repoUrl()} />
    </>
  );
}
