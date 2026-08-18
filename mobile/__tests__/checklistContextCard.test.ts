/**
 * The checklist fill screen must ask each question ONCE.
 *
 * The owner reported the workshop and mixer sheets "showing 2 places for asset
 * to be entered ... remove that top one with the title". The asset half was
 * already solved (the header picker writes through to every `asset` field,
 * which then renders locked), but the context card still carried a Title box
 * and a Site box on top of the sheet's own fields:
 *
 *   - every published template carries a `site` field (the workshop and mixer
 *     sheets label it "Location"), so Location was answered twice;
 *   - V594 mints the document number server-side, so a sheet with a doc_prefix
 *     already HAS its reference and the Title box invited a second, conflicting
 *     name for the same sheet - directly under a caption saying the reference is
 *     assigned automatically.
 *
 * Both are now DERIVED FROM THE TEMPLATE, never from a template name. This is a
 * source-scan guard because the invariant is a render decision on a screen the
 * pure ts-jest project cannot mount; the assertions are anchored on balanced
 * JSX blocks so a control moved back out of its condition fails here.
 */
import fs from 'fs'
import path from 'path'

const SCREEN = path.join(__dirname, '..', 'app', '(app)', 'checklists', '[templateId].tsx')
const src = fs.readFileSync(SCREEN, 'utf8')

/**
 * The source span of a JSX block opened at `marker`, matched by balancing the
 * parenthesis that follows it. Substring matching alone would happily "find" a
 * control that sits AFTER the block it is supposed to be inside.
 */
function balancedFrom(open: number): { text: string; end: number } {
  expect(src[open]).toBe('(')
  let depth = 0
  for (let j = open; j < src.length; j += 1) {
    const ch = src[j]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return { text: src.slice(open, j + 1), end: j + 1 }
    }
  }
  throw new Error(`unbalanced block at ${open}`)
}

function blockAfter(marker: string): string {
  const start = src.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  const open = src.indexOf('(', start + marker.length - 1)
  expect(open).toBeGreaterThan(-1)
  return balancedFrom(open).text
}

const count = (needle: string) => src.split(needle).length - 1

describe('checklist fill: the context card asks nothing the sheet already asks', () => {
  it('derives "the template owns the site question" from a site FIELD, not a name', () => {
    // A template-name check would be right for exactly two sheets and wrong for
    // the third one published tomorrow.
    expect(src).toMatch(/siteFieldIds\s*=\s*useMemo\(/)
    expect(src).toMatch(/filter\(f => f\?\.type === 'site'\)/)
    expect(src).toMatch(/templateOwnsSite = siteFieldIds\.length > 0/)
    expect(src).not.toMatch(/Workshop Daily Checklist|Fleet Transit Mixer/)
  })

  it('renders the header Site box ONLY when the template has no site field', () => {
    // There is exactly one such input, and it lives inside the negative branch.
    expect(count('value={site}')).toBe(1)
    expect(blockAfter('{!templateOwnsSite && (')).toContain('value={site}')
  })

  it('writes the resolved site through to the sheet field, filling blanks only', () => {
    const effect = src.slice(src.indexOf('if (!siteFieldIds.length) return'))
    // A read-only site field is owned by autoFillAnswers and an editable one by
    // whoever typed in it: a seeded site must never overwrite either.
    expect(effect).toContain("if (String(prev[id] ?? '').trim()) continue")
  })

  it('files the submission under the site the SHEET recorded', () => {
    expect(src).toContain('site: effectiveSite || null,')
    expect(src).not.toContain('site: site.trim() || null,')
    // effectiveSite prefers the field answer and falls back to the header value.
    const memo = src.slice(src.indexOf('const effectiveSite = useMemo('))
    expect(memo.slice(0, 400)).toContain('answers[id]')
    expect(memo.slice(0, 400)).toContain('return site.trim()')
  })

  it('drops the Title box when the server mints the reference, and keeps it otherwise', () => {
    expect(count('value={title}')).toBe(1)
    // The consequent is the reference line; the Title box is in the alternative,
    // i.e. only a template with no prefix still asks for a title.
    const marker = '{template.doc_prefix ? ('
    const start = src.indexOf(marker)
    expect(start).toBeGreaterThan(-1)
    const consequent = balancedFrom(src.indexOf('(', start + marker.length - 1))
    expect(src.slice(consequent.end, consequent.end + 4)).toMatch(/^\s*:\s*\(/)
    const alternative = balancedFrom(src.indexOf('(', consequent.end))
    expect(consequent.text).toContain('referenceLabel')
    expect(consequent.text).not.toContain('value={title}')
    expect(alternative.text).toContain('value={title}')
  })

  it('keeps the asset write-through that made the header the single asset control', () => {
    // Guards the inherited fix: the sheet's own asset field must still be fed
    // from the header, or a required asset line reads answered and fails submit.
    expect(src).toMatch(/filter\(f => f\?\.type === 'asset'\)/)
    expect(src).toContain("field.type === 'asset' && String(value ?? '').trim() !== ''")
  })
})

describe('checklist fill: every phrase it shows can be translated', () => {
  // A missing key does NOT fall back to English on mobile unless it exists in
  // en.json; absent there it renders the RAW KEY PATH on the machine.
  const keys = Array.from(new Set(
    (src.match(/\bt\('([^']+)'\)/g) || []).map(m => m.slice(3, -2)),
  ))
  const load = (f: string) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', f), 'utf8'))
  const resolve = (dict: any, key: string) => {
    let cur = dict
    for (const part of key.split('.')) {
      if (!cur || typeof cur !== 'object' || !(part in cur)) return undefined
      cur = cur[part]
    }
    return cur
  }

  it('found the screen strings at all', () => {
    expect(keys.length).toBeGreaterThan(50)
  })

  it.each(['en.json', 'ar.json'])('%s carries every key the screen asks for', file => {
    const dict = load(file)
    const missing = keys.filter(k => typeof resolve(dict, k) !== 'string')
    expect(missing).toEqual([])
  })
})
