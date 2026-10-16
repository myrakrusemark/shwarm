// Charts for the admin analytics page (web/admin.tsx), drawn on the server as SVG: no script, so the site's CSP stays
// as it is. Hover is the browser's own: each day's column carries a <title> with its numbers. Every chart has its
// numbers in a table beside it (the page puts one under each), so nothing is read from color alone.
// Colors (static/css/admin.css, .viz): blue, orange, aqua, violet in that order, checked for colorblind separation on
// the site's paper (dataviz validate_palette.js: worst adjacent ΔE 9.2). Gray is "unknown", never a series hue.
import type { FC } from 'hono/jsx'

export type Series = { label: string; slot: 1 | 2 | 3 | 4 | 'none'; values: number[] }

const W = 640
const H = 180
const PAD = { top: 10, right: 8, bottom: 22, left: 34 }
const GAP = 2 // the paper gap between stacked segments and between columns

const n = (x: number) => x.toLocaleString('en-US')
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** 'oct 14' for '2026-10-14'. */
export const shortDay = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`

/** A round top for the axis: 1, 2, 5 or 10 times a power of ten, at least `max`. */
function niceMax(max: number) {
  if (max <= 4) return 4
  const p = 10 ** Math.floor(Math.log10(max))
  return ([1, 2, 5, 10].find(m => m * p >= max) ?? 10) * p
}

/** A bar with its top corners rounded (radius r), standing on y + h. */
const topRounded = (x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

/** One column per day, the series stacked in order (first at the bottom). */
export const Columns: FC<{ days: string[]; series: Series[]; label: string }> = ({ days, series, label }) => {
  const totals = days.map((_, i) => series.reduce((s, x) => s + x.values[i], 0))
  const top = niceMax(Math.max(0, ...totals))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const slot = plotW / days.length
  const bw = Math.max(2, slot - GAP * 2)
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH
  const ticks = [0, top / 2, top]
  const labelled = new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])
  return (
    <svg class="viz cols" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {ticks.map(t => (
        <g>
          <line class="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
          <text class="tick" x={PAD.left - 6} y={y(t) + 4} text-anchor="end">{n(t)}</text>
        </g>
      ))}
      {days.map((day, i) => {
        const x = PAD.left + i * slot + (slot - bw) / 2
        let base = 0
        const shown = series.filter(s => s.values[i] > 0)
        return (
          <g class="col">
            <title>{`${shortDay(day)}: ${series.length === 1 ? n(totals[i]) : series.map(s => `${n(s.values[i])} ${s.label}`).join(' · ')}`}</title>
            <rect class="hit" x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} />
            {shown.map((s, j) => {
              const y0 = y(base)
              base += s.values[i]
              const y1 = y(base)
              // the gap sits on top of each segment below the last, so stacked segments never touch
              const h = Math.max(0, y0 - y1 - (j < shown.length - 1 ? GAP : 0))
              const cls = `s${s.slot}`
              return j === shown.length - 1 ? <path class={cls} d={topRounded(x, y1, bw, h, 4)} /> : <rect class={cls} x={x} y={y1 + GAP} width={bw} height={h} />
            })}
            {labelled.has(i) && <text class="tick" x={PAD.left + i * slot + slot / 2} y={H - 6} text-anchor="middle">{shortDay(day)}</text>}
          </g>
        )
      })}
      <line class="base" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
    </svg>
  )
}

/** The legend: a swatch and a label per series. Only for two or more series; one series is named by its heading. */
export const Legend: FC<{ series: Pick<Series, 'label' | 'slot'>[] }> = ({ series }) => (
  <ul class="legend">
    {series.map(s => (
      <li><i class={`sw s${s.slot}`} aria-hidden="true" />{s.label}</li>
    ))}
  </ul>
)

/** Horizontal bars, one row per item, longest first as given: a name, its bar and its number. */
export const Bars: FC<{ rows: { name: string; value: number; note?: string }[]; none: string }> = ({ rows, none }) => {
  if (!rows.length) return <p class="note">{none}</p>
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <ol class="bars">
      {rows.map(r => (
        <li>
          <span class="name">{r.name}</span>
          <span class="track"><span class="bar" style={`width:${((r.value / max) * 100).toFixed(1)}%`} /></span>
          <span class="val">{n(r.value)}{r.note && <span class="mk"> {r.note}</span>}</span>
        </li>
      ))}
    </ol>
  )
}
