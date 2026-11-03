/**
 * Serialize an SVG for rasterising, with every <image> it references inlined.
 *
 * The tyre map draws the real top-down vehicle photo as an <image href="/...">.
 * A browser renders an SVG loaded as an image (the PDF path: blob -> <img> ->
 * canvas) in secure mode and refuses to fetch anything external from inside
 * it, so the photo silently disappeared from every PDF. Inlining each href as
 * a data URL first keeps the PDF identical to the screen. A photo that cannot
 * be fetched is left as it was: the tyres and labels still print.
 */
const cache = new Map()

async function toDataUrl(href) {
  if (!href || href.startsWith('data:')) return href
  if (!cache.has(href)) {
    cache.set(href, fetch(href)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((blob) => new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result)
        fr.onerror = () => reject(fr.error)
        fr.readAsDataURL(blob)
      }))
      .catch(() => { cache.delete(href); return null }))
  }
  return cache.get(href)
}

export async function serializeSvgInlined(svgEl) {
  const clone = svgEl.cloneNode(true)
  const images = [...clone.querySelectorAll('image')]
  await Promise.all(images.map(async (img) => {
    const href = img.getAttribute('href') || img.getAttribute('xlink:href')
    const data = await toDataUrl(href)
    if (data) {
      img.setAttribute('href', data)
      img.removeAttribute('xlink:href')
    }
  }))
  return new XMLSerializer().serializeToString(clone)
}
