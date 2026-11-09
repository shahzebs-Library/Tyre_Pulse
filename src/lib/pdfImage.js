/**
 * Shrink a photo before it goes into a PDF.
 *
 * Phone photos arrive at full camera size (often 1600 px, 300 KB to 1 MB each)
 * while the report prints them as small thumbnails, so a 12-photo inspection
 * produced a ~4 MB PDF. Re-encoding each one at the size it is printed keeps it
 * sharp on screen and on paper and cuts the file to a fraction.
 *
 * Never throws: when anything fails the original image is returned unchanged,
 * so a report can never lose a photo because shrinking did not work.
 */
export const PDF_PHOTO_MAX_PX = 600
export const PDF_PHOTO_QUALITY = 0.72

// A decode that never finishes must not hold up the whole report.
function loadImg(src, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    const done = (v) => { clearTimeout(timer); resolve(v) }
    try {
      const img = new Image()
      img.onload = () => done(img)
      img.onerror = () => done(null)
      img.src = src
    } catch { done(null) }
  })
}

/** Target size: longest edge at most maxPx, aspect kept, never upscaled. */
export function fitWithin(width, height, maxPx = PDF_PHOTO_MAX_PX) {
  const w = Number(width), h = Number(height)
  if (!(w > 0) || !(h > 0)) return null
  const k = Math.min(1, maxPx / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}

/**
 * @param {string} dataUrl  image data URL
 * @param {string} fmt      'JPEG' | 'PNG' | 'WEBP' (the original's format)
 * @returns {Promise<{dataUrl: string, fmt: string}>}
 */
export async function shrinkImageForPdf(dataUrl, fmt = 'JPEG', { maxPx = PDF_PHOTO_MAX_PX, quality = PDF_PHOTO_QUALITY, timeoutMs = 8000 } = {}) {
  const original = { dataUrl, fmt }
  if (!dataUrl || typeof document === 'undefined') return original
  try {
    const img = await loadImg(dataUrl, timeoutMs)
    if (!img || !img.naturalWidth) return original
    const size = fitWithin(img.naturalWidth, img.naturalHeight, maxPx)
    if (!size) return original
    const c = document.createElement('canvas')
    c.width = size.width
    c.height = size.height
    const ctx = c.getContext && c.getContext('2d')
    if (!ctx) return original
    ctx.fillStyle = '#FFFFFF' // JPEG has no transparency
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const out = c.toDataURL('image/jpeg', quality)
    if (!out || !out.startsWith('data:image/jpeg')) return original
    // Keep the original when re-encoding would not make it smaller.
    return out.length < dataUrl.length ? { dataUrl: out, fmt: 'JPEG' } : original
  } catch {
    return original
  }
}
