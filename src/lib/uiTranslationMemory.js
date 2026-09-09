/**
 * Compatibility localiser for legacy UI that still renders an English locale
 * value directly instead of calling t().  The paired locale catalog remains
 * the only source of translations; this module never sends page content to a
 * translation service and only changes text/accessible labels in the DOM.
 *
 * New code should continue to use t().  This bridge makes older and
 * role-specific screens switch atomically while they are migrated.
 */

import GENERATED_MEMORY from '../locales/legacy-ar-memory.json'

const ATTRS = ['placeholder', 'title', 'aria-label']
const originals = new WeakMap()

function buildMemory() {
  const exact = new Map()
  const templates = []
  for (const [source, target] of Object.entries(GENERATED_MEMORY)) {
    exact.set(source, target)
    exact.set(source.toLowerCase(), target)
    if (!source.includes('{')) continue
    const names = []
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\{(\w+)\\\}/g, (_, name) => {
        names.push(name)
        return '(.+?)'
      })
    templates.push({ regex: new RegExp(`^${escaped}$`, 'i'), names, target })
  }
  return { exact, templates }
}

const memory = buildMemory()

export function translateLegacyText(value) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed || !/[A-Za-z]/.test(trimmed)) return value
  let translated = memory.exact.get(trimmed) || memory.exact.get(trimmed.toLowerCase())
  if (!translated) {
    for (const item of memory.templates) {
      const match = trimmed.match(item.regex)
      if (!match) continue
      const vars = Object.fromEntries(item.names.map((name, i) => [name, match[i + 1]]))
      translated = item.target.replace(/\{(\w+)\}/g, (token, name) => vars[name] ?? token)
      break
    }
  }
  if (!translated) return value
  const leading = value.match(/^\s*/)?.[0] || ''
  const trailing = value.match(/\s*$/)?.[0] || ''
  return `${leading}${translated}${trailing}`
}

function localiseTextNode(node, enabled) {
  let saved = originals.get(node)
  if (!enabled) {
    // React may already have committed a new value. Only undo a value this
    // bridge still owns; restoring an older render would clobber t().
    if (saved && node.nodeValue === saved.last) node.nodeValue = saved.original
    originals.delete(node)
    return
  }
  if (!saved || node.nodeValue !== saved.last) {
    saved = { original: node.nodeValue, last: node.nodeValue }
  }
  const next = translateLegacyText(saved.original)
  if (next === saved.original) {
    originals.delete(node)
    return
  }
  saved.last = next
  originals.set(node, saved)
  if (node.nodeValue !== next) node.nodeValue = next
}

function localiseElement(element, enabled) {
  for (const attr of ATTRS) {
    if (!element.hasAttribute?.(attr)) continue
    let records = originals.get(element)
    if (!records) {
      records = {}
      originals.set(element, records)
    }
    const current = element.getAttribute(attr)
    let saved = records[attr]
    if (!enabled) {
      if (saved && current === saved.last) element.setAttribute(attr, saved.original)
      delete records[attr]
      continue
    }
    if (!saved || current !== saved.last) {
      saved = { original: current, last: current }
    }
    const next = translateLegacyText(saved.original)
    if (next === saved.original) {
      delete records[attr]
      continue
    }
    saved.last = next
    records[attr] = saved
    if (element.getAttribute(attr) !== next) element.setAttribute(attr, next)
  }
}

export function localiseLegacyDom(root, enabled) {
  if (!root) return
  if (root.nodeType === Node.TEXT_NODE) localiseTextNode(root, enabled)
  if (root.nodeType === Node.ELEMENT_NODE) localiseElement(root, enabled)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) localiseTextNode(node, enabled)
    else localiseElement(node, enabled)
    node = walker.nextNode()
  }
}

export function observeLegacyDom(root, enabled) {
  localiseLegacyDom(root, enabled)
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') localiseLegacyDom(record.target, enabled)
      for (const node of record.addedNodes) localiseLegacyDom(node, enabled)
      if (record.type === 'attributes') {
        localiseElement(record.target, enabled)
      }
    }
  })
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
  return () => observer.disconnect()
}

export const legacyTranslationCount = memory.exact.size
