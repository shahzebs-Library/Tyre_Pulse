/// "Verify on site" text in English, Arabic and Urdu.
///
/// Kept local (like `fleet_supervisor_copy.dart`) because the ARB catalogs
/// are being edited by another lane this round. The keys below, prefixed
/// `fleetVerify`, are the ones to move into app_en/ar/ur.arb later.
library;

import 'package:flutter/widgets.dart';

final class FleetVerificationCopy {
  const FleetVerificationCopy._(this._lang);

  factory FleetVerificationCopy.of(BuildContext context) =>
      FleetVerificationCopy._(Localizations.localeOf(context).languageCode);

  factory FleetVerificationCopy.forLanguage(String lang) =>
      FleetVerificationCopy._(lang);

  final String _lang;

  String call(String key) =>
      (values[_lang] ?? values['en']!)[key] ?? values['en']![key] ?? key;

  String fill(String key, Map<String, String> args) {
    String out = call(key);
    args.forEach((String k, String v) => out = out.replaceAll('{$k}', v));
    return out;
  }

  static const Map<String, Map<String, String>> values =
      <String, Map<String, String>>{
    'en': <String, String>{
      'retry': 'Retry',
      'waitingFor': 'Waiting to send for this machine',
      'stateWaiting': 'Waiting to send (tries: {n})',
      'stateFailed': 'Not sent: {reason}',
      '@photoMissing':
          'the photo is no longer on this phone. Discard and check again.',
      '@retryLimit':
          'could not reach the server after many tries. Discard and check again.',
      'retryNow': 'Send now',
      'action': 'Verify on site',
      'title': 'Verify on site',
      'subtitle': '{asset} - check the machine in front of you',
      'outcome': 'What did you find?',
      'present': 'Here',
      'notFound': 'Not here',
      'otherCountry': 'Other country',
      'whichCountry': 'Which country?',
      'assetCode': 'Asset code on the machine',
      'plate': 'Plate number',
      'chassis': 'Chassis number',
      'onFile': 'On file: {value}',
      'blank': 'blank',
      'scan': 'Scan',
      'photo': 'Photo of the machine',
      'takePhoto': 'Take photo',
      'retakePhoto': 'Retake photo',
      'gallery': 'From gallery',
      'photoHint': 'On approval it replaces the class picture.',
      'note': 'Note (optional)',
      'gps': 'Location is recorded if allowed. It never blocks saving.',
      'willFill': 'Filled now: {fields}',
      'willWait': 'Waits for a manager: {reasons}',
      'willApply': 'Everything matches. Saved straight away.',
      'notFoundHint':
          'A manager confirms before the machine is marked Inactive.',
      'otherCountryHint':
          'A manager confirms before the machine is marked Transferred.',
      'save': 'Save verification',
      'saving': 'Saving...',
      'sent': 'Saved. The office will see it now.',
      'queued': 'Saved on this phone. It will send when you are back online.',
      'failed': 'The server refused this verification: {reason}',
      'notSetUp':
          'On-site verification is not set up on the server yet. Saved on this phone.',
      'needCountry': 'Choose the country the machine is in.',
      'noAccess':
          'Only a Fleet Supervisor, Fleet Incharge or Admin can verify machines on site.',
      'waitingTitle': 'Waiting to send',
      'discard': 'Discard',
      'f.registration_no': 'plate',
      'f.chassis_no': 'chassis',
      'f.image_path': 'photo',
      'r.asset_code_mismatch': 'asset code differs',
      'r.chassis_invalid_chars': 'chassis has I, O or Q',
      'r.duplicate_plate': 'plate already on another machine',
      'r.duplicate_chassis': 'chassis already on another machine',
      'r.plate_changed': 'plate differs from file',
      'r.chassis_changed': 'chassis differs from file',
    },
    'ar': <String, String>{
      'retry': 'إعادة المحاولة',
      'waitingFor': 'بانتظار الإرسال لهذه المعدة',
      'stateWaiting': 'بانتظار الإرسال (المحاولات: {n})',
      'stateFailed': 'لم يرسل: {reason}',
      '@photoMissing': 'الصورة لم تعد على هذا الهاتف. تجاهل وتحقق مرة أخرى.',
      '@retryLimit':
          'تعذر الوصول إلى الخادم بعد محاولات كثيرة. تجاهل وتحقق مرة أخرى.',
      'retryNow': 'إرسال الآن',
      'action': 'التحقق في الموقع',
      'title': 'التحقق في الموقع',
      'subtitle': '{asset} - افحص المعدة التي أمامك',
      'outcome': 'ماذا وجدت؟',
      'present': 'موجودة',
      'notFound': 'غير موجودة',
      'otherCountry': 'دولة أخرى',
      'whichCountry': 'أي دولة؟',
      'assetCode': 'رمز الأصل على المعدة',
      'plate': 'رقم اللوحة',
      'chassis': 'رقم الشاصي',
      'onFile': 'في السجل: {value}',
      'blank': 'فارغ',
      'scan': 'مسح',
      'photo': 'صورة المعدة',
      'takePhoto': 'التقاط صورة',
      'retakePhoto': 'إعادة التقاط',
      'gallery': 'من المعرض',
      'photoHint': 'عند الاعتماد تحل محل الصورة العامة.',
      'note': 'ملاحظة (اختياري)',
      'gps': 'يتم تسجيل الموقع إذا سمحت بذلك. لا يمنع الحفظ أبدا.',
      'willFill': 'يعبأ الآن: {fields}',
      'willWait': 'بانتظار المدير: {reasons}',
      'willApply': 'كل شيء مطابق. يحفظ مباشرة.',
      'notFoundHint': 'يؤكد المدير قبل تحويل المعدة إلى غير نشطة.',
      'otherCountryHint': 'يؤكد المدير قبل تحويل المعدة إلى منقولة.',
      'save': 'حفظ التحقق',
      'saving': 'جار الحفظ...',
      'sent': 'تم الحفظ. سيراه المكتب الآن.',
      'queued': 'تم الحفظ على الهاتف. سيرسل عند عودة الاتصال.',
      'failed': 'رفض الخادم هذا التحقق: {reason}',
      'notSetUp':
          'التحقق في الموقع غير مفعل على الخادم بعد. تم الحفظ على الهاتف.',
      'needCountry': 'اختر الدولة التي توجد بها المعدة.',
      'noAccess':
          'يمكن فقط لمشرف الأسطول أو مسؤول الأسطول أو المدير العام التحقق في الموقع.',
      'waitingTitle': 'بانتظار الإرسال',
      'discard': 'تجاهل',
      'f.registration_no': 'اللوحة',
      'f.chassis_no': 'الشاصي',
      'f.image_path': 'الصورة',
      'r.asset_code_mismatch': 'رمز الأصل مختلف',
      'r.chassis_invalid_chars': 'الشاصي يحتوي على I أو O أو Q',
      'r.duplicate_plate': 'اللوحة مسجلة على معدة أخرى',
      'r.duplicate_chassis': 'الشاصي مسجل على معدة أخرى',
      'r.plate_changed': 'اللوحة تختلف عن السجل',
      'r.chassis_changed': 'الشاصي يختلف عن السجل',
    },
    'ur': <String, String>{
      'retry': 'دوبارہ کوشش',
      'waitingFor': 'اس مشین کے لیے بھیجنے کا انتظار',
      'stateWaiting': 'بھیجنے کا انتظار (کوششیں: {n})',
      'stateFailed': 'نہیں بھیجا گیا: {reason}',
      '@photoMissing':
          'تصویر اب اس فون پر نہیں ہے۔ ختم کریں اور دوبارہ چیک کریں۔',
      '@retryLimit':
          'کئی کوششوں کے بعد بھی سرور تک رسائی نہیں ہو سکی۔ ختم کریں اور دوبارہ چیک کریں۔',
      'retryNow': 'ابھی بھیجیں',
      'action': 'سائٹ پر تصدیق',
      'title': 'سائٹ پر تصدیق',
      'subtitle': '{asset} - سامنے موجود مشین چیک کریں',
      'outcome': 'آپ کو کیا ملا؟',
      'present': 'یہاں ہے',
      'notFound': 'یہاں نہیں',
      'otherCountry': 'دوسرا ملک',
      'whichCountry': 'کون سا ملک؟',
      'assetCode': 'مشین پر ایسٹ کوڈ',
      'plate': 'پلیٹ نمبر',
      'chassis': 'چیسس نمبر',
      'onFile': 'ریکارڈ میں: {value}',
      'blank': 'خالی',
      'scan': 'اسکین',
      'photo': 'مشین کی تصویر',
      'takePhoto': 'تصویر لیں',
      'retakePhoto': 'دوبارہ تصویر لیں',
      'gallery': 'گیلری سے',
      'photoHint': 'منظوری پر یہ عام تصویر کی جگہ لے گی۔',
      'note': 'نوٹ (اختیاری)',
      'gps': 'اجازت ہو تو مقام ریکارڈ ہوتا ہے۔ یہ محفوظ کرنے سے نہیں روکتا۔',
      'willFill': 'ابھی بھرا جائے گا: {fields}',
      'willWait': 'مینیجر کا انتظار: {reasons}',
      'willApply': 'سب کچھ درست ہے۔ فوراً محفوظ ہوگا۔',
      'notFoundHint': 'مشین کو غیر فعال کرنے سے پہلے مینیجر تصدیق کرتا ہے۔',
      'otherCountryHint':
          'مشین کو منتقل شدہ کرنے سے پہلے مینیجر تصدیق کرتا ہے۔',
      'save': 'تصدیق محفوظ کریں',
      'saving': 'محفوظ ہو رہا ہے...',
      'sent': 'محفوظ ہو گیا۔ دفتر اب دیکھ سکتا ہے۔',
      'queued': 'فون پر محفوظ ہو گیا۔ آن لائن ہوتے ہی بھیج دیا جائے گا۔',
      'failed': 'سرور نے یہ تصدیق مسترد کر دی: {reason}',
      'notSetUp': 'سائٹ پر تصدیق ابھی سرور پر فعال نہیں۔ فون پر محفوظ ہو گیا۔',
      'needCountry': 'وہ ملک منتخب کریں جہاں مشین ہے۔',
      'noAccess':
          'صرف فلیٹ سپروائزر، فلیٹ انچارج یا ایڈمن سائٹ پر تصدیق کر سکتے ہیں۔',
      'waitingTitle': 'بھیجنے کا انتظار',
      'discard': 'ختم کریں',
      'f.registration_no': 'پلیٹ',
      'f.chassis_no': 'چیسس',
      'f.image_path': 'تصویر',
      'r.asset_code_mismatch': 'ایسٹ کوڈ مختلف ہے',
      'r.chassis_invalid_chars': 'چیسس میں I، O یا Q ہے',
      'r.duplicate_plate': 'پلیٹ کسی اور مشین پر ہے',
      'r.duplicate_chassis': 'چیسس کسی اور مشین پر ہے',
      'r.plate_changed': 'پلیٹ ریکارڈ سے مختلف ہے',
      'r.chassis_changed': 'چیسس ریکارڈ سے مختلف ہے',
    },
  };
}
