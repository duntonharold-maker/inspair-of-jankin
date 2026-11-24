"use client";
import { useMemo, useRef } from "react";
import MediaView from "@/components/MediaView";
import { local } from "../timeline";
import { useStoryFrame, useStoryValue } from "../store";
import TickRuler from "./TickRuler";
import type { Item } from "@/lib/types";

const MODELS = ["Midjourney", "GPT Image", "Flux", "即梦"];

const STEPS = [
  { title: "Spot it", text: "在哪里看到喜欢的图片、动效或界面都行。" },
  { title: "Hand it over", text: "把链接、SVG 或文件丢给智能体，它通过 MCP 收进来。" },
  { title: "Keep the prompt", text: "提示词、模型和参数原样记下，下次直接复制。" },
  { title: "Find it again", text: "按分类、标签或提示词里的一个词，就能找回来。" },
];

/** "→ Start from something you saw then make it unmistakably (yours)", assembled from scattered letters. */
const MORE: { text: string; cls: string }[] = [
  { text: "→ Start from", cls: "ml-1" },
  { text: "something", cls: "ml-2" },
  { text: "you saw", cls: "ml-3" },
  { text: "then", cls: "ml-4" },
  { text: "make it", cls: "ml-5" },
  { text: "unmistakably", cls: "ml-6" },
  { text: "(yours)", cls: "ml-7" },
];

function scatter(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export default function CustomScreen({ items }: { items: Item[] }) {
  const step = useStoryValue((p) => {
    const t = local(p, "custom");
    return Math.min(3, Math.max(0, Math.floor(((t - 0.04) / 0.6) * 4)));
  });
  const model = useStoryValue((p) => {
    const t = local(p, "custom");
    return Math.floor(Math.max(0, t - 0.34) * 40) % MODELS.length;
  });
  const moreRef = useRef<HTMLDivElement>(null);

  useStoryFrame((p) => {
    const box = moreRef.current;
    if (!box) return;
    const t = local(p, "custom");
    if (t < 0.6 || t > 1.1) return;
    const lines = box.children;
    for (let l = 0; l < lines.length; l++) {
      const r = Math.min(1, Math.max(0, (t - 0.7 - l * 0.025) / 0.12));
      const e = 1 - Math.pow(1 - r, 3);
      const chars = (lines[l] as HTMLElement).children;
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i] as HTMLElement;
        const sx = (scatter(l * 31 + i) - 0.5) * 3;
        const sy = (scatter(l * 17 + i * 3 + 1) - 0.5) * 2.4;
        c.style.transform = `translate3d(${((1 - e) * sx).toFixed(3)}em, ${((1 - e) * sy).toFixed(3)}em, 0)`;
        c.style.opacity = e.toFixed(3);
      }
    }
  });

  const hero = useMemo(() => items.find((i) => i.media.type === "image" && i.prompt) ?? items[0], [items]);
  const results = useMemo(() => items.filter((i) => i.media.type === "image").slice(0, 6), [items]);

  return (
    <section data-screen="custom" data-on="0" className="scr scr-custom" aria-labelledby="custom-title">
      <h2 id="custom-title" className="sr-only">
        怎么收进来
      </h2>
      <div className={`app-panel step-${step}`} aria-hidden="true">
        <div className="app-bar">
          <i />
          <i />
          <i />
          <span>inspair · 新收藏</span>
        </div>
        <div className="app-body">
          <div className="app-drop">
            {hero && (
              <div className="app-media">
                <MediaView item={hero} />
              </div>
            )}
            <span className="app-drop-hint">把图片拖进来，或者丢一个链接</span>
          </div>
          <div className="app-fields">
            <div className="app-field app-title">{hero?.title}</div>
            <div className="app-chips">
              {hero?.tags.slice(0, 3).map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <div className="app-prompt">
              <div className="app-models">
                {MODELS.map((m, k) => (
                  <span key={m} className={k === model ? "is-on" : ""}>
                    {m}
                  </span>
                ))}
              </div>
              <p>{hero?.prompt}</p>
            </div>
          </div>
          <div className="app-search">
            <div className="app-query">
              <span>⌕</span> 红黑
            </div>
            <div className="app-results">
              {results.map((i, k) => (
                <div key={i.id} className={k === 1 ? "is-hit" : ""}>
                  <MediaView item={i} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="custom-steps">
        <TickRuler className="custom-ruler" at={step / 3} />
        <ol className="custom-view" style={{ ["--step" as string]: step }}>
          {STEPS.map((s, k) => (
            <li key={s.title} className={k === step ? "is-active" : ""}>
              <span className="custom-num">0{k + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              {k === 2 && (
                <div className="custom-swatches" aria-hidden="true">
                  {MODELS.map((m, j) => (
                    <span key={m} className={j === model ? "is-on" : ""}>
                      {m}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div ref={moreRef} className="custom-more" aria-label="Start from something you saw, then make it unmistakably yours">
        {MORE.map((line) => (
          <span key={line.cls} className={`ml ${line.cls}`} aria-hidden="true">
            {[...line.text].map((ch, i) => (
              <span key={i} className="ml-ch">
                {ch === " " ? " " : ch}
              </span>
            ))}
          </span>
        ))}
      </div>
    </section>
  );
}
