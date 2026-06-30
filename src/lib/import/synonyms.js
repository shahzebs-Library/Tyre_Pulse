/**
 * Import Center — canonical field dictionaries + Arabic/English synonym lists.
 *
 * Each MODULE (fleet, tyre, stock) maps to a real destination table and a fixed
 * set of canonical target columns. Synonyms are scoped per module so a tyre-only
 * alias (e.g. "serial no" -> serial_no) can never leak into the stock module.
 *
 * Targets MUST be real columns on the destination table:
 *   fleet -> vehicle_fleet
 *   tyre  -> tyre_records
 *   stock -> stock_records
 *
 * Design notes:
 *   - Synonyms cover English + Arabic + common ERP/Excel variants and
 *     transliterations seen in Gulf fleet exports.
 *   - Each canonical field declares { required, type } so downstream
 *     transform/validate can coerce + check without re-deriving intent.
 *
 * @module import/synonyms
 */

/**
 * @typedef {'string'|'number'|'integer'|'date'|'currency'|'pressure'|'distance'|'mass'} FieldType
 */

/**
 * @typedef {Object} CanonicalField
 * @property {string} key            Canonical target column name.
 * @property {string} label          Human-readable label.
 * @property {boolean} required      Whether the field is mandatory for a "ready" row.
 * @property {FieldType} type        Logical type used by transform/validate.
 * @property {string[]} synonyms     English + Arabic aliases (raw, un-normalised).
 */

/**
 * Normalise a header/synonym for comparison: lowercase, strip punctuation,
 * collapse whitespace. Arabic characters are preserved (no transliteration).
 * Mirrors the proven normaliser from the legacy uploader.
 *
 * @param {*} s
 * @returns {string}
 */
export function normaliseToken(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[.\-_/\\()[\]{}'"*@#%&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Supported import modules. */
export const MODULES = ['fleet', 'tyre', 'stock']

/**
 * Destination table per module.
 * @type {Record<string,string>}
 */
export const MODULE_TABLES = {
  fleet: 'vehicle_fleet',
  tyre: 'tyre_records',
  stock: 'stock_records',
}

/* ── Fleet (vehicle_fleet) ──────────────────────────────────────────────────── */

/** @type {CanonicalField[]} */
const FLEET_FIELDS = [
  { key: 'asset_no', label: 'Asset No.', required: true, type: 'string',
    synonyms: ['asset', 'asset no', 'asset number', 'asset code', 'equipment', 'equipment no', 'unit', 'unit no', 'vehicle', 'vehicle no', 'vehicle number', 'veh no', 'ub no', 'chassis', 'plate', 'plate no',
      'رقم المعدة', 'رقم المركبة', 'رقم الأصل', 'الأصل', 'رقم السيارة'] },
  { key: 'fleet_number', label: 'Fleet Number', required: false, type: 'string',
    synonyms: ['fleet', 'fleet no', 'fleet number', 'fleet code', 'fleet id', 'رقم الأسطول'] },
  { key: 'make', label: 'Make', required: false, type: 'string',
    synonyms: ['make', 'manufacturer', 'oem', 'brand', 'الصانع', 'الماركة'] },
  { key: 'model', label: 'Model', required: false, type: 'string',
    synonyms: ['model', 'variant', 'الموديل', 'الطراز'] },
  { key: 'vehicle_type', label: 'Vehicle Type', required: false, type: 'string',
    synonyms: ['vehicle type', 'veh type', 'type', 'category', 'asset type', 'equipment type', 'fleet type', 'class', 'نوع المركبة', 'نوع المعدة', 'الفئة'] },
  { key: 'year', label: 'Year', required: false, type: 'integer',
    synonyms: ['year', 'model year', 'yr', 'manufacture year', 'سنة الصنع', 'السنة'] },
  { key: 'department', label: 'Department', required: false, type: 'string',
    synonyms: ['department', 'dept', 'division', 'cost center', 'cost centre', 'القسم', 'الإدارة'] },
  { key: 'operator_name', label: 'Operator', required: false, type: 'string',
    synonyms: ['operator', 'operator name', 'driver', 'driver name', 'assigned to', 'اسم المشغل', 'السائق', 'المشغل'] },
  { key: 'site', label: 'Site', required: false, type: 'string',
    synonyms: ['site', 'location', 'area', 'camp', 'depot', 'yard', 'project', 'branch', 'الموقع', 'موقع العمل', 'المعسكر', 'الفرع'] },
  { key: 'country', label: 'Country', required: false, type: 'string',
    synonyms: ['country', 'nation', 'country code', 'cc', 'البلد', 'الدولة'] },
  { key: 'region', label: 'Region', required: false, type: 'string',
    synonyms: ['region', 'zone', 'territory', 'المنطقة', 'الإقليم'] },
  { key: 'tyre_size', label: 'Tyre Size', required: false, type: 'string',
    synonyms: ['tyre size', 'tire size', 'rim size', 'wheel size', 'fitment size', 'مقاس الإطار', 'حجم الإطار'] },
  { key: 'status', label: 'Status', required: false, type: 'string',
    synonyms: ['status', 'state', 'condition', 'active', 'الحالة'] },
  { key: 'current_km', label: 'Current KM', required: false, type: 'distance',
    synonyms: ['current km', 'odometer', 'odo', 'mileage', 'km', 'kms', 'current odometer', 'reading', 'قراءة العداد', 'الكيلومترات الحالية'] },
  { key: 'registration_no', label: 'Registration No.', required: false, type: 'string',
    synonyms: ['registration', 'registration no', 'reg', 'reg no', 'license plate', 'number plate', 'plate number', 'رقم التسجيل', 'رقم اللوحة'] },
]

/* ── Tyre (tyre_records) ────────────────────────────────────────────────────── */

/** @type {CanonicalField[]} */
const TYRE_FIELDS = [
  { key: 'serial_no', label: 'Serial No.', required: true, type: 'string',
    synonyms: ['serial', 'serial no', 'serial number', 'serial num', 's/n', 'sn', 'tyre serial', 'tyre no', 'tyre number', 'tyre num', 'barcode', 'part no',
      'رقم الإطار', 'الرقم التسلسلي', 'رقم التسلسل', 'رقم المنتج'] },
  { key: 'asset_no', label: 'Asset No.', required: true, type: 'string',
    synonyms: ['asset', 'asset no', 'asset number', 'equipment', 'vehicle', 'vehicle no', 'vehicle number', 'veh no', 'unit', 'unit no', 'plate', 'plate no', 'fleet no', 'chassis', 'ub no',
      'رقم المعدة', 'رقم المركبة', 'رقم الأصل', 'رقم السيارة', 'الأصل'] },
  { key: 'brand', label: 'Brand', required: false, type: 'string',
    synonyms: ['brand', 'tyre brand', 'manufacturer', 'make', 'brand name', 'tyre make', 'الماركة', 'العلامة التجارية', 'صانع'] },
  { key: 'size', label: 'Size', required: false, type: 'string',
    synonyms: ['size', 'tyre size', 'tire size', 'description', 'tyre description', 'desc', 'tyre size desc', 'مقاس الإطار', 'الحجم', 'الوصف'] },
  { key: 'position', label: 'Position', required: false, type: 'string',
    synonyms: ['position', 'tyre position', 'tyre pos', 'wheel position', 'pos', 'axle position', 'axle', 'wheel', 'موضع الإطار', 'الموضع'] },
  { key: 'pressure_reading', label: 'Pressure', required: false, type: 'pressure',
    synonyms: ['pressure', 'pressure reading', 'air pressure', 'tyre pressure', 'psi', 'inflation', 'inflation pressure', 'ضغط الهواء', 'ضغط الإطار', 'الضغط'] },
  { key: 'tread_depth', label: 'Tread Depth', required: false, type: 'number',
    synonyms: ['tread', 'tread depth', 'tread reading', 'remaining tread', 'tread mm', 'rtd', 'عمق المداس', 'عمق الإطار'] },
  { key: 'site', label: 'Site', required: false, type: 'string',
    synonyms: ['site', 'location', 'area', 'camp', 'depot', 'branch', 'workshop location', 'project', 'الموقع', 'موقع العمل', 'الفرع'] },
  { key: 'country', label: 'Country', required: false, type: 'string',
    synonyms: ['country', 'nation', 'country code', 'cc', 'البلد', 'الدولة'] },
  { key: 'cost_per_tyre', label: 'Cost / Tyre', required: false, type: 'currency',
    synonyms: ['cost', 'cost per tyre', 'unit cost', 'price', 'tyre cost', 'amount', 'value', 'rate', 'سعر الإطار', 'تكلفة الإطار', 'التكلفة', 'السعر'] },
  { key: 'km_at_fitment', label: 'KM at Fitment', required: false, type: 'distance',
    synonyms: ['fitted km', 'fitment km', 'km at fitment', 'fixed km', 'install km', 'km fitted', 'mounting km', 'odometer at fitment', 'كم التركيب', 'عداد التركيب'] },
  { key: 'km_at_removal', label: 'KM at Removal', required: false, type: 'distance',
    synonyms: ['removed km', 'removal km', 'km at removal', 'scrap km', 'km removed', 'odometer at removal', 'كم الإزالة', 'عداد الإزالة'] },
  { key: 'removal_reason', label: 'Removal Reason', required: false, type: 'string',
    synonyms: ['removal reason', 'reason', 'reason for removal', 'scrap reason', 'failure reason', 'cause', 'سبب الإزالة', 'سبب'] },
  { key: 'supplier', label: 'Supplier', required: false, type: 'string',
    synonyms: ['supplier', 'vendor', 'vendor name', 'supplier name', 'dealer', 'المورد', 'اسم المورد'] },
  { key: 'issue_date', label: 'Issue / Fitment Date', required: false, type: 'date',
    synonyms: ['date', 'issue date', 'issued date', 'fitment date', 'fitted date', 'transaction date', 'fix date', 'fixed date', 'install date', 'job card date',
      'تاريخ التركيب', 'تاريخ الإصدار', 'التاريخ'] },
]

/* ── Stock (stock_records) ──────────────────────────────────────────────────── */

/** @type {CanonicalField[]} */
const STOCK_FIELDS = [
  { key: 'site', label: 'Site', required: true, type: 'string',
    synonyms: ['site', 'warehouse', 'store', 'branch', 'location', 'depot', 'الموقع', 'المستودع', 'الفرع'] },
  { key: 'description', label: 'Description', required: true, type: 'string',
    synonyms: ['description', 'desc', 'item', 'item name', 'item description', 'product', 'product name', 'material', 'الوصف', 'اسم الصنف', 'البيان'] },
  { key: 'stock_qty', label: 'Stock Qty', required: true, type: 'number',
    synonyms: ['qty', 'quantity', 'stock', 'stock qty', 'on hand', 'balance', 'in stock', 'available', 'soh', 'الكمية', 'المخزون', 'الرصيد'] },
  { key: 'min_level', label: 'Min Level', required: false, type: 'number',
    synonyms: ['min level', 'minimum', 'min stock', 'minimum level', 'safety stock', 'reorder level', 'الحد الأدنى'] },
  { key: 'critical_level', label: 'Critical Level', required: false, type: 'number',
    synonyms: ['critical level', 'critical', 'danger level', 'min critical', 'الحد الحرج'] },
  { key: 'reorder_qty', label: 'Reorder Qty', required: false, type: 'number',
    synonyms: ['reorder qty', 'reorder quantity', 'order qty', 'order quantity', 'eoq', 'كمية إعادة الطلب'] },
  { key: 'region', label: 'Region', required: false, type: 'string',
    synonyms: ['region', 'zone', 'territory', 'المنطقة'] },
  { key: 'country', label: 'Country', required: false, type: 'string',
    synonyms: ['country', 'nation', 'country code', 'cc', 'البلد', 'الدولة'] },
]

/**
 * Module → canonical field list.
 * @type {Record<string, CanonicalField[]>}
 */
export const MODULE_FIELDS = Object.freeze({
  fleet: FLEET_FIELDS,
  tyre: TYRE_FIELDS,
  stock: STOCK_FIELDS,
})

/**
 * Pre-built, module-scoped reverse index: normalised alias -> target key.
 * Built once at module load; never mutated. Because each module owns its own
 * index, a tyre alias cannot resolve inside the stock module.
 * @type {Record<string, Map<string,string>>}
 */
const ALIAS_INDEX = Object.freeze(
  Object.fromEntries(
    MODULES.map((mod) => {
      /** @type {Map<string,string>} */
      const idx = new Map()
      for (const field of MODULE_FIELDS[mod]) {
        // The canonical key itself is always a valid alias.
        idx.set(normaliseToken(field.key), field.key)
        idx.set(normaliseToken(field.label), field.key)
        for (const syn of field.synonyms) idx.set(normaliseToken(syn), field.key)
      }
      return [mod, idx]
    }),
  ),
)

/**
 * Resolve a header to a canonical target key within a module via exact
 * (normalised) alias match. Returns null when no exact alias exists (fuzzy
 * matching lives in mapping.js).
 *
 * @param {string} header
 * @param {'fleet'|'tyre'|'stock'} module
 * @returns {string|null}
 */
export function exactAlias(header, module) {
  const idx = ALIAS_INDEX[module]
  if (!idx) return null
  return idx.get(normaliseToken(header)) ?? null
}

/**
 * Return the canonical field definition for a target key within a module.
 * @param {string} key
 * @param {'fleet'|'tyre'|'stock'} module
 * @returns {CanonicalField|null}
 */
export function fieldDef(key, module) {
  const list = MODULE_FIELDS[module]
  if (!list) return null
  return list.find((f) => f.key === key) ?? null
}

/**
 * All synonyms (raw) for a target key within a module — used by fuzzy scoring.
 * @param {string} key
 * @param {'fleet'|'tyre'|'stock'} module
 * @returns {string[]}
 */
export function synonymsFor(key, module) {
  const def = fieldDef(key, module)
  if (!def) return []
  return [def.key, def.label, ...def.synonyms]
}
