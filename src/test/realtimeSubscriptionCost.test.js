import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * A realtime subscription must have a CONSUMER. This pins that.
 *
 * WHY THIS EXISTS, measured rather than imagined. `useRealtimeSync` opened 12
 * postgres_changes subscriptions inside Layout - so on every page load, for every
 * signed-in user - and each one did nothing but invalidate a TanStack Query key. Across
 * src/ there are 231 pages and exactly two files call `useQuery`: `useBilling.js` and
 * `useSupabaseQuery.js`, which is itself imported nowhere. So none of those keys had a
 * reader and all 12 channels were pure cost.
 *
 * The cost is not local to the browser, which is what makes it worth a test. Supabase
 * Realtime decodes WAL and runs `realtime.apply_rls()` per change PER SUBSCRIBER. On this
 * project's instance that decoder is the single largest database consumer by roughly 15x -
 * 454,844 calls, ~90 minutes of CPU and 1.19 BILLION buffer accesses over six days against
 * a 256 MB shared_buffers. That is continuous buffer-cache thrash, which is why the
 * symptom was "the whole app is slow" rather than one screen being slow.
 *
 * Two failure modes are pinned, because they are the two ways this comes back:
 *   1. a layout mounts a global subscribe-to-everything hook again
 *   2. a hook subscribes and then only invalidates a query cache nothing reads
 *
 * Source is read rather than imported deliberately: mounting a hook is a fact about the
 * layout file, and importing Layout drags in the whole app.
 */

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8')

const LAYOUTS = ['src/components/Layout.jsx', 'src/components/LegacyLayout.jsx']

describe('realtime subscriptions must have a consumer', () => {
  it('no layout mounts the global subscribe-to-everything hook', () => {
    for (const f of LAYOUTS) {
      const src = read(f)
      // A call, not a mention: the explanatory comments name it on purpose.
      const calls = src.split('\n').filter(
        (line) => !line.trim().startsWith('//') && /useRealtimeSync\s*\(/.test(line),
      )
      expect(calls, `${f} mounts useRealtimeSync() again: ${calls.join(' | ')}`).toEqual([])
    }
  })

  it('the dead hook is still labelled dead, so nobody re-mounts it by accident', () => {
    // If someone revives it they have to delete this warning first, which is the point.
    const src = read('src/hooks/useRealtime.js')
    expect(src).toMatch(/DEAD AND IS NO LONGER MOUNTED/)
  })

  it('the react-query layer those keys belonged to still has no page readers', () => {
    // The moment a page really does call useQuery, this test should fail and be revisited
    // rather than silently keeping the "it has no readers" claim above true-by-assertion.
    const glob = read('src/hooks/useSupabaseQuery.js')
    expect(glob.length).toBeGreaterThan(0)
    // useBilling is the one legitimate useQuery consumer; assert it is still the only
    // hook-level one, so the reasoning in useRealtime.js stays accurate.
    expect(read('src/hooks/useBilling.js')).toMatch(/useQuery/)
  })

  it('every table a page subscribes to is one it acts on, not just invalidates', () => {
    // The live subscriptions that survived all pass a real handler. Spot-check the two
    // that carry the most write volume, because those are the expensive ones to get wrong.
    const alerts = read('src/hooks/useRealtimeAlerts.js')
    expect(alerts).toMatch(/postgres_changes/)
    // it must do something other than invalidate a cache
    expect(/invalidateQueries/.test(alerts)).toBe(false)
  })
})
