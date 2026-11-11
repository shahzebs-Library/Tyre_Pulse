import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import baseline from './pagesWithoutT.baseline.json'

/**
 * i18n ratchet (F-J-02 infra).
 *
 * The web app still has a long tail of pages that render English literals with
 * no translation layer (localization-rtl backlog). We cannot fix them all in one
 * loop, but we can stop the pile from growing: this test counts the pages that
 * call NO t() helper AND carry more than ten literal JSX strings, and fails the
 * moment that count rises above the committed baseline. A new page ships
 * internationalised, or the number it would bump is already recorded here.
 *
 * It is a SOURCE SCAN, deliberately coarse. The exact string count does not need
 * to be perfect - it needs to be STABLE and the same on every machine - so the
 * ratchet measures a trend, not an absolute. Lower the baseline whenever a page
 * is localised, to lock the gain in.
 */

const DIR = 'src/pages'

// A file "uses translation" if it calls a t(...) helper. The lookbehind-style
// prefix check avoids matching identifiers that merely end in `t(` such as
// request(, format(, useEffect( or .at().
const usesT = (src) => /(^|[^A-Za-z0-9_$.])t\(/.test(src)

// A literal JSX string: visible text content between tags that holds a real
// word (two or more letters). Expressions ({...}) are excluded by the character
// class, so {t('x')} and {count} do not count.
const countLiteralJsxStrings = (src) =>
  (src.match(/>\s*[^<>{}]*?[A-Za-z]{2,}[^<>{}]*?\s*</g) || []).length

const LITERAL_THRESHOLD = 10

function unlocalisedPages() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.jsx'))
    .filter((f) => {
      const src = readFileSync(`${DIR}/${f}`, 'utf8')
      return !usesT(src) && countLiteralJsxStrings(src) > LITERAL_THRESHOLD
    })
}

describe('i18n ratchet: pages with no translation layer', () => {
  it('does not exceed the committed baseline', () => {
    const current = unlocalisedPages().length
    // The message names the overshoot so a regression reads at a glance.
    expect(
      current,
      `New un-internationalised page(s): the count rose from the baseline ${baseline.baseline} to ${current}. ` +
        `Localise the new page with t(), or (if a page was localised) lower the baseline in ` +
        `src/test/pagesWithoutT.baseline.json.`,
    ).toBeLessThanOrEqual(baseline.baseline)
  })

  it('the baseline is a plausible, non-trivial number', () => {
    // Guards against the baseline being blanked to 0 (which would make the
    // ratchet vacuously pass) or set absurdly high.
    expect(baseline.baseline).toBeGreaterThan(0)
    expect(baseline.baseline).toBeLessThanOrEqual(readdirSync(DIR).filter((f) => f.endsWith('.jsx')).length)
  })
})
