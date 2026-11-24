import "@fontsource/inter-tight/400.css";
import "@fontsource/inter-tight/500.css";
import "@fontsource/inter-tight/600.css";
import "lenis/dist/lenis.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import Ruler from "@/components/Ruler";
import SmoothScroll from "@/components/SmoothScroll";
import { getContent } from "@/lib/content";

const { site } = getContent();

const siteUrl =
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: `${site.name} — ${site.owner} 的灵感集合`, template: `%s · ${site.name}` },
  description: site.description,
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { themeColor: "#f2f5f7", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <SmoothScroll />
        {children}
        <Ruler />
      </body>
    </html>
  );
}
