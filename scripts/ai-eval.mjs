#!/usr/bin/env node
// Offline evaluation of AI answers (src/lib/aiEvaluation.js). No paid calls:
// it only reads exported JSON.
//
// 1) Build a versioned dataset from an ai_feedback export (expert-verified rows only):
//    node scripts/ai-eval.mjs build --feedback feedback.json --out dataset.json [--version v2] [--seed s]
// 2) Score two answer sets on one split (default holdout):
//    node scripts/ai-eval.mjs score --dataset dataset.json --current current.json --candidate candidate.json
//         [--split holdout|validation|train] [--seed s] [--min-delta 0.02] [--min-holdout 30] [--json]
//    answers file: { "prompt_version": "...", "answers": { "<item id>": { "answer": "...", "coverage": [...] } } }
//
// Exit: 0 eligible for human review (or build ok) | 1 not eligible | 3 usage/input error.
// Eligible never means promoted: a named approver signs off, the old prompt stays deployable.
import { readFileSync, writeFileSync } from 'node:fs'
import {
  buildEvalDataset, splitDataset, checkSplitLeakage, evaluateAnswers, comparePromotion,
  formatEvalReport, SPLITS,
} from '../src/lib/aiEvaluation.js'

const a = process.argv.slice(2)
const cmd = a[0]
const get = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : null }
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

try {
  if (cmd === 'build') {
    const fb = get('--feedback'), out = get('--out')
    if (!fb || !out) throw new Error('Usage: build --feedback <json> --out <json> [--version v] [--seed s]')
    const raw = readJson(fb)
    const rows = Array.isArray(raw) ? raw : raw.rows ?? raw.items ?? []
    const ds = buildEvalDataset(rows, { version: get('--version') || 'v1', generatedAt: new Date().toISOString() })
    const seed = get('--seed') || 'tyrepulse'
    const splits = splitDataset(ds, { seed })
    const leak = checkSplitLeakage(splits)
    if (leak.length) throw new Error(`Split leakage in ${leak.length} conversation(s)`)
    ds.seed = seed
    ds.split_counts = Object.fromEntries(SPLITS.map((s) => [s, splits[s].length]))
    writeFileSync(out, JSON.stringify(ds, null, 2))
    console.log(`Dataset ${ds.version} (${ds.fingerprint}): ${ds.count} items ` +
      `[train ${ds.split_counts.train}, validation ${ds.split_counts.validation}, holdout ${ds.split_counts.holdout}]. ` +
      `Skipped: ${ds.skipped.unverified} unverified, ${ds.skipped.noQuestion} without question, ${ds.skipped.duplicate} duplicate.`)
    process.exit(0)
  }

  if (cmd === 'score') {
    const dp = get('--dataset'), cp = get('--current'), kp = get('--candidate')
    if (!dp || !cp || !kp) throw new Error('Usage: score --dataset <json> --current <json> --candidate <json> [--split holdout]')
    const split = get('--split') || 'holdout'
    if (!SPLITS.includes(split)) throw new Error(`Unknown split ${split}`)
    const ds = readJson(dp)
    const splits = splitDataset(ds, { seed: get('--seed') || ds.seed || 'tyrepulse' })
    const items = splits[split]
    const cur = evaluateAnswers(items, readJson(cp).answers ?? {})
    const cand = evaluateAnswers(items, readJson(kp).answers ?? {})
    const opts = {}
    if (get('--min-delta')) opts.minDelta = Number(get('--min-delta'))
    if (get('--min-holdout')) opts.minHoldout = Number(get('--min-holdout'))
    const decision = comparePromotion(cur, cand, opts)
    console.log(a.includes('--json')
      ? JSON.stringify({ split, current: cur, candidate: cand, decision }, null, 2)
      : formatEvalReport({ split, current: cur, candidate: cand, decision }))
    process.exit(decision.eligible ? 0 : 1)
  }

  throw new Error('Usage: ai-eval.mjs build|score ... (see header)')
} catch (e) { console.error(e.message); process.exit(3) }
