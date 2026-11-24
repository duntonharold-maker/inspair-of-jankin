import { Fragment } from "react";
import { scrollToId } from "@/lib/scroll";

/** Words that come into focus one after another, from --a onward in the screen's progress. */
export function Reveal({ text, from, step = 0.018, className }: { text: string; from: number; step?: number; className?: string }) {
  return (
    <span className={className}>
      {text.split(" ").map((w, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className="rv" style={{ ["--a" as string]: from + i * step }}>
            {w}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

export default function LibraryScreen() {
  return (
    <section data-screen="library" data-on="0" className="scr scr-lib" aria-labelledby="lib-title">
      <div className="lib-fallback" aria-hidden="true" />
      <div className="lib-copy">
        <h2 id="lib-title" className="h-display lib-title">
          <Reveal text="Fresh" from={0.6} />
          <br />
          <Reveal text="from the" from={0.62} />
          <br />
          <Reveal text="stash" from={0.66} />
        </h2>
        <div className="lib-notes">
          <p>
            <Reveal text="最近收进来的图片和动效， 精选的钉在这面墙上。" from={0.7} step={0.02} />
          </p>
          <p>
            <Reveal text="点开任意一张， 看它的提示词、 模型和出处。" from={0.73} step={0.02} />
          </p>
        </div>
        <button className="btn btn--dark rv" style={{ ["--a" as string]: 0.77 }} onClick={() => scrollToId("all")}>
          浏览全部 <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
