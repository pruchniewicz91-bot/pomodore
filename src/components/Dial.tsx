import { useRef, type PointerEvent } from 'react'

interface Props {
  progress: number          // 0..1 ile juz uplynelo
  label: string             // pozostaly czas
  mode: string              // podpis trybu
  color: string
  editable: boolean         // przeciaganie ustawia dlugosc sesji
  minutes: number
  maxMinutes: number
  snapMinutes: number
  onChangeMinutes(m: number): void
}

const SIZE = 268
const STROKE = 9
const R = (SIZE - STROKE * 2) / 2 - 8
const CIRC = 2 * Math.PI * R

export default function Dial({
  progress, label, mode, color, editable, minutes, maxMinutes, snapMinutes, onChangeMinutes,
}: Props) {
  const ref = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)

  // Kat liczony od gory, zgodnie z ruchem wskazowek.
  function angleToMinutes(e: PointerEvent) {
    const svg = ref.current
    if (!svg) return
    const r = svg.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI
    if (deg < 0) deg += 360
    const raw = (deg / 360) * maxMinutes
    const step = Math.max(snapMinutes, 1)
    onChangeMinutes(Math.min(maxMinutes, Math.max(step, Math.round(raw / step) * step)))
  }

  const handlers = editable
    ? {
        onPointerDown: (e: PointerEvent) => {
          dragging.current = true
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          angleToMinutes(e)
        },
        onPointerMove: (e: PointerEvent) => { if (dragging.current) angleToMinutes(e) },
        onPointerUp: () => { dragging.current = false },
        onPointerCancel: () => { dragging.current = false },
      }
    : {}

  const shown = editable ? minutes / maxMinutes : progress

  return (
    <div className="dial-wrap">
      <svg
        ref={ref}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ touchAction: 'none', cursor: editable ? 'grab' : 'default' }}
        role={editable ? 'slider' : 'img'}
        aria-label={editable ? 'Długość sesji w minutach' : `${mode}, pozostało ${label}`}
        aria-valuenow={editable ? minutes : undefined}
        aria-valuemin={editable ? snapMinutes : undefined}
        aria-valuemax={editable ? maxMinutes : undefined}
        {...handlers}
      >
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none" stroke="currentColor" strokeWidth={STROKE}
          style={{ color: 'var(--bg-elev-2)' }}
        />
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - Math.min(1, Math.max(0, shown)))}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ transition: dragging.current ? 'none' : 'stroke-dashoffset 0.6s linear' }}
        />
        {editable && (
          <circle
            cx={SIZE / 2 + R * Math.sin(shown * 2 * Math.PI)}
            cy={SIZE / 2 - R * Math.cos(shown * 2 * Math.PI)}
            r={9} fill={color} stroke="var(--bg)" strokeWidth={3}
          />
        )}
      </svg>
      <div className="dial-center">
        <div className="dial-time">{label}</div>
        <div className="dial-mode">{mode}</div>
      </div>
    </div>
  )
}
