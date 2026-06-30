/**
 * Import Center engine — barrel.
 *
 * The client-side parse → map → transform → validate pipeline that stages rows
 * into the import_* tables (V45) and commits them via the import_commit_batch
 * RPC (V46). Pages import from here:
 *   import { parseWorkbook, suggestMapping, transformRow, validateRow } from '../lib/import'
 */
export {
  parseWorkbook,
  sha256OfArrayBuffer,
  rowFingerprint,
  detectHeaderRow,
  sniffDelimiter,
  parseDelimitedText,
} from './parseWorkbook'

export {
  MODULES,
  MODULE_TABLES,
  MODULE_FIELDS,
  exactAlias,
  fieldDef,
  synonymsFor,
  normaliseToken,
} from './synonyms'

export { suggestMapping, AUTO_THRESHOLD, SUGGEST_THRESHOLD } from './mapping'

export { transformRow } from './transform'

export { validateRow, classifyDuplicates, NATURAL_KEY } from './validate'
