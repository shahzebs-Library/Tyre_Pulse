/**
 * Brand-free tread illustration for a tyre (see src/lib/tyreImage.js).
 * `thumb` shows the picture only; `hero` adds the tread class and why it was
 * chosen, so an illustration is never mistaken for a photo of this tyre.
 */
import { useMemo } from 'react'
import { resolveTyreImage, tyreImageCaption } from '../../lib/tyreImage'

export default function TyreTreadImage({ size, position, catalogue, variant = 'thumb', width, className = '' }) {
  const img = useMemo(() => resolveTyreImage({ size, position, catalogue }), [size, position, catalogue])
  const caption = tyreImageCaption(img)
  const w = width || (variant === 'hero' ? 220 : 46)
  const pic = (
    <img
      src={img.src}
      width={w}
      height={Math.round(w * (200 / 260))}
      alt={`${img.label} tyre illustration`}
      title={caption}
      loading="lazy"
      decoding="async"
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
    />
  )
  if (variant !== 'hero') return <span className={`tyre-img-thumb ${className}`}>{pic}</span>
  return (
    <figure className={`tyre-img-hero ${className}`} style={{ margin: 0 }}>
      {pic}
      <figcaption style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--cc-ink-3, var(--text-muted))', marginTop: 6, maxWidth: w }}>
        {caption}
      </figcaption>
    </figure>
  )
}
