/**
 * Bulk export tasks that outlive the page that started them.
 *
 * A task is a module-level object, not React state, so moving to another page of the
 * app does not cancel it. The tray (components/pdf/PdfExportTray.jsx, mounted once in
 * the layout) shows progress and offers the finished ZIP. A full reload of the browser
 * tab does end a task: this is a background task in the page, NOT a server job.
 */
const tasks = new Map()
const listeners = new Set()
let seq = 0
let snapshot = []

function emit() {
  snapshot = [...tasks.values()]
  for (const fn of listeners) { try { fn() } catch { /* a listener must not break a task */ } }
}

export function subscribeExportTasks(fn) { listeners.add(fn); return () => listeners.delete(fn) }
export function getExportTasks() { return snapshot }

/**
 * @param {string} title  shown in the tray
 * @param {(ctx: {report: (patch: object) => void, isCancelled: () => boolean}) => Promise<{blob: Blob, fileName: string, included: number, missing: number}>} run
 */
export function startExportTask(title, run) {
  seq += 1
  const id = `export-${seq}`
  const task = { id, title, status: 'running', done: 0, total: 0, phase: 'reports', result: null, error: null, cancelled: false }
  tasks.set(id, task)
  const patch = (p) => { tasks.set(id, { ...tasks.get(id), ...p }); emit() }
  emit()
  Promise.resolve()
    .then(() => run({ report: patch, isCancelled: () => !!tasks.get(id)?.cancelled }))
    .then((result) => patch({ status: 'ready', result }))
    .catch((err) => patch({ status: 'failed', error: String(err?.message || 'The download could not be prepared.') }))
  return id
}

export function cancelExportTask(id) {
  const t = tasks.get(id)
  if (t && t.status === 'running') { tasks.set(id, { ...t, cancelled: true }); emit() }
}

export function dismissExportTask(id) { tasks.delete(id); emit() }
