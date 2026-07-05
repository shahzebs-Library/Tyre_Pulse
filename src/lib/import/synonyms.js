/**
 * Import Center - canonical field dictionaries + Arabic/English synonym lists.
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
export const MODULES = ['fleet', 'tyre', 'stock', 'accident', 'inspection', 'workorder', 'warranty', 'gatepass', 'supplier', 'driver']

/**
 * Destination table per module.
 * @type {Record<string,string>}
 */
export const MODULE_TABLES = {
  fleet: 'vehicle_fleet',
  tyre: 'tyre_records',
  stock: 'stock_records',
  accident: 'accidents',
  inspection: 'inspections',
  workorder: 'work_orders',
  warranty: 'warranty_claims',
  gatepass: 'gate_passes',
  supplier: 'suppliers',
  driver: 'drivers',
}

/* ── Fleet (vehicle_fleet) ──────────────────────────────────────────────────── */

/** @type {CanonicalField[]} */
const FLEET_FIELDS = [
  { key: 'asset_no', label: 'Asset No.', required: true, type: 'string',
    synonyms: ['asset', 'asset no', 'asset number', 'asset code', 'equipment', 'equipment no', 'unit', 'unit no', 'vehicle', 'vehicle no', 'vehicle number', 'veh no', 'ub no',
      'رقم المعدة', 'رقم المركبة', 'رقم الأصل', 'الأصل', 'رقم السيارة'] },
  { key: 'fleet_number', label: 'Fleet Number', required: false, type: 'string',
    synonyms: ['fleet', 'fleet no', 'fleet number', 'fleet code', 'fleet id', 'رقم الأسطول'] },
  { key: 'make', label: 'Make', required: false, type: 'string',
    synonyms: ['make', 'manufacturer', 'oem', 'brand', 'الصانع', 'الماركة'] },
  { key: 'model', label: 'Model', required: false, type: 'string',
    synonyms: ['model', 'variant', 'asset desc', 'asset desc.', 'asset description', 'الموديل', 'الطراز'] },
  { key: 'vehicle_type', label: 'Vehicle Type', required: false, type: 'string',
    synonyms: ['vehicle type', 'veh type', 'type', 'category', 'asset type', 'equipment type', 'fleet type', 'class', 'نوع المركبة', 'نوع المعدة', 'الفئة'] },
  { key: 'year', label: 'Year', required: false, type: 'integer',
    synonyms: ['year', 'model year', 'yr', 'manufacture year', 'سنة الصنع', 'السنة'] },
  { key: 'department', label: 'Department', required: false, type: 'string',
    synonyms: ['department', 'dept', 'division', 'cost center', 'cost centre', 'القسم', 'الإدارة'] },
  { key: 'operator_name', label: 'Operator', required: false, type: 'string',
    synonyms: ['operator', 'operator name', 'driver', 'driver name', 'assigned to', 'اسم المشغل', 'السائق', 'المشغل'] },
  { key: 'site', label: 'Site', required: false, type: 'string',
    synonyms: ['site', 'location', 'area', 'camp', 'depot', 'yard', 'project', 'branch', 'asset location', 'الموقع', 'موقع العمل', 'المعسكر', 'الفرع'] },
  { key: 'country', label: 'Country', required: false, type: 'string',
    synonyms: ['country', 'nation', 'country code', 'cc', 'البلد', 'الدولة'] },
  { key: 'region', label: 'Region', required: false, type: 'string',
    synonyms: ['region', 'zone', 'territory', 'المنطقة', 'الإقليم'] },
  { key: 'tyre_size', label: 'Tyre Size', required: false, type: 'string',
    synonyms: ['tyre size', 'tire size', 'rim size', 'wheel size', 'fitment size', 'مقاس الإطار', 'حجم الإطار'] },
  { key: 'status', label: 'Status', required: false, type: 'string',
    synonyms: ['status', 'state', 'condition', 'active', 'asset status', 'الحالة'] },
  { key: 'current_km', label: 'Current KM', required: false, type: 'distance',
    synonyms: ['current km', 'odometer', 'odo', 'mileage', 'km', 'kms', 'current odometer', 'reading', 'قراءة العداد', 'الكيلومترات الحالية'] },
  { key: 'registration_no', label: 'Registration No.', required: false, type: 'string',
    synonyms: ['registration', 'registration no', 'reg', 'reg no', 'license plate', 'number plate', 'plate number', 'plate no', 'plate no.', 'plate', 'رقم التسجيل', 'رقم اللوحة'] },
  { key: 'notes', label: 'Notes / Remarks', required: false, type: 'string',
    synonyms: ['notes', 'remarks', 'comment', 'comments', 'ملاحظات'] },
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
    synonyms: ['size', 'tyre size', 'tire size', 'description', 'tyre description', 'desc', 'tyre size desc', 'item/tyre', 'item tyre', 'مقاس الإطار', 'الحجم', 'الوصف'] },
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
  { key: 'cost_per_tyre', label: 'Unit Cost / Tyre', required: false, type: 'currency',
    synonyms: ['cost', 'cost per tyre', 'unit cost', 'unit price', 'price per tyre', 'price', 'tyre cost', 'rate', 'unit rate', 'سعر الإطار', 'تكلفة الإطار', 'التكلفة', 'السعر', 'سعر الوحدة'] },
  { key: 'qty', label: 'Quantity', required: false, type: 'integer',
    synonyms: ['qty', 'quantity', 'qnty', 'qty.', 'no of tyres', 'number of tyres', 'no. of tyres', 'no of tyre', 'nos', 'pcs', 'pieces', 'count', 'units', 'الكمية', 'عدد الإطارات', 'العدد', 'عدد'] },
  { key: 'total_amount', label: 'Total Amount', required: false, type: 'currency', derived: true,
    synonyms: ['total amount', 'total cost', 'total value', 'total price', 'amount', 'line total', 'net amount', 'gross amount', 'grand total', 'tyre value', 'tyres cost', 'cost of tyres', 'tyre amount', 'cost value', 'المبلغ الإجمالي', 'الإجمالي', 'المجموع', 'القيمة الإجمالية'] },
  { key: 'km_at_fitment', label: 'KM at Fitment', required: false, type: 'distance',
    synonyms: ['fitted km', 'fitment km', 'km at fitment', 'fixed km', 'install km', 'km fitted', 'mounting km', 'odometer at fitment', 'كم التركيب', 'عداد التركيب'] },
  { key: 'km_at_removal', label: 'KM at Removal', required: false, type: 'distance',
    synonyms: ['removed km', 'removal km', 'km at removal', 'scrap km', 'km removed', 'odometer at removal', 'كم الإزالة', 'عداد الإزالة'] },
  { key: 'removal_reason', label: 'Removal Reason', required: false, type: 'string',
    synonyms: ['removal reason', 'reason', 'reason for removal', 'scrap reason', 'failure reason', 'cause', 'سبب الإزالة', 'سبب'] },
  { key: 'supplier', label: 'Supplier', required: false, type: 'string',
    synonyms: ['supplier', 'vendor', 'vendor name', 'supplier name', 'dealer', 'المورد', 'اسم المورد'] },
  { key: 'issue_date', label: 'Issue / Fitment Date', required: false, type: 'date',
    synonyms: ['date', 'issue date', 'issued date', 'fitment date', 'fitted date', 'transaction date', 'fix date', 'fixed date', 'install date', 'tyre fix date',
      'تاريخ التركيب', 'تاريخ الإصدار', 'التاريخ'] },
  { key: 'removal_date', label: 'Removal Date', required: false, type: 'date',
    synonyms: ['removal date', 'removed date', 'tyre removed date', 'date removed', 'scrap date', 'تاريخ الإزالة'] },
  { key: 'job_card', label: 'Job Card No.', required: false, type: 'string',
    synonyms: ['job card', 'job card no', 'job card no.', 'job card number', 'jc no', 'jc number', 'jc', 'رقم البطاقة', 'رقم أمر العمل'] },
  { key: 'vehicle_type', label: 'Vehicle Type', required: false, type: 'string',
    synonyms: ['vehicle type', 'veh type', 'veh type/category', 'vehicle category', 'veh category', 'asset type', 'equipment type', 'نوع المركبة', 'نوع المعدة'] },
  { key: 'hrs_at_fitment', label: 'Hours at Fitment', required: false, type: 'number',
    synonyms: ['fixed hrs', 'fitment hrs', 'hrs at fitment', 'fitted hrs', 'install hrs', 'hours at fitment', 'ساعات التركيب'] },
  { key: 'hrs_at_removal', label: 'Hours at Removal', required: false, type: 'number',
    synonyms: ['removed hrs', 'removal hrs', 'hrs at removal', 'scrap hrs', 'hours at removal', 'ساعات الإزالة'] },
  { key: 'total_km', label: 'Total KM (Tyre Life)', required: false, type: 'distance',
    synonyms: ['total km', 'km run', 'km covered', 'tyre km', 'life km', 'total kilometers', 'إجمالي الكيلومترات'] },
  { key: 'total_hrs', label: 'Total Hours (Tyre Life)', required: false, type: 'number',
    synonyms: ['total hrs', 'total hours', 'life hrs', 'life hours', 'إجمالي الساعات'] },
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

/* ── Accident & Insurance (accidents) ───────────────────────────────────────── */

/**
 * Accident identity in this DB is the insurance claim no (preferred) or police
 * report no - there is no dedicated accident_no column. asset_no + incident_date
 * form the minimum usable record; claim/police identifiers drive dedup.
 * @type {CanonicalField[]}
 */
const ACCIDENT_FIELDS = [
  { key: 'asset_no', label: 'Asset No.', required: true, type: 'string',
    synonyms: ['asset', 'asset no', 'asset number', 'equipment', 'equipment no', 'vehicle', 'vehicle no', 'vehicle number', 'veh no', 'unit', 'unit no', 'plate', 'plate no', 'fleet no',
      'رقم المعدة', 'رقم المركبة', 'رقم الأصل', 'رقم السيارة'] },
  { key: 'incident_date', label: 'Incident Date', required: true, type: 'date',
    synonyms: ['date', 'incident date', 'accident date', 'date of accident', 'date of incident', 'event date', 'loss date',
      'تاريخ الحادث', 'تاريخ الحادثة', 'التاريخ'] },
  { key: 'incident_time', label: 'Incident Time', required: false, type: 'string',
    synonyms: ['time', 'incident time', 'accident time', 'time of accident', 'وقت الحادث', 'الوقت'] },
  { key: 'location', label: 'Location', required: false, type: 'string',
    synonyms: ['location', 'place', 'accident location', 'spot', 'مكان الحادث', 'الموقع'] },
  { key: 'site', label: 'Site', required: false, type: 'string',
    synonyms: ['site', 'project', 'branch', 'depot', 'camp', 'الموقع', 'المشروع', 'الفرع'] },
  { key: 'country', label: 'Country', required: false, type: 'string',
    synonyms: ['country', 'nation', 'country code', 'cc', 'البلد', 'الدولة'] },
  { key: 'accident_type', label: 'Accident Type', required: false, type: 'string',
    synonyms: ['type', 'accident type', 'incident type', 'category', 'collision type', 'نوع الحادث', 'الفئة'] },
  { key: 'severity', label: 'Severity', required: false, type: 'string',
    synonyms: ['severity', 'seriousness', 'damage level', 'impact', 'الخطورة', 'الشدة'] },
  { key: 'description', label: 'Description', required: false, type: 'string',
    synonyms: ['description', 'details', 'narrative', 'remarks', 'how it happened', 'الوصف', 'التفاصيل'] },
  { key: 'damage_description', label: 'Damage Description', required: false, type: 'string',
    synonyms: ['damage', 'damage description', 'damages', 'damage details', 'وصف الأضرار', 'الأضرار'] },
  { key: 'driver_name', label: 'Driver / Operator', required: false, type: 'string',
    synonyms: ['driver', 'driver name', 'operator', 'operator name', 'at fault driver', 'السائق', 'اسم السائق', 'المشغل'] },
  { key: 'police_report_no', label: 'Police Report No.', required: false, type: 'string',
    synonyms: ['police report', 'police report no', 'police no', 'police ref', 'report no', 'fir no', 'رقم المحضر', 'رقم البلاغ'] },
  { key: 'insurer', label: 'Insurer', required: false, type: 'string',
    synonyms: ['insurer', 'insurance company', 'insurance', 'underwriter', 'شركة التأمين', 'المؤمن'] },
  { key: 'policy_no', label: 'Policy No.', required: false, type: 'string',
    synonyms: ['policy', 'policy no', 'policy number', 'policy ref', 'رقم الوثيقة', 'رقم البوليصة'] },
  { key: 'insurance_claim_no', label: 'Claim No.', required: false, type: 'string',
    synonyms: ['claim', 'claim no', 'claim number', 'insurance claim', 'insurance claim no', 'claim ref', 'claim reference', 'رقم المطالبة', 'مطالبة'] },
  { key: 'claim_status', label: 'Claim Status', required: false, type: 'string',
    synonyms: ['claim status', 'status of claim', 'حالة المطالبة'] },
  { key: 'claim_amount', label: 'Claim Amount', required: false, type: 'currency',
    synonyms: ['claim amount', 'claimed amount', 'claim value', 'amount claimed', 'مبلغ المطالبة', 'قيمة المطالبة'] },
  { key: 'claim_approved_amount', label: 'Approved Amount', required: false, type: 'currency',
    synonyms: ['approved amount', 'claim approved', 'approved claim', 'settled amount', 'sanctioned amount', 'المبلغ المعتمد', 'المبلغ المقبول'] },
  { key: 'recovered_amount', label: 'Recovered Amount', required: false, type: 'currency',
    synonyms: ['recovered', 'recovered amount', 'recovery amount', 'amount recovered', 'reimbursed', 'المبلغ المسترد', 'المسترد'] },
  { key: 'deductible', label: 'Deductible / Excess', required: false, type: 'currency',
    synonyms: ['deductible', 'excess', 'excess amount', 'own damage excess', 'التحمل', 'نسبة التحمل'] },
  { key: 'estimated_damage_cost', label: 'Estimated Cost', required: false, type: 'currency',
    synonyms: ['estimate', 'estimated cost', 'estimated damage', 'estimated damage cost', 'quotation', 'quote', 'التكلفة التقديرية', 'التقدير'] },
  { key: 'repair_cost', label: 'Actual Repair Cost', required: false, type: 'currency',
    synonyms: ['actual cost', 'repair cost', 'actual repair cost', 'final cost', 'invoice amount', 'التكلفة الفعلية', 'تكلفة الإصلاح'] },
  { key: 'parts_cost', label: 'Parts Cost', required: false, type: 'currency',
    synonyms: ['parts cost', 'parts', 'spare parts cost', 'material cost', 'تكلفة قطع الغيار'] },
  { key: 'closure_status', label: 'Closure Status', required: false, type: 'string',
    synonyms: ['closure status', 'closure', 'closed', 'case closed', 'حالة الإغلاق', 'الإغلاق'] },
]

/* ── Inspections (inspections) ──────────────────────────────────────────────── */

/** @type {CanonicalField[]} */
const INSPECTION_FIELDS = [
  { key: 'asset_no', label: 'Asset No.', required: true, type: 'string',
    synonyms: ['asset', 'asset no', 'asset number', 'equipment', 'vehicle', 'vehicle no', 'veh no', 'unit', 'unit no', 'plate', 'fleet no',
      'رقم المعدة', 'رقم المركبة', 'رقم الأصل', 'رقم السيارة'] },
  { key: 'inspection_date', label: 'Inspection Date', required: true, type: 'date',
    synonyms: ['date', 'inspection date', 'inspected date', 'check date', 'date inspected', 'تاريخ الفحص', 'التاريخ'] },
  { key: 'inspection_type', label: 'Inspection Type', required: false, type: 'string',
    synonyms: ['type', 'inspection type', 'template', 'checklist', 'check type', 'category', 'نوع الفحص', 'الفئة'] },
  { key: 'inspector', label: 'Inspector', required: false, type: 'string',
    synonyms: ['inspector', 'inspected by', 'checked by', 'technician', 'examiner', 'المفتش', 'الفاحص'] },
  { key: 'tyre_serial', label: 'Tyre Serial', required: false, type: 'string',
    synonyms: ['serial', 'tyre serial', 'serial no', 'tyre no', 's/n', 'رقم الإطار'] },
  { key: 'site', label: 'Site', required: false, type: 'string',
    synonyms: ['site', 'location', 'area', 'project', 'branch', 'depot', 'الموقع', 'المشروع', 'الفرع'] },
  { key: 'country', label: 'Country', required: false, type: 'string',
    synonyms: ['country', 'nation', 'country code', 'cc', 'البلد', 'الدولة'] },
  { key: 'status', label: 'Status', required: false, type: 'string',
    synonyms: ['status', 'state', 'result', 'outcome', 'الحالة', 'النتيجة'] },
  { key: 'severity', label: 'Severity', required: false, type: 'string',
    synonyms: ['severity', 'risk', 'risk level', 'priority', 'الخطورة', 'المخاطر'] },
  { key: 'findings', label: 'Findings', required: false, type: 'string',
    synonyms: ['findings', 'observations', 'remarks', 'comments', 'notes', 'الملاحظات', 'النتائج'] },
  { key: 'odometer_km', label: 'Odometer KM', required: false, type: 'distance',
    synonyms: ['odometer', 'odo', 'km', 'mileage', 'reading', 'odometer km', 'قراءة العداد', 'الكيلومترات'] },
  { key: 'pressure_reading', label: 'Pressure', required: false, type: 'pressure',
    synonyms: ['pressure', 'air pressure', 'psi', 'tyre pressure', 'ضغط الهواء', 'الضغط'] },
]

/* ── Work Orders (work_orders) ──────────────────────────────────────────────── */

/** @type {CanonicalField[]} */
const WORKORDER_FIELDS = [
  { key: 'work_order_no', label: 'Work Order No.', required: true, type: 'string',
    synonyms: ['wo', 'wo no', 'wo number', 'work order', 'work order no', 'work order number', 'job no', 'job card', 'job card no', 'jc', 'jc no', 'jc number', 'job card number', 'ticket no', 'order no', 'doc no', 'رقم أمر العمل', 'رقم البطاقة'] },
  { key: 'asset_no', label: 'Asset No.', required: false, type: 'string',
    synonyms: ['asset', 'asset no', 'asset number', 'equipment', 'equipment no', 'vehicle no', 'veh no', 'vehicle number', 'unit', 'unit no', 'plate', 'plate no', 'fleet no', 'رقم المعدة', 'رقم المركبة'] },
  { key: 'tyre_serial', label: 'Tyre Serial', required: false, type: 'string',
    synonyms: ['tyre serial', 'serial', 'serial no', 'serial number', 's/n', 'sn', 'tyre no', 'الرقم التسلسلي'] },
  { key: 'tyre_position', label: 'Tyre Position', required: false, type: 'string',
    synonyms: ['tyre position', 'position', 'wheel position', 'axle position', 'axle', 'الموضع'] },
  { key: 'work_type', label: 'Work Type', required: false, type: 'string',
    synonyms: ['work type', 'job type', 'repair type', 'service type', 'nature of work', 'reason of repair', 'reason for repair', 'repair reason', 'reason', 'نوع العمل'] },
  { key: 'status', label: 'Status', required: false, type: 'string',
    synonyms: ['status', 'state', 'wo status', 'job status', 'tracking category', 'tracking status', 'الحالة'] },
  { key: 'priority', label: 'Priority', required: false, type: 'string',
    synonyms: ['priority', 'urgency', 'الأولوية'] },
  { key: 'description', label: 'Complaint / Description', required: false, type: 'string',
    synonyms: ['description', 'work description', 'complaint', 'complaints', 'fault', 'defect', 'problem', 'problem reported', 'issue reported', 'scope', 'الوصف', 'الشكوى'] },
  { key: 'notes', label: 'Notes / Job Done', required: false, type: 'string',
    synonyms: ['notes', 'remarks', 'qc remarks', 'job done', 'job done description', 'work done', 'action taken', 'repair done', 'resolution', 'comments', 'ملاحظات'] },
  { key: 'technician_name', label: 'Technician', required: false, type: 'string',
    synonyms: ['technician', 'technician name', 'mechanic', 'fitter', 'assigned to', 'الفني', 'الميكانيكي'] },
  { key: 'workshop_name', label: 'Workshop', required: false, type: 'string',
    synonyms: ['workshop', 'workshop name', 'workshop location', 'garage', 'service center', 'service centre', 'bay', 'الورشة'] },
  { key: 'site', label: 'Site', required: false, type: 'string',
    synonyms: ['site', 'location', 'project', 'branch', 'depot', 'الموقع', 'المشروع'] },
  { key: 'country', label: 'Country', required: false, type: 'string',
    synonyms: ['country', 'nation', 'country code', 'cc', 'البلد', 'الدولة'] },
  { key: 'opened_at', label: 'Opened / In Date', required: false, type: 'date',
    synonyms: ['opened at', 'open date', 'date opened', 'wo date', 'date in', 'in date', 'vehicle in date', 'veh in date', 'received date', 'job card date', 'created date', 'تاريخ الفتح', 'تاريخ الدخول'] },
  { key: 'started_at', label: 'Started', required: false, type: 'date',
    synonyms: ['started at', 'start date', 'date started', 'work start', 'تاريخ البدء'] },
  { key: 'completed_at', label: 'Completed / Out Date', required: false, type: 'date',
    synonyms: ['completed at', 'completion date', 'date completed', 'date out', 'out date', 'vehicle out date', 'veh out date', 'closed date', 'finish date', 'done date', 'تاريخ الإكمال', 'تاريخ الخروج'] },
  { key: 'target_completion', label: 'Target Completion', required: false, type: 'date',
    synonyms: ['target completion', 'target date', 'due date', 'promised date', 'expected completion', 'التاريخ المستهدف'] },
  { key: 'labour_hours', label: 'Labour Hours', required: false, type: 'number',
    synonyms: ['labour hours', 'labor hours', 'man hours', 'manpower hours', 'manpow hrs', 'mp hrs', 'std hrs', 'standard hours', 'work hours', 'ساعات العمل'] },
  { key: 'labour_rate', label: 'Labour Rate', required: false, type: 'currency',
    synonyms: ['labour rate', 'labor rate', 'rate per hour', 'hourly rate', 'معدل العمالة'] },
  { key: 'labour_cost', label: 'Labour Cost', required: false, type: 'currency',
    synonyms: ['labour cost', 'labor cost', 'تكلفة العمالة'] },
  { key: 'parts_cost', label: 'Parts Cost', required: false, type: 'currency',
    synonyms: ['parts cost', 'spare parts cost', 'total spare cost', 'spare cost', 'material cost', 'spares cost', 'تكلفة قطع الغيار'] },
  { key: 'lubricant_cost', label: 'Lubricant Cost', required: false, type: 'currency',
    synonyms: ['lubricant cost', 'lubricants', 'lubricant', 'oil cost', 'oil', 'consumables', 'تكلفة الزيوت', 'الزيوت'] },
  { key: 'tyre_cost', label: 'Tyre Cost', required: false, type: 'currency',
    synonyms: ['tyre cost', 'tyres', 'tire cost', 'tyre amount', 'tyres cost', 'trye', 'tyre', 'tyre value', 'تكلفة الإطارات', 'الإطارات'] },
  { key: 'outside_repair_cost', label: 'Outside Repair Cost', required: false, type: 'currency',
    synonyms: ['outside repair cost', 'outside rep cost', 'outside repair', 'external repair', 'subcontract cost', 'sublet cost', 'تكلفة الإصلاح الخارجي'] },
  { key: 'breakdown_hours', label: 'Breakdown Hours', required: false, type: 'number',
    synonyms: ['breakdown hours', 'bd hrs', 'total bd hrs', 'breakdown hrs', 'downtime hours', 'downtime hrs', 'ساعات التعطل'] },
  { key: 'standard_hours', label: 'Standard Hours', required: false, type: 'number',
    synonyms: ['standard hours', 'std hrs', 'std hours', 'estimated hours', 'flat rate hours', 'الساعات القياسية'] },
  { key: 'odometer', label: 'Odometer (KM/HR)', required: false, type: 'number',
    synonyms: ['odometer', 'km', 'km reading', 'km/hr', 'kmhr', 'hr meter', 'hour meter', 'mileage', 'meter reading', 'قراءة العداد', 'الكيلومترات'] },
  { key: 'total_cost', label: 'Total Cost', required: false, type: 'currency',
    synonyms: ['total cost', 'grand total', 'net total', 'total amount', 'total repair cost', 'التكلفة الإجمالية'] },
]

/* ── Warranty Claims (warranty_claims) ──────────────────────────────────────── */

/** @type {CanonicalField[]} */
const WARRANTY_FIELDS = [
  { key: 'serial_number', label: 'Tyre Serial', required: true, type: 'string',
    synonyms: ['serial', 'serial no', 'serial number', 'tyre serial', 'tyre no', 's/n', 'sn', 'barcode', 'رقم الإطار', 'الرقم التسلسلي'] },
  { key: 'claim_no', label: 'Claim No.', required: false, type: 'string',
    synonyms: ['claim', 'claim no', 'claim number', 'warranty claim', 'claim ref', 'rma', 'rma no', 'رقم المطالبة', 'مطالبة الضمان'] },
  { key: 'brand', label: 'Brand', required: false, type: 'string',
    synonyms: ['brand', 'tyre brand', 'make', 'manufacturer', 'الماركة', 'العلامة التجارية'] },
  { key: 'size', label: 'Size', required: false, type: 'string',
    synonyms: ['size', 'tyre size', 'description', 'المقاس', 'الحجم'] },
  { key: 'asset_no', label: 'Asset No.', required: false, type: 'string',
    synonyms: ['asset', 'asset no', 'equipment', 'vehicle', 'vehicle no', 'unit', 'plate', 'رقم المعدة', 'رقم المركبة'] },
  { key: 'site', label: 'Site', required: false, type: 'string',
    synonyms: ['site', 'location', 'project', 'branch', 'الموقع', 'المشروع'] },
  { key: 'country', label: 'Country', required: false, type: 'string',
    synonyms: ['country', 'nation', 'country code', 'cc', 'البلد', 'الدولة'] },
  { key: 'fitment_date', label: 'Fitment Date', required: false, type: 'date',
    synonyms: ['fitment date', 'fitted date', 'install date', 'تاريخ التركيب'] },
  { key: 'removal_date', label: 'Removal Date', required: false, type: 'date',
    synonyms: ['removal date', 'removed date', 'failure date', 'تاريخ الإزالة', 'تاريخ العطل'] },
  { key: 'km_at_fitment', label: 'KM at Fitment', required: false, type: 'distance',
    synonyms: ['fitted km', 'fitment km', 'km at fitment', 'install km', 'كم التركيب'] },
  { key: 'km_at_removal', label: 'KM at Removal', required: false, type: 'distance',
    synonyms: ['removed km', 'removal km', 'km at removal', 'failure km', 'كم الإزالة'] },
  { key: 'failure_type', label: 'Failure Type', required: false, type: 'string',
    synonyms: ['failure type', 'failure', 'defect', 'fault', 'reason', 'complaint', 'نوع العطل', 'العيب'] },
  { key: 'supplier', label: 'Supplier', required: false, type: 'string',
    synonyms: ['supplier', 'vendor', 'dealer', 'manufacturer', 'المورد', 'الوكيل'] },
  { key: 'claim_status', label: 'Claim Status', required: false, type: 'string',
    synonyms: ['claim status', 'status', 'warranty status', 'حالة المطالبة'] },
  { key: 'credit_amount', label: 'Credit Amount', required: false, type: 'currency',
    synonyms: ['credit', 'credit amount', 'credited', 'refund', 'compensation', 'مبلغ الائتمان', 'التعويض'] },
]

/* ── Gate Pass (gate_passes) ────────────────────────────────────────────────── */

/** @type {CanonicalField[]} */
const GATEPASS_FIELDS = [
  { key: 'asset_no', label: 'Asset No.', required: true, type: 'string',
    synonyms: ['asset', 'asset no', 'equipment', 'vehicle', 'vehicle no', 'unit', 'plate', 'fleet no', 'رقم المعدة', 'رقم المركبة'] },
  { key: 'pass_date', label: 'Pass Date', required: true, type: 'date',
    synonyms: ['date', 'pass date', 'gate pass date', 'release date', 'exit date', 'تاريخ التصريح', 'تاريخ الخروج'] },
  { key: 'site', label: 'Site', required: false, type: 'string',
    synonyms: ['site', 'location', 'gate', 'project', 'branch', 'الموقع', 'البوابة'] },
  { key: 'country', label: 'Country', required: false, type: 'string',
    synonyms: ['country', 'nation', 'country code', 'cc', 'البلد', 'الدولة'] },
  { key: 'status', label: 'Status', required: false, type: 'string',
    synonyms: ['status', 'state', 'pass status', 'clearance', 'الحالة'] },
  { key: 'denial_reason', label: 'Denial Reason', required: false, type: 'string',
    synonyms: ['denial reason', 'rejection reason', 'reason', 'hold reason', 'سبب الرفض', 'سبب'] },
  { key: 'notes', label: 'Notes', required: false, type: 'string',
    synonyms: ['notes', 'remarks', 'comments', 'ملاحظات'] },
]

/* ── Supplier master (suppliers) ────────────────────────────────────────────── */

/** @type {CanonicalField[]} */
const SUPPLIER_FIELDS = [
  { key: 'supplier_name', label: 'Supplier Name', required: true, type: 'string',
    synonyms: ['supplier', 'supplier name', 'vendor', 'vendor name', 'name', 'company', 'company name', 'dealer', 'المورد', 'اسم المورد', 'الشركة'] },
  { key: 'supplier_code', label: 'Supplier Code', required: false, type: 'string',
    synonyms: ['code', 'supplier code', 'vendor code', 'supplier id', 'vendor id', 'account no', 'رمز المورد', 'كود المورد'] },
  { key: 'supplier_type', label: 'Supplier Type', required: false, type: 'string',
    synonyms: ['type', 'supplier type', 'vendor type', 'category', 'classification', 'نوع المورد', 'الفئة'] },
  { key: 'contact_person', label: 'Contact Person', required: false, type: 'string',
    synonyms: ['contact', 'contact person', 'contact name', 'representative', 'rep', 'الشخص المسؤول', 'جهة الاتصال'] },
  { key: 'phone', label: 'Phone', required: false, type: 'string',
    synonyms: ['phone', 'mobile', 'tel', 'telephone', 'contact no', 'phone no', 'الهاتف', 'الجوال'] },
  { key: 'email', label: 'Email', required: false, type: 'string',
    synonyms: ['email', 'e-mail', 'mail', 'email address', 'البريد الإلكتروني'] },
  { key: 'site', label: 'Site', required: false, type: 'string',
    synonyms: ['site', 'location', 'branch', 'city', 'الموقع', 'الفرع'] },
  { key: 'region', label: 'Region', required: false, type: 'string',
    synonyms: ['region', 'zone', 'territory', 'المنطقة'] },
  { key: 'country', label: 'Country', required: false, type: 'string',
    synonyms: ['country', 'nation', 'country code', 'cc', 'البلد', 'الدولة'] },
  { key: 'rating', label: 'Rating', required: false, type: 'number',
    synonyms: ['rating', 'score', 'rank', 'grade', 'التقييم'] },
  { key: 'status', label: 'Status', required: false, type: 'string',
    synonyms: ['status', 'state', 'active', 'الحالة'] },
]

/* ── Driver master (drivers) ────────────────────────────────────────────────── */

/** @type {CanonicalField[]} */
const DRIVER_FIELDS = [
  { key: 'driver_id', label: 'Driver ID', required: true, type: 'string',
    synonyms: ['driver id', 'driver no', 'employee id', 'emp id', 'employee no', 'badge', 'badge no', 'iqama', 'iqama no', 'staff id', 'رقم السائق', 'رقم الموظف', 'الإقامة'] },
  { key: 'driver_name', label: 'Driver Name', required: true, type: 'string',
    synonyms: ['driver', 'driver name', 'name', 'operator', 'operator name', 'employee name', 'السائق', 'اسم السائق', 'المشغل'] },
  { key: 'license_no', label: 'License No.', required: false, type: 'string',
    synonyms: ['license', 'license no', 'licence', 'licence no', 'driving license', 'dl no', 'رقم الرخصة', 'رخصة القيادة'] },
  { key: 'license_expiry', label: 'License Expiry', required: false, type: 'date',
    synonyms: ['license expiry', 'licence expiry', 'expiry', 'expiry date', 'license expiry date', 'تاريخ انتهاء الرخصة', 'انتهاء الرخصة'] },
  { key: 'phone', label: 'Phone', required: false, type: 'string',
    synonyms: ['phone', 'mobile', 'tel', 'contact no', 'phone no', 'الهاتف', 'الجوال'] },
  { key: 'nationality', label: 'Nationality', required: false, type: 'string',
    synonyms: ['nationality', 'nation', 'citizenship', 'الجنسية'] },
  { key: 'assigned_asset_no', label: 'Assigned Asset', required: false, type: 'string',
    synonyms: ['asset', 'asset no', 'assigned asset', 'vehicle', 'vehicle no', 'assigned vehicle', 'unit', 'المركبة المخصصة', 'رقم المركبة'] },
  { key: 'site', label: 'Site', required: false, type: 'string',
    synonyms: ['site', 'location', 'project', 'branch', 'depot', 'الموقع', 'المشروع'] },
  { key: 'region', label: 'Region', required: false, type: 'string',
    synonyms: ['region', 'zone', 'territory', 'المنطقة'] },
  { key: 'country', label: 'Country', required: false, type: 'string',
    synonyms: ['country', 'nation', 'country code', 'cc', 'البلد', 'الدولة'] },
  { key: 'status', label: 'Status', required: false, type: 'string',
    synonyms: ['status', 'state', 'active', 'الحالة'] },
]

/**
 * Module → canonical field list.
 * @type {Record<string, CanonicalField[]>}
 */
export const MODULE_FIELDS = Object.freeze({
  fleet: FLEET_FIELDS,
  tyre: TYRE_FIELDS,
  stock: STOCK_FIELDS,
  accident: ACCIDENT_FIELDS,
  inspection: INSPECTION_FIELDS,
  workorder: WORKORDER_FIELDS,
  warranty: WARRANTY_FIELDS,
  gatepass: GATEPASS_FIELDS,
  supplier: SUPPLIER_FIELDS,
  driver: DRIVER_FIELDS,
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
 * All synonyms (raw) for a target key within a module - used by fuzzy scoring.
 * @param {string} key
 * @param {'fleet'|'tyre'|'stock'} module
 * @returns {string[]}
 */
export function synonymsFor(key, module) {
  const def = fieldDef(key, module)
  if (!def) return []
  return [def.key, def.label, ...def.synonyms]
}
