/** A column of ticks; the ones around `at` (0…1) grow and darken. */
export default function TickRuler({ count = 44, at, className = "" }: { count?: number; at: number; className?: string }) {
  const pos = at * (count - 1);
  return (
    <div className={`ticks ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, k) => {
        const s = Math.max(0, 1 - Math.abs(k - pos) / 5);
        return <span key={k} style={{ ["--s" as string]: s.toFixed(3) }} />;
      })}
    </div>
  );
}
