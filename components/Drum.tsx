"use client";

/**
 * A word printed twice around a turning drum, seen through a pair of parentheses:
 * "(close)" rolls by as "(lose c)", "(ose cl)"…
 */
export default function Drum({ word }: { word: string }) {
  const slots = [...`${word} ${word} `];
  const n = slots.length;
  return (
    <span className="drum" aria-label={word} style={{ ["--n" as string]: n, ["--w" as string]: word.length }}>
      <span className="drum-ring" aria-hidden="true">
        {slots.map((ch, i) => (
          <span key={i} className="drum-ch" style={{ ["--i" as string]: i }}>
            {ch === " " ? " " : ch}
          </span>
        ))}
      </span>
    </span>
  );
}
