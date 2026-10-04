/**
 * Turn an uploaded logo file into a small PNG data URI for system_config
 * company_logo (no storage bucket needed). The image is scaled to fit
 * 480 x 160, re-encoded as PNG (which drops any embedded script or metadata),
 * and checked for size and for being too light to see on a white report page.
 *
 * Accepts PNG, JPEG and WebP only. SVG is refused: it can carry script.
 */
import { averageLightness } from './paletteCheck'

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const LOGO_MAX_INPUT_BYTES = 3 * 1024 * 1024
export const LOGO_MAX_OUTPUT_BYTES = 300 * 1024
const MAX_W = 480
const MAX_H = 160

/** Pure pre-check of a File-like { type, size }. null when acceptable. */
export function logoFileProblem(file) {
  if (!file) return 'Choose an image file.'
  if (!LOGO_TYPES.includes(file.type)) return 'Use a PNG, JPEG or WebP image. SVG and other files are not accepted.'
  if (file.size > LOGO_MAX_INPUT_BYTES) return 'The file is larger than 3 MB. Use a smaller image.'
  return null
}

/** Fit (w, h) inside the logo box, never enlarging. */
export function fitLogo(w, h) {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 }
  const k = Math.min(1, MAX_W / w, MAX_H / h)
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('The file could not be read.'))
    r.readAsDataURL(file)
  })
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('This file is not a readable image.'))
    img.src = src
  })
}

/**
 * @returns {Promise<{dataUrl:string,width:number,height:number,bytes:number,lightness:number|null,tooLight:boolean}>}
 */
export async function prepareLogo(file) {
  const problem = logoFileProblem(file)
  if (problem) throw new Error(problem)
  const img = await loadImage(await readAsDataUrl(file))
  const { width, height } = fitLogo(img.naturalWidth || img.width, img.naturalHeight || img.height)
  if (!width) throw new Error('This image has no size.')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot prepare the image.')
  ctx.drawImage(img, 0, 0, width, height)
  let lightness = null
  try { lightness = averageLightness(ctx.getImageData(0, 0, width, height).data) } catch { lightness = null }
  const dataUrl = canvas.toDataURL('image/png')
  const bytes = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
  if (bytes > LOGO_MAX_OUTPUT_BYTES) throw new Error('The logo is still larger than 300 KB after resizing. Use a simpler image.')
  return { dataUrl, width, height, bytes, lightness, tooLight: lightness != null && lightness > 0.85 }
}
