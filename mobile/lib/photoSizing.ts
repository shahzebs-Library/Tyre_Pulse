/**
 * photoSizing - pure sizing rules for photos prepared on the phone.
 *
 * No native imports so it is unit-testable in plain Node (see
 * __tests__/photoSizing.test.ts). photoUpload.ts applies the result.
 *
 * Tyre-inspection photos feed ai_tyre_inspection_jobs (photo_ref comes from
 * tyre_conditions[pos].photo_url). A long edge of ~1280px at JPEG q0.6 keeps
 * tread grooves, sidewall DOT/size text and cuts legible while cutting the
 * bytes the vision model has to ingest (~35-45% smaller than 1600px/q0.5
 * measured by pixel count: 1280^2 / 1600^2 = 0.64, and fewer image tokens).
 */

export type PhotoProfile = 'tyre' | 'general'

export interface ResizeRung {
  /** Longest edge in px after resize (aspect preserved). */
  maxLongEdge: number
  /** JPEG quality 0..1. */
  compress: number
}

/** Ladder tried in order; later rungs only run if an earlier one fails (memory pressure). */
export const LADDERS: Record<PhotoProfile, ResizeRung[]> = {
  tyre: [
    { maxLongEdge: 1280, compress: 0.6 },
    { maxLongEdge: 1024, compress: 0.55 },
    { maxLongEdge: 720, compress: 0.45 },
  ],
  general: [
    { maxLongEdge: 1600, compress: 0.5 },
    { maxLongEdge: 1024, compress: 0.45 },
    { maxLongEdge: 720, compress: 0.4 },
  ],
}

/**
 * Decide which single dimension to pass to the resizer so the LONG edge ends
 * at maxLongEdge. Never upscales: returns null when already within bounds.
 * Without known dimensions it falls back to a width target (previous behaviour).
 */
export function resizeTarget(
  srcWidth: number | null | undefined,
  srcHeight: number | null | undefined,
  maxLongEdge: number,
): { width: number } | { height: number } | null {
  const w = Number(srcWidth)
  const h = Number(srcHeight)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: maxLongEdge }
  }
  if (Math.max(w, h) <= maxLongEdge) return null
  return w >= h ? { width: maxLongEdge } : { height: maxLongEdge }
}

/** Output dimensions for a given source and target (for tests / size estimates). */
export function resizedDimensions(
  srcWidth: number,
  srcHeight: number,
  maxLongEdge: number,
): { width: number; height: number } {
  const long = Math.max(srcWidth, srcHeight)
  if (long <= maxLongEdge) return { width: srcWidth, height: srcHeight }
  const s = maxLongEdge / long
  return { width: Math.round(srcWidth * s), height: Math.round(srcHeight * s) }
}
