#!/usr/bin/env node
// Accuracy proof against an expert-labelled dataset (src/lib/aiTyreAccuracy.js).
//   node scripts/ai-accuracy.mjs --labelled labels.csv|json --predictions preds.json [--thresholds t.json] [--json]
// predictions file: array, or { results: [...] }. Exit: 0 pass | 1 fail | 2 insufficient | 3 usage.
import { readFileSync } from 'node:fs'
import { buildAccuracyReport, evaluateAccuracyGate, formatAccuracyReport } from '../src/lib/aiTyreAccuracy.js'

const a = process.argv.slice(2)
const get = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : null }
try {
  const lf = get('--labelled'), pf = get('--predictions')
  if (!lf || !pf) throw new Error('Usage: --labelled <csv|json> --predictions <json> [--thresholds <json>] [--json]')
  const raw = readFileSync(lf, 'utf8')
  const labelled = lf.toLowerCase().endsWith('.csv') ? raw : JSON.parse(raw)
  const p = JSON.parse(readFileSync(pf, 'utf8'))
  const th = get('--thresholds') ? JSON.parse(readFileSync(get('--thresholds'), 'utf8')) : {}
  const report = buildAccuracyReport({ labelled: Array.isArray(labelled) ? labelled : labelled.cases ?? labelled, predictions: Array.isArray(p) ? p : p.results }, th)
  const gate = evaluateAccuracyGate(report, th)
  console.log(a.includes('--json') ? JSON.stringify({ gate, report }, null, 2) : formatAccuracyReport(report, gate))
  process.exit(gate.status === 'pass' ? 0 : gate.status === 'fail' ? 1 : 2)
} catch (e) { console.error(e.message); process.exit(3) }
