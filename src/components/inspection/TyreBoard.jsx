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
  const frameH = viewH + 10
  const wheels = tyres.map((t) => {
    const d = tyreData?.[t.id] || null
    const recorded = !!(d && (d.condition || d.pressure != null || d.tread != null))
    return {
      id: t.id,
      code: codeOf(t.id),
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
  const sideW = maxPerSide * cardW + (maxPerSide - 1) * 4
  const leader = 16
  // The photo is sized so a side's stacked axle cards fit beside it: a long
  // mixer gets a tall photo, a pickup a squat one, never a thumbnail.
  const maxGroups = Math.max(1, left.length, right.length)
  const stackH = maxGroups * (CARD_H + 4) - 4
  const fromWidth = Math.max(90, width - 2 * (sideW + leader)) * frameH / 220
  const photoW = Math.max(80, Math.min(180, (Math.max(stackH, fromWidth) * 220) / frameH))
  const photoH = photoW * frameH / 220
  const yOf = (cy) => ((cy + 5) / frameH) * photoH

  // Lay a side's axle groups out top to bottom without overlap.
  const place = (groups) => {
    let floor = 0
    return groups.map((g) => {
      const want = yOf(g.cy) - CARD_H / 2
      const top = Math.max(want, floor)
      floor = top + CARD_H + 4
      return { ...g, top, axleY: yOf(g.cy) }
    })
  }
  const L = place(left)
  const R = place(right)
  const height = Math.max(photoH, ...L.map((g) => g.top + CARD_H), ...R.map((g) => g.top + CARD_H))
  const total = 2 * (sideW + leader) + photoW
  const recordedCount = wheels.filter((w) => w.recorded).length

  const side = (groups, onLeft) => groups.map((g) => {
    const cardsLeft = onLeft ? sideW - (g.wheels.length * cardW + (g.wheels.length - 1) * 4) : sideW + leader * 2 + photoW
    const cardMid = g.top + CARD_H / 2 + 6
    const tone = TONE[g.wheels.reduce((worst, w) => (
      ({ critical: 3, warning: 2, good: 1, none: 0 })[w.risk] > ({ critical: 3, warning: 2, good: 1, none: 0 })[worst] ? w.risk : worst
    ), 'none')] || 'none'
    // The leader runs from the card edge to the photo edge at the axle line.
    const x1 = onLeft ? sideW : sideW + leader * 2 + photoW
    const x2 = onLeft ? sideW + leader : sideW + leader + photoW
    return (
      <div key={`${onLeft ? 'L' : 'R'}${g.cy}`}>
        <svg className="tb-leader" width={total} height={height} aria-hidden="true">
          <path d={`M${x1} ${cardMid} L${(x1 + x2) / 2} ${cardMid} L${x2} ${g.axleY}`} className={`tb-line tb-${tone}`} />
          <circle cx={x2} cy={g.axleY} r="3.5" className={`tb-knob tb-${tone}`} />
        </svg>
        <div className="tb-group" style={{ left: cardsLeft, top: g.top, flexDirection: onLeft ? 'row-reverse' : 'row' }}>
          {(onLeft ? [...g.wheels].sort((a, b) => b.cx - a.cx) : [...g.wheels].sort((a, b) => a.cx - b.cx))
            .map((w) => <Card key={w.id} w={w} />)}
        </div>
      </div>
    )
  })

  return (
    <div className="tb-scroll"><div className="tb" style={{ width: total }}>
      {title && <div className="tb-title"><b>{title}</b><span>{tyres.length} tyres, {recordedCount} recorded</span></div>}
      <div className="tb-front">▲ FRONT</div>
      <div className="tb-stage" style={{ width: total, height }}>
        <div className="tb-photo" style={{ left: sideW + leader, width: photoW, height: photoH }}>
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
