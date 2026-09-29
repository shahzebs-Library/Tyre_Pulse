/// Arabic and Urdu wording for the fixed phrases the timeline feed builds
/// (`accident_timeline_feed.dart`). The feed is a pure domain function and
/// keeps its English vocabulary; this maps each fixed phrase, and the few
/// counted patterns, to the reader's language at the point of display.
///
/// Anything not in the vocabulary (a recorded email subject, a person, a
/// note) is returned exactly as stored: it is data, not app copy.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_mock_copy.dart';

const Map<String, List<String>> _phrases = <String, List<String>>{
  'Accident reported': <String>[
    'تم الإبلاغ عن الحادث',
    'حادثے کی اطلاع دی گئی',
  ],
  'Documents uploaded': <String>['تم رفع المستندات', 'دستاویزات اپ لوڈ ہوئیں'],
  'Photos uploaded': <String>['تم رفع الصور', 'تصاویر اپ لوڈ ہوئیں'],
  'Evidence uploaded': <String>['تم رفع الأدلة', 'شواہد اپ لوڈ ہوئے'],
  'Email sent': <String>['تم إرسال بريد إلكتروني', 'ای میل بھیجی گئی'],
  'Email received': <String>['تم استلام بريد إلكتروني', 'ای میل موصول ہوئی'],
  'Notification sent': <String>['تم إرسال إشعار', 'اطلاع بھیجی گئی'],
  'Call logged': <String>['تم تسجيل مكالمة', 'کال درج کی گئی'],
  'Portal update': <String>['تحديث البوابة', 'پورٹل اپ ڈیٹ'],
  'Timeline note': <String>['ملاحظة السجل الزمني', 'ٹائم لائن نوٹ'],
  'Sent': <String>['تم الإرسال', 'بھیج دیا گیا'],
  'Logged': <String>['تم التسجيل', 'درج کیا گیا'],
  'Vehicle dispatched to workshop': <String>[
    'تم إرسال المركبة إلى الورشة',
    'گاڑی ورکشاپ بھیج دی گئی',
  ],
  'Transit timer running': <String>[
    'مؤقت النقل يعمل',
    'ٹرانزٹ ٹائمر چل رہا ہے',
  ],
  'Vendor SLA not started': <String>[
    'لم تبدأ مهلة المورد',
    'وینڈر SLA شروع نہیں ہوا',
  ],
  'Vehicle acceptance signed': <String>[
    'تم توقيع استلام المركبة',
    'گاڑی کی وصولی پر دستخط ہو گئے',
  ],
  'Signed handover paper': <String>[
    'ورقة التسليم الموقعة',
    'دستخط شدہ حوالگی کاغذ',
  ],
  'SLA met': <String>['تم الالتزام بالمهلة', 'SLA پورا ہوا'],
  'SLA breached': <String>['تم تجاوز المهلة', 'SLA کی خلاف ورزی'],
  'Email': <String>['بريد إلكتروني', 'ای میل'],
  'Notification': <String>['إشعار', 'اطلاع'],
  'In-app': <String>['داخل التطبيق', 'ایپ کے اندر'],
  'Email + in-app': <String>[
    'بريد إلكتروني + داخل التطبيق',
    'ای میل + ایپ کے اندر',
  ],
};

/// `(pattern, ar, ur)`; `%1`/`%2` are the pattern's capture groups.
final List<(RegExp, String, String)> _patterns = <(RegExp, String, String)>[
  (RegExp(r'^Verified (\d+)/(\d+)$'), 'تم التحقق %1/%2', 'تصدیق شدہ %1/%2'),
  (RegExp(r'^Delivered (\d+)/(\d+)$'), 'تم التسليم %1/%2', 'پہنچ گئے %1/%2'),
  (RegExp(r'^(\d+) recipients$'), '%1 مستلمين', '%1 وصول کنندگان'),
  (RegExp(r'^(\d+) attachments$'), '%1 مرفقات', '%1 منسلکات'),
  (RegExp(r'^(\d+) photos attached$'), '%1 صور مرفقة', '%1 تصاویر منسلک'),
  (RegExp(r'^(\d+) documents$'), '%1 مستندات', '%1 دستاویزات'),
  (RegExp(r'^Scheduled in (.+)$'), 'مجدول خلال %1', '%1 میں طے شدہ'),
  (RegExp(r'^Overdue (.+)$'), 'متأخر %1', '%1 تاخیر'),
];

/// [text] in the reader's language when it is one of the feed's fixed
/// phrases or counted patterns (or a case-flow step name); otherwise the
/// stored text unchanged.
String accidentTimelineText(BuildContext context, String text) {
  final String language = Localizations.localeOf(context).languageCode;
  final int index = switch (language) {
    'ar' => 0,
    'ur' => 1,
    _ => -1,
  };
  if (index < 0) return text;
  final List<String>? phrase = _phrases[text];
  if (phrase != null) return phrase[index];
  for (final (RegExp pattern, String ar, String ur) in _patterns) {
    final RegExpMatch? m = pattern.firstMatch(text);
    if (m == null) continue;
    String out = index == 0 ? ar : ur;
    for (int g = 1; g <= m.groupCount; g++) {
      out = out.replaceAll('%$g', m.group(g) ?? '');
    }
    return out;
  }
  for (final NumberedStep step in caseFlow) {
    if (step.label == text) {
      return accidentVocabLabel(
        AccidentMockCopy.of(context),
        'flow',
        step.key,
        step.label,
      );
    }
  }
  return text;
}
