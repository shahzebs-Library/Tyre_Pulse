#!/usr/bin/env node
/**
 * generate-icons.js
 * Generates all PWA icon sizes from an SVG source using sharp.
 * Outputs: public/icons/*.png, public/favicon.ico equivalent, apple touch icons, maskable variants.
 *
 * Usage: node scripts/generate-icons.js
 */
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ICONS_DIR = path.join(ROOT, 'public', 'icons')

// TyrePulse brand icon SVG — dark navy background, blue tyre wheel
const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0f172a"/>
  <!-- Tyre rubber: thick outer ring -->
  <circle cx="256" cy="256" r="220" fill="none" stroke="#1d4ed8" stroke-width="80"/>
  <!-- Rim border -->
  <circle cx="256" cy="256" r="174" fill="none" stroke="#3b82f6" stroke-width="6"/>
  <!-- Rim surface -->
  <circle cx="256" cy="256" r="168" fill="#1e3a5f"/>
  <!-- Spokes -->
  <g stroke="#60a5fa" stroke-linecap="round">
    <line x1="256" y1="100" x2="256" y2="412" stroke-width="20"/>
    <line x1="100" y1="256" x2="412" y2="256" stroke-width="20"/>
    <line x1="152" y1="152" x2="360" y2="360" stroke-width="14" opacity="0.85"/>
    <line x1="360" y1="152" x2="152" y2="360" stroke-width="14" opacity="0.85"/>
  </g>
  <!-- Hub -->
  <circle cx="256" cy="256" r="56" fill="#0f172a" stroke="#3b82f6" stroke-width="5"/>
  <circle cx="256" cy="256" r="36" fill="#2563eb"/>
  <circle cx="256" cy="256" r="16" fill="#1d4ed8"/>
  <!-- Outer tread lines -->
  <circle cx="256" cy="256" r="256" fill="none" stroke="#2563eb" stroke-width="3" opacity="0.4"/>
  <circle cx="256" cy="256" r="182" fill="none" stroke="#3b82f6" stroke-width="2" opacity="0.3"/>
</svg>`

// Maskable variant: same icon with extra 15% navy background padding (safe zone)
const MASKABLE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0f172a"/>
  <!-- Tyre rubber: thick outer ring — slightly smaller to honour safe zone -->
  <circle cx="256" cy="256" r="185" fill="none" stroke="#1d4ed8" stroke-width="68"/>
  <!-- Rim border -->
  <circle cx="256" cy="256" r="146" fill="none" stroke="#3b82f6" stroke-width="5"/>
  <!-- Rim surface -->
  <circle cx="256" cy="256" r="140" fill="#1e3a5f"/>
  <!-- Spokes -->
  <g stroke="#60a5fa" stroke-linecap="round">
    <line x1="256" y1="126" x2="256" y2="386" stroke-width="17"/>
    <line x1="126" y1="256" x2="386" y2="256" stroke-width="17"/>
    <line x1="172" y1="172" x2="340" y2="340" stroke-width="12" opacity="0.85"/>
    <line x1="340" y1="172" x2="172" y2="340" stroke-width="12" opacity="0.85"/>
  </g>
  <!-- Hub -->
  <circle cx="256" cy="256" r="48" fill="#0f172a" stroke="#3b82f6" stroke-width="4"/>
  <circle cx="256" cy="256" r="30" fill="#2563eb"/>
  <circle cx="256" cy="256" r="13" fill="#1d4ed8"/>
</svg>`

const STANDARD_SIZES = [72, 96, 128, 144, 152, 192, 384, 512]

async function generateAll() {
  fs.mkdirSync(ICONS_DIR, { recursive: true })
  const svgBuf     = Buffer.from(ICON_SVG)
  const maskBuf    = Buffer.from(MASKABLE_SVG)

  // Standard icons (any purpose)
  for (const size of STANDARD_SIZES) {
    await sharp(svgBuf)
      .resize(size, size)
      .png({ compressionLevel: 9, palette: false })
      .toFile(path.join(ICONS_DIR, `icon-${size}x${size}.png`))
    console.log(`  ✓ icon-${size}x${size}.png`)
  }

  // Maskable icons (192 + 512)
  for (const size of [192, 512]) {
    await sharp(maskBuf)
      .resize(size, size)
      .png({ compressionLevel: 9, palette: false })
      .toFile(path.join(ICONS_DIR, `icon-${size}x${size}-maskable.png`))
    console.log(`  ✓ icon-${size}x${size}-maskable.png`)
  }

  // Apple touch icon (180×180)
  await sharp(svgBuf)
    .resize(180, 180)
    .png({ compressionLevel: 9 })
    .toFile(path.join(ROOT, 'public', 'apple-touch-icon.png'))
  console.log('  ✓ apple-touch-icon.png')

  // Apple touch icon for older devices (152×152 in icons/)
  await sharp(svgBuf)
    .resize(152, 152)
    .png({ compressionLevel: 9 })
    .toFile(path.join(ICONS_DIR, 'apple-touch-icon-152x152.png'))
  console.log('  ✓ icons/apple-touch-icon-152x152.png')

  // SVG source for browsers that support it
  fs.writeFileSync(path.join(ROOT, 'public', 'favicon.svg'), ICON_SVG)
  console.log('  ✓ favicon.svg')

  console.log('\nAll icons generated successfully.')
}

generateAll().catch(err => { console.error(err); process.exit(1) })
