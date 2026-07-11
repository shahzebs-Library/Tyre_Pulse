/**
 * BrandIcon — renders the app brand mark legibly on ANY surface.
 *
 * The bundled default mark (logo.svg) is tuned for the dark/green app chrome, so
 * it renders as-is. A tenant-assigned library logo, however, is usually a
 * navy/coloured mark on transparency that would disappear on a dark or
 * green-tinted badge — so when `custom` is set we frame it on a small white chip
 * so its true colours always read. Pure/presentational: the caller resolves the
 * source and whether it is a custom logo.
 *
 * Pass `chip={false}` to opt OUT of the white frame and render the logo
 * transparent so it blends with whatever background sits behind it (e.g. the
 * login screen, where the logo should match the page's own backdrop).
 *
 *   <BrandIcon src={appIcon} custom={!!customAppIcon} size={18} />
 *   <BrandIcon src={loginLogo} custom chip={false} size={30} />  // blends in
 */
export default function BrandIcon({ src, custom = false, chip = true, size = 18, className = '', imgClassName = '' }) {
  if (custom && chip) {
    const pad = Math.max(2, Math.round(size * 0.14))
    return (
      <span
        className={`inline-flex items-center justify-center rounded-md bg-white shadow-sm ${className}`}
        style={{ padding: pad }}
      >
        <img
          src={src}
          alt=""
          className={imgClassName}
          style={{ width: size, height: size, objectFit: 'contain', display: 'block' }}
        />
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      className={`object-contain ${className} ${imgClassName}`.trim()}
      style={{ width: size, height: size }}
    />
  )
}
