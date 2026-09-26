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
