"use client";
import { useEffect, useState } from "react";
import { local } from "../timeline";
import { useStory, useStoryValue } from "../store";
import type { Effect } from "../scene";

const MODES: { id: Effect; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "flare", label: "Flare" },
  { id: "prism", label: "Prism" },
  { id: "bend", label: "Bend" },
];

/** What the screen shows on its own as you scroll through it. */
function auto(t: number): { mode: Effect; amount: number } {
  const seq: Effect[] = ["bend", "prism", "flare", "prism", "bend"];
  const k = Math.min(seq.length - 1, Math.max(0, Math.floor(((t - 0.12) / 0.76) * seq.length)));
  return { mode: seq[k], amount: 0.9 + 0.6 * Math.sin(t * 9) ** 2 };
}

export default function DistortScreen({ onEffect }: { onEffect: (mode: Effect, amount: number) => void }) {
  const store = useStory();
  const [manual, setManual] = useState<{ mode: Effect; amount: number } | null>(null);
  const autoState = useStoryValue((p) => {
    const a = auto(local(p, "distort"));
    return `${a.mode}|${a.amount.toFixed(2)}`;
  });
  const inside = useStoryValue((p) => {
    const t = local(p, "distort");
    return t > -0.2 && t < 1.2;
  });

  // leaving the screen hands control back to the scroll
  useEffect(() => {
    if (!inside) setManual(null);
  }, [inside]);

  const [autoMode, autoAmount] = autoState.split("|");
  const state = manual ?? { mode: autoMode as Effect, amount: Number(autoAmount) };

  useEffect(() => {
    store.effect = { ...state, manual: Boolean(manual) };
    onEffect(state.mode, state.amount);
  }, [state.mode, state.amount, manual, onEffect, store]);

  return (
    <section data-screen="distort" data-on="0" className="scr scr-distort" aria-labelledby="distort-title">
      <div className="distort-scrim" aria-hidden="true" />
      <h2 id="distort-title" className="h-display distort-title">
        Bend
        <br />
        anything
      </h2>
      <div className="distort-controls">
        <div className="seg" role="radiogroup" aria-label="效果">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={state.mode === m.id}
              className={state.mode === m.id ? "is-on" : ""}
              onClick={() => setManual({ mode: m.id, amount: state.amount })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="amount">
          <span>Amount</span>
          <input
            id="distort-amount"
            type="range"
            min={0}
            max={250}
            value={Math.round(state.amount * 100)}
            onChange={(e) => setManual({ mode: state.mode === "off" ? "bend" : state.mode, amount: Number(e.target.value) / 100 })}
          />
          <output>{Math.round(state.amount * 100)}%</output>
        </label>
      </div>
    </section>
  );
}
