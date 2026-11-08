/**
 * Saving inspection photos to the device.
 *
 * Photos are signed storage URLs, so a plain `<a download>` does not work: the
 * browser ignores `download` for another origin and just opens the picture.
 * The file is fetched as a blob and saved from a local object URL instead,
 * under a name a person can find again (asset, position, date).
 */

/** Strip what a file system or a zip reader will not take. */
export function safeFilePart(value) {
  return String(value ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic' }

/** Extension from the blob's type, else from the URL path, else jpg. */
export function extensionFor(type, url = '') {
  if (type && EXT[type.toLowerCase()]) return EXT[type.toLowerCase()]
  const m = String(url).split('?')[0].match(/\.([a-z0-9]{3,4})$/i)
  return m ? m[1].toLowerCase() : 'jpg'
}

/** "TM514 LHF1 2026-11-08" - the asset, what the photo shows, and the inspection day. */
export function photoBaseName(inspection, item, index = 0) {
  const day = String(inspection?.inspection_date || inspection?.scheduled_date || inspection?.created_at || '').slice(0, 10)
  const parts = [inspection?.asset_no, item?.label || `Photo ${index + 1}`, day].map(safeFilePart).filter(Boolean)
  return parts.join(' ') || `Inspection photo ${index + 1}`
}

/** Unique names inside one zip: a repeat gets " (2)", " (3)". */
export function uniqueNames(names) {
  const seen = new Map()
  return names.map((n) => {
    const key = n.toLowerCase()
    const count = (seen.get(key) || 0) + 1
    seen.set(key, count)
    if (count === 1) return n
    const dot = n.lastIndexOf('.')
    return dot > 0 ? `${n.slice(0, dot)} (${count})${n.slice(dot)}` : `${n} (${count})`
  })
}

function saveBlob(blob, filename) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 2000)
}

/** Download one photo. Throws when the file cannot be fetched. */
export async function downloadPhoto(url, baseName) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('The photo could not be downloaded.')
  const blob = await res.blob()
  saveBlob(blob, `${baseName}.${extensionFor(blob.type, url)}`)
}

/**
 * Every ready photo of an inspection in one zip. Photos that fail are left out
 * and counted, never silently: the result says how many made it.
 *
 * @param {Array<{url:string,label:string}>} items photos that have a signed URL
 * @returns {Promise<{saved:number, failed:number}>}
 */
export async function downloadPhotosZip(inspection, items, onProgress) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const fetched = []
  let failed = 0
  for (let i = 0; i < items.length; i += 1) {
    try {
      const res = await fetch(items[i].url)
      if (!res.ok) throw new Error('fetch')
      const blob = await res.blob()
      fetched.push({ blob, name: `${photoBaseName(inspection, items[i], i)}.${extensionFor(blob.type, items[i].url)}` })
    } catch {
      failed += 1
    }
    if (onProgress) onProgress(i + 1, items.length)
  }
  if (!fetched.length) throw new Error('None of the photos could be downloaded.')
  const names = uniqueNames(fetched.map((f) => f.name))
  fetched.forEach((f, i) => zip.file(names[i], f.blob))
  const out = await zip.generateAsync({ type: 'blob' })
  saveBlob(out, `${safeFilePart(`${inspection?.asset_no || 'Inspection'} photos ${String(inspection?.inspection_date || '').slice(0, 10)}`)}.zip`)
  return { saved: fetched.length, failed }
}
