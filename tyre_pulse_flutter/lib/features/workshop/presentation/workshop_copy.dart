/// Copy for the technician screen, read from the `workshopCopyCatalog` ARB
/// key - the same one-key catalog convention `TasksCopy` uses.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

final class WorkshopCopy {
  factory WorkshopCopy.of(BuildContext context) {
    final String catalog = AppLocalizations.of(context).workshopCopyCatalog;
    final String lang = Localizations.localeOf(context).languageCode;
    return WorkshopCopy._(lang, <String, String>{
      for (final String entry in catalog.split('~'))
        if (entry.indexOf('=') > 0)
          entry.substring(0, entry.indexOf('=')):
              entry.substring(entry.indexOf('=') + 1),
    });
  }

  WorkshopCopy._(this._lang, this._values);

  final String _lang;

  final Map<String, String> _values;

  /// en / ar / ur fallbacks for keys added after the last ARB catalog update.
  /// The ARB catalog always wins; see scratchpad `arb_fragment_sync.json`
  /// for the en/ar/ur strings to fold into `workshopCopyCatalog`.
  static const Map<String, Map<String, String>> _fallbacks =
      <String, Map<String, String>>{
    'en': <String, String>{
      'more': 'More',
      'fewer': 'Fewer actions',
      'pauseTitle': 'Why are you pausing?',
      'r_parts': 'Waiting for parts',
      'r_approval': 'Waiting for approval',
      'r_vehicle': 'Waiting for the vehicle',
      'r_tools': 'Waiting for tools',
      'r_break': 'Break',
      'r_other': 'Other',
      'partName': 'Part needed',
      'partQty': 'Quantity',
      'partsSent': 'Parts request sent to the store.',
      'partsNotSent':
          'Recorded on your job, but the parts request could not be sent. Tell the store keeper, or try again with a connection.',
      'offlineBanner':
          'You are offline. Showing your jobs as last loaded. New taps are saved on this phone and sync when you are back online.',
    },
    'ar': <String, String>{
      'more': 'المزيد',
      'fewer': 'إجراءات أقل',
      'pauseTitle': 'لماذا توقفت؟',
      'r_parts': 'بانتظار قطع الغيار',
      'r_approval': 'بانتظار الموافقة',
      'r_vehicle': 'بانتظار المركبة',
      'r_tools': 'بانتظار الأدوات',
      'r_break': 'استراحة',
      'r_other': 'سبب آخر',
      'partName': 'القطعة المطلوبة',
      'partQty': 'الكمية',
      'partsSent': 'تم إرسال طلب القطع إلى المستودع.',
      'partsNotSent':
          'تم تسجيله على مهمتك، لكن تعذر إرسال طلب القطع. أبلغ أمين المستودع، أو حاول مرة أخرى عند توفر الاتصال.',
      'offlineBanner':
          'أنت غير متصل. تظهر مهامك كما تم تحميلها آخر مرة. تُحفظ الإجراءات الجديدة على هذا الهاتف وتُزامن عند عودة الاتصال.',
    },
    'ur': <String, String>{
      'more': 'مزید',
      'fewer': 'کم اقدامات',
      'pauseTitle': 'آپ کام کیوں روک رہے ہیں؟',
      'r_parts': 'پرزوں کا انتظار',
      'r_approval': 'منظوری کا انتظار',
      'r_vehicle': 'گاڑی کا انتظار',
      'r_tools': 'اوزاروں کا انتظار',
      'r_break': 'وقفہ',
      'r_other': 'دیگر',
      'partName': 'مطلوبہ پرزہ',
      'partQty': 'مقدار',
      'partsSent': 'پرزوں کی درخواست اسٹور کو بھیج دی گئی۔',
      'partsNotSent':
          'آپ کے کام پر درج ہو گیا، لیکن پرزوں کی درخواست نہیں بھیجی جا سکی۔ اسٹور کیپر کو بتائیں، یا کنکشن ملنے پر دوبارہ کوشش کریں۔',
      'offlineBanner':
          'آپ آف لائن ہیں۔ آپ کے کام آخری بار لوڈ ہونے کے مطابق دکھائے جا رہے ہیں۔ نئے اندراج اس فون پر محفوظ ہوتے ہیں اور کنکشن بحال ہونے پر سنک ہو جاتے ہیں۔',
    },
  };

  String call(String key) =>
      _values[key] ??
      (_fallbacks[_lang] ?? _fallbacks['en']!)[key] ??
      _fallbacks['en']![key] ??
      key;
}
