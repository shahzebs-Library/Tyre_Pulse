import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * A native-driver Animated loop must own its node and must stop on unmount.
 *
 * WHY THIS EXISTS. A production FATAL on Android:
 *
 *   JSApplicationIllegalArgumentException: startAnimatingNode:
 *   Animated node [932] does not exist
 *     at com.facebook.react.animated.NativeAnimatedNodesManager.startAnimatingNode
 *
 * The cause was SyncBanner, the banner mounted app-wide. It did two things wrong and
 * needed both to crash:
 *
 *   1. `const pulse = new Animated.Value(1)` in the RENDER BODY. That allocates a new
 *      native animated node on every render, so a loop started on an earlier render is
 *      driving a node React has already dropped.
 *   2. `Animated.loop(...).start()` with the handle thrown away and no cleanup. The effect
 *      depended on `pending`, which changes on every sync, so each change started ANOTHER
 *      loop - and the component returns null once the queue drains, unmounting the
 *      Animated.View and dropping its node while those loops were still running.
 *
 * Neither is visible to tsc or to a render test: both files compile and render fine. Only
 * the relationship between the value's lifetime and the loop's lifetime is wrong, which is
 * why this is a source scan. SkeletonLoader and TypingDots were already correct and are
 * the reference shape.
 */

const ROOT = join(__dirname, '..')
const SKIP = new Set(['node_modules', '.expo', 'android', 'ios', 'dist', '.git', '__tests__'])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    let isDir = false
    try { isDir = statSync(full).isDirectory() } catch { continue }
    if (isDir) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const FILES = walk(ROOT).map(f => ({ path: f.slice(ROOT.length + 1), src: readFileSync(f, 'utf8') }))

describe('Animated lifecycle', () => {
  it('finds the files it is meant to police', () => {
    // A scan that silently matches nothing is worse than no scan at all.
    expect(FILES.length).toBeGreaterThan(20)
    expect(FILES.some(f => f.src.includes('Animated.loop('))).toBe(true)
  })

  it('every Animated.Value is owned by a useRef, never created during render', () => {
    const offenders: string[] = []
    for (const { path, src } of FILES) {
      src.split('\n').forEach((line, i) => {
        const code = line.trim()
        // Skip comments - this file's own explanation names the bad form on purpose.
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return
        if (!code.includes('new Animated.Value')) return
        if (code.includes('useRef(')) return // the only safe form
        offenders.push(`${path}:${i + 1} ${code}`)
      })
    }
    expect(offenders.join('\n')).toBe('')
  })

  it('every Animated.loop is captured so it can be stopped, and its file stops one', () => {
    const offenders: string[] = []
    for (const { path, src } of FILES) {
      if (!src.includes('Animated.loop(')) continue
      // `Animated.loop(...).start()` throws the handle away. Match the loop's OWN closing
      // paren by counting depth - a lazy regex spans into unrelated code and produced a
      // false positive against TypingDots, which is correct.
      let idx = src.indexOf('Animated.loop(')
      while (idx !== -1) {
        let depth = 0
        let end = -1
        for (let i = src.indexOf('(', idx); i < src.length; i++) {
          if (src[i] === '(') depth++
          else if (src[i] === ')') { depth--; if (depth === 0) { end = i; break } }
        }
        if (end !== -1 && /^\s*\.start\s*\(/.test(src.slice(end + 1))) {
          offenders.push(`${path}: Animated.loop(...).start() discards the handle, so it can never be stopped`)
        }
        idx = src.indexOf('Animated.loop(', idx + 1)
      }
      if (!src.includes('.stop()')) {
        offenders.push(`${path}: starts an Animated.loop but never calls .stop()`)
      }
    }
    expect(offenders.join('\n')).toBe('')
  })
})
