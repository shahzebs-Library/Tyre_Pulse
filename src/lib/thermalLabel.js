/**
 * Thermal label commands (pure, no I/O): ZPL for Zebra-class printers and
 * ESC/POS for receipt-style label printers. Used by QR Labels' "Print to
 * thermal printer" (admin only); the PDF sheet stays the fallback.
 *
 * SECURITY: label text is user/asset data. ZPL treats ^ and ~ as command
 * prefixes and ESC/POS treats control bytes as commands, so a crafted asset
 * name could otherwise reconfigure or brick the printer. Both builders strip
 * those characters before anything is sent.
 */

export const LABEL_SIZES = Object.freeze({
  '50x25': { w: 50, h: 25, label: '50 x 25 mm' },
  '60x40': { w: 60, h: 40, label: '60 x 40 mm' },
  '100x50': { w: 100, h: 50, label: '100 x 50 mm' },
})
export const DEFAULT_LABEL_SIZE = '60x40'

/** Remove ZPL command prefixes and control characters; keep printable ASCII + basic Latin. */
export function zplSafe(v, max = 60) {
  return String(v ?? '')
    .replace(/[\^~\\]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** One label = { code (encoded in the QR), title, lines[] }. */
export function buildZpl(labels, { size = DEFAULT_LABEL_SIZE, dpi = 203 } = {}) {
  const s = LABEL_SIZES[size] || LABEL_SIZES[DEFAULT_LABEL_SIZE]
  const dpmm = dpi / 25.4
  const pw = Math.round(s.w * dpmm)
  const ll = Math.round(s.h * dpmm)
  const qrMag = Math.max(2, Math.min(10, Math.floor((s.h * dpmm) / 60)))
  const textX = Math.round(s.h * dpmm * 0.95)
  return (labels || []).filter((l) => l && l.code).map((l) => {
    const code = zplSafe(l.code, 120)
    const lines = [l.title, ...(l.lines || [])].map((x) => zplSafe(x, 32)).filter(Boolean).slice(0, 4)
    const text = lines.map((t, i) => `^FO${textX},${20 + i * 40}^A0N,${i === 0 ? 34 : 26},${i === 0 ? 34 : 26}^FD${t}^FS`).join('')
    return `^XA^CI28^PW${pw}^LL${ll}^FO16,16^BQN,2,${qrMag}^FDQA,${code}^FS${text}^XZ`
  }).join('\n')
}

function asciiBytes(s) {
  const out = []
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0)
    out.push(c >= 0x20 && c <= 0x7e ? c : 0x3f)
  }
  return out
}

/** ESC/POS bytes: text lines, a QR (GS ( k model 2) and a partial cut per label. */
export function buildEscPos(labels) {
  const bytes = [0x1b, 0x40] // ESC @ init
  for (const l of labels || []) {
    if (!l || !l.code) continue
    const code = asciiBytes(zplSafe(l.code, 120))
    const len = code.length + 3
    bytes.push(0x1b, 0x61, 0x01) // centre
    bytes.push(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00) // model 2
    bytes.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06) // module size 6
    bytes.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31) // error level M
    bytes.push(0x1d, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...code)
    bytes.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30) // print QR
    for (const t of [l.title, ...(l.lines || [])].map((x) => zplSafe(x, 32)).filter(Boolean).slice(0, 4)) {
      bytes.push(...asciiBytes(t), 0x0a)
    }
    bytes.push(0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00) // feed + partial cut
  }
  return new Uint8Array(bytes)
}
