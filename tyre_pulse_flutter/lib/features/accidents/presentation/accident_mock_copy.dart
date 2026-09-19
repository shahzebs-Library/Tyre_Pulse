/// Copy for the M3 and M6 mock-matched case workspaces and the shared
/// workstream header, in English, Arabic and Urdu.
///
/// Kept feature-local like the neighbouring `_copy` maps so the mock's exact
/// English survives while the ARB catalog is not regenerated. No entry names
/// a person, and no entry contains an em or en dash.
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

final class AccidentMockCopy {
  factory AccidentMockCopy.of(BuildContext context) {
    final String language = Localizations.localeOf(context).languageCode;
    return AccidentMockCopy._(
      language == 'ar'
          ? 1
          : language == 'ur'
              ? 2
              : 0,
    );
  }

  const AccidentMockCopy._(this._index);

  final int _index;

  String call(String key) {
    final List<String>? values = _strings[key];
    if (values == null) return key;
    final String value = values[_index];
    return value.isEmpty ? values.first : value;
  }

  /// Substitutes `%a`, `%b`, `%n`, `%d` and `%owner` placeholders.
  String fill(String key, Map<String, String> values) {
    String text = call(key);
    for (final MapEntry<String, String> entry in values.entries) {
      text = text.replaceAll('%${entry.key}', entry.value);
    }
    return text;
  }
}

/// `severe`/`major`/`fatal` read Major accident; `moderate` and `minor` keep
/// their own word; anything unrecorded says so.
String accidentSeverityBadge(AccidentMockCopy copy, String? severity) {
  final String token = severity?.trim().toLowerCase() ?? '';
  if (token.isEmpty) return copy('severityNotSet');
  if (token.contains('severe') ||
      token.contains('major') ||
      token.contains('fatal') ||
      token.contains('total')) {
    return copy('severityMajor');
  }
  if (token.contains('moderate')) return copy('severityModerate');
  if (token.contains('minor')) return copy('severityMinor');
  return humaniseAccidentToken(token);
}

/// The bare level ("Major", not "Major accident") for the M6 notification
/// priority row, which the mock prints beside the badge that already carries
/// the full wording.
String accidentSeverityLevel(AccidentMockCopy copy, String? severity) {
  final String token = severity?.trim().toLowerCase() ?? '';
  if (token.isEmpty) return copy('severityNotSet');
  if (token.contains('severe') ||
      token.contains('major') ||
      token.contains('fatal') ||
      token.contains('total')) {
    return copy('severityLevelMajor');
  }
  return accidentSeverityBadge(copy, severity);
}

bool accidentIsClosed(AccidentRecord record) {
  final String status = <String?>[
    record.caseStatus,
    record.closureStatus,
    record.status,
    record.currentStatus,
  ]
      .map((String? value) => value?.trim().toLowerCase() ?? '')
      .firstWhere((String value) => value.isNotEmpty, orElse: () => '');
  return status == 'closed' ||
      status == 'legacy_closed' ||
      status == 'fully_closed';
}

/// "team / owner role" from a workstream row, else the case-flow team for
/// that step, else Not set. Never a person's name.
String accidentWorkstreamOwner(
  AccidentMockCopy copy,
  List<AccidentWorkstream> workstreams,
  String workstreamKey,
) {
  for (final AccidentWorkstream row in workstreams) {
    if (row.key != workstreamKey) continue;
    final String owner = <String?>[row.team, row.ownerRole]
        .map((String? value) => value?.trim() ?? '')
        .where((String value) => value.isNotEmpty)
        .join(' / ');
    if (owner.isNotEmpty) return owner;
  }
  final String fallback = caseFlowStep(workstreamKey)?.owner ?? '';
  return fallback.isEmpty ? copy('notSet') : fallback;
}

AccidentWorkstream? accidentWorkstreamRow(
  List<AccidentWorkstream> workstreams,
  String workstreamKey,
) {
  for (final AccidentWorkstream row in workstreams) {
    if (row.key == workstreamKey) return row;
  }
  return null;
}

String accidentClock(BuildContext context, DateTime value) => DateFormat.Hm(
      Localizations.localeOf(context).toLanguageTag(),
    ).format(value.toLocal());

String accidentDayClock(BuildContext context, DateTime value) {
  final String locale = Localizations.localeOf(context).toLanguageTag();
  final DateTime local = value.toLocal();
  return '${DateFormat('d MMM', locale).format(local)} '
      '${DateFormat.Hm(locale).format(local)}';
}

/// "1h 18m" or "42m". Negative spans are reported as their magnitude; the
/// caller decides whether that means remaining or overdue.
String accidentShortDuration(Duration value) {
  final int minutes = value.inMinutes.abs();
  final int hours = minutes ~/ 60;
  final int rest = minutes % 60;
  if (hours <= 0) return '${rest}m';
  return '${hours}h ${rest.toString().padLeft(2, '0')}m';
}

String accidentPctText(num? value) {
  if (value == null || !value.isFinite) return '';
  final num rounded = value == value.roundToDouble() ? value.round() : value;
  return '$rounded%';
}

const Map<String, List<String>> _strings = <String, List<String>>{
  // Shared
  'notSet': <String>['Not set', 'غير محدد', 'مقرر نہیں'],
  'yes': <String>['Yes', 'نعم', 'ہاں'],
  'no': <String>['No', 'لا', 'نہیں'],
  'open': <String>['Open', 'مفتوح', 'کھلا'],
  'closed': <String>['Closed', 'مغلق', 'بند'],
  'cancel': <String>['Cancel', 'إلغاء', 'منسوخ کریں'],
  'done': <String>['Done', 'تم', 'مکمل'],
  'edit': <String>['Edit', 'تعديل', 'ترمیم'],
  'loading': <String>['Loading', 'جارٍ التحميل', 'لوڈ ہو رہا ہے'],
  'loggedOnTimeline': <String>[
    'Logged on the case timeline',
    'تم التسجيل في الجدول الزمني للحالة',
    'کیس ٹائم لائن پر درج کر دیا گیا',
  ],
  'insurance': <String>['Insurance', 'التأمين', 'انشورنس'],
  'notProvisionedShort': <String>[
    'Not provisioned yet',
    'غير مفعّل بعد',
    'ابھی فراہم نہیں کیا گیا',
  ],

  // Header
  'workstreamOf': <String>[
    'Workstream %n of %t',
    'مسار العمل %n من %t',
    'ورک اسٹریم %n از %t',
  ],
  'ownerLabel': <String>['Owner', 'المالك', 'مالک'],
  'received': <String>['Received', 'تم الاستلام', 'موصول'],
  'withTeam': <String>['With', 'لدى', 'کے پاس'],
  'slaRemaining': <String>[
    'SLA %d remaining',
    'المتبقي في اتفاقية الخدمة %d',
    'SLA میں %d باقی',
  ],
  'slaOverdue': <String>[
    'SLA overdue by %d',
    'تجاوز اتفاقية الخدمة بمقدار %d',
    'SLA %d سے تاخیر',
  ],
  'slaPaused': <String>['SLA paused', 'اتفاقية الخدمة متوقفة', 'SLA روکا گیا'],
  'slaMet': <String>['SLA met', 'تم الوفاء باتفاقية الخدمة', 'SLA پورا ہوا'],
  'slaBreached': <String>[
    'SLA breached',
    'تم خرق اتفاقية الخدمة',
    'SLA کی خلاف ورزی',
  ],
  'slaCancelled': <String>[
    'SLA cancelled',
    'تم إلغاء اتفاقية الخدمة',
    'SLA منسوخ',
  ],
  'slaDueNotSet': <String>[
    'SLA due time not set',
    'لم يُحدد موعد اتفاقية الخدمة',
    'SLA کا مقررہ وقت طے نہیں',
  ],
  'noSla': <String>[
    'No SLA started',
    'لم تبدأ اتفاقية خدمة',
    'کوئی SLA شروع نہیں ہوا',
  ],
  'checkingSla': <String>[
    'Checking SLA',
    'جارٍ التحقق من اتفاقية الخدمة',
    'SLA چیک ہو رہا ہے',
  ],
  'slaUnavailable': <String>[
    'SLA unavailable',
    'اتفاقية الخدمة غير متاحة',
    'SLA دستیاب نہیں',
  ],
  'slaNotProvisioned': <String>[
    'SLA tracking not provisioned yet',
    'تتبع اتفاقية الخدمة غير مفعّل بعد',
    'SLA ٹریکنگ ابھی فراہم نہیں',
  ],

  // M6 severity + summary
  'severityMajor': <String>['Major accident', 'حادث جسيم', 'بڑا حادثہ'],
  'severityLevelMajor': <String>['Major', 'جسيم', 'بڑا'],
  'severityModerate': <String>['Moderate', 'متوسط', 'درمیانہ'],
  'severityMinor': <String>['Minor', 'بسيط', 'معمولی'],
  'severityNotSet': <String>[
    'Severity not set',
    'الخطورة غير محددة',
    'شدت مقرر نہیں',
  ],
  'incidentSummary': <String>[
    'Incident summary',
    'ملخص الحادث',
    'واقعے کا خلاصہ',
  ],
  'type': <String>['Type', 'النوع', 'قسم'],
  'driver': <String>['Driver', 'السائق', 'ڈرائیور'],
  'location': <String>['Location', 'الموقع', 'مقام'],
  'damageAndPhotos': <String>[
    '%a marked damage areas · %b photos',
    '%a مناطق ضرر محددة · %b صور',
    '%a نشان زدہ نقصان کے حصے · %b تصاویر',
  ],
  'noInjuries': <String>['No injuries', 'لا إصابات', 'کوئی زخمی نہیں'],
  'injuriesReported': <String>[
    'Injuries reported',
    'تم الإبلاغ عن إصابات',
    'زخمیوں کی اطلاع',
  ],
  'injuriesNotSet': <String>[
    'Injuries not set',
    'الإصابات غير محددة',
    'زخمی مقرر نہیں',
  ],
  'thirdPartyInvolved': <String>[
    'Third party involved',
    'طرف ثالث مشارك',
    'تیسرا فریق شامل',
  ],
  'noThirdParty': <String>[
    'No third party',
    'لا طرف ثالث',
    'کوئی تیسرا فریق نہیں',
  ],
  'thirdPartyNotSet': <String>[
    'Third party not set',
    'الطرف الثالث غير محدد',
    'تیسرا فریق مقرر نہیں',
  ],
  'viewReport': <String>[
    'View complete incident report',
    'عرض تقرير الحادث الكامل',
    'مکمل واقعہ رپورٹ دیکھیں',
  ],
  'viewReportNote': <String>[
    'Opens the incident record. A PDF export is not available in this app yet.',
    'يفتح سجل الحادث. تصدير PDF غير متاح في هذا التطبيق بعد.',
    'واقعے کا ریکارڈ کھولتا ہے۔ PDF برآمد ابھی اس ایپ میں دستیاب نہیں۔',
  ],

  // M6 checklist
  'checklist': <String>[
    'Fleet validation checklist',
    'قائمة التحقق للأسطول',
    'فلیٹ تصدیق کی فہرست',
  ],
  'stateDone': <String>['Done', 'تم', 'مکمل'],
  'statePending': <String>['Pending', 'قيد الانتظار', 'زیر التوا'],
  'stateAttention': <String>[
    'Needs attention',
    'يحتاج إلى انتباه',
    'توجہ درکار',
  ],
  'stateNotApplicable': <String>[
    'Not applicable',
    'لا ينطبق',
    'لاگو نہیں',
  ],
  'countOf': <String>['%a of %b', '%a من %b', '%b میں سے %a'],
  'missingCount': <String>['%n missing', '%n مفقود', '%n غائب'],
  'complete': <String>['Complete', 'مكتمل', 'مکمل'],
  'photosOnRecord': <String>[
    '%n photos on record',
    '%n صور مسجلة',
    '%n تصاویر ریکارڈ پر',
  ],
  'addNote': <String>['Add note', 'إضافة ملاحظة', 'نوٹ شامل کریں'],
  'editNote': <String>['Edit note', 'تعديل الملاحظة', 'نوٹ میں ترمیم'],
  'note': <String>['Note', 'ملاحظة', 'نوٹ'],
  'saveNote': <String>['Save note', 'حفظ الملاحظة', 'نوٹ محفوظ کریں'],
  'openRelated': <String>['Open', 'فتح', 'کھولیں'],
  'markDone': <String>['Mark done', 'وضع علامة تم', 'مکمل نشان زد کریں'],
  'markPending': <String>[
    'Mark pending',
    'وضع علامة قيد الانتظار',
    'زیر التوا نشان زد کریں',
  ],
  'checklistNotProvisioned': <String>[
    'Checklist tracking is not provisioned yet. Items are shown from the '
        'case record and cannot be ticked until the database is updated.',
    'تتبع قائمة التحقق غير مفعّل بعد. تُعرض البنود من سجل الحالة ولا يمكن '
        'تحديدها حتى يتم تحديث قاعدة البيانات.',
    'چیک لسٹ ٹریکنگ ابھی فراہم نہیں۔ آئٹمز کیس ریکارڈ سے دکھائے جاتے ہیں اور '
        'ڈیٹا بیس اپ ڈیٹ ہونے تک ٹک نہیں کیے جا سکتے۔',
  ],

  // M6 notify
  'notifyTitle': <String>[
    'Notify Insurance / Claims',
    'إشعار التأمين / المطالبات',
    'انشورنس / کلیمز کو مطلع کریں',
  ],
  'assignedRecipient': <String>[
    'Assigned recipient',
    'المستلم المعيّن',
    'مقرر کردہ وصول کنندہ',
  ],
  'packageIncludes': <String>[
    'Detailed package includes',
    'تتضمن الحزمة التفصيلية',
    'تفصیلی پیکج میں شامل',
  ],
  'packageList': <String>[
    'Incident report, asset details, damage locations, photos, '
        'police / Najm documents',
    'تقرير الحادث، تفاصيل الأصل، مواقع الضرر، الصور، وثائق الشرطة / نجم',
    'واقعہ رپورٹ، اثاثے کی تفصیلات، نقصان کے مقامات، تصاویر، '
        'پولیس / نجم دستاویزات',
  ],
  'priority': <String>[
    'Notification priority',
    'أولوية الإشعار',
    'اطلاع کی ترجیح',
  ],
  'sendWhenComplete': <String>[
    'Send when required documents complete',
    'الإرسال عند اكتمال المستندات المطلوبة',
    'مطلوبہ دستاویزات مکمل ہونے پر بھیجیں',
  ],
  'najmMissingWarning': <String>[
    'Najm report is missing. Claim registration cannot start.',
    'تقرير نجم مفقود. لا يمكن بدء تسجيل المطالبة.',
    'نجم رپورٹ غائب ہے۔ کلیم رجسٹریشن شروع نہیں ہو سکتی۔',
  ],
  'policeMissingWarning': <String>[
    'Police report is missing. Claim registration cannot start.',
    'تقرير الشرطة مفقود. لا يمكن بدء تسجيل المطالبة.',
    'پولیس رپورٹ غائب ہے۔ کلیم رجسٹریشن شروع نہیں ہو سکتی۔',
  ],
  'requestMissingDocument': <String>[
    'Request missing document',
    'طلب المستند المفقود',
    'غائب دستاویز کی درخواست',
  ],
  'sendAvailableNow': <String>[
    'Send available details now',
    'إرسال التفاصيل المتاحة الآن',
    'دستیاب تفصیلات ابھی بھیجیں',
  ],
  'monitoringSla': <String>[
    '%owner is monitoring SLA',
    '%owner يراقب اتفاقية الخدمة',
    '%owner SLA کی نگرانی کر رہا ہے',
  ],
  'completeAndNotify': <String>[
    'Complete Fleet validation and notify %owner',
    'إكمال تحقق الأسطول وإشعار %owner',
    'فلیٹ تصدیق مکمل کریں اور %owner کو مطلع کریں',
  ],
  'saveProgress': <String>['Save progress', 'حفظ التقدم', 'پیش رفت محفوظ کریں'],
  'progressSaved': <String>['Progress saved', 'تم حفظ التقدم', 'پیش رفت محفوظ'],
  'validationCompleted': <String>[
    'Fleet validation completed',
    'اكتمل تحقق الأسطول',
    'فلیٹ تصدیق مکمل',
  ],
  'requestSubject': <String>[
    'Missing document requested',
    'تم طلب المستند المفقود',
    'غائب دستاویز کی درخواست کی گئی',
  ],
  'sendSubject': <String>[
    'Available case details sent',
    'تم إرسال تفاصيل الحالة المتاحة',
    'دستیاب کیس تفصیلات بھیجی گئیں',
  ],
  'completeSubject': <String>[
    'Fleet validation completed',
    'اكتمل تحقق الأسطول',
    'فلیٹ تصدیق مکمل',
  ],

  // M3
  'draftSaved': <String>[
    'Draft saved on device',
    'تم حفظ المسودة على الجهاز',
    'ڈرافٹ ڈیوائس پر محفوظ',
  ],
  'insuranceReview': <String>[
    'Insurance review',
    'مراجعة التأمين',
    'انشورنس جائزہ',
  ],
  'whoAtFault': <String>['Who was at fault?', 'من المتسبب؟', 'قصور کس کا تھا؟'],
  'faultStatus': <String>['Fault status', 'حالة الخطأ', 'قصور کی حیثیت'],
  'gccLiability': <String>[
    'GCC liability %',
    'نسبة مسؤولية GCC %',
    'GCC ذمہ داری %',
  ],
  'otherLiability': <String>[
    'Other-party liability %',
    'نسبة مسؤولية الطرف الآخر %',
    'دوسرے فریق کی ذمہ داری %',
  ],
  'provisionalNote': <String>[
    'Provisional until authority/insurer confirmation.',
    'مبدئي حتى تأكيد الجهة المختصة/شركة التأمين.',
    'اتھارٹی/انشورر کی تصدیق تک عارضی۔',
  ],
  'whoWillPay': <String>['Who will pay?', 'من سيدفع؟', 'ادائیگی کون کرے گا؟'],
  'faultParty': <String>['Fault party', 'الطرف المتسبب', 'قصوروار فریق'],
  'payer': <String>['Payer', 'الدافع', 'ادا کنندہ'],
  'responsibleCompany': <String>[
    'Responsible company',
    'الشركة المسؤولة',
    'ذمہ دار کمپنی',
  ],
  'recoveryRequired': <String>[
    'Recovery required',
    'الاسترداد مطلوب',
    'ریکوری درکار',
  ],
  'auto': <String>['Auto', 'تلقائي', 'خودکار'],
  'override': <String>['Override', 'تجاوز', 'اوور رائیڈ'],
  'authorityTitle': <String>[
    'Third-party and authority details',
    'تفاصيل الطرف الثالث والجهات المختصة',
    'تیسرے فریق اور اتھارٹی کی تفصیلات',
  ],
  'value': <String>['Value', 'القيمة', 'قدر'],
  'recordedBy': <String>['Recorded by', 'سُجّل بواسطة', 'ریکارڈ کنندہ'],
  'verification': <String>['Verification', 'التحقق', 'تصدیق'],
  'verified': <String>['Verified', 'تم التحقق', 'تصدیق شدہ'],
  'pending': <String>['Pending', 'قيد الانتظار', 'زیر التوا'],
  'missing': <String>['Missing', 'مفقود', 'غائب'],
  'none': <String>['None', 'لا يوجد', 'کوئی نہیں'],
  'docsTitle': <String>[
    'Responsibility documents',
    'مستندات المسؤولية',
    'ذمہ داری کی دستاویزات',
  ],
  'document': <String>['Document', 'المستند', 'دستاویز'],
  'status': <String>['Status', 'الحالة', 'حیثیت'],
  'uploader': <String>['Uploader', 'الرافع', 'اپ لوڈر'],
  'time': <String>['Time', 'الوقت', 'وقت'],
  'requiredDocs': <String>[
    '%a of %b required documents',
    '%a من %b مستندات مطلوبة',
    '%b مطلوبہ دستاویزات میں سے %a',
  ],
  'uploaded': <String>['Uploaded', 'تم الرفع', 'اپ لوڈ شدہ'],
  'optional': <String>['Optional', 'اختياري', 'اختیاری'],
  'upload': <String>['Upload', 'رفع', 'اپ لوڈ'],
  'takePhoto': <String>['Take photo', 'التقاط صورة', 'تصویر لیں'],
  'chooseFile': <String>[
    'Choose from gallery',
    'اختيار من المعرض',
    'گیلری سے منتخب کریں',
  ],
  'you': <String>['You', 'أنت', 'آپ'],
  'anotherUser': <String>['Another user', 'مستخدم آخر', 'دوسرا صارف'],
  'unverified': <String>['Unverified', 'غير محقق', 'غیر تصدیق شدہ'],
  'rejected': <String>['Rejected', 'مرفوض', 'مسترد'],
  'uploadFailed': <String>[
    'The document could not be uploaded. It is not recorded on the case.',
    'تعذر رفع المستند. لم يُسجل في الحالة.',
    'دستاویز اپ لوڈ نہیں ہو سکی۔ یہ کیس پر درج نہیں ہے۔',
  ],
  'taqdeerWarning': <String>[
    'Insurance claim can be drafted, but payer confirmation waits for '
        'Taqdeer assessment.',
    'يمكن إعداد مطالبة التأمين، لكن تأكيد الدافع ينتظر تقييم تقدير.',
    'انشورنس کلیم کا مسودہ بن سکتا ہے، مگر ادا کنندہ کی تصدیق تقدیر تشخیص '
        'کی منتظر ہے۔',
  ],
  'saveDetails': <String>[
    'Save responsibility details',
    'حفظ تفاصيل المسؤولية',
    'ذمہ داری کی تفصیلات محفوظ کریں',
  ],
  'requestTaqdeer': <String>[
    'Request missing Taqdeer document',
    'طلب مستند تقدير المفقود',
    'غائب تقدیر دستاویز کی درخواست',
  ],
  'continueDamage': <String>[
    'Continue to damage mapping',
    'المتابعة إلى تحديد الأضرار',
    'نقصان کی نقشہ بندی پر جائیں',
  ],
  'saved': <String>[
    'Responsibility details saved',
    'تم حفظ تفاصيل المسؤولية',
    'ذمہ داری کی تفصیلات محفوظ',
  ],
  'liabilityNotProvisioned': <String>[
    'Extended responsibility fields are not provisioned yet. Fault and '
        'liability still save; payer, third-party and verification details '
        'will save once the database is updated.',
    'حقول المسؤولية الموسعة غير مفعّلة بعد. يُحفظ الخطأ والمسؤولية؛ وستُحفظ '
        'تفاصيل الدافع والطرف الثالث والتحقق بعد تحديث قاعدة البيانات.',
    'توسیعی ذمہ داری کے فیلڈز ابھی فراہم نہیں۔ قصور اور ذمہ داری محفوظ ہوتی '
        'ہے؛ ادا کنندہ، تیسرے فریق اور تصدیق کی تفصیلات ڈیٹا بیس اپ ڈیٹ پر '
        'محفوظ ہوں گی۔',
  ],
  'docsNotProvisioned': <String>[
    'The document register is not available on this server yet.',
    'سجل المستندات غير متاح على هذا الخادم بعد.',
    'دستاویز رجسٹر ابھی اس سرور پر دستیاب نہیں۔',
  ],
  'taqdeerRequestSubject': <String>[
    'Missing Taqdeer document requested',
    'تم طلب مستند تقدير المفقود',
    'غائب تقدیر دستاویز کی درخواست کی گئی',
  ],
  'lockedNotice': <String>[
    'This assessment is locked and can no longer be edited here.',
    'هذا التقييم مقفل ولا يمكن تعديله هنا.',
    'یہ تشخیص مقفل ہے اور یہاں ترمیم نہیں ہو سکتی۔',
  ],
};
