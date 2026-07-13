import { describe, it, expect } from 'vitest'
import { validatePhotoFile } from '../lib/api/vehicle360.js'

// Client-side guard for vehicle photo uploads. Rejects wrong MIME types and
// oversized files before they reach storage, and derives the storage extension
// from the trusted MIME type (never the client-supplied filename) so a spoofed
// extension can't influence the upload path.
const MB = 1024 * 1024
const makeFile = (type, size = 1024, name = 'photo.jpg') => ({ type, size, name })

describe('validatePhotoFile — vehicle photo upload guard', () => {
  it('accepts a valid JPEG and returns the jpg extension', () => {
    expect(validatePhotoFile(makeFile('image/jpeg', 2 * MB))).toBe('jpg')
  })

  it('rejects a file larger than 20 MB', () => {
    expect(() => validatePhotoFile(makeFile('image/png', 20 * MB + 1))).toThrow(
      'Image must be 20 MB or smaller.',
    )
  })

  it('accepts a file exactly at the 20 MB limit', () => {
    expect(validatePhotoFile(makeFile('image/png', 20 * MB))).toBe('png')
  })

  it('rejects a disallowed MIME type', () => {
    expect(() => validatePhotoFile(makeFile('application/pdf', 1024))).toThrow(
      'Only JPEG, PNG, WebP, or HEIC images are allowed.',
    )
  })

  it('accepts HEIC and returns the heic extension', () => {
    expect(validatePhotoFile(makeFile('image/heic', MB))).toBe('heic')
  })

  it('derives the extension from the MIME type, ignoring a spoofed filename', () => {
    // Filename claims .php.jpg but the real content type is webp.
    expect(validatePhotoFile(makeFile('image/webp', MB, 'evil.php.jpg'))).toBe('webp')
  })

  it('rejects a missing file', () => {
    expect(() => validatePhotoFile(null)).toThrow('No image file was provided.')
  })
})
