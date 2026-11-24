import Drum from "@/components/Drum";
import type { Site } from "@/lib/types";

export default function HeroScreen({ site, count }: { site: Site; count: number }) {
  return (
    <section data-screen="hero" data-on="1" className="scr scr-hero" aria-label="介绍">
      <div className="hero-inner">
        <h1 className="hero-title">
          <span className="hero-l">
            <span className="rise">Spotted</span>
            <span className="rise" style={{ animationDelay: "80ms" }}>
              already
            </span>
          </span>
          <span className="hero-r">
            <span className="rise" style={{ animationDelay: "140ms" }}>
              Now keep
            </span>
            <span className="rise" style={{ animationDelay: "220ms" }}>
              it <span className="paren">(</span>
              <Drum word="close" />
              <span className="paren">)</span>
            </span>
          </span>
        </h1>
        <div className="hero-notes">
          <p className="rise" style={{ animationDelay: "500ms" }}>
            {site.name} 收着 {site.owner} 看过就忘不掉的图片和动效，连同生成它们的提示词
          </p>
          <p className="rise" style={{ animationDelay: "620ms" }}>
            交给智能体，它会填好标题、分类和标签
          </p>
          <p className="rise" style={{ animationDelay: "740ms" }}>
            已收藏 {count} 条
          </p>
        </div>
      </div>
    </section>
  );
}
