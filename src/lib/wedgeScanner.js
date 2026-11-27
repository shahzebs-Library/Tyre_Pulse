/**
 * Keyboard-wedge scanner detection. USB barcode and RFID readers in keyboard
 * mode "type" a code very fast and end it with Enter. A person cannot type
 * that fast, so a burst of characters each arriving within `maxGapMs` of the
 * last, ending in Enter, is a scan.
 */
export function createWedgeDetector({ onScan, minLength = 4, maxGapMs = 40, maxLength = 128 } = {}) {
  let buf = ''
  let last = 0
  return function handle(e) {
    const key = e?.key
    const now = typeof e?.timeStamp === 'number' ? e.timeStamp : Date.now()
    if (key === 'Enter' || key === 'Tab') {
      const code = buf
      buf = ''
      if (code.length >= minLength) { onScan?.(code); return true }
      return false
    }
    if (typeof key !== 'string' || key.length !== 1) return false
    if (buf && now - last > maxGapMs) buf = ''
    last = now
    if (buf.length < maxLength) buf += key
    return false
  }
}
