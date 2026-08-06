/**
 * assetClasses - asset-number class (prefix) helpers for fleet pickers.
 *
 * Asset numbers encode the equipment class in their leading letters (TM =
 * transit mixer, MP = mobile pump, WL = wheel loader, ...). Only SOME classes
 * carry tyres; generators (GN), batching plants (BP), ice plants (IP),
 * stationary/placing pumps (SP/PB) etc. never do, and they are what push the
 * full register past 1000 rows per country.
 *
 * TYRE_ASSET_CLASSES = every class with at least one tyre_records row in any
 * country (measured live 2026-08-06: TM/MP/PL/WL/BH/SL plus LP in KSA and MB
 * in Egypt). Filtering pickers to these keeps each country's list well under
 * 1000 (KSA: 735 of 1022) while every class stays one tap away via its chip.
 */

export const TYRE_ASSET_CLASSES = ['TM', 'MP', 'PL', 'WL', 'BH', 'SL', 'LP', 'MB']

const TYRE_SET = new Set(TYRE_ASSET_CLASSES)

/** Leading letters of an asset number, uppercased ('TM634' -> 'TM'). */
export function assetClassOf(assetNo?: string | null): string | null {
  const m = String(assetNo ?? '').trim().match(/^[A-Za-z]+/)
  return m ? m[0].toUpperCase() : null
}

/** Does this asset belong to a class that carries tyres? */
export function isTyreAsset(assetNo?: string | null): boolean {
  const cls = assetClassOf(assetNo)
  return cls != null && TYRE_SET.has(cls)
}

export type ClassChip = { cls: string; count: number; tyre: boolean }

/**
 * Build the chip list from the loaded fleet rows: one chip per class actually
 * present, tyre classes first (in TYRE_ASSET_CLASSES order), the rest by count.
 */
export function classChips(rows: Array<{ asset_no?: string | null }>): ClassChip[] {
  const counts = new Map<string, number>()
  for (const r of rows || []) {
    const cls = assetClassOf(r?.asset_no)
    if (!cls) continue
    counts.set(cls, (counts.get(cls) || 0) + 1)
  }
  const chips: ClassChip[] = [...counts.entries()].map(([cls, count]) => ({ cls, count, tyre: TYRE_SET.has(cls) }))
  chips.sort((a, b) => {
    if (a.tyre !== b.tyre) return a.tyre ? -1 : 1
    if (a.tyre && b.tyre) return TYRE_ASSET_CLASSES.indexOf(a.cls) - TYRE_ASSET_CLASSES.indexOf(b.cls)
    return b.count - a.count || a.cls.localeCompare(b.cls)
  })
  return chips
}
