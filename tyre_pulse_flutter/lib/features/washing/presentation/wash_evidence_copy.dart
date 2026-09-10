import 'package:flutter/widgets.dart';

String washEvidenceCopy(BuildContext context, String key) =>
    (_copy[Localizations.localeOf(context).languageCode] ?? _copy['en']!)[key]!;

const _copy = <String, Map<String, String>>{
  'en': {
    'before': 'Before washing',
    'after': 'After washing',
    'checklist': 'Completion checklist',
    'washCompleted': 'Selected wash work completed',
    'conditionChecked': 'Final vehicle condition checked',
    'required':
        'Confirm both completion checks before saving a completed wash.',
    'optional':
        'Photos are optional. Before/after classification and your checks are saved with this record.',
    'limit': 'Up to 6 photos across both stages.',
  },
  'ar': {
    'before': 'قبل الغسيل',
    'after': 'بعد الغسيل',
    'checklist': 'قائمة التحقق من الإكمال',
    'washCompleted': 'اكتملت أعمال الغسيل المحددة',
    'conditionChecked': 'تم فحص حالة المركبة النهائية',
    'required': 'أكد كلا البندين قبل حفظ غسيل مكتمل.',
    'optional': 'الصور اختيارية. يتم حفظ تصنيف قبل/بعد وإجاباتك مع السجل.',
    'limit': 'حتى 6 صور للمرحلتين معاً.',
  },
  'ur': {
    'before': 'دھلائی سے پہلے',
    'after': 'دھلائی کے بعد',
    'checklist': 'تکمیل کی چیک لسٹ',
    'washCompleted': 'منتخب دھلائی کا کام مکمل ہوا',
    'conditionChecked': 'گاڑی کی آخری حالت چیک کی',
    'required': 'مکمل دھلائی محفوظ کرنے سے پہلے دونوں جانچ کی تصدیق کریں۔',
    'optional':
        'تصاویر اختیاری ہیں۔ پہلے/بعد کی درجہ بندی اور آپ کی جانچ ریکارڈ کے ساتھ محفوظ ہوتی ہے۔',
    'limit': 'دونوں مراحل میں کل 6 تصاویر تک۔',
  },
};
