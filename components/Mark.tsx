/** The inspair mark: two offset rounded tiles, like cards on a pin board. `live` shuffles them. */
export default function Mark({ size = 22, live = false }: { size?: number | string; live?: boolean }) {
  return (
    <svg className={live ? "mark mark--live" : "mark"} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect className="mark-back" x="1" y="5" width="13" height="16" rx="3.5" fill="currentColor" opacity="0.35" />
      <rect className="mark-front" x="9" y="2" width="14" height="17" rx="3.5" fill="currentColor" />
    </svg>
  );
}
