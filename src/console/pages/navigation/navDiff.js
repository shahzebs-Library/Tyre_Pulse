/**
 * Differences between the built-in sidebar and an edited navigation model,
 * as plain-English rows for the Navigation Customizer's Changes tab.
 *
 * Both inputs are buildNavEditorModel shapes:
 *   [{ key, label, defaultLabel, hidden, items: [{ key, label, hidden }] }]
 * Group order is compared by position among the groups; item order only
 * within the same group (a moved item is reported as moved, not reordered).
 */
export function navChanges(defaults = [], model = []) {
  const out = []
  const defGroupIndex = new Map(defaults.map((g, i) => [g.key, i]))
  const defItem = new Map()
  for (const g of defaults) g.items.forEach((it, i) => defItem.set(it.key, { group: g.key, index: i, groupLabel: g.label }))

  model.forEach((g, gi) => {
    if (g.label !== g.defaultLabel) out.push({ kind: 'Renamed', tone: 'accent', target: g.defaultLabel, detail: `Group now called "${g.label}"` })
    if (g.hidden) out.push({ kind: 'Hidden', tone: 'quiet', target: g.label, detail: 'Whole group hidden from the sidebar' })
    const di = defGroupIndex.get(g.key)
    if (di != null && di !== gi) out.push({ kind: 'Reordered', tone: 'default', target: g.label, detail: `Group moved from position ${di + 1} to ${gi + 1}` })

    g.items.forEach((it, ii) => {
      const d = defItem.get(it.key)
      if (it.hidden) out.push({ kind: 'Hidden', tone: 'quiet', target: it.label, detail: `Item hidden in ${g.label}` })
      if (!d) return
      if (d.group !== g.key) {
        out.push({ kind: 'Moved', tone: 'info', target: it.label, detail: `From ${d.groupLabel} to ${g.label}` })
      } else if (d.index !== ii) {
        out.push({ kind: 'Reordered', tone: 'default', target: it.label, detail: `Position ${d.index + 1} to ${ii + 1} in ${g.label}` })
      }
    })
  })
  return out
}

/**
 * Move an item to a new place (drag and drop). `from` and `to` are
 * { g: groupIndex, i: itemIndex }; `to.i` may equal the target group's length
 * to append. Returns a new model; the input is never mutated. Invalid
 * positions return the model unchanged.
 */
export function moveItemTo(model = [], from, to) {
  if (!from || !to || !model[from.g] || !model[to.g]) return model
  const src = model[from.g].items
  if (from.i < 0 || from.i >= src.length) return model
  const next = model.map((g) => ({ ...g, items: g.items.slice() }))
  const [item] = next[from.g].items.splice(from.i, 1)
  let at = from.g === to.g && from.i < to.i ? to.i - 1 : to.i
  at = Math.max(0, Math.min(at, next[to.g].items.length))
  next[to.g].items.splice(at, 0, item)
  return next
}

/** Move a whole group from one index to another. Returns a new model. */
export function moveGroupTo(model = [], from, to) {
  if (from === to || from < 0 || to < 0 || from >= model.length || to >= model.length) return model
  const next = model.slice()
  const [g] = next.splice(from, 1)
  next.splice(to, 0, g)
  return next
}

/**
 * One line describing a stored nav_layout value (from the change history):
 * how many groups and items it arranges and how many it hides. A blank or
 * unreadable value is the built-in sidebar.
 */
export function describeLayout(raw) {
  if (raw == null || raw === '') return 'Built-in sidebar'
  let v
  try { v = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return 'Unreadable layout' }
  const groups = Array.isArray(v?.groups) ? v.groups : []
  const items = Array.isArray(v?.items) ? v.items : []
  if (!groups.length && !items.length) return 'Built-in sidebar'
  const hidden = items.filter((i) => i && i.hidden).length + groups.filter((g) => g && g.hidden).length
  const renamed = groups.filter((g) => g && typeof g.label === 'string' && g.label).length
  return `${groups.length} groups, ${items.length} items arranged, ${hidden} hidden, ${renamed} renamed`
}
