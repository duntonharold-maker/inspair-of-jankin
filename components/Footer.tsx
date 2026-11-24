import Mark from "./Mark";
import type { Site } from "@/lib/types";

export default function Footer({ site, repoUrl }: { site: Site; repoUrl?: string }) {
  return (
    <footer className="footer">
      <div className="footer-top">
        <p className="footer-line">
          Keep
          <br />
          collecting.
        </p>
        <nav className="footer-links" aria-label="页脚">
          <div>
            <h4>浏览</h4>
            <a href="/#fresh">最新</a>
            <a href="/#categories">分类</a>
            <a href="/#all">全部</a>
          </div>
          <div>
            <h4>更多</h4>
            <a href="/#mcp">MCP</a>
            {repoUrl && (
              <a href={repoUrl} target="_blank" rel="noopener noreferrer">
                GitHub ↗
              </a>
            )}
          </div>
        </nav>
      </div>
      <div className="footer-mark">
        <Mark size="0.82em" />
        <span>{site.name}</span>
      </div>
      <p className="footer-legal">
        © {new Date().getFullYear()} {site.owner} · 收藏的作品版权归原作者所有
      </p>
    </footer>
  );
}
