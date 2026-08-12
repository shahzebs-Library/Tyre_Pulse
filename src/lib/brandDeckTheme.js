/**
 * brandDeckTheme - the Green Concrete house style for every deck this app
 * produces, in ONE place, so a slide built by the app is indistinguishable from
 * a slide the office built by hand.
 *
 * WHERE THIS COMES FROM. It is measured from the company's own
 * "GCC - Assets Disposal Plan" deck, not invented to look corporate:
 *
 *   - Theme accent1 `277D33` is the Green Concrete green; accent2 `6A6A6A` is
 *     the grey in the logo mark. Both are read straight from that deck's
 *     theme1.xml, so they are the company's colours rather than an eyeballed
 *     match.
 *   - The cover is a pale-green panel on the left carrying the illustration,
 *     and a white panel on the right carrying the logo above a green title.
 *     The white panel is three stacked `flowChartManualInput` shapes rotated
 *     270 degrees - that is what gives the soft stepped edge down the middle.
 *     The panel tint is accent1 at lumMod 40 / lumOff 60 with 50% alpha, which
 *     resolves to `CAEECF`; it is stored flat here because a renderer should
 *     not have to redo HSL arithmetic to draw a rectangle.
 *   - Content slides run navy `0B2A4A` headings over white, with green
 *     `177A3A` for the positive figure, and soft tints behind callouts:
 *     `E6F2EA` green, `EAF0F6` blue, `FFF0DC` amber.
 *
 * TYPEFACE, AND A DELIBERATE DEPARTURE. The company cover uses Axiforma
 * ExtraBold. Axiforma is not installed with Office and has no metric-compatible
 * substitute, so a deck that asks for it renders in whatever the reader's
 * machine falls back to - different widths, and any text that fitted here may
 * overflow there. Their own CONTENT slides are already Arial. So Arial is used
 * throughout: it is what the rest of their deck uses, it ships with Office
 * everywhere, and it renders true to width. If the office installs Axiforma
 * fleet-wide, set TITLE_FONT to it in this one place.
 *
 * Geometry is in INCHES on a 13.333 x 7.5 canvas, so the same numbers drive
 * pptxgenjs and jsPDF and the two renderers cannot drift apart.
 */

/** The canvas both renderers draw on. */
export const PAGE = { w: 13.333, h: 7.5 }

/** Arial for everything - see the typeface note above. */
export const BODY_FONT = 'Arial'
export const TITLE_FONT = 'Arial'

/**
 * The house palette, as bare 6-digit hex (what pptxgenjs wants; never a #).
 * Every colour here appears in the company's own deck.
 */
export const BRAND = {
  // Identity
  green: '277D33',        // theme accent1 - the Green Concrete green
  greenDeep: '0F5F2D',    // the darker green used on content headings
  greenMid: '177A3A',     // the working green for a positive figure
  grey: '6A6A6A',         // theme accent2 - the grey in the logo mark

  // Cover
  panelTint: 'CAEECF',    // accent1 lumMod 40 / lumOff 60 at 50% alpha
  panelWhite: 'FFFFFF',

  // Content
  navy: '0B2A4A',         // section headings
  ink: '101828',          // body text
  secondary: '344054',    // supporting text
  muted: '667085',        // captions, basis lines
  surface: 'F6F7F9',      // page background / quiet card
  card: 'FFFFFF',
  border: 'E4E7EC',

  // Callout tints, each with the ink that reads on it
  tintGreen: 'E6F2EA',
  tintBlue: 'EAF0F6',
  tintAmber: 'FFF0DC',
  amber: 'E47C00',
  red: 'B42318',
}

/**
 * Status tones. Kept separate from the identity colours: a band is a JUDGEMENT
 * and must not borrow the brand green, or a merely-average figure reads as
 * company-approved.
 */
export const TONE = {
  good: BRAND.greenMid,
  watch: BRAND.amber,
  bad: BRAND.red,
  quiet: BRAND.muted,
}

/** Priority tones for a recommendation. Amber and red carry the weight. */
export const PRIORITY_TONE = {
  critical: BRAND.red,
  high: BRAND.amber,
  medium: BRAND.navy,
  low: BRAND.secondary,
  info: BRAND.secondary,
}

/** [r,g,b] for jsPDF, which will not take a hex string. */
export function rgb(hex) {
  const h = String(hex || '').replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** The same palette pre-converted, so a renderer never calls rgb() in a loop. */
export const BRAND_RGB = Object.fromEntries(
  Object.entries(BRAND).map(([k, v]) => [k, rgb(v)]),
)

/**
 * The cover composition, measured from the company deck and expressed in
 * inches so both renderers place it identically.
 *
 * `steps` are the three stacked panels that make the soft edge. In PowerPoint
 * they are rotated flowChartManualInput shapes; a renderer without that shape
 * (jsPDF) draws the same three rectangles, which reads as the same stepped
 * panel because the step is the only part a reader notices.
 */
export const COVER = {
  // Pale green panel, left, full height.
  panel: { x: 0, y: 0, w: 7.958, h: PAGE.h },
  // The white panel over it, as three stacked steps. x is the left edge of the
  // rotated footprint; each step sits slightly further right and slightly
  // shorter, which is what makes the edge look layered rather than cut.
  steps: [
    { x: 6.410, y: 0.00, w: PAGE.w - 6.410, h: PAGE.h },
    { x: 6.520, y: 0.08, w: PAGE.w - 6.520, h: PAGE.h - 0.16 },
    { x: 6.585, y: 0.12, w: PAGE.w - 6.585, h: PAGE.h - 0.24 },
  ],
  // Logo, top right on the white panel. Height is the constraint; width is
  // whatever the logo's own aspect gives, so a re-uploaded logo of a different
  // shape is not stretched.
  logo: { x: 8.626, y: 1.262, maxW: 3.206, maxH: 1.540 },
  // Title block, below the logo. Green on white, as on the company cover.
  title: { x: 6.767, y: 4.000, w: 5.536, size: 26 },
  subtitle: { x: 6.767, y: 4.560, w: 5.536, size: 13 },
  meta: { x: 6.767, y: 6.500, w: 5.536, size: 10 },
  // Where an illustration or cover figure sits, on the green panel.
  art: { x: 0.229, y: 1.783, w: 6.444, h: 3.934 },
}

/** Content-slide geometry. One margin, used by every slide. */
export const SLIDE = {
  mx: 0.55,
  headingY: 0.42,
  headingSize: 22,
  eyebrowSize: 10,
  subheadY: 1.05,
  bodyTop: 1.45,
  get contentW() { return PAGE.w - this.mx * 2 },
  footerY: PAGE.h - 0.42,
  footerSize: 9,
}

/** Type scale, in points. Titles carry the contrast; captions stay quiet. */
export const TYPE = {
  cover: 26,
  heading: 22,
  subhead: 15,
  section: 13,
  body: 11.5,
  small: 10,
  caption: 9,
  stat: 30,
  statLabel: 9.5,
}

/**
 * The one line that names what a figure rests on.
 *
 * Kept in the theme because it is a house rule, not a slide's own text: a
 * number that reached a board paper without its basis is the failure this whole
 * module exists to prevent, so the styling of that line is fixed and quiet
 * rather than decided per slide.
 */
export const BASIS_STYLE = { size: TYPE.caption, color: BRAND.muted, italic: true }

/** Chart colours, in the order a series should take them. */
export const CHART_SERIES = [
  BRAND.greenMid, BRAND.navy, BRAND.amber, BRAND.grey,
  BRAND.greenDeep, BRAND.secondary, BRAND.red, BRAND.muted,
]

/**
 * A cover subtitle that says what the deck covers without overclaiming.
 * Exported so the deck builder and any future report use the same wording.
 */
export function coverMeta({ company = 'Green Concrete Company', country = null, generated = null } = {}) {
  const bits = [company]
  if (country && country !== 'All') bits.push(country)
  if (generated) bits.push(generated)
  return bits.filter(Boolean).join('   |   ')
}
