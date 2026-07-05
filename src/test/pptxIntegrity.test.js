/**
 * REAL PowerPoint integrity tests — no mocks. Builds the actual deck with
 * pptxgenjs, serialises it, and validates the ZIP + slide XML the way
 * PowerPoint would. Catches the "corrupt file" class of bug that mocked tests
 * can never see (invalid colors, NaN in chart XML, malformed parts).
 */
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildPptxDeck } from '../lib/exportUtils'

const FULL_DATA = {
  company: 'TyrePulse QA',
  period: 'Integrity Run',
  currency: 'SAR',
  totalTyres: 2383,
  totalVehicles: 162,
  totalCost: 2859598,
  highRisk: 41,
  openActions: 3,
  generatedBy: 'integrity-test',
  monthlyTrend: [
    { month: '2021-05', count: 120, cost: 144000 },
    { month: '2021-06', count: 180, cost: 216000 },
    { month: '2021-07', count: 90, cost: 108000 },
  ],
  riskBreakdown: [
    { level: 'Low', count: 2000 }, { level: 'Medium', count: 342 },
    { level: 'High', count: 30 }, { level: 'Critical', count: 11 },
  ],
  topSites: [
    { site: 'Riyadh', count: 900 }, { site: 'Jeddah', count: 700 }, { site: 'Dammam', count: 400 },
  ],
  categoryBreakdown: [
    { category: 'New', count: 1800 }, { category: 'Retread', count: 583 },
  ],
  topBrands: [
    { brand: 'Michelin', count: 700 }, { brand: 'Bridgestone', count: 650 },
  ],
  costBySite: [
    { site: 'Riyadh', cost: 1200000 }, { site: 'Jeddah', cost: 900000 },
  ],
  recentActions: [
    { title: 'Check steer axle wear', priority: 'High', site: 'Riyadh', status: 'Open' },
  ],
  branding: { primary_color: '#4F46E5', accent_color: '7C3AED' },
}

// The hostile version: every numeric hole the app has ever produced.
const DIRTY_DATA = {
  ...FULL_DATA,
  totalCost: NaN,
  totalVehicles: undefined,
  highRisk: Infinity,
  monthlyTrend: [
    { month: null, count: NaN, cost: undefined },
    { month: '2021-06', count: 'x', cost: -0 },
  ],
  riskBreakdown: [
    { level: 'Low', count: NaN }, { level: undefined, count: 5 },
  ],
  topSites: [{ site: '', count: null }],
  categoryBreakdown: [],
  topBrands: [{ brand: 'Michelin', count: Infinity }],
  costBySite: [{ site: 'Riyadh', cost: 'not-a-number' }],
  recentActions: [{ title: null, priority: 'weird', site: undefined, status: 42 }],
  branding: { primary_color: 'nonsense', accent_color: '#GGGGGG' },
}

async function deckToZip(data) {
  const pptx = await buildPptxDeck(data)
  const buf = await pptx.write('arraybuffer')
  // A valid pptx is a ZIP: magic bytes PK\x03\x04
  const head = new Uint8Array(buf.slice(0, 4))
  expect(head[0]).toBe(0x50) // P
  expect(head[1]).toBe(0x4b) // K
  return JSZip.loadAsync(buf)
}

async function validateDeck(zip) {
  // Mandatory OPC parts PowerPoint requires
  expect(zip.file('[Content_Types].xml')).toBeTruthy()
  expect(zip.file('ppt/presentation.xml')).toBeTruthy()
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
  expect(slides.length).toBeGreaterThanOrEqual(3)
  for (const s of slides) {
    const xml = await zip.file(s).async('string')
    // Well-formed-ish: opens and closes the slide element, no raw NaN/undefined
    expect(xml).toContain('<p:sld')
    expect(xml).toContain('</p:sld>')
    expect(xml).not.toMatch(/>NaN</)
    expect(xml).not.toMatch(/>undefined</)
    expect(xml).not.toMatch(/val="NaN"/)
  }
  // Charts (if any) must not embed NaN values
  const charts = Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f))
  for (const c of charts) {
    const xml = await zip.file(c).async('string')
    expect(xml).not.toMatch(/NaN|Infinity|undefined/)
  }
}

describe('PPTX real integrity (no mocks)', () => {
  it('produces a valid, PowerPoint-openable deck from full data', async () => {
    const zip = await deckToZip(FULL_DATA)
    await validateDeck(zip)
  }, 30000)

  it('survives hostile data (NaN/Infinity/undefined/bad colors) without corrupting', async () => {
    const zip = await deckToZip(DIRTY_DATA)
    await validateDeck(zip)
  }, 30000)
})
