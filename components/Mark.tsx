/** The inspair mark: two offset rounded tiles, like cards on a pin board. */
export default function Mark({ size = 22 }: { size?: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="5" width="13" height="16" rx="3.5" fill="currentColor" opacity="0.35" />
      <rect x="9" y="2" width="14" height="17" rx="3.5" fill="currentColor" />
    </svg>
  );
}
