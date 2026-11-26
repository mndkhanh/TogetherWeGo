/**
 * The red plastic stool of a Vietnamese sidewalk hangout: the app icon, drawn as flat geometry.
 * The body widens toward the floor; the arch between the legs and the handle are holes.
 */
const BODY = [
  "M17 12 H103 L114 96 H88 Q84 70 60 70 Q36 70 32 96 H6 Z",
  "M46 30 h28 a9 9 0 0 1 0 18 h-28 a9 9 0 0 1 0 -18 Z",
].join(" ")

function Stool({ x = 0, y = 0, color }: { x?: number; y?: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={BODY} fill={color} fillRule="evenodd" />
      <rect x={8} y={0} width={104} height={13} rx={4} fill={color} />
    </g>
  )
}

/** One stool in the current text color: the logo mark. */
export function StoolMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden>
      <path d={BODY} fill="currentColor" fillRule="evenodd" />
      <rect x={8} y={0} width={104} height={13} rx={4} fill="currentColor" />
    </svg>
  )
}

/**
 * Stools pulled up around a low table, the way a sidewalk hangout starts. The empty one at the
 * end is for whoever turns up next.
 */
export function StoolCircle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 520 150"
      className={className}
      role="img"
      aria-label="Plastic stools around a low table"
    >
      <rect x={0} y={146} width={520} height={4} rx={2} fill="var(--color-ink)" opacity={0.12} />
      <Stool x={0} y={50} color="var(--color-stool)" />
      <Stool x={128} y={50} color="var(--color-brand-dark)" />
      {/* The table: a wider stool-like top on a narrow stand. */}
      <g transform="translate(262 34)">
        <rect x={0} y={0} width={130} height={14} rx={4} fill="var(--color-ink)" opacity={0.85} />
        <rect x={56} y={14} width={18} height={98} fill="var(--color-ink)" opacity={0.85} />
        <rect x={34} y={106} width={62} height={6} rx={3} fill="var(--color-ink)" opacity={0.85} />
        {/* Two glasses of trà đá. */}
        <rect
          x={26}
          y={-26}
          width={16}
          height={26}
          rx={3}
          fill="var(--color-surface)"
          opacity={0.9}
        />
        <rect
          x={86}
          y={-26}
          width={16}
          height={26}
          rx={3}
          fill="var(--color-surface)"
          opacity={0.9}
        />
      </g>
      <Stool x={400} y={50} color="var(--color-stool)" />
    </svg>
  )
}
