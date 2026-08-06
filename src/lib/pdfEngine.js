/**
 * One place that resolves a CALLABLE autoTable for jsPDF.
 *
 * WHY THIS EXISTS. `jspdf-autotable@3.8.4` declares `peerDependencies:
 * { jspdf: "^2.5.1" }`, but this app runs `jspdf@4.2.1` - two majors apart.
 * Under that pairing the package's ESM `default` export resolves to an OBJECT,
 * so the documented call
 *
 *     autoTable(doc, { head, body })      // as every caller here writes it
 *
 * throws `TypeError: autoTable is not a function`. That broke EVERY PDF export
 * that draws a table - inspections, job cards, and ~29 other surfaces - while
 * the build stayed clean and the tests stayed green, because nothing exercises
 * the real library end to end.
 *
 * The plugin itself is fine: importing it still patches
 * `jsPDF.prototype.autoTable`, and calling THAT produces a valid PDF (verified
 * against the installed versions). So this loader prefers a genuine function
 * default when one exists (any future/compatible release) and otherwise calls
 * through the prototype method. Callers keep the `autoTable(doc, options)`
 * signature unchanged.
 *
 * There is no autotable release that supports jsPDF 4 (5.x still declares
 * `^2 || ^3`), so pinning a different version is not an available fix today.
 */

let cached = null

/**
 * @returns {Promise<(doc: any, options: object) => any>} callable autoTable
 */
export async function loadAutoTable() {
  if (cached) return cached
  const mod = await import('jspdf-autotable')
  const fn = mod?.default ?? mod?.autoTable

  if (typeof fn === 'function') {
    cached = fn
    return cached
  }

  // Fallback: the plugin patched jsPDF.prototype.autoTable on import.
  cached = (doc, options) => {
    if (!doc || typeof doc.autoTable !== 'function') {
      throw new Error('The PDF table engine could not be loaded.')
    }
    return doc.autoTable(options)
  }
  return cached
}

/**
 * Load jsPDF and a callable autoTable together.
 * The constructor is whichever binding is actually callable: bundlers hand back
 * `default`, while a plain Node ESM resolve exposes the named `jsPDF` - picking
 * blindly yields "jsPDF is not a constructor" in one of the two.
 */
export async function loadPdf() {
  const [j, autoTable] = await Promise.all([import('jspdf'), loadAutoTable()])
  const jsPDF = typeof j.default === 'function' ? j.default : j.jsPDF
  return { jsPDF, autoTable }
}
