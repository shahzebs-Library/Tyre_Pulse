// Every literal t('ns.path') key in the web app must resolve to a STRING in
// both the English and Arabic dictionaries. A missing key renders its raw
// path on screen (the login button once read "auth.login.signingIn").
// Also covers prefix helpers such as `const p = (k) => t(`auth.login.page.${k}`)`.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const LOCALES = path.join(ROOT, 'locales')

function loadLang(lang) {
  const dir = path.join(LOCALES, lang)
  const out = {}
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.json')) out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  }
  return out
}

function resolve(dict, key) {
  let cur = dict
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, part)) cur = cur[part]
    else return undefined
  }
  return cur
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === 'locales') continue
      walk(full, files)
    } else if (/\.(js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

const EN = loadLang('en')
const AR = loadLang('ar')
const LITERAL = /(?<![\w.])t\(\s*['"]([a-zA-Z][\w-]*(?:\.[\w-]+)+)['"]/g
const HELPER = /const\s+(\w+)\s*=\s*\(\s*(\w+)[^)]*\)\s*=>\s*t\(\s*`([\w.-]+)\.\$\{\2\}`/g

function collectKeys() {
  const keys = []
  for (const file of walk(ROOT)) {
    // Comments are prose (e.g. "t('ns.key', ...)" in a doc block), not calls.
    const src = fs.readFileSync(file, 'utf8').replace(/\r/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    const rel = path.relative(ROOT, file)
    // An unknown namespace (a typo such as 'commmon.x') must fail too.
    for (const m of src.matchAll(LITERAL)) keys.push({ rel, key: m[1] })
    for (const h of src.matchAll(HELPER)) {
      const call = new RegExp(`(?<![\\w.])${h[1]}\\(\\s*['"]([\\w.-]+)['"]`, 'g')
      for (const c of src.matchAll(call)) keys.push({ rel, key: `${h[3]}.${c[1]}` })
    }
  }
  return keys
}

describe('web i18n key coverage', () => {
  const keys = collectKeys()

  it('finds keys to check (the scan is not vacuous)', () => {
    expect(keys.length).toBeGreaterThan(500)
  })

  it('every key resolves to an English string', () => {
    const missing = keys.filter(({ key }) => typeof resolve(EN, key) !== 'string')
      .map(({ rel, key }) => `${rel}: ${key}`)
    expect(missing).toEqual([])
  })

  it('every key resolves to an Arabic string when the namespace has an Arabic file', () => {
    const missing = keys
      .filter(({ key }) => Object.prototype.hasOwnProperty.call(AR, key.split('.')[0]))
      .filter(({ key }) => typeof resolve(AR, key) !== 'string')
      .map(({ rel, key }) => `${rel}: ${key}`)
    expect(missing).toEqual([])
  })
})
