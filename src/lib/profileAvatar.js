export const AVATAR_LIMIT = 32768
export const AVATAR_PRESETS = ['green', 'blue', 'violet', 'amber', 'rose', 'slate']
export const AVATAR_COLORS = { green: '#15803d', blue: '#2563eb', violet: '#7c3aed', amber: '#b45309', rose: '#be123c', slate: '#475569' }

export function avatarInitials(name = '') {
  return String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => [...part][0]).join('').toLocaleUpperCase() || 'U'
}

// Stored photos are small raster thumbnails, never arbitrary SVG/HTML or URLs.
export function isAvatarImage(value) {
  return typeof value === 'string' && value.length <= AVATAR_LIMIT && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(value)
}

export function avatarSource(value) {
  if (isAvatarImage(value)) return value
  // Preserve existing hosted profile photos without allowing script/data SVG URLs.
  if (typeof value === 'string' && value.length < 2048 && /^https:\/\//i.test(value)) return value
  return ''
}

export function validateAvatarFile(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('type')
  if (file.size > 5 * 1024 * 1024) throw new Error('size')
}

export function avatarCrop(width, height, zoom = 1, vertical = 50) {
  if (!(width > 0 && height > 0)) throw new Error('dimensions')
  const side = Math.min(width, height) / Math.min(3, Math.max(1, Number(zoom) || 1))
  return { x: (width - side) / 2, y: (height - side) * Math.min(100, Math.max(0, Number(vertical) || 0)) / 100, side }
}

function thumbnailCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 192
  return canvas
}

function encode(canvas) {
  for (const quality of [0.85, 0.7, 0.5]) {
    const value = canvas.toDataURL('image/jpeg', quality)
    if (isAvatarImage(value)) return value
  }
  throw new Error('size')
}

export async function cropAvatarPhoto(file, zoom, vertical) {
  validateAvatarFile(file)
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > 24000000) throw new Error('dimensions')
    const canvas = thumbnailCanvas()
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas')
    const crop = avatarCrop(bitmap.width, bitmap.height, zoom, vertical)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, 192, 192)
    context.drawImage(bitmap, crop.x, crop.y, crop.side, crop.side, 0, 0, 192, 192)
    return encode(canvas)
  } finally { bitmap.close() }
}

// Built locally with canvas. No third-party avatar service receives a name/photo.
export function makeAvatar(name, preset, illustrated = false) {
  const canvas = thumbnailCanvas()
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas')
  context.fillStyle = AVATAR_COLORS[preset] || AVATAR_COLORS.green
  context.fillRect(0, 0, 192, 192)
  if (illustrated) {
    context.fillStyle = '#e2e8f0'
    context.beginPath(); context.ellipse(96, 192, 69, 66, 0, 0, Math.PI * 2); context.fill()
    context.fillStyle = '#f2c5a7'
    context.beginPath(); context.ellipse(96, 88, 37, 43, 0, 0, Math.PI * 2); context.fill()
    context.fillStyle = '#253343'
    context.beginPath(); context.ellipse(96, 61, 39, 23, -0.15, Math.PI, Math.PI * 2); context.fill()
    context.beginPath(); context.arc(83, 88, 3, 0, Math.PI * 2); context.arc(109, 88, 3, 0, Math.PI * 2); context.fill()
    context.strokeStyle = '#8b4e3a'; context.lineWidth = 3
    context.beginPath(); context.arc(96, 101, 11, 0.2, Math.PI - 0.2); context.stroke()
  } else {
    context.fillStyle = '#ffffff'; context.font = '600 68px system-ui'; context.textAlign = 'center'; context.textBaseline = 'middle'
    context.fillText(avatarInitials(name), 96, 101, 165)
  }
  return encode(canvas)
}
