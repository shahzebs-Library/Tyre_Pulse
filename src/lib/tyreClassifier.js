/**
 * Rule-based tyre classification engine.
 * No AI tokens required - pure keyword/pattern matching.
 * Classifies tyre description/remarks into category + risk level.
 */

// ── Abbreviation expansion ────────────────────────────────────────────────────
const ABBREV_MAP = {
  'b/o': 'Blowout', 'bo': 'Blowout', 'b.o': 'Blowout',
  's/w': 'Sidewall', 's/c': 'Sidewall cut', 'sw': 'Sidewall',
  'p/c': 'Puncture cut', 'p/t': 'Puncture',
  'f/t': 'Flat tyre', 'ft': 'Flat tyre',
  'eol': 'End of life', 'e/l': 'End of life',
  'n/t': 'New tyre', 'w/o': 'Worn out',
  'i/r': 'Irregular wear', 'o/l': 'Overloaded',
  'o/i': 'Over inflated', 'u/i': 'Under inflated',
  'c/d': 'Cord damaged', 'r/d': 'Rim damaged',
  'trd': 'Tread', 'sep': 'Separation',
  'dmg': 'Damage', 'dmgd': 'Damaged',
  'rplc': 'Replace', 'rpl': 'Replace',
  'insp': 'Inspection', 'mnt': 'Mounted',
}

const ARABIC_TERM_MAP = {
  // Blowout - Arabic script + transliteration
  'انفجار': 'Blowout', 'انفجر': 'Blowout', 'إنفجار': 'Blowout',
  'infijar': 'Blowout', 'infijaar': 'Blowout',
  // Puncture
  'ثقب': 'Puncture', 'ثقوب': 'Puncture', 'تسريب': 'Puncture',
  'tasreeb': 'Puncture', 'tasrib': 'Puncture', 'thaqb': 'Puncture',
  // Worn out / Normal wear
  'تآكل': 'Worn out', 'بالى': 'Worn out', 'مستهلك': 'Worn out', 'اهتراء': 'Worn out',
  'ta\'akul': 'Worn out', 'mustahlak': 'Worn out', 'ihtira': 'Worn out',
  // Sidewall
  'جانبي': 'Sidewall', 'جدار جانبي': 'Sidewall',
  'janbi': 'Sidewall',
  // Blowout - Urdu transliteration
  'phat gaya': 'Blowout', 'phat gayi': 'Blowout', 'fut gaya': 'Blowout', 'phata': 'Blowout',
  // Puncture - Urdu
  'pankchar': 'Puncture', 'panchar': 'Puncture', 'punctchar': 'Puncture',
  'hawa nikal': 'Puncture',
  // Worn - Urdu
  'ghis gaya': 'Worn out', 'ghisa': 'Worn out', 'ghas gaya': 'Worn out',
  'khatam': 'Worn out', 'khatm': 'Worn out',
  // Sidewall - Urdu
  'side kat': 'Sidewall cut', 'kinara': 'Sidewall', 'side phata': 'Sidewall',
  // Cut - Urdu/Arabic
  'kata hua': 'Cut', 'kat gaya': 'Cut',
  // Heat - Urdu/Arabic
  'jala hua': 'Heat damage', 'garmi se': 'Heat damage', 'harara': 'Heat damage',
  // Irregular wear - Urdu
  'ek taraf ghisa': 'Irregular wear',
}

// ── Category definitions ───────────────────────────────────────────────────────
export const CATEGORIES = {
  BLOWOUT: {
    label: 'Blowout',
    risk_level: 'Critical',
    weight: 10,
    patterns: [
      /\bb[\s/-]?o\b/i,
      /blow[-\s]?out/i,
      /burst/i,
      /explod/i,
      /blown[-\s]out/i,
      /sudden deflat/i,
    ],
  },
  SEPARATION: {
    label: 'Tread Separation',
    risk_level: 'Critical',
    weight: 10,
    patterns: [
      /separat/i,
      /delaminat/i,
      /belt[-\s]?separat/i,
      /tread[-\s]?peel/i,
      /peel[-\s]?off/i,
      /tread[-\s]?strip/i,
      /chunk(ing| off)/i,
      /tread loss/i,
    ],
  },
  SIDEWALL: {
    label: 'Sidewall Damage',
    risk_level: 'High',
    weight: 8,
    patterns: [
      /s[\s/-]w\b/i,
      /side[-\s]?wall/i,
      /side[-\s]?cut/i,
      /cord[-\s]?(damage|exposed|broken|visible)/i,
      /bulge/i,
      /bubble/i,
      /chop/i,
      /pinch/i,
    ],
  },
  CUT: {
    label: 'Cut / Tread Damage',
    risk_level: 'High',
    weight: 7,
    patterns: [
      /tread[-\s]?cut/i,
      /tread[-\s]?(damage|damaged)/i,
      /deep[-\s]?cut/i,
      /gash/i,
      /slash/i,
      /tread[-\s]?torn/i,
      /external[-\s]?damage/i,
    ],
  },
  HEAT: {
    label: 'Heat / Overload Damage',
    risk_level: 'High',
    weight: 7,
    patterns: [
      /heat[-\s]?(damage|damaged|fail)/i,
      /overheat/i,
      /over[-\s]?load/i,
      /thermal/i,
      /run[-\s]?flat/i,
      /under[-\s]?inflat/i,
      /over[-\s]?inflat/i,
      /wrong[-\s]?pressure/i,
      /improper[-\s]?(inflat|pressure)/i,
    ],
  },
  IMPACT: {
    label: 'Impact Damage',
    risk_level: 'High',
    weight: 6,
    patterns: [
      /impact/i,
      /pothole/i,
      /kerb[-\s]?damage/i,
      /curb[-\s]?damage/i,
      /road[-\s]?hazard/i,
      /road[-\s]?damage/i,
      /rock[-\s]?damage/i,
      /struck[-\s]?by/i,
    ],
  },
  PUNCTURE: {
    label: 'Puncture',
    risk_level: 'Medium',
    weight: 5,
    patterns: [
      /puncture/i,
      /flat[-\s]?tyre/i,
      /flat[-\s]?tire/i,
      /nail/i,
      /screw/i,
      /\bflat\b/i,
      /foreign[-\s]?object/i,
      /penetrat/i,
      /sharp[-\s]?object/i,
      /slow[-\s]?puncture/i,
    ],
  },
  IRREGULAR_WEAR: {
    label: 'Irregular Wear',
    risk_level: 'Medium',
    weight: 4,
    patterns: [
      /irregular[-\s]?wear/i,
      /uneven[-\s]?wear/i,
      /center[-\s]?wear/i,
      /centre[-\s]?wear/i,
      /shoulder[-\s]?wear/i,
      /one[-\s]?sided/i,
      /cupping/i,
      /feather[-\s]?edge/i,
      /scallop/i,
    ],
  },
  CHEMICAL: {
    label: 'Chemical Damage',
    risk_level: 'Medium',
    weight: 4,
    patterns: [
      /chemical[-\s]?(damage|deteriorat)/i,
      /oil[-\s]?damage/i,
      /oil[-\s]?contamina/i,
      /fuel[-\s]?(damage|contact|spill)/i,
      /solvent/i,
      /acid[-\s]?damage/i,
      /petroleum/i,
      /diesel[-\s]?damage/i,
    ],
  },
  BEAD: {
    label: 'Bead / Rim Damage',
    risk_level: 'Medium',
    weight: 4,
    patterns: [
      /bead[-\s]?(damage|fail|broken|bent)/i,
      /rim[-\s]?(damage|damaged)/i,
      /wheel[-\s]?damage/i,
      /mounting[-\s]?damage/i,
      /bead[-\s]?wire/i,
    ],
  },
  VALVE: {
    label: 'Valve Issue',
    risk_level: 'Low',
    weight: 3,
    patterns: [
      /valve[-\s]?(stem|fail|damage|broken|leak)/i,
      /valve issue/i,
      /slow[-\s]?leak/i,
      /air[-\s]?leak/i,
      /gradual[-\s]?deflat/i,
    ],
  },
  WEAR: {
    label: 'Normal Wear',
    risk_level: 'Low',
    weight: 2,
    patterns: [
      /normal[-\s]?wear/i,
      /\bworn[-\s]?out\b/i,
      /\bworn[-\s]?down\b/i,
      /\bbald\b/i,
      /\bsmooth\b/i,
      /low[-\s]?tread/i,
      /end[-\s]?of[-\s]?life/i,
      /condemned/i,
      /wear[-\s]?limit/i,
      /tread[-\s]?depth/i,
      /\bworn\b/i,
    ],
  },
  REPLACEMENT: {
    label: 'Scheduled Replacement',
    risk_level: 'Low',
    weight: 1,
    patterns: [
      /schedul(ed|e)[-\s]?replace/i,
      /routine[-\s]?replace/i,
      /\brotation\b/i,
      /tyre[-\s]?rotation/i,
      /new[-\s]?tyre/i,
      /\binstall(ed|ation)?\b/i,
      /swap(ped)?/i,
    ],
  },
}

// ── Junk pattern (to strip from text) ─────────────────────────────────────────
const JUNK_PATTERN = /[/\\|*]{2,}|[?!]{3,}|[-_=]{4,}|\s{2,}/g

// ── Expand abbreviations in text ──────────────────────────────────────────────
function expandAbbreviations(text) {
  let out = text
  // English abbreviations (existing logic - keep unchanged)
  for (const [abbr, expansion] of Object.entries(ABBREV_MAP)) {
    const re = new RegExp(`\\b${abbr.replace(/[/]/g, '\\/')}\\b`, 'gi')
    out = out.replace(re, expansion)
  }
  // Arabic script + Urdu transliterations
  for (const [term, expansion] of Object.entries(ARABIC_TERM_MAP)) {
    if (/[؀-ۿ]/.test(term)) {
      // Arabic script: plain replace (no word boundary - Arabic doesn't use \b)
      out = out.split(term).join(expansion)
    } else {
      // Latin-script Urdu transliterations: use word boundary when safe
      try {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(`\\b${escaped}\\b`, 'gi')
        out = out.replace(re, expansion)
      } catch (_) {
        out = out.split(term).join(expansion)
      }
    }
  }
  return out
}

// ── Clean raw text ────────────────────────────────────────────────────────────
function cleanText(text) {
  if (!text) return ''
  let t = String(text).trim()
  t = expandAbbreviations(t)
  t = t.replace(JUNK_PATTERN, match => (match.includes(' ') ? ' ' : ' '))
  t = t.replace(/\s+/g, ' ').trim()
  if (t.length > 0) t = t[0].toUpperCase() + t.slice(1)
  if (t && !t.endsWith('.') && !t.endsWith('?') && !t.endsWith('!')) t += '.'
  return t
}

// ── Main classifier ────────────────────────────────────────────────────────────
/**
 * Classify a tyre record based on description and remarks text.
 *
 * @param {string} description  - Tyre description / type
 * @param {string} remarks      - Free-text remarks
 * @returns {{ category, risk_level, remarks_cleaned, confidence, matched_keywords }}
 */
export function classifyTyre(description = '', remarks = '') {
  const combined = expandAbbreviations(`${description} ${remarks}`).toLowerCase()
  const results = []

  for (const [key, def] of Object.entries(CATEGORIES)) {
    const matched = []
    for (const pat of def.patterns) {
      const m = combined.match(pat)
      if (m) matched.push(m[0])
    }
    if (matched.length > 0) {
      results.push({ key, def, matched, score: matched.length * def.weight })
    }
  }

  const cleanedRemarks = cleanText(remarks || description)

  if (results.length === 0) {
    return {
      category: 'Unclassified',
      risk_level: 'Medium',
      remarks_cleaned: cleanedRemarks,
      confidence: 'Low',
      matched_keywords: [],
    }
  }

  // Sort by score descending, take winner
  results.sort((a, b) => b.score - a.score)
  const winner = results[0]
  const confidence = winner.matched.length >= 3 ? 'High' : winner.matched.length >= 2 ? 'Medium' : 'Low'

  return {
    category: winner.def.label,
    risk_level: winner.def.risk_level,
    remarks_cleaned: cleanedRemarks,
    confidence,
    matched_keywords: winner.matched,
  }
}

// ── Batch classify array of records ───────────────────────────────────────────
/**
 * @param {Array<{id, description, remarks}>} records
 * @returns {Array<{id, ...classifyTyre result}>}
 */
export function batchClassify(records) {
  return records.map(r => ({
    id: r.id,
    ...classifyTyre(r.description, r.remarks),
    original_description: r.description,
    original_remarks: r.remarks,
  }))
}

// ── Derive risk colour class for UI ───────────────────────────────────────────
export const RISK_COLOUR = {
  Critical: 'bg-red-900/50 text-red-300 border border-red-700/40',
  High:     'bg-orange-900/50 text-orange-300 border border-orange-700/40',
  Medium:   'bg-yellow-900/50 text-yellow-300 border border-yellow-700/40',
  Low:      'bg-green-900/50 text-green-300 border border-green-700/40',
}

export const CONFIDENCE_COLOUR = {
  High:   'text-green-400',
  Medium: 'text-yellow-400',
  Low:    'text-gray-500',
}

export const ALL_CATEGORY_LABELS = Object.values(CATEGORIES).map(c => c.label).concat(['Unclassified'])

export function containsArabic(text) {
  return /[؀-ۿ]/.test(String(text || ''))
}
