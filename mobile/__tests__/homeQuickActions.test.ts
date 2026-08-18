/**
 * Home quick actions: one line of text, one calm colour system.
 *
 * The owner's report on 2026-08-18, verbatim: "See its messy and it has button
 * the commetry also no needs that make sure you make it proffetional way that
 * green icon is ok for inspection but other not correct".
 *
 * Two defects, both fixed on the Home screen and both pinned here:
 *
 *  1. THE COMMENTARY. Every tile printed a second line under its label ("Log a
 *     wash", "Daily odometer / hrs", "Sheets I have filled"). It doubled tile
 *     height, said nothing the label did not, and turned an admin's 27 tiles
 *     into a wall. The `sublabel` field and its rendering are gone - not blanked
 *     out, REMOVED - so it cannot creep back by data.
 *
 *  2. THE CONFETTI. Each tile was assigned one of seven pastel tints with no
 *     rule behind the choice, so six unrelated colours competed in one grid and
 *     a red tile carried no more meaning than a violet one. Colour is now spent
 *     only on real signal (alert / approve); everything else is one neutral chip.
 *
 * Removing the sublabel put weight on the label, so this also guards the
 * ambiguity that created: two tiles may not carry the same word ("History" in
 * Fleet against "Checklist History" in Field) now that nothing explains them.
 *
 * SOURCE SCAN, deliberately: the registry lives inside a screen module that
 * pulls in expo-router and react-native, which the pure ts-jest project cannot
 * load. The locale halves ARE read from the real JSON.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const HOME = join(__dirname, '..', 'app', '(app)', 'index.tsx')
const src = readFileSync(HOME, 'utf8')

const en = require('../locales/en.json')
const ar = require('../locales/ar.json')

// The glyph map that actually ships in the bundle - never a remembered list.
const GLYPHS: Record<string, number> = require(
  '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json',
)

// ── Parse the tile registry out of the screen source ─────────────────────────

interface Tile {
  module: string
  section: string
  icon: string
  label: string
  route: string
  tone?: string
  id?: string
  raw: string
}

function registryBlock(): string {
  const start = src.indexOf('const QUICK_ACTIONS: QuickAction[] = [')
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('\n]', start)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
}

function parseTiles(): Tile[] {
  const block = registryBlock()
  const out: Tile[] = []
  for (const line of block.split('\n')) {
    const raw = line.trim()
    if (!raw.startsWith('{ module:')) continue
    const field = (k: string) => {
      const m = raw.match(new RegExp(`\\b${k}:\\s*'([^']*)'`))
      return m ? m[1] : undefined
    }
    out.push({
      module: field('module')!,
      section: field('section')!,
      icon: field('icon')!,
      label: field('label')!,
      route: field('route')!,
      tone: field('tone'),
      id: field('id'),
      raw,
    })
  }
  return out
}

const tiles = parseTiles()
const tileId = (t: Tile) => t.id ?? t.module

// A parse that silently found nothing would make every assertion below pass
// while checking absolutely nothing.
describe('the registry parse is not vacuous', () => {
  it('found every tile, each with the fields the screen reads', () => {
    expect(tiles.length).toBeGreaterThanOrEqual(20)
    for (const t of tiles) {
      expect(typeof t.module).toBe('string')
      expect(t.section).toMatch(/^(Field|Fleet|Maintenance|Management|Admin)$/)
      expect(t.icon).toBeTruthy()
      expect(t.label).toBeTruthy()
      expect(t.route.startsWith('/(app)/')).toBe(true)
    }
  })
})

// ── 1. The commentary is gone ────────────────────────────────────────────────

describe('a quick-action tile renders its label and nothing else', () => {
  it('no tile in the registry declares a sublabel', () => {
    for (const t of tiles) {
      expect(t.raw.includes('sublabel')).toBe(false)
    }
  })

  it('the QuickAction shape has no sublabel field to fill in', () => {
    const shape = src.slice(src.indexOf('interface QuickAction {'), src.indexOf('const QUICK_ACTIONS'))
    expect(shape).not.toMatch(/\bsublabel\??\s*:/)
  })

  it('the card renders exactly ONE line of text', () => {
    const start = src.indexOf('function QuickActionCard(')
    expect(start).toBeGreaterThan(-1)
    const card = src.slice(start, src.indexOf('\n}', start))
    // A <Text> is a rendered line. Two of them is the commentary coming back.
    const lines = card.match(/<Text[\s>]/g) ?? []
    expect(lines).toHaveLength(1)
    // And the reader must not resolve a second locale string to print.
    expect(card).not.toMatch(/\.sub`|\.sub'|\bsubKey\b|\bsublabel\b/)
  })

  it('the sublabel text style no longer exists', () => {
    expect(src).not.toMatch(/qaSublabel\s*:/)
  })

  it('the tile is sized for a label only, not a label plus commentary', () => {
    const card = src.slice(src.indexOf('qaCard: {'), src.indexOf('qaIcon:'))
    const min = card.match(/minHeight:\s*(\d+)/)
    expect(min).not.toBeNull()
    expect(Number(min![1])).toBeLessThan(124)
    // maxWidth is what stops a lone tile on the last row stretching into a
    // full-width slab - the ragged grid the owner called messy.
    expect(card).toMatch(/maxWidth:/)
  })
})

// ── 2. Colour means something ────────────────────────────────────────────────

const SIGNAL_TILES = new Set(['accidents', 'reportAccident', 'alerts', 'approvals'])

describe('tile colour is reserved for signal, not decoration', () => {
  it('no tile carries a decorative tint any more', () => {
    for (const t of tiles) {
      expect(t.raw).not.toMatch(/\btint:/)
    }
    const card = src.slice(src.indexOf('function QuickActionCard('), src.indexOf('// Site stat card'))
    expect(card).not.toMatch(/theme\.tint\[/)
  })

  it('only alert and approve are spendable tones', () => {
    for (const t of tiles) {
      if (t.tone) expect(['alert', 'approve']).toContain(t.tone)
    }
  })

  it('exactly the tiles that carry real urgency or sign-off are coloured', () => {
    const coloured = new Set(tiles.filter(t => t.tone).map(tileId))
    expect([...coloured].sort()).toEqual([...SIGNAL_TILES].sort())
  })

  it('the rest of the grid shares one neutral chip', () => {
    const plain = tiles.filter(t => !t.tone)
    // If colour ever creeps back onto most tiles, the system is decoration again.
    expect(plain.length).toBeGreaterThan(tiles.length / 2)
    const chip = src.slice(src.indexOf('function tileChip('), src.indexOf('interface QuickAction'))
    // The neutral default and both signals come from THEME tokens, so they
    // resolve correctly in the light (sunlight) and dark palettes alike.
    expect(chip).toMatch(/theme\.color\.surfaceAlt/)
    expect(chip).toMatch(/theme\.color\.danger\.soft/)
    expect(chip).toMatch(/theme\.color\.success\.soft/)
    expect(chip).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

// ── 3. Labels must stand alone now that nothing explains them ────────────────

describe('every label is unambiguous on its own', () => {
  it('no two tiles share a label', () => {
    const labels = tiles.map(t => t.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('no label is swallowed by another label', () => {
    // "History" beside "Checklist History" told a user nothing once the
    // sublabel that distinguished them was removed.
    const swallowed: string[] = []
    for (const a of tiles) {
      for (const b of tiles) {
        if (a === b) continue
        if (b.label.toLowerCase().includes(a.label.toLowerCase())) {
          swallowed.push(`"${a.label}" is swallowed by "${b.label}"`)
        }
      }
    }
    expect(swallowed.join(' | ')).toBe('')
  })

  it('no two tiles draw the same icon', () => {
    const icons = tiles.map(t => t.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  it('every icon is a real Ionicons glyph', () => {
    expect(Object.keys(GLYPHS).length).toBeGreaterThan(1000)
    for (const t of tiles) {
      expect(`${t.icon} (${t.label})`).toBe(
        GLYPHS[t.icon] === undefined ? `MISSING GLYPH ${t.icon}` : `${t.icon} (${t.label})`,
      )
    }
  })
})

// ── 4. i18n: a missing key renders the raw key path on mobile ────────────────

function lookup(dict: any, path: string): unknown {
  return path.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), dict)
}

describe('every locale key Home asks for exists in BOTH locales', () => {
  // LanguageContext.resolve falls back to English only when the key exists in
  // en.json; absent there too it renders the dotted key path on screen.
  it.each(tiles.map(t => [tileId(t), t.label] as const))(
    'modules.home.qa.%s.label is translated (%s)',
    (id) => {
      for (const [name, dict] of [['en', en], ['ar', ar]] as const) {
        const key = `modules.home.qa.${id}.label`
        const v = lookup(dict, key)
        const ok = typeof v === 'string' && (v as string).trim().length > 0
        // A missing key renders the dotted path ON SCREEN, so name it.
        expect(ok ? 'present' : `MISSING ${name}.json -> ${key}`).toBe('present')
      }
    },
  )

  it('every section heading is translated', () => {
    for (const section of new Set(tiles.map(t => t.section))) {
      expect(typeof lookup(en, `modules.home.sections.${section}`)).toBe('string')
      expect(typeof lookup(ar, `modules.home.sections.${section}`)).toBe('string')
    }
  })

  it('the dead sublabel strings were deleted, not left to rot', () => {
    for (const [name, dict] of [['en', en], ['ar', ar]] as const) {
      const qa = lookup(dict, 'modules.home.qa') as Record<string, any>
      expect(qa).toBeTruthy()
      const withSub = Object.keys(qa).filter(k => 'sub' in qa[k])
      expect(`${name}: ${withSub.join(', ')}`).toBe(`${name}: `)
    }
  })

  it('the two locales describe the same set of tiles', () => {
    expect(Object.keys(lookup(ar, 'modules.home.qa') as object).sort())
      .toEqual(Object.keys(lookup(en, 'modules.home.qa') as object).sort())
  })
})

// ── 5. Behaviour that must survive a design pass ─────────────────────────────

describe('the design pass changed presentation only', () => {
  it('tiles are still gated by the effective access resolver', () => {
    expect(src).toMatch(/QUICK_ACTIONS\.filter\(a => a\.section === key && canAccess\(a\.module\)\)/)
  })

  it('a section with no reachable tile still does not render', () => {
    expect(src).toMatch(/\.filter\(sec => sec\.items\.length > 0\)/)
  })

  it('the React key still falls back to the module, so shared keys stay distinct', () => {
    expect(src).toMatch(/key=\{a\.id \?\? a\.module\}/)
  })

  it('a missing translation still falls back to the registry English string', () => {
    expect(src).toMatch(/labelTr === labelKey \? action\.label : labelTr/)
  })
})
