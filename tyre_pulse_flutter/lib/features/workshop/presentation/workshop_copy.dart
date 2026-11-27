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
      'completeTitle': 'Finish job',
      'c_required': 'Required',
      'c_whatDone': 'What was done',
      'c_whatDoneHint': 'Describe the work (or tap the quick picks)',
      'qp_replaced': 'Replaced',
      'qp_repaired': 'Repaired',
      'qp_adjusted': 'Adjusted',
      'qp_inspected': 'Inspected',
      'qp_cleaned': 'Cleaned',
      'qp_lubricated': 'Lubricated',
      'c_parts': 'Parts used',
      'c_partsFromRequests': 'From this job\'s parts requests',
      'c_addPart': 'Add part',
      'c_removePart': 'Remove part',
      'c_after': 'After photos',
      'c_afterHint': 'At least one photo of the finished work.',
      'c_before': 'Before photos (optional)',
      'c_meters': 'Meter readings',
      'c_km': 'Odometer (km)',
      'c_hours': 'Hour meter',
      'c_last': 'Last reading:',
      'c_signature': 'Your signature',
      'c_signClear': 'Clear',
      'c_signRedraw': 'Sign again',
      'c_submit': 'Send for supervisor approval',
      'c_stillNeeded': 'Still needed:',
      'need_workDone': 'what was done',
      'need_afterPhoto': 'an after photo',
      'need_signature': 'your signature',
      'c_uploading': 'Uploading photos...',
      'c_photosNeedSignal':
          'The photos could not be uploaded. Your completion is kept on this screen. Try again when you have a connection.',
      'c_sent': 'Sent for supervisor approval.',
      'waitingApproval': 'Waiting for supervisor approval',
      'returned': 'Returned by supervisor',
      'notAccepted': 'Not accepted:',
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
      'completeTitle': 'إنهاء العمل',
      'c_required': 'مطلوب',
      'c_whatDone': 'ما الذي تم إنجازه',
      'c_whatDoneHint': 'صف العمل (أو اختر من الخيارات السريعة)',
      'qp_replaced': 'استبدال',
      'qp_repaired': 'إصلاح',
      'qp_adjusted': 'ضبط',
      'qp_inspected': 'فحص',
      'qp_cleaned': 'تنظيف',
      'qp_lubricated': 'تشحيم',
      'c_parts': 'القطع المستخدمة',
      'c_partsFromRequests': 'من طلبات القطع لهذا العمل',
      'c_addPart': 'إضافة قطعة',
      'c_removePart': 'إزالة القطعة',
      'c_after': 'صور بعد العمل',
      'c_afterHint': 'صورة واحدة على الأقل للعمل المنجز.',
      'c_before': 'صور قبل العمل (اختياري)',
      'c_meters': 'قراءات العداد',
      'c_km': 'عداد المسافة (كم)',
      'c_hours': 'عداد الساعات',
      'c_last': 'آخر قراءة:',
      'c_signature': 'توقيعك',
      'c_signClear': 'مسح',
      'c_signRedraw': 'التوقيع من جديد',
      'c_submit': 'إرسال لموافقة المشرف',
      'c_stillNeeded': 'ما زال مطلوبًا:',
      'need_workDone': 'ما تم إنجازه',
      'need_afterPhoto': 'صورة بعد العمل',
      'need_signature': 'توقيعك',
      'c_uploading': 'جارٍ رفع الصور...',
      'c_photosNeedSignal':
          'تعذر رفع الصور. إنهاء العمل محفوظ في هذه الشاشة. حاول مرة أخرى عند توفر الاتصال.',
      'c_sent': 'تم الإرسال لموافقة المشرف.',
      'waitingApproval': 'بانتظار موافقة المشرف',
      'returned': 'أعاده المشرف',
      'notAccepted': 'لم يُقبل:',
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
      'completeTitle': 'کام مکمل کریں',
      'c_required': 'لازمی',
      'c_whatDone': 'کیا کام کیا گیا',
      'c_whatDoneHint': 'کام کی تفصیل لکھیں (یا فوری انتخاب پر ٹیپ کریں)',
      'qp_replaced': 'تبدیل کیا',
      'qp_repaired': 'مرمت کی',
      'qp_adjusted': 'ایڈجسٹ کیا',
      'qp_inspected': 'معائنہ کیا',
      'qp_cleaned': 'صاف کیا',
      'qp_lubricated': 'چکنائی لگائی',
      'c_parts': 'استعمال شدہ پرزے',
      'c_partsFromRequests': 'اس کام کی پرزہ درخواستوں سے',
      'c_addPart': 'پرزہ شامل کریں',
      'c_removePart': 'پرزہ ہٹائیں',
      'c_after': 'کام کے بعد کی تصاویر',
      'c_afterHint': 'مکمل کام کی کم از کم ایک تصویر۔',
      'c_before': 'کام سے پہلے کی تصاویر (اختیاری)',
      'c_meters': 'میٹر ریڈنگ',
      'c_km': 'اوڈومیٹر (کلومیٹر)',
      'c_hours': 'آور میٹر',
      'c_last': 'آخری ریڈنگ:',
      'c_signature': 'آپ کے دستخط',
      'c_signClear': 'صاف کریں',
      'c_signRedraw': 'دوبارہ دستخط کریں',
      'c_submit': 'سپروائزر کی منظوری کے لیے بھیجیں',
      'c_stillNeeded': 'ابھی درکار:',
      'need_workDone': 'کیا کام کیا گیا',
      'need_afterPhoto': 'کام کے بعد کی تصویر',
      'need_signature': 'آپ کے دستخط',
      'c_uploading': 'تصاویر اپ لوڈ ہو رہی ہیں...',
      'c_photosNeedSignal':
          'تصاویر اپ لوڈ نہیں ہو سکیں۔ آپ کا اندراج اسی اسکرین پر محفوظ ہے۔ کنکشن ملنے پر دوبارہ کوشش کریں۔',
      'c_sent': 'سپروائزر کی منظوری کے لیے بھیج دیا گیا۔',
      'waitingApproval': 'سپروائزر کی منظوری کا انتظار',
      'returned': 'سپروائزر نے واپس کر دیا',
      'notAccepted': 'قبول نہیں ہوا:',
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
