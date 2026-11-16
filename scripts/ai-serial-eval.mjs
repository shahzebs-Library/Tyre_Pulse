#!/usr/bin/env node
// Evaluation harness for the DRAFT AI tyre serial reading (docs/features/AI_SERIAL_RECOGNITION.md).
//
//   node scripts/ai-serial-eval.mjs sample-sql
//        prints the READ-ONLY SQL that proposes a stratified sample of >= 60 completed photo jobs.
//   node scripts/ai-serial-eval.mjs run --truth truth.json --photos-dir ./photos --out predictions.json
//        [--dry-run] | [--confirm-paid --max-usd 0.20] [--model claude-haiku-5-5]
//        PAID: calls the Anthropic API once per photo with the v4 prompt + the serial section, exactly as
//        the worker would with the flag on. Refuses to run without --confirm-paid and ANTHROPIC_API_KEY,
//        and stops before the running cost would pass --max-usd (default 0.20). --dry-run costs nothing.
//        Photos are local files named <photo_id>.jpg|.jpeg|.png|.webp (exported by the owner).
//   node scripts/ai-serial-eval.mjs score --truth truth.json --predictions predictions.json
//        [--photos-per-month 1000] [--budget 20] [--json]       (offline, free)
//
// truth.json: [{ "photo_id": "...", "true_serial": "YMA55312" or "", "source_type": "label|moulded|none" }]
// Exit: 0 eligible / run ok | 1 not eligible | 3 usage or input error.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreSerialPredictions, serialGateVerdicts, formatSerialReport, SAMPLE_SQL } from '../src/lib/aiSerialEvaluation.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const a = process.argv.slice(2)
const cmd = a[0]
const get = (f, d = null) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : d }
const has = (f) => a.includes(f)
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

function basePrompt() {
  const index = readFileSync(path.join(ROOT, 'supabase/functions/ai-tyre-inspection/index.ts'), 'utf8')
  const m = index.match(/^const PROMPT = "(.*)";\s*$/m)
  if (!m) throw new Error('Could not read the v4 prompt from index.ts')
  return m[1]
}
const parseLoose = (text) => {
  const t = String(text || '').trim().replace(/^`{3}(?:json)?\s*/i, '').replace(/\s*`{3}$/, '')
  try { return JSON.parse(t) } catch { /* fall through */ }
  const s = t.indexOf('{'), e = t.lastIndexOf('}')
  return s >= 0 && e > s ? JSON.parse(t.slice(s, e + 1)) : null
}

async function run() {
  const truthPath = get('--truth'), dir = get('--photos-dir'), out = get('--out')
  if (!truthPath || !dir || !out) throw new Error('Usage: run --truth <json> --photos-dir <dir> --out <json> [--dry-run | --confirm-paid --max-usd 0.20]')
  const truth = readJson(truthPath)
  const serial = await import('../supabase/functions/ai-tyre-inspection/serial.ts')
  const prompt = serial.promptFor(basePrompt(), true)
  const files = truth.map((t) => {
    const f = ['.jpg', '.jpeg', '.png', '.webp'].map((x) => path.join(dir, t.photo_id + x)).find(existsSync)
    return { photo_id: t.photo_id, file: f || null }
  })
  const missing = files.filter((f) => !f.file).length
  const est = 0.0015
  console.log(`${files.length} photos (${missing} file(s) missing), prompt ${serial.SERIAL_PROMPT_VERSION}, est. $${(est * (files.length - missing)).toFixed(4)} max`)
  if (has('--dry-run')) return 0
  const key = process.env.ANTHROPIC_API_KEY
  if (!has('--confirm-paid') || !key) throw new Error('Paid run refused: pass --confirm-paid and set ANTHROPIC_API_KEY (or use --dry-run)')
  const maxUsd = Math.min(Number(get('--max-usd', '0.20')), 5)
  const model = get('--model', 'claude-haiku-5-5')
  const rates = { input: Number(process.env.AI_INPUT_USD_PER_MILLION ?? 0.1), output: Number(process.env.AI_OUTPUT_USD_PER_MILLION ?? 0.5) }
  const results = []
  let spent = 0
  for (const f of files) {
    if (!f.file) { results.push({ photo_id: f.photo_id, error: 'photo file missing' }); continue }
    if (spent + est > maxUsd) { console.log(`Stopping: next call could pass the $${maxUsd} cap`); break }
    const bytes = readFileSync(f.file)
    const ext = path.extname(f.file).slice(1).replace('jpg', 'jpeg')
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1800, messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image', source: { type: 'base64', media_type: 'image/' + ext, data: bytes.toString('base64') } }] }] }),
    })
    const body = res.ok ? await res.json() : null
    const usage = body?.usage ? { input_tokens: body.usage.input_tokens, output_tokens: body.usage.output_tokens } : null
    spent += usage ? (usage.input_tokens * rates.input + usage.output_tokens * rates.output) / 1e6 : est
    const text = body?.content?.filter((p) => p.type === 'text').map((p) => p.text).join('') ?? ''
    const reading = serial.extractSerialFromOutput(text, parseLoose)
    results.push({ photo_id: f.photo_id, reading, usage, http_status: res.status })
    console.log(`${f.photo_id}: ${reading.status} ${reading.normalized ?? ''} ($${spent.toFixed(4)} so far)`)
  }
  writeFileSync(out, JSON.stringify({ prompt_version: serial.SERIAL_PROMPT_VERSION, model, spent_usd: spent, results }, null, 2))
  console.log(`Wrote ${out}. Spent about $${spent.toFixed(4)}.`)
  return 0
}

function score() {
  const tp = get('--truth'), pp = get('--predictions')
  if (!tp || !pp) throw new Error('Usage: score --truth <json> --predictions <json>')
  const truth = readJson(tp)
  const p = readJson(pp)
  const preds = Array.isArray(p) ? p : p.results ?? []
  const s = scoreSerialPredictions(truth, preds, {
    photosPerMonth: Number(get('--photos-per-month', '1000')), monthlyBudgetUsd: Number(get('--budget', '20')) })
  const v = serialGateVerdicts(s)
  console.log(has('--json') ? JSON.stringify({ score: s, verdicts: v }, null, 2) : formatSerialReport(s, v))
  return v.eligible ? 0 : 1
}

try {
  if (cmd === 'sample-sql') { console.log(SAMPLE_SQL); process.exit(0) }
  if (cmd === 'run') process.exit(await run())
  if (cmd === 'score') process.exit(score())
  throw new Error('Commands: sample-sql | run | score')
} catch (e) {
  console.error(e.message)
  process.exit(3)
}
