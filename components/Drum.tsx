"use client";

/**
 * A word printed twice around a turning drum, seen through a pair of parentheses:
 * "(close)" rolls by as "(lose c)", "(ose cl)"…
 */
export default function Drum({ word }: { word: string }) {
  const slots = [...`${word} ${word} `];
  const n = slots.length;
  return (
    <span className="drum" style={{ ["--n" as string]: n, ["--w" as string]: word.length }}>
      {/* screen readers get the word itself; the turning letters are only for the eye */}
      <span className="sr-only">{word}</span>
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
