library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

/// Feature copy parsed from the locale-specific ARB catalog.
///
/// Accident work is intentionally kept in one compact catalog because this
/// module has a dense operational vocabulary. The catalog itself still lives
/// in every shipped ARB (English, Arabic and Urdu), so RTL copy never falls
/// back to a hard-coded presentation string.
final class AccidentCopy {
  factory AccidentCopy.of(BuildContext context) {
    final String catalog = AppLocalizations.of(context).accidentCopyCatalog;
    final String language = Localizations.localeOf(context).languageCode;
    return AccidentCopy._(<String, String>{
      for (final String entry in catalog.split('~'))
        if (entry.indexOf('=') > 0)
          entry.substring(0, entry.indexOf('=')):
              entry.substring(entry.indexOf('=') + 1),
      ...?_damageComponentCopy[language],
    });
  }
  AccidentCopy._(this._values);

  final Map<String, String> _values;

  String call(String key) => _values[key] ?? key;
}

/// Asset-class component names added by the exact damage mapper. They remain
/// in this feature-local catalogue so English, Arabic and Urdu stay aligned
/// even before the next generated ARB refresh.
const Map<String, Map<String, String>> _damageComponentCopy =
    <String, Map<String, String>>{
  'en': <String, String>{
    'driver': 'Driver',
    'injuries': 'Injuries reported',
    'injuryCount': 'Injury count',
    'thirdParty': 'Third party involved',
    'damageCondition': 'Damage condition',
    'estimatedDamage': 'Estimated damage cost',
    'damageDent': 'Dent',
    'damageScratch': 'Scratch',
    'damageCracked': 'Cracked',
    'damageBroken': 'Broken',
    'damageMissing': 'Missing',
    'damageOther': 'Other',
    'zoneCabPanel': 'Cab front panel',
    'zoneCab': 'Cab',
    'zoneBodyPanel': 'Body panel',
    'zoneDriverDoor': 'Driver door',
    'zonePassengerDoor': 'Passenger door',
    'zoneSidePanel': 'Side panel',
    'zoneEquipmentBody': 'Equipment body',
    'zoneBoom': 'Boom',
    'zoneOutrigger': 'Outrigger',
    'zoneBucket': 'Bucket',
    'zoneLiftArm': 'Lift arm',
    'zoneFrontWheel': 'Front wheel area',
    'zoneRearWheel': 'Rear wheel area',
    'zoneEngineCover': 'Engine cover',
    'zoneCounterweight': 'Counterweight',
    'zoneEquipmentPanel': 'Equipment panel',
    'zoneControlPanel': 'Control panel',
    'zonePipework': 'Pipework',
    'zoneBaseFrame': 'Base frame',
    'zonePassengerBody': 'Passenger body',
  },
  'ar': <String, String>{
    'driver': 'السائق',
    'injuries': 'وجود إصابات',
    'injuryCount': 'عدد الإصابات',
    'thirdParty': 'وجود طرف ثالث',
    'damageCondition': 'حالة الضرر',
    'estimatedDamage': 'التكلفة التقديرية للضرر',
    'damageDent': 'انبعاج',
    'damageScratch': 'خدش',
    'damageCracked': 'متشقق',
    'damageBroken': 'مكسور',
    'damageMissing': 'مفقود',
    'damageOther': 'أخرى',
    'zoneCabPanel': 'لوحة مقدمة الكابينة',
    'zoneCab': 'الكابينة',
    'zoneBodyPanel': 'لوحة الهيكل',
    'zoneDriverDoor': 'باب السائق',
    'zonePassengerDoor': 'باب الركاب',
    'zoneSidePanel': 'اللوحة الجانبية',
    'zoneEquipmentBody': 'هيكل المعدة',
    'zoneBoom': 'الذراع',
    'zoneOutrigger': 'الدعامة',
    'zoneBucket': 'الجرافة',
    'zoneLiftArm': 'ذراع الرفع',
    'zoneFrontWheel': 'منطقة العجلة الأمامية',
    'zoneRearWheel': 'منطقة العجلة الخلفية',
    'zoneEngineCover': 'غطاء المحرك',
    'zoneCounterweight': 'الثقل الخلفي',
    'zoneEquipmentPanel': 'لوحة المعدة',
    'zoneControlPanel': 'لوحة التحكم',
    'zonePipework': 'الأنابيب',
    'zoneBaseFrame': 'الإطار السفلي',
    'zonePassengerBody': 'هيكل الركاب',
  },
  'ur': <String, String>{
    'driver': 'ڈرائیور',
    'injuries': 'زخمی افراد',
    'injuryCount': 'زخمیوں کی تعداد',
    'thirdParty': 'تیسرا فریق شامل',
    'damageCondition': 'نقصان کی حالت',
    'estimatedDamage': 'نقصان کی تخمینی لاگت',
    'damageDent': 'ڈینٹ',
    'damageScratch': 'خراش',
    'damageCracked': 'دراڑ',
    'damageBroken': 'ٹوٹا ہوا',
    'damageMissing': 'غائب',
    'damageOther': 'دیگر',
    'zoneCabPanel': 'کیبن کا اگلا پینل',
    'zoneCab': 'کیبن',
    'zoneBodyPanel': 'باڈی پینل',
    'zoneDriverDoor': 'ڈرائیور دروازہ',
    'zonePassengerDoor': 'مسافر دروازہ',
    'zoneSidePanel': 'سائیڈ پینل',
    'zoneEquipmentBody': 'مشین باڈی',
    'zoneBoom': 'بوم',
    'zoneOutrigger': 'آؤٹ ریگر',
    'zoneBucket': 'بکٹ',
    'zoneLiftArm': 'لفٹ بازو',
    'zoneFrontWheel': 'اگلے پہیے کا حصہ',
    'zoneRearWheel': 'پچھلے پہیے کا حصہ',
    'zoneEngineCover': 'انجن کور',
    'zoneCounterweight': 'کاؤنٹر ویٹ',
    'zoneEquipmentPanel': 'مشین پینل',
    'zoneControlPanel': 'کنٹرول پینل',
    'zonePipework': 'پائپ ورک',
    'zoneBaseFrame': 'بیس فریم',
    'zonePassengerBody': 'مسافر باڈی',
  },
};
