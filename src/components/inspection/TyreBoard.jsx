/**
 * TyreBoard - the inspection RESULT drawn the way the Flutter app draws it.
 *
 * The real top-down vehicle photo in the middle with no drawn tyres on it, and
 * one small card per wheel on the side that wheel is on: the position code
 * above, a status dot (tick / ! / -), then ONLY what was recorded (tread mm,
 * pressure psi, or the condition word), or "Not recorded" when nothing was.
 * A dashed leader runs from each card to the wheel's axle on the photo.
 *
 * Positions come from the same layout the drawn map uses, so a card always
 * points at its own axle. Purely presentational: no fetching, no state.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import './tyreBoard.css'

const TONE = { good: 'good', warning: 'warn', critical: 'bad', none: 'none' }
const ICON = { good: '✓', warn: '!', bad: '!', none: '–' }
const fmt = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : String(v)
}

/** Group a side's wheels into axles by their layout centre, front to rear. */
function axleGroups(wheels) {
  const groups = []
  for (const w of [...wheels].sort((a, b) => a.cy - b.cy || a.cx - b.cx)) {
    const g = groups.find((x) => Math.abs(x.cy - w.cy) < 14)
    if (g) { g.wheels.push(w); g.cy = (g.cy + w.cy) / 2 } else groups.push({ cy: w.cy, wheels: [w] })
  }
  return groups
}

const CARD_H = 64 // card + its code label, px
const CARD_W = 70

function Card({ w }) {
  const tone = TONE[w.risk] || 'none'
  const tread = fmt(w.tread)
  const pressure = fmt(w.pressure)
  const recorded = w.recorded
  return (
    <div className={`tb-card tb-${tone}`} title={`${w.code}: ${recorded ? (w.condition || 'Recorded') : 'Not recorded'}`}>
      <span className="tb-code">{w.code}</span>
      <span className="tb-body">
        <i className="tb-dot" aria-hidden="true">{ICON[tone]}</i>
        <span className="tb-vals">
          {!recorded && <small className="tb-muted">Not recorded</small>}
          {recorded && tread && <b>{tread}<small> mm</small></b>}
          {recorded && pressure && <b>{pressure}<small> psi</small></b>}
          {recorded && (!tread && !pressure ? true : tone !== 'good') && w.condition && (
            <small className="tb-cond">{w.condition}</small>
          )}
        </span>
      </span>
    </div>
  )
}

export default function TyreBoard({
  tyres, viewH, photo, Body, tyreData = {}, riskOf, codeOf, title, width = 340,
}) {
  // The board is laid out at its natural width, then shrunk as a whole to the
  // card it sits in. A twin-wheel truck needs ~380px and the side card is ~300,
  // which used to cut off every right-hand wheel.
  const boxRef = useRef(null)
  const [avail, setAvail] = useState(0)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return undefined
    const read = () => setAvail(el.clientWidth || 0)
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fit = (natural) => (avail > 0 && natural > avail ? Math.max(0.55, avail / natural) : 1)
  const frameH = viewH + 10
  const wheels = tyres.map((t) => {
    const d = tyreData?.[t.id] || null
    const recorded = !!(d && (d.condition || d.pressure != null || d.tread != null))
    return {
      id: t.id,
      code: codeOf(t.id),
      x: t.x,
      w: t.w,
      cx: t.x + t.w / 2,
      cy: t.y + t.h / 2,
      risk: riskOf(t.id),
      recorded,
      condition: d?.condition || null,
      pressure: d?.pressure ?? null,
      tread: d?.tread ?? null,
    }
  })
  const left = axleGroups(wheels.filter((w) => w.cx < 100))
  const right = axleGroups(wheels.filter((w) => w.cx >= 100))
  const maxPerSide = Math.max(1, ...left.map((g) => g.wheels.length), ...right.map((g) => g.wheels.length))

  // Space: cards either side of the photo, a short leader between.
  const cardW = CARD_W
  const leader = 16
  // In a narrow card a twin wheel's inner and outer cards stack one above the
  // other instead of side by side, which halves the width the board needs so it
  // fits at full size rather than being shrunk until the text is unreadable.
  const wideSide = maxPerSide * cardW + (maxPerSide - 1) * 4
  const stacked = maxPerSide > 1 && 2 * (wideSide + leader) + 110 > width
  const sideW = stacked ? cardW : wideSide
  const groupH = (g) => (stacked ? g.wheels.length * (CARD_H + 4) - 4 : CARD_H)
  // The photo is sized so a side's stacked axle cards fit beside it: a long
  // mixer gets a tall photo, a pickup a squat one, never a thumbnail.
  const sideH = (groups) => groups.reduce((h, g) => h + groupH(g) + 4, -4)
  const stackH = Math.max(CARD_H, sideH(left), sideH(right))
  const fromWidth = Math.max(90, width - 2 * (sideW + leader)) * frameH / 220
  // Never wider than the space the cards leave, so the board fits its card.
  const roomW = Math.max(80, width - 2 * (sideW + leader))
  const photoW = Math.max(80, Math.min(180, roomW, (Math.max(stackH, fromWidth) * 220) / frameH))
  const photoH = photoW * frameH / 220
  // When the card column is taller than the photo, the photo sits centred
  // against it so the leaders fan out both ways instead of all running down.
  const H = Math.max(photoH, stackH)
  const photoTop = (H - photoH) / 2
  const yOf = (cy) => photoTop + ((cy + 5) / frameH) * photoH
  // Layout x (frame -10..210) to a pixel on the stage, so a leader ends ON the
  // wheel rather than at the edge of the picture box.
  const xOf = (fx) => sideW + leader + ((fx + 10) / 220) * photoW

  // Lay a side's axle groups out top to bottom without overlap.
  // Each card as close to its own axle as the cards above and below allow.
  const place = (groups) => {
    const hs = groups.map(groupH)
    const below = hs.map((_, i) => hs.slice(i).reduce((t, h) => t + h + 4, -4))
    let floor = 0
    return groups.map((g, i) => {
      const h = hs[i]
      const ceiling = H - below[i]
      const top = Math.min(Math.max(yOf(g.cy) - h / 2, floor), Math.max(floor, ceiling))
      floor = top + h + 4
      return { ...g, top, h, axleY: yOf(g.cy) }
    })
  }
  const L = place(left)
  const R = place(right)
  const height = Math.max(H, ...L.map((g) => g.top + g.h), ...R.map((g) => g.top + g.h))
  const total = 2 * (sideW + leader) + photoW
  const recordedCount = wheels.filter((w) => w.recorded).length

  const side = (groups, onLeft) => groups.map((g) => {
    const rowW = stacked ? cardW : g.wheels.length * cardW + (g.wheels.length - 1) * 4
    const cardsLeft = onLeft ? sideW - rowW : sideW + leader * 2 + photoW
    const cardMid = g.top + g.h / 2 + (stacked ? 0 : 6)
    const tone = TONE[g.wheels.reduce((worst, w) => (
      ({ critical: 3, warning: 2, good: 1, none: 0 })[w.risk] > ({ critical: 3, warning: 2, good: 1, none: 0 })[worst] ? w.risk : worst
    ), 'none')] || 'none'
    // The leader runs from the card edge to the photo edge at the axle line.
    const x1 = onLeft ? sideW : sideW + leader * 2 + photoW
    const x2 = onLeft
      ? xOf(Math.min(...g.wheels.map((w) => w.x)))
      : xOf(Math.max(...g.wheels.map((w) => w.x + w.w)))
    const bend = onLeft ? sideW + leader : sideW + leader + photoW
    return (
      <div key={`${onLeft ? 'L' : 'R'}${g.cy}`}>
        <svg className="tb-leader" width={total} height={height} aria-hidden="true">
          <path d={`M${x1} ${cardMid} L${(x1 + bend) / 2} ${cardMid} L${bend} ${g.axleY} L${x2} ${g.axleY}`} className={`tb-line tb-${tone}`} />
          <circle cx={x2} cy={g.axleY} r="3.5" className={`tb-knob tb-${tone}`} />
        </svg>
        <div className="tb-group" style={{ left: cardsLeft, top: g.top, flexDirection: stacked ? 'column' : onLeft ? 'row-reverse' : 'row' }}>
          {/* Outer wheel first: furthest from the photo when side by side, on top when stacked. */}
          {[...g.wheels].sort((a, b) => (stacked ? (onLeft ? a.cx - b.cx : b.cx - a.cx) : (onLeft ? b.cx - a.cx : a.cx - b.cx)))
            .map((w) => <Card key={w.id} w={w} />)}
        </div>
      </div>
    )
  })

  return (
    <div className="tb-scroll" ref={boxRef}><div className="tb" style={{ width: total, zoom: fit(total) }}>
      {title && <div className="tb-title"><b>{title}</b><span>{tyres.length} tyres, {recordedCount} recorded</span></div>}
      <div className="tb-front">▲ FRONT</div>
      <div className="tb-stage" style={{ width: total, height }}>
        <div className="tb-photo" style={{ left: sideW + leader, top: photoTop, width: photoW, height: photoH }}>
          {photo ? (
            <img
              src={photo.href}
              alt=""
              style={{
                objectFit: photo.fit === 'slice' ? 'cover' : 'contain',
                transform: photo.rotate180 ? 'rotate(180deg)' : undefined,
              }}
            />
          ) : Body ? (
            <svg viewBox={`-10 -5 220 ${frameH}`} width={photoW} height={photoH} aria-hidden="true"><Body /></svg>
          ) : null}
        </div>
        {side(L, true)}
        {side(R, false)}
      </div>
      <div className="tb-legend">
        <span><i className="tb-dot tb-good">✓</i>Good</span>
        <span><i className="tb-dot tb-warn">!</i>Warning</span>
        <span><i className="tb-dot tb-bad">!</i>Critical</span>
        <span><i className="tb-dot tb-none">–</i>Not recorded</span>
      </div>
    </div></div>
  )
}
