import { ArrowUpRight } from "lucide-react";
import Mark from "./Mark";
import type { Site } from "@/lib/types";

export default function Footer({ site, repoUrl }: { site: Site; repoUrl?: string }) {
  return (
    <footer className="footer">
      <div className="footer-top">
        <div className="footer-lead">
          <p className="footer-line">
            Keep collecting,
            <br />
            before it’s gone
          </p>
          <p className="footer-mail">{site.description}</p>
        </div>
        <nav className="footer-links" aria-label="页脚">
          <div>
            <h4>浏览</h4>
            <a href="/#fresh">最新</a>
            <a href="/#categories">分类</a>
            <a href="/#all">全部</a>
          </div>
          <div>
            <h4>更多</h4>
            {repoUrl && (
              <a href={repoUrl} target="_blank" rel="noopener noreferrer">
                GitHub
                <ArrowUpRight className="ic-out" />
              </a>
            )}
          </div>
        </nav>
      </div>
      <div className="footer-sign">
        <div className="footer-mark">
          <span className="footer-tile">
            <Mark size="0.62em" live />
          </span>
          <span>{site.name}</span>
        </div>
        <div className="footer-legal">
          <span>
            © {new Date().getFullYear()} {site.owner}
          </span>
          <span>收藏的作品版权归原作者所有</span>
          <span>Collected with MCP</span>
        </div>
      </div>
    </footer>
  );
}
