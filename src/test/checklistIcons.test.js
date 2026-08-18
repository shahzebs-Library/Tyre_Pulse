import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CHECKLIST_ICONS, CHECKLIST_ICON_TOKENS, DEFAULT_CHECKLIST_ICON,
  normaliseIconKey, isEmojiIcon, tokenFromName, tokenFromCategory,
  tokenFromTemplateName, resolveChecklistIcon, checklistIconComponent,
  checklistIconLabel,
} from '../lib/checklist/checklistIcons'

/**
 * The six templates that exist live today, with the EXACT icon + category
 * values measured from the database. Four of the six carried a value that
 * Ionicons cannot render, which is why the mobile cards showed a blank square.
 */
const LIVE = [
  { name: 'a',                                     category: 'Workshop',    icon: '🔧' },
  { name: 'Fleet Transit Mixer Checklist',         category: 'Inspection',  icon: 'ClipboardCheck' },
  { name: 'Maint',                                 category: 'Maintenance', icon: '📋' },
  { name: 'PMD',                                   category: 'Maintenance', icon: '📋' },
  { name: 'Predictive Maintenance Checklist',      category: 'Maintenance', icon: null },
  { name: 'Workshop Daily TM Inspection Checklist', category: 'Inspection', icon: 'ClipboardCheck' },
]

describe('checklistIcons resolution', () => {
  it('every live template resolves to something renderable', () => {
    for (const t of LIVE) {
      const r = resolveChecklistIcon(t)
      expect(['emoji', 'icon']).toContain(r.kind)
      expect(CHECKLIST_ICON_TOKENS).toContain(r.token)
      if (r.kind === 'emoji') expect(r.emoji).toBeTruthy()
      // A token ALWAYS maps to a real component, which is the guarantee that
      // stops anything downstream rendering a blank.
      expect(typeof checklistIconComponent(r.token)).not.toBe('undefined')
    }
  })

  it('an emoji is kept as an emoji and still carries a usable fallback token', () => {
    const r = resolveChecklistIcon({ icon: '🔧', category: 'Workshop' })
    expect(r.kind).toBe('emoji')
    expect(r.emoji).toBe('🔧')
    // Workshop -> wrench, so a monochrome badge or PDF glyph slot has something
    // sensible even though the emoji is what the card shows.
    expect(r.token).toBe('wrench')
  })

  it('the lucide names the seeded templates carry resolve instead of rendering blank', () => {
    // This is the actual production bug: <Ionicons name="ClipboardCheck"> drew
    // nothing, and the web builder printed the literal word.
    expect(tokenFromName('ClipboardCheck')).toBe('clipboard')
    expect(resolveChecklistIcon({ icon: 'ClipboardCheck' })).toMatchObject({ kind: 'icon', token: 'clipboard' })
  })

  it('name matching ignores case, spacing, dashes and underscores', () => {
    expect(normaliseIconKey('Clipboard-Check')).toBe('clipboardcheck')
    for (const v of ['ClipboardCheck', 'clipboard-check', 'CLIPBOARD_CHECK', 'clipboard check']) {
      expect(tokenFromName(v)).toBe('clipboard')
    }
    // Ionicons spellings resolve too, so a value written by an older build is
    // not suddenly unknown.
    expect(tokenFromName('construct-outline')).toBe('wrench')
    expect(tokenFromName('shield-checkmark-outline')).toBe('safety')
  })

  it('falls back through category, then name, then the generic clipboard', () => {
    // no icon, known category
    expect(resolveChecklistIcon({ icon: null, category: 'Maintenance' }).token).toBe('wrench')
    expect(resolveChecklistIcon({ icon: null, category: 'Electrical' }).token).toBe('bolt')
    // compound category still matches on containment
    expect(tokenFromCategory('Workshop Maintenance')).toBe('wrench')
    // no icon, no category, but the name says what it is
    expect(resolveChecklistIcon({ name: 'Daily tyre pressure round' }).token).toBe('tyre')
    expect(tokenFromTemplateName('Electrical safety check')).toBe('bolt')
    // nothing at all -> the generic one, never a guessed trade
    expect(resolveChecklistIcon({}).token).toBe(DEFAULT_CHECKLIST_ICON)
    expect(resolveChecklistIcon({ icon: '   ', category: '', name: '' }).token).toBe('clipboard')
  })

  it('never claims a specific trade for a checklist it knows nothing about', () => {
    // The last fallback must stay generic: an unknown sheet showing a lightning
    // bolt would assert it is electrical work.
    const r = resolveChecklistIcon({ name: 'Untitled', category: null, icon: null })
    expect(r.token).toBe('clipboard')
  })

  it('isEmojiIcon separates emoji from names and from blanks', () => {
    for (const v of ['🔧', '📋', '✅', '🚚']) expect(isEmojiIcon(v)).toBe(true)
    for (const v of ['ClipboardCheck', 'wrench', 'clipboard-outline', '', '   ', null, undefined, 'a']) {
      expect(isEmojiIcon(v)).toBe(false)
    }
    // A long string is a name or junk, never an icon glyph.
    expect(isEmojiIcon('🔧🔧🔧🔧🔧🔧🔧🔧🔧')).toBe(false)
  })

  it('an unknown token still yields a real component and a real label', () => {
    expect(typeof checklistIconComponent('nonsense')).not.toBe('undefined')
    expect(checklistIconLabel('nonsense')).toBe(checklistIconLabel(DEFAULT_CHECKLIST_ICON))
  })

  it('every catalogue entry is complete and its token is unique', () => {
    const seen = new Set()
    for (const e of CHECKLIST_ICONS) {
      expect(typeof e.token).toBe('string')
      expect(e.label.length).toBeGreaterThan(0)
      expect(typeof e.Icon).not.toBe('undefined')
      expect(Array.isArray(e.keywords)).toBe(true)
      expect(seen.has(e.token)).toBe(false)
      seen.add(e.token)
    }
  })
})

describe('mobile mirror stays in step', () => {
  const src = readFileSync(resolve(__dirname, '../../mobile/lib/checklistIcons.ts'), 'utf8')

  it('declares the SAME tokens in the SAME order', () => {
    // Drift here is invisible until someone notices a phone showing a different
    // icon from the web for the same checklist.
    const tokens = [...src.matchAll(/\{ token: '([a-z]+)'/g)].map((m) => m[1])
    expect(tokens).toEqual(CHECKLIST_ICON_TOKENS)
  })

  it('maps every token to a REAL Ionicons glyph', () => {
    // Guessing a glyph name is exactly how this bug shipped, so the names are
    // checked against the installed glyph map, not against a memory of it.
    const glyphs = JSON.parse(readFileSync(
      resolve(__dirname, '../../mobile/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'),
      'utf8',
    ))
    const used = [...src.matchAll(/ionicon: '([a-z-]+)'/g)].map((m) => m[1])
    expect(used).toHaveLength(CHECKLIST_ICON_TOKENS.length)
    for (const name of used) expect(Object.prototype.hasOwnProperty.call(glyphs, name)).toBe(true)
  })

  it('shares the same aliases and category map, so both stacks fall back alike', () => {
    for (const alias of ['clipboardcheck', 'constructoutline', 'shieldcheck', 'snowflake']) {
      expect(src).toContain(`${alias}:`)
    }
    for (const cat of ['inspection', 'maintenance', 'electrical', 'washing']) {
      expect(src).toContain(`${cat}:`)
    }
    expect(src).toContain("export const DEFAULT_CHECKLIST_ICON")
    expect(src).toContain("'clipboard'")
  })
})
