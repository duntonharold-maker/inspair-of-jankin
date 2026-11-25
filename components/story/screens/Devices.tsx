import { ArrowRight } from "lucide-react";
import MediaView from "@/components/MediaView";
import type { Item, Site } from "@/lib/types";

export default function DevicesScreen({ items, site }: { items: Item[]; site: Site }) {
  const shown = items.slice(0, 12);
  return (
    <section data-screen="devices" data-on="0" className="scr scr-devices" aria-labelledby="devices-title">
      <h2 id="devices-title" className="h-display devices-title">
        On every
        <br />
        <ArrowRight className="arrow" /> device
      </h2>
      <div className="phone" aria-hidden="true">
        <div className="phone-screen">
          <div className="phone-nav">
            <b>{site.name}</b>
            <span>
              随便看看 <ArrowRight />
            </span>
          </div>
          <div className="phone-feed">
            {[0, 1].map((col) => (
              <div key={col} className="phone-col">
                {shown
                  .filter((_, k) => k % 2 === col)
                  .map((item) => (
                    <div key={item.id} className="phone-card" style={{ background: item.media.background }}>
                      <MediaView item={item} />
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="devices-copy">
        <p>电脑上收藏，平板上翻看，手机上随手复制提示词。</p>
        <p>不用登录，打开链接就能看。</p>
      </div>
    </section>
  );
}
