/**
 * Pure signature-ink policy shared by the React Native pad and its Node tests.
 *
 * Keeping this free of React Native imports lets the existing fast ts-jest
 * suite verify the stored-ink contrast rule without loading a UI component.
 */
export const PAD_SURFACE = '#f8fafc'
export const DEFAULT_PEN = '#0f172a'

/**
 * The pen colour is baked into the stored SVG, so an illegible pen is not a
 * display-only problem. Refuse ink without sufficient contrast against the
 * document surface and fall back to the production-safe dark pen.
 */
export function legiblePen(pen?: string | null, surface: string = PAD_SURFACE): string {
  const lum = (hex?: string | null): number | null => {
    if (typeof hex !== 'string') return null
    let h = hex.trim().replace(/^#/, '')
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    if (h.length === 8) h = h.slice(0, 6)
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
    const v = (i: number) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * v(0) + 0.7152 * v(2) + 0.0722 * v(4)
  }
  const p = lum(pen)
  const s = lum(surface)
  if (p === null || s === null) return DEFAULT_PEN
  const ratio = (Math.max(p, s) + 0.05) / (Math.min(p, s) + 0.05)
  return ratio >= 3 ? (pen as string) : DEFAULT_PEN
}
