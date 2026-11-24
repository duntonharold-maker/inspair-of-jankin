"use client";
import { useEffect, useState } from "react";

const N = 72;

/** A ruler on the right edge whose ticks swell around the current scroll position. */
export default function Ruler() {
  const [p, setP] = useState(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setP(max > 0 ? window.scrollY / max : 0);
    };
    const on = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);
  const at = p * (N - 1);
  return (
    <div className="ruler" aria-hidden="true">
      {Array.from({ length: N }, (_, k) => {
        const d = Math.abs(k - at);
        const s = Math.max(0, 1 - d / 6);
        return <span key={k} style={{ ["--s" as string]: s.toFixed(3) }} />;
      })}
    </div>
  );
}
