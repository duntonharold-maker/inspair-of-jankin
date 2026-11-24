/** The story's screens and how many viewport heights of scrolling each one gets. */
export const SCREENS = [
  { id: "hero", len: 1.4 },
  { id: "library", len: 4.6 },
  { id: "categories", len: 4.4 },
  { id: "shortcut", len: 3.0 },
  { id: "custom", len: 5.6 },
  { id: "distort", len: 3.4 },
  { id: "agents", len: 4.2 },
  { id: "devices", len: 2.4 },
  { id: "export", len: 2.8 },
] as const;

export type ScreenId = (typeof SCREENS)[number]["id"];

export const START: Record<ScreenId, number> = (() => {
  let at = 0;
  const out = {} as Record<ScreenId, number>;
  for (const s of SCREENS) {
    out[s.id] = at;
    at += s.len;
  }
  return out;
})();

export const LEN = Object.fromEntries(SCREENS.map((s) => [s.id, s.len])) as Record<ScreenId, number>;
export const TOTAL = SCREENS.reduce((a, s) => a + s.len, 0);

/** Local progress of a screen: 0 at its start, 1 at its end (unclamped). */
export const local = (p: number, id: ScreenId) => (p - START[id]) / LEN[id];

/** Where in the story the scene changes pose (in viewport heights). */
export const MARKS = {
  gather: [START.library - 0.4, START.library + 1.2] as [number, number],
  unroll: [START.library + 1.7, START.library + 3.0] as [number, number],
  exit: [START.categories - 0.5, START.categories + 0.3] as [number, number],
  distort: [START.distort, START.distort + 0.7, START.distort + LEN.distort - 0.7, START.distort + LEN.distort] as [
    number,
    number,
    number,
    number,
  ],
};

/** Scroll positions (viewport heights into the story) that the nav links jump to. */
export const ANCHORS: { id: string; at: number }[] = [
  { id: "fresh", at: START.library + 3.4 },
  { id: "categories", at: START.categories + 0.25 },
  { id: "how", at: START.custom + 0.2 },
  { id: "mcp", at: START.agents + 0.3 },
];
