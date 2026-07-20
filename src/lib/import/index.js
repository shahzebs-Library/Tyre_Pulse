/**
 * Import Center engine - barrel.
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
  headerFingerprint,
  detectHeaderRow,
  sniffDelimiter,
  parseDelimitedText,
  stripFooterRows,
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

export { suggestMapping, scoreHeader, AUTO_THRESHOLD, SUGGEST_THRESHOLD } from './mapping'

export { detectModule, rankModules, DETECT_CONFIDENCE } from './detectModule'

export { transformRow, convertAmount } from './transform'

export { validateRow, classifyDuplicates, naturalKey, countryConflict, NATURAL_KEY } from './validate'

export {
  wrongModuleWarning,
  duplicateRatio,
  naturalKeyLabel,
  hasNaturalKey,
  singleKeyField,
  WRONG_MODULE_THRESHOLD,
  NATURAL_KEY_FIELDS,
} from './granularity'

export { buildAliasMap, applyAliases, applyAliasesToRow } from './aliases'

export { aggregateStagedRows } from './aggregate'

export { mergeCrossFileRows, COST_FIELDS } from './mergeCrossFile'

export {
  extractZip,
  matchAttachment,
  buildMatchRows,
  normaliseId,
  extOf,
  MATCH_FIELDS,
  ALLOWED_EXTENSIONS,
  MAX_FILE_BYTES,
  MAX_ENTRIES,
} from './attachments'
