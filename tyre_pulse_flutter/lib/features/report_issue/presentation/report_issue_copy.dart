library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

final class ReportIssueCopy {
  factory ReportIssueCopy.of(BuildContext context) {
    final String catalog = AppLocalizations.of(context).reportIssueCopyCatalog;
    final String lang = Localizations.localeOf(context).languageCode;
    return ReportIssueCopy._(lang, <String, String>{
      for (final String entry in catalog.split('~'))
        if (entry.indexOf('=') > 0)
          entry.substring(0, entry.indexOf('=')):
              entry.substring(entry.indexOf('=') + 1),
    });
  }

  ReportIssueCopy._(this._lang, this._values);

  final String _lang;

  final Map<String, String> _values;

  /// en / ar / ur fallbacks for keys added after the last ARB catalog update;
  /// the catalog always wins (strings for en/ar/ur are in the scratchpad
  /// `arb_fragment_sync.json`).
  static const Map<String, Map<String, String>> _fallbacks =
      <String, Map<String, String>>{
    'en': <String, String>{
      'requestWorkOrder': 'Request a work order',
      'savedBodyNoTasks':
          'The issue is saved on this phone and will sync automatically.',
      'backHome': 'Back to Home',
      'syncWaiting': 'Saved on this phone. Waiting to send.',
      'syncSent': 'Sent to the team.',
      'syncFailed': 'This issue was not accepted by the server yet.',
      'syncFailedHint':
          'It stays on this phone. Ask your supervisor, or check Pending sync on your profile.',
    },
    'ar': <String, String>{
      'requestWorkOrder': 'طلب أمر عمل',
      'savedBodyNoTasks':
          'تم حفظ المشكلة على هذا الهاتف وستتم مزامنتها تلقائيًا.',
      'backHome': 'العودة إلى الرئيسية',
      'syncWaiting': 'محفوظة على هذا الهاتف. بانتظار الإرسال.',
      'syncSent': 'تم الإرسال إلى الفريق.',
      'syncFailed': 'لم يقبل الخادم هذه المشكلة بعد.',
      'syncFailedHint':
          'تبقى على هذا الهاتف. اسأل مشرفك، أو راجع المزامنة المعلقة في ملفك الشخصي.',
    },
    'ur': <String, String>{
      'requestWorkOrder': 'ورک آرڈر کی درخواست کریں',
      'savedBodyNoTasks':
          'مسئلہ اس فون پر محفوظ ہو گیا ہے اور خود بخود سنک ہو جائے گا۔',
      'backHome': 'ہوم پر واپس جائیں',
      'syncWaiting': 'اس فون پر محفوظ ہے۔ بھیجنے کا انتظار ہے۔',
      'syncSent': 'ٹیم کو بھیج دیا گیا۔',
      'syncFailed': 'سرور نے ابھی یہ مسئلہ قبول نہیں کیا۔',
      'syncFailedHint':
          'یہ اس فون پر رہے گا۔ اپنے سپروائزر سے پوچھیں، یا اپنی پروفائل میں زیر التوا سنک دیکھیں۔',
    },
  };

  String call(String key) =>
      _values[key] ??
      (_fallbacks[_lang] ?? _fallbacks['en']!)[key] ??
      _fallbacks['en']![key] ??
      key;
}
