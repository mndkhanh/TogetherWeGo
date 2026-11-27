import { Minus, Plus } from "lucide-react"
import * as React from "react"

import { Sheet } from "@/components/sheet"
import { Button } from "@/components/ui"
import type { Crop } from "@/lib/photos"

/** The square frame's side, in CSS pixels. Fits a phone with the sheet's padding. */
const FRAME = 288
const MAX_ZOOM = 4
const KEY_STEP = 12

interface View {
  zoom: number
  /** Where the picture's top-left corner sits in the frame (always ≤ 0: no gaps). */
  x: number
  y: number
}

/**
 * Pick the part of a photo that becomes your round profile picture: drag it into place, zoom
 * with the slider (or the mouse wheel, or + and −). Arrow keys move it too.
 */
export function CropPicker({
  src,
  initial,
  onDone,
  onCancel,
}: {
  src: string
  initial?: Crop
  onDone: (crop: Crop) => void
  onCancel: () => void
}) {
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null)
  const [view, setView] = React.useState<View>({ zoom: 1, x: 0, y: 0 })
  const [broken, setBroken] = React.useState(false)
  const frame = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{ id: number; x: number; y: number } | null>(null)

  // At zoom 1 the picture's short side just fills the frame.
  const scaleAt = (zoom: number) => (size ? (FRAME / Math.min(size.w, size.h)) * zoom : 1)

  /** Keeps the picture covering the whole frame. */
  const clamp = React.useCallback(
    (v: View): View => {
      if (!size) return v
      const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom))
      const scale = (FRAME / Math.min(size.w, size.h)) * zoom
      const w = size.w * scale
      const h = size.h * scale
      return {
        zoom,
        x: Math.min(0, Math.max(FRAME - w, v.x)),
        y: Math.min(0, Math.max(FRAME - h, v.y)),
      }
    },
    [size],
  )

  /** Zooms around the frame's centre, so what's in the middle stays there. */
  const zoomTo = React.useCallback(
    (next: number | ((zoom: number) => number)) =>
      setView((v) => {
        if (!size) return v
        const zoom = typeof next === "function" ? next(v.zoom) : next
        const base = FRAME / Math.min(size.w, size.h)
        const from = base * v.zoom
        const to = base * Math.min(MAX_ZOOM, Math.max(1, zoom))
        const cx = (FRAME / 2 - v.x) / from
        const cy = (FRAME / 2 - v.y) / from
        return clamp({ zoom, x: FRAME / 2 - cx * to, y: FRAME / 2 - cy * to })
      }),
    [clamp, size],
  )

  const loaded = (img: HTMLImageElement) => {
    const s = { w: img.naturalWidth, h: img.naturalHeight }
    setSize(s)
    const base = FRAME / Math.min(s.w, s.h)
    if (initial) {
      const zoom = Math.min(s.w, s.h) / initial.side
      setView({ zoom, x: -initial.x * base * zoom, y: -initial.y * base * zoom })
    } else {
      // Centred, like the old automatic crop.
      setView({ zoom: 1, x: (FRAME - s.w * base) / 2, y: (FRAME - s.h * base) / 2 })
    }
  }

  // The wheel needs a non-passive listener to stop the page scrolling behind the sheet.
  React.useEffect(() => {
    const el = frame.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomTo((z) => z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomTo])

  const scale = scaleAt(view.zoom)
  const done = () => {
    if (!size) return
    onDone({ x: -view.x / scale, y: -view.y / scale, side: FRAME / scale })
  }

  const onKey = (e: React.KeyboardEvent) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [KEY_STEP, 0],
      ArrowRight: [-KEY_STEP, 0],
      ArrowUp: [0, KEY_STEP],
      ArrowDown: [0, -KEY_STEP],
    }
    const move = moves[e.key]
    if (move) {
      e.preventDefault()
      setView((v) => clamp({ ...v, x: v.x + move[0], y: v.y + move[1] }))
    } else if (e.key === "+" || e.key === "=") zoomTo((z) => z + 0.25)
    else if (e.key === "-") zoomTo((z) => z - 0.25)
  }

  return (
    <Sheet title="Crop your photo" onClose={onCancel}>
      <div className="flex flex-col items-center gap-4">
        <div
          ref={frame}
          tabIndex={0}
          role="group"
          aria-label="Photo position. Drag, or use the arrow keys to move it and + or − to zoom."
          onKeyDown={onKey}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d || d.id !== e.pointerId) return
            const dx = e.clientX - d.x
            const dy = e.clientY - d.y
            drag.current = { id: d.id, x: e.clientX, y: e.clientY }
            setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }))
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          style={{ width: FRAME, height: FRAME }}
          className="relative cursor-grab touch-none overflow-hidden rounded-2xl bg-ink select-none active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {!broken && (
            <img
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => loaded(e.currentTarget)}
              onError={() => setBroken(true)}
              style={
                size
                  ? {
                      left: view.x,
                      top: view.y,
                      width: size.w * scale,
                      height: size.h * scale,
                    }
                  : { opacity: 0 }
              }
              className="absolute max-w-none"
            />
          )}
          {/* Everything outside the circle is dimmed: that's what gets cut off. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgb(0_0_0/0.5)] ring-2 ring-white/80"
          />
          {broken && (
            <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">
              This photo can't be shown here. Try a JPEG or PNG.
            </p>
          )}
        </div>

        <div className="flex w-full max-w-[18rem] items-center gap-2">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => zoomTo(view.zoom - 0.25)}
            disabled={!size || view.zoom <= 1}
            className="rounded-full p-1.5 text-muted hover:bg-brand-soft hover:text-ink disabled:opacity-40"
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <input
            type="range"
            aria-label="Zoom"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={view.zoom}
            disabled={!size}
            onChange={(e) => zoomTo(Number(e.target.value))}
            className="min-w-0 flex-1 accent-brand"
          />
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => zoomTo(view.zoom + 0.25)}
            disabled={!size || view.zoom >= MAX_ZOOM}
            className="rounded-full p-1.5 text-muted hover:bg-brand-soft hover:text-ink disabled:opacity-40"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </div>

        <div className="flex w-full justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={done} disabled={!size}>
            Use photo
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
