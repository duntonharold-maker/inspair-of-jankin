"use client";

/** A number whose digits roll into place like an odometer when `live` turns on. */
export default function Roll({ value, live }: { value: number; live: boolean }) {
  const digits = String(value).split("");
  return (
    <span className="roll" aria-label={String(value)}>
      {digits.map((d, i) => (
        <span key={`${digits.length}-${i}`} className="roll-col" aria-hidden="true">
          <span
            className="roll-strip"
            style={{
              transform: `translateY(${live ? -Number(d) * 10 : 0}%)`,
              transitionDelay: `${(digits.length - i) * 90}ms`,
            }}
          >
            {"0123456789".split("").map((n) => (
              <span key={n}>{n}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}
