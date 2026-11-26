import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

/**
 * The plastic stools of a Vietnamese sidewalk hangout (the app icon is one), drawn as flat geometry.
 * Stacked stools nest, so each one above shows only its rim over the stool below.
 */

const STOOL_HEIGHT = 96
const NEST_OFFSET = 15

export const STOOL_RIM = { x: 8, y: 0, width: 104, height: 13, rx: 4 }

// Body widens toward the floor; the arch between the legs and the cut-out
// handle on the side panel are holes (even-odd fill).
export const BODY_PATH = [
  "M17 12 H103 L114 96 H88 Q84 70 60 70 Q36 70 32 96 H6 Z",
  "M46 30 h28 a9 9 0 0 1 0 18 h-28 a9 9 0 0 1 0 -18 Z",
].join(" ")

function Stool({
  x,
  y,
  color,
  nested = false,
}: {
  x: number
  y: number
  color: string
  /** A stool nested in the one below shows only its rim. */
  nested?: boolean
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {!nested && <path d={BODY_PATH} fill={color} fillRule="evenodd" />}
      <rect x={8} y={0} width={104} height={13} rx={4} fill={color} />
      {/* Shadow under the rim gives the stack its depth. */}
      <rect x={14} y={13} width={92} height={nested ? 2 : 4} fill="black" opacity={0.16} />
    </g>
  )
}

function Stack({ x, colors, floor }: { x: number; colors: string[]; floor: number }) {
  // colors[0] is the bottom stool. Draw it last so its rim sits in front of the rims above.
  return (
    <>
      {colors
        .map((color, index) => (
          <Stool
            key={index}
            x={x}
            y={floor - STOOL_HEIGHT - index * NEST_OFFSET}
            color={color}
            nested={index > 0}
          />
        ))
        .reverse()}
    </>
  )
}

const RED = "var(--stool-red)"
const PALE = "var(--stool-cream)"
const DEEP = "var(--stool-deep)"

/** The app icon: one stool, in the current text color unless told otherwise. */
export function StoolMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 100" className={cn("h-[0.9em] w-auto shrink-0", className)} aria-hidden>
      <path d={BODY_PATH} fill="currentColor" fillRule="evenodd" />
      <rect {...STOOL_RIM} fill="currentColor" />
    </svg>
  )
}

export function StoolScene({ className }: { className?: string }) {
  const { t } = useTranslation()
  const floor = 190
  return (
    <svg
      viewBox="0 0 440 200"
      className={cn("h-auto w-full", className)}
      role="img"
      aria-label={t("scene.stools")}
    >
      <Stack x={0} floor={floor} colors={[RED, RED, PALE, RED, RED, PALE]} />
      <Stack x={134} floor={floor} colors={[PALE, DEEP, PALE, DEEP]} />
      {/* The one pulled out from the stack, waiting for someone to sit. */}
      <Stool x={300} y={floor - STOOL_HEIGHT} color={RED} />
      <rect x={0} y={floor} width={440} height={3} rx={1.5} fill={DEEP} opacity={0.35} />
    </svg>
  )
}
