// Email templates. Text lives here, per locale; the database only stores a
// template key + data, never HTML. Every value is escaped by the layout.
//
// Each field lists whether an EXTERNAL recipient (insurer, accident mailbox)
// may see it. Driver names, free-text descriptions and money are staff-only.

export type Locale = 'en' | 'ar'
export type Audience = 'staff' | 'external' | 'owner'

export type FieldDef = { key: string; label: Record<Locale, string>; external?: boolean; format?: 'date' | 'datetime' | 'money' | 'count' }

export type TemplateDef = {
  key: string
  subject: Record<Locale, (d: Record<string, unknown>) => string>
  heading: Record<Locale, (d: Record<string, unknown>) => string>
  intro: Record<Locale, (d: Record<string, unknown>) => string>
  fields?: FieldDef[]
  /** Render a list block from data[listKey] (array of strings). */
  listKey?: string
  listTitle?: Record<Locale, string>
  /** Daily digest sections: data.sections = [{ key, count, items: string[] }]. */
  sections?: boolean
  cta: Record<Locale, string>
  /** Optional mandatory notice shown under the button. */
  note?: Record<Locale, string>
  /** Can the person turn this email off? Assignments and accidents cannot. */
  optional: boolean
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const ref = (d: Record<string, unknown>) => s(d.reference_no) || s(d.asset_no)

const STAGES: Record<string, Record<Locale, string>> = {
  reported: { en: 'Reported', ar: 'تم الإبلاغ' },
  initial_review: { en: 'Initial review', ar: 'المراجعة الأولية' },
  hse_investigation: { en: 'HSE investigation', ar: 'تحقيق السلامة' },
  workshop_assessment: { en: 'Workshop assessment', ar: 'تقييم الورشة' },
  insurance_claim: { en: 'Insurance claim', ar: 'مطالبة التأمين' },
  repair_approval: { en: 'Repair approval', ar: 'اعتماد الإصلاح' },
  repair_in_progress: { en: 'Repair in progress', ar: 'الإصلاح جارٍ' },
  final_inspection: { en: 'Final inspection', ar: 'الفحص النهائي' },
  vehicle_release: { en: 'Vehicle release', ar: 'تسليم المركبة' },
  cost_recovery: { en: 'Cost recovery', ar: 'استرداد التكلفة' },
  closed: { en: 'Closed', ar: 'مغلقة' },
}
export function stageLabel(stage: unknown, locale: Locale): string {
  const k = s(stage).toLowerCase()
  return STAGES[k]?.[locale] ?? s(stage)
}
const SEVERITY: Record<string, Record<Locale, string>> = {
  minor: { en: 'Minor', ar: 'بسيطة' }, moderate: { en: 'Moderate', ar: 'متوسطة' },
  severe: { en: 'Major', ar: 'كبيرة' }, fatal: { en: 'Fatal', ar: 'مميتة' },
}
export function severityLabel(v: unknown, locale: Locale): string {
  const k = s(v).toLowerCase()
  return SEVERITY[k]?.[locale] ?? s(v)
}

const STEPS: Record<string, Record<Locale, string>> = {
  incident_evidence: { en: 'Incident evidence', ar: 'أدلة الحادث' },
  fleet_validation: { en: 'Fleet validation', ar: 'تحقق الأسطول' },
  liability: { en: 'Liability', ar: 'المسؤولية' },
  insurance: { en: 'Insurance claim', ar: 'مطالبة التأمين' },
  assessment: { en: 'Workshop assessment', ar: 'تقييم الورشة' },
  repair: { en: 'Repair', ar: 'الإصلاح' },
  handover: { en: 'Vehicle handover', ar: 'تسليم المركبة' },
  finance: { en: 'Finance and cost recovery', ar: 'المالية واسترداد التكلفة' },
  closure: { en: 'Case closure', ar: 'إغلاق الحالة' },
}
export function stepLabel(step: unknown, locale: Locale): string {
  const k = s(step).toLowerCase()
  return STEPS[k]?.[locale] ?? s(step).replace(/_/g, ' ')
}

const accidentFields: FieldDef[] = [
  { key: 'reference_no', label: { en: 'Reference', ar: 'المرجع' }, external: true },
  { key: 'asset_no', label: { en: 'Vehicle', ar: 'المركبة' }, external: true },
  { key: 'site', label: { en: 'Site', ar: 'الموقع' }, external: true },
  { key: 'severity_label', label: { en: 'Severity', ar: 'الخطورة' }, external: true },
  { key: 'stage_label', label: { en: 'Stage', ar: 'المرحلة' }, external: true },
  { key: 'incident_date', label: { en: 'Incident date', ar: 'تاريخ الحادث' }, external: true, format: 'date' },
  { key: 'driver_name', label: { en: 'Driver', ar: 'السائق' } },
  { key: 'description', label: { en: 'What happened', ar: 'ماذا حدث' } },
  { key: 'action', label: { en: 'Next action', ar: 'الإجراء التالي' } },
]

export const TEMPLATES: Record<string, TemplateDef> = {
  'accident.reported': {
    key: 'accident.reported',
    optional: false,
    subject: {
      en: d => `New accident ${ref(d)} at ${s(d.site)}`,
      ar: d => `حادث جديد ${ref(d)} في ${s(d.site)}`,
    },
    heading: { en: () => 'A new accident was reported', ar: () => 'تم الإبلاغ عن حادث جديد' },
    intro: {
      en: d => `Vehicle ${s(d.asset_no)} was in an accident. Please review the case and take the first step.`,
      ar: d => `تعرضت المركبة ${s(d.asset_no)} لحادث. يرجى مراجعة الحالة واتخاذ الخطوة الأولى.`,
    },
    fields: accidentFields,
    cta: { en: 'Open the accident', ar: 'فتح الحادث' },
  },
  'accident.update': {
    key: 'accident.update',
    optional: false,
    subject: {
      en: d => `Accident ${ref(d)}: ${s(d.stage_label)}`,
      ar: d => `الحادث ${ref(d)}: ${s(d.stage_label)}`,
    },
    heading: { en: d => `Accident ${ref(d)} moved to ${s(d.stage_label)}`, ar: d => `انتقل الحادث ${ref(d)} إلى ${s(d.stage_label)}` },
    intro: {
      en: () => 'The case was updated. The details below show where it stands now.',
      ar: () => 'تم تحديث الحالة. توضح التفاصيل أدناه وضعها الحالي.',
    },
    fields: accidentFields,
    cta: { en: 'Open the accident', ar: 'فتح الحادث' },
  },
  'accident.escalation': {
    key: 'accident.escalation',
    optional: false,
    subject: {
      en: d => `Overdue: accident ${ref(d)} needs action`,
      ar: d => `متأخر: الحادث ${ref(d)} يحتاج إلى إجراء`,
    },
    heading: { en: d => `Accident ${ref(d)} is overdue`, ar: d => `الحادث ${ref(d)} متأخر` },
    intro: {
      en: d => (s(d.reason) === 'vor_sla_breach'
        ? `Vehicle ${s(d.asset_no)} has been off the road longer than allowed.`
        : 'This case has passed its target date without moving forward.'),
      ar: d => (s(d.reason) === 'vor_sla_breach'
        ? `المركبة ${s(d.asset_no)} خارج الخدمة لمدة أطول من المسموح.`
        : 'تجاوزت هذه الحالة تاريخها المستهدف دون أي تقدم.'),
    },
    fields: accidentFields,
    cta: { en: 'Open the accident', ar: 'فتح الحادث' },
  },
  'assignment.new': {
    key: 'assignment.new',
    optional: false,
    subject: { en: d => `Assigned to you: ${s(d.title)}`, ar: d => `مُسند إليك: ${s(d.title)}` },
    heading: { en: d => s(d.title) || 'New work for you', ar: d => s(d.title) || 'عمل جديد لك' },
    intro: {
      en: d => s(d.body) || 'Something was assigned to you in Tyre Pulse.',
      ar: d => s(d.body) || 'تم إسناد مهمة إليك في Tyre Pulse.',
    },
    fields: [
      { key: 'item_label', label: { en: 'Item', ar: 'العنصر' } },
      { key: 'site', label: { en: 'Site', ar: 'الموقع' } },
      { key: 'due_at', label: { en: 'Due', ar: 'الموعد' }, format: 'datetime' },
    ],
    cta: { en: 'Open in Tyre Pulse', ar: 'فتح في Tyre Pulse' },
  },
  'accident.step_assigned': {
    key: 'accident.step_assigned',
    optional: false,
    subject: {
      en: d => `Accident ${ref(d)}: a step is assigned to you`,
      ar: d => `الحادث ${ref(d)}: أُسندت إليك خطوة`,
    },
    heading: { en: d => `You own work on accident ${ref(d)}`, ar: d => `لديك عمل في الحادث ${ref(d)}` },
    intro: {
      en: d => `Vehicle ${s(d.asset_no)} at ${s(d.site)}. Please open the case and complete your step.`,
      ar: d => `المركبة ${s(d.asset_no)} في ${s(d.site)}. يرجى فتح الحالة وإكمال خطوتك.`,
    },
    fields: [
      { key: 'reference_no', label: { en: 'Reference', ar: 'المرجع' } },
      { key: 'asset_no', label: { en: 'Vehicle', ar: 'المركبة' } },
      { key: 'site', label: { en: 'Site', ar: 'الموقع' } },
      { key: 'severity_label', label: { en: 'Severity', ar: 'الخطورة' } },
      { key: 'stage_label', label: { en: 'Stage', ar: 'المرحلة' } },
      { key: 'incident_date', label: { en: 'Incident date', ar: 'تاريخ الحادث' }, format: 'date' },
    ],
    listKey: 'step_labels',
    listTitle: { en: 'Your steps on this case', ar: 'خطواتك في هذه الحالة' },
    cta: { en: 'Open the accident', ar: 'فتح الحادث' },
  },
  'workshop.waiting': {
    key: 'workshop.waiting',
    optional: false,
    subject: {
      en: d => (Number(d.count) === 1 ? '1 vehicle is waiting for you to confirm' : `${s(d.count)} vehicles are waiting for you to confirm`),
      ar: d => (Number(d.count) === 1 ? 'مركبة واحدة بانتظار تأكيدك' : `${s(d.count)} مركبات بانتظار تأكيدك`),
    },
    heading: { en: () => 'Vehicles are waiting at your workshop', ar: () => 'مركبات بانتظارك في الورشة' },
    intro: {
      en: () => 'These vehicles were sent to your workshop and need you to confirm them in Tyre Pulse.',
      ar: () => 'أُرسلت هذه المركبات إلى ورشتك وتحتاج إلى تأكيدك في Tyre Pulse.',
    },
    listKey: 'assets',
    listTitle: { en: 'Waiting vehicles', ar: 'المركبات المنتظرة' },
    cta: { en: 'Confirm the vehicles', ar: 'تأكيد المركبات' },
  },
  'summary.daily': {
    key: 'summary.daily',
    optional: true,
    subject: { en: d => `Tyre Pulse summary for ${s(d.summary_label)}`, ar: d => `ملخص Tyre Pulse ليوم ${s(d.summary_label)}` },
    heading: { en: () => 'Your morning summary', ar: () => 'ملخصك الصباحي' },
    intro: {
      en: d => `What happened yesterday (${s(d.summary_label)}) at your sites, and what is waiting now.`,
      ar: d => `ما حدث أمس (${s(d.summary_label)}) في مواقعك، وما ينتظر الآن.`,
    },
    fields: [
      { key: 'inspections_done', label: { en: 'Inspections done yesterday', ar: 'الفحوصات المنجزة أمس' }, format: 'count' },
      { key: 'accidents_reported', label: { en: 'Accidents reported yesterday', ar: 'الحوادث المبلغ عنها أمس' }, format: 'count' },
      { key: 'workshop_in', label: { en: 'Vehicles into the workshop yesterday', ar: 'المركبات الداخلة إلى الورشة أمس' }, format: 'count' },
      { key: 'workshop_released', label: { en: 'Vehicles released yesterday', ar: 'المركبات المُفرج عنها أمس' }, format: 'count' },
      { key: 'tyres_attention', label: { en: 'Tyres needing attention now', ar: 'إطارات تحتاج إلى متابعة الآن' }, format: 'count' },
      { key: 'approvals_waiting', label: { en: 'Approvals waiting now', ar: 'موافقات بانتظار القرار الآن' }, format: 'count' },
    ],
    cta: { en: 'Open Tyre Pulse', ar: 'فتح Tyre Pulse' },
  },
  'reminder.escalation': {
    key: 'reminder.escalation',
    optional: false,
    subject: {
      en: d => `${s(d.count)} unanswered item(s) for ${s(d.person_name)}`,
      ar: d => `${s(d.count)} عنصر دون رد لدى ${s(d.person_name)}`,
    },
    heading: { en: () => 'Assigned work is waiting', ar: () => 'عمل مُسند بانتظار الرد' },
    intro: {
      en: d => `${s(d.person_name)} has not opened the items below after three reminders. Please follow up.`,
      ar: d => `لم يفتح ${s(d.person_name)} العناصر أدناه بعد ثلاثة تذكيرات. يرجى المتابعة.`,
    },
    listKey: 'items',
    listTitle: { en: 'Waiting items', ar: 'العناصر المنتظرة' },
    cta: { en: 'Open Tyre Pulse', ar: 'فتح Tyre Pulse' },
  },
  'user.signup_pending': {
    key: 'user.signup_pending',
    optional: false,
    subject: { en: d => `New sign-up waiting for approval: ${s(d.full_name) || s(d.username)}`, ar: d => `تسجيل جديد بانتظار الموافقة: ${s(d.full_name) || s(d.username)}` },
    heading: { en: () => 'Someone is waiting to join', ar: () => 'شخص ينتظر الانضمام' },
    intro: {
      en: () => 'A new account was created and cannot use Tyre Pulse until an administrator approves it.',
      ar: () => 'تم إنشاء حساب جديد ولا يمكنه استخدام Tyre Pulse حتى يوافق عليه أحد المسؤولين.',
    },
    fields: [
      { key: 'full_name', label: { en: 'Name', ar: 'الاسم' } },
      { key: 'username', label: { en: 'Username', ar: 'اسم المستخدم' } },
      { key: 'role', label: { en: 'Requested role', ar: 'الدور المطلوب' } },
      { key: 'country', label: { en: 'Country', ar: 'الدولة' } },
      { key: 'signed_up_at', label: { en: 'Signed up', ar: 'تاريخ التسجيل' }, format: 'datetime' },
    ],
    cta: { en: 'Review sign-ups', ar: 'مراجعة التسجيلات' },
  },
  'website.enquiry': {
    key: 'website.enquiry',
    optional: false,
    subject: { en: d => `Website enquiry from ${s(d.name)}${d.company ? `, ${s(d.company)}` : ''}`, ar: d => `استفسار من الموقع: ${s(d.name)}` },
    heading: { en: () => 'New enquiry from tyrepulse.app', ar: () => 'استفسار جديد من tyrepulse.app' },
    intro: {
      en: () => 'Someone filled in the contact form. Reply to them directly; they have not received an automatic answer.',
      ar: () => 'قام شخص بتعبئة نموذج التواصل. يرجى الرد عليه مباشرة؛ لم يتلقَّ ردًا تلقائيًا.',
    },
    fields: [
      { key: 'name', label: { en: 'Name', ar: 'الاسم' } },
      { key: 'company', label: { en: 'Company', ar: 'الشركة' } },
      { key: 'email', label: { en: 'Email', ar: 'البريد الإلكتروني' } },
      { key: 'phone', label: { en: 'Phone', ar: 'الهاتف' } },
      { key: 'fleet_size', label: { en: 'Fleet size', ar: 'حجم الأسطول' } },
      { key: 'message', label: { en: 'Message', ar: 'الرسالة' } },
    ],
    cta: { en: 'Open Tyre Pulse', ar: 'فتح Tyre Pulse' },
  },
  'digest.daily': {
    key: 'digest.daily',
    optional: true,
    subject: { en: d => `Today in Tyre Pulse: ${s(d.total)} item(s) need attention`, ar: d => `اليوم في Tyre Pulse: ${s(d.total)} عنصر يحتاج إلى متابعة` },
    heading: { en: () => 'Your morning summary', ar: () => 'ملخصك الصباحي' },
    intro: {
      en: () => 'These are the open problems for your sites this morning.',
      ar: () => 'هذه هي المشكلات المفتوحة في مواقعك هذا الصباح.',
    },
    sections: true,
    cta: { en: 'Open Tyre Pulse', ar: 'فتح Tyre Pulse' },
  },
  test: {
    key: 'test',
    optional: true,
    subject: { en: () => 'Tyre Pulse test email', ar: () => 'رسالة تجريبية من Tyre Pulse' },
    heading: { en: () => 'Email delivery works', ar: () => 'إرسال البريد يعمل' },
    intro: {
      en: () => 'This is a test from your Tyre Pulse email settings. No action is needed.',
      ar: () => 'هذه رسالة تجريبية من إعدادات البريد في Tyre Pulse. لا يلزم أي إجراء.',
    },
    cta: { en: 'Open Tyre Pulse', ar: 'فتح Tyre Pulse' },
  },
}

export const DIGEST_SECTIONS: Record<string, Record<Locale, string>> = {
  missed_upload: { en: 'Missed uploads', ar: 'تحميلات فائتة' },
  maintenance_due: { en: 'Maintenance due', ar: 'صيانة مستحقة' },
  tyres_due: { en: 'Tyres due', ar: 'إطارات مستحقة' },
  low_stock: { en: 'Low stock', ar: 'مخزون منخفض' },
  workshop_delays: { en: 'Workshop delays', ar: 'تأخيرات الورشة' },
  driver_concerns: { en: 'Driver concerns', ar: 'ملاحظات السائقين' },
  documents_due: { en: 'Documents expiring', ar: 'وثائق قاربت على الانتهاء' },
  other: { en: 'Other', ar: 'أخرى' },
}

export const COMMON: Record<string, Record<Locale, string>> = {
  manage: { en: 'Manage settings', ar: 'إدارة الإعدادات' },
  play: { en: 'Get it on Google Play', ar: 'متوفر على Google Play' },
  appstore: { en: 'Download on the App Store', ar: 'حمّله من App Store' },
  mandatory: {
    en: 'You receive this because work was assigned to you or your team. These alerts cannot be turned off.',
    ar: 'تصلك هذه الرسالة لأن عملًا أُسند إليك أو إلى فريقك. لا يمكن إيقاف هذه التنبيهات.',
  },
  optional: {
    en: 'You can turn the daily summary off in your notification settings.',
    ar: 'يمكنك إيقاف الملخص اليومي من إعدادات الإشعارات.',
  },
  footer: { en: 'Sent by Tyre Pulse. Replies go to info@tyrepulse.app.', ar: 'أُرسلت من Tyre Pulse. الردود تصل إلى info@tyrepulse.app.' },
  more: { en: 'and {n} more', ar: 'و{n} أخرى' },
  unreadable: { en: 'Could not be read', ar: 'تعذرت القراءة' },
}
