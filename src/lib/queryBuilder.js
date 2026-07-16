/**
 * queryBuilder.js
 *
 * A safe, read-only filter model shared by the no-code DB browser and the
 * Ask-your-data feature. Pure (no I/O, no side effects). Every export is
 * defensive: bad input never throws, it degrades to a null/empty result.
 *
 * A "filter" is the shape { table, column, op, value }. Only a small,
 * fixed set of operators is permitted, so untrusted callers (the AI parser
 * in Ask-your-data) can never smuggle in an arbitrary predicate.
 */

/** The complete allow-list of supported operators. Order is display order. */
export const QUERY_OPERATORS = [
  { key: 'eq', label: 'equals' },
  { key: 'neq', label: 'not equal' },
  { key: 'gt', label: 'greater than' },
  { key: 'gte', label: 'at least' },
  { key: 'lt', label: 'less than' },
  { key: 'lte', label: 'at most' },
  { key: 'ilike', label: 'contains' },
];

const OPERATOR_KEYS = QUERY_OPERATORS.map((o) => o.key);
const OPERATOR_LABELS = QUERY_OPERATORS.reduce((acc, o) => {
  acc[o.key] = o.label;
  return acc;
}, {});

/**
 * Returns true when op is one of the supported operator keys.
 * @param {*} op
 * @returns {boolean}
 */
export function isValidOperator(op) {
  return typeof op === 'string' && OPERATOR_KEYS.includes(op);
}

/**
 * Human-friendly label for an operator key. Falls back to the raw op string
 * when the key is unknown (never throws).
 * @param {*} op
 * @returns {string}
 */
export function operatorLabel(op) {
  if (typeof op !== 'string') return '';
  return OPERATOR_LABELS[op] || op;
}

/** Internal: is a value a plain non-empty string after trimming. */
function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Coerce a value into a display/round-trip safe string.
 * - numbers stay numeric-looking (no locale formatting)
 * - booleans become 'true' / 'false'
 * - everything else is String()'d and trimmed
 * Pure and defensive: null/undefined/NaN collapse to ''.
 * @param {*} value
 * @param {string} [dataType] optional hint: 'number' | 'boolean' | 'text'
 * @returns {string}
 */
export function coerceValue(value, dataType) {
  if (value === null || value === undefined) return '';

  const hint = typeof dataType === 'string' ? dataType.toLowerCase() : '';

  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  const str = String(value).trim();

  if (hint === 'boolean') {
    if (/^(true|1|yes)$/i.test(str)) return 'true';
    if (/^(false|0|no)$/i.test(str)) return 'false';
    return str;
  }

  if (hint === 'number') {
    // Keep it numeric-looking when it parses, else return the trimmed string.
    if (str !== '' && Number.isFinite(Number(str))) return String(Number(str));
    return str;
  }

  return str;
}

/**
 * Clean and validate a raw filter object.
 * Rules:
 *  - table and column must be non-empty strings (trimmed)
 *  - op must be a supported operator key
 *  - value is coerced to a string; an empty value is allowed ONLY for 'ilike'
 *    (a "contains" with no needle is a harmless no-op), otherwise null.
 * Returns the cleaned filter { table, column, op, value } or null.
 * @param {{table?:*, column?:*, op?:*, value?:*}} f
 * @returns {{table:string, column:string, op:string, value:string}|null}
 */
export function normalizeFilter(f) {
  if (!f || typeof f !== 'object') return null;

  const { table, column, op } = f;

  if (!nonEmptyString(table)) return null;
  if (!nonEmptyString(column)) return null;
  if (!isValidOperator(op)) return null;

  const value = coerceValue(f.value);

  if (value === '' && op !== 'ilike') return null;

  return {
    table: table.trim(),
    column: column.trim(),
    op,
    value,
  };
}

/**
 * Produce a plain-English description of a filter.
 * "site contains NHC", "odometer at least 100000", or "Showing all rows"
 * when there is no valid filter. Never throws.
 * @param {*} f
 * @param {{columns?: Array<{key:string,label?:string}>|Object}} [opts]
 * @returns {string}
 */
export function describeFilter(f, { columns } = {}) {
  const clean = normalizeFilter(f);
  if (!clean) return 'Showing all rows';

  const label = columnLabel(clean.column, columns);
  const verb = operatorLabel(clean.op);
  const value = clean.value === '' ? '(any)' : clean.value;

  return `${label} ${verb} ${value}`;
}

/** Internal: resolve a friendly column label from a columns map/list. */
function columnLabel(column, columns) {
  if (!columns) return column;

  // Array form: [{ key, label }]
  if (Array.isArray(columns)) {
    const hit = columns.find((c) => c && c.key === column);
    if (hit && nonEmptyString(hit.label)) return hit.label.trim();
    return column;
  }

  // Object map form: { column: label }
  if (typeof columns === 'object') {
    const val = columns[column];
    if (nonEmptyString(val)) return val.trim();
  }

  return column;
}
