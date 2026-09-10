import 'package:flutter/widgets.dart';

String meterCaptureCopy(BuildContext context, String key) =>
    (_copy[Localizations.localeOf(context).languageCode] ?? _copy['en']!)[key]!;

const _copy = <String, Map<String, String>>{
  'en': {
    'distance': 'Distance since last reading',
    'unknown':
        'Unavailable until valid current and previous readings are known.',
    'source': 'Reading source',
    'manual': 'Read directly from gauge',
    'photo': 'Transcribed from photo',
    'help':
        'Enter the reading manually. Gauge photo evidence is required on the review screen.',
  },
  'ar': {
    'distance': 'المسافة منذ آخر قراءة',
    'unknown': 'غير متاحة حتى تتوفر قراءة حالية وسابقة صالحتان.',
    'source': 'مصدر القراءة',
    'manual': 'قراءة مباشرة من العداد',
    'photo': 'منقولة من صورة',
    'help': 'أدخل القراءة يدوياً. صورة العداد مطلوبة في شاشة المراجعة.',
  },
  'ur': {
    'distance': 'پچھلی ریڈنگ سے فاصلہ',
    'unknown': 'درست موجودہ اور پچھلی ریڈنگ تک دستیاب نہیں۔',
    'source': 'ریڈنگ کا ماخذ',
    'manual': 'میٹر سے براہ راست پڑھی',
    'photo': 'تصویر سے نقل کی',
    'help':
        'ریڈنگ دستی طور پر درج کریں۔ جائزہ اسکرین پر میٹر کی تصویر ضروری ہے۔',
  },
};
