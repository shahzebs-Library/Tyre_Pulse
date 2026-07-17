/**
 * safeUrl
 *
 * Minimal client-side URL guards for the mobile app. Any user-supplied or
 * database-sourced value that will be rendered as an image source or opened as
 * a link MUST pass through these so hostile schemes (javascript:, vbscript:,
 * data:text/html, ...) can never reach an <Image> or Linking.openURL.
 *
 * These are allow-lists: only known-safe schemes pass. Anything unrecognised
 * returns undefined so the caller renders nothing rather than something unsafe.
 * Local capture URIs (file://) are permitted because the app itself produces
 * them from the camera/picker.
 */

const IMG_SCHEME = /^(https?:|file:|data:image\/(?:png|jpe?g|gif|webp|heic|heif);)/i
const LINK_SCHEME = /^(https?:|mailto:|tel:)/i
const DANGEROUS = /^\s*(javascript|vbscript|data):/i

/**
 * Returns a safe image source string, or undefined when the value is missing
 * or uses a scheme that is not an allowed image source. Pass the result
 * straight into <Image source={{ uri: safeImageSrc(x) }} /> (undefined uri
 * simply renders no image).
 */
export function safeImageSrc(value: string | null | undefined): string | undefined {
  if (!value || typeof value !== 'string') return undefined
  const v = value.trim()
  // data: is allowed ONLY for image mime types (handled by IMG_SCHEME); any
  // other data: payload (e.g. data:text/html) is rejected here.
  if (DANGEROUS.test(v) && !/^data:image\//i.test(v)) return undefined
  return IMG_SCHEME.test(v) ? v : undefined
}

/**
 * Returns a safe href for links, or undefined for missing / hostile values.
 */
export function safeHref(value: string | null | undefined): string | undefined {
  if (!value || typeof value !== 'string') return undefined
  const v = value.trim()
  if (DANGEROUS.test(v)) return undefined
  return LINK_SCHEME.test(v) ? v : undefined
}
