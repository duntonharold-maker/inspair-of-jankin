"use client";
import { useMemo } from "react";
import MediaView from "@/components/MediaView";
import { local } from "../timeline";
import { useStoryValue } from "../store";
import type { Item } from "@/lib/types";

const RATIOS = ["3:4", "4:5", "9:16", "1:1", "4:3", "16:9"];
const MODELS = ["Midjourney", "GPT Image", "Flux", "即梦"];

export default function ExportScreen({ items }: { items: Item[] }) {
  const k = useStoryValue((p) => {
    const t = local(p, "export");
    return Math.min(RATIOS.length - 1, Math.max(0, Math.floor(((t - 0.1) / 0.8) * RATIOS.length)));
  });
  const model = k % MODELS.length;
  const [w, h] = RATIOS[k].split(":").map(Number);
  const item = useMemo(() => items.find((i) => i.media.type === "image" && i.prompt) ?? items[0], [items]);
  const param = model === 0 ? `--ar ${RATIOS[k]}` : model === 1 ? `size: ${w}:${h}` : model === 2 ? `aspect_ratio: "${RATIOS[k]}"` : `比例 ${RATIOS[k]}`;

  return (
    <section data-screen="export" data-on="0" className="scr scr-export" aria-labelledby="export-title">
      <div className="export-words">
        <h2 id="export-title" className="h-display">
          Copy once.
          <br />
          <span className="arrow">→</span> Use it anywhere
        </h2>
        <div className="export-rows" aria-hidden="true">
          <div className="pills">
            {RATIOS.map((r, j) => (
              <span key={r} className={j === k ? "is-on" : ""}>
                {r}
              </span>
            ))}
          </div>
          <div className="pills">
            {MODELS.map((m, j) => (
              <span key={m} className={j === model ? "is-on" : ""}>
                {m}
              </span>
            ))}
            <span className="pills-note">文本 / JSON</span>
          </div>
        </div>
        <div className="export-notes">
          <p>提示词和参数一起复制，贴进哪个模型都行。</p>
          <p>比例、模型和参数跟着卡片一起保存。</p>
        </div>
      </div>
      <div className="export-stage" aria-hidden="true">
        <div className="export-frame" style={{ aspectRatio: `${w} / ${h}`, ["--ar" as string]: w / h }}>
          {item && <MediaView item={item} />}
        </div>
        <code className="export-param">{param}</code>
      </div>
    </section>
  );
}
