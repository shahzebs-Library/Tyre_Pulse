#!/usr/bin/env node
// Runs the AI tyre adjudication harness (src/lib/aiTyreAdjudication.js) on JSON files and gates on thresholds.
//
//   node scripts/ai-adjudicate.mjs                       # golden.v1 + candidate.current + baseline.json
//   node scripts/ai-adjudicate.mjs --candidate run.json  # a new model/prompt/engine run
//   node scripts/ai-adjudicate.mjs --write-baseline src/test/fixtures/ai-adjudication/baseline.json
//
// Options: --golden <file> --candidate <file> --baseline <file|none> --thresholds <file> --json
//          --write-baseline <file>   (writes the summary of THIS run; never fails the run)
// Exit codes: 0 pass | 1 gate failed (regression) | 2 insufficient data | 3 usage / unreadable input
// Deterministic: no network, no clock, no randomness.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildReport, evaluateGate, formatReport, summarizeForBaseline,
} from '../src/lib/aiTyreAdjudication.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIX = path.join(here, '..', 'src', 'test', 'fixtures', 'ai-adjudication')

function parseArgs(argv) {
  const opts = { json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') opts.json = true
    else if (['--golden', '--candidate', '--baseline', '--thresholds', '--write-baseline'].includes(a)) {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`)
      opts[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v
    } else throw new Error(`Unknown argument ${a}`)
  }
  return opts
}

const readJson = (file, label) => {
  try { return JSON.parse(readFileSync(file, 'utf8')) }
  catch (e) { throw new Error(`Cannot read ${label} (${file}): ${e.message}`) }
}

let opts
try { opts = parseArgs(process.argv.slice(2)) } catch (e) { console.error(e.message); process.exit(3) }

try {
  const goldenFile = opts.golden || path.join(FIX, 'golden.v1.json')
  const candidateFile = opts.candidate || path.join(FIX, 'candidate.current.json')
  const golden = readJson(goldenFile, 'golden set')
  const candidate = readJson(candidateFile, 'candidate run')
  const thresholds = opts.thresholds ? readJson(opts.thresholds, 'thresholds') : {}
  const baselineFile = opts.baseline === 'none' ? null : (opts.baseline || path.join(FIX, 'baseline.json'))
  const baseline = baselineFile && existsSync(baselineFile) ? readJson(baselineFile, 'baseline') : null

  const report = buildReport({ golden: golden.cases, results: candidate.results, reviews: candidate.reviews }, thresholds)
  const gate = evaluateGate(report, thresholds, baseline)

  if (opts.writeBaseline) {
    writeFileSync(opts.writeBaseline, JSON.stringify(summarizeForBaseline(report), null, 2) + '\n')
    console.log(`Baseline written to ${opts.writeBaseline}`)
  }
  if (opts.json) console.log(JSON.stringify({ gate, report }, null, 2))
  else {
    console.log(`Golden: ${path.basename(goldenFile)} | Candidate: ${candidate.label || path.basename(candidateFile)} | Baseline: ${baseline ? path.basename(baselineFile) : 'none'}`)
    console.log(formatReport(report, gate))
  }
  process.exit(gate.status === 'pass' ? 0 : gate.status === 'fail' ? 1 : 2)
} catch (e) {
  console.error(e.message)
  process.exit(3)
}
