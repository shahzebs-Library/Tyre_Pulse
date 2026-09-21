import 'package:tyre_pulse/app/localization/tp_localizations.dart';

const washCheckLabels = <String>[
  'Exterior surfaces',
  'Windows, mirrors and lights',
  'Wheels and wheel arches',
  'Cab interior',
  'Final rinse and visible residue',
];

Map<String, dynamic> emptyWashDetails() => <String, dynamic>{
      'version': 1,
      'chemical_status': 'not_recorded',
      'chemicals': <Map<String, dynamic>>[],
      'checklist': [
        for (final label in washCheckLabels)
          <String, dynamic>{
            'label': label,
            'result': 'not_checked',
            'note': '',
          },
      ],
    };

List<Map<String, dynamic>> detailItems(
  Map<String, dynamic>? details,
  String key,
) =>
    (details?[key] as List<dynamic>? ?? <dynamic>[])
        .whereType<Map<String, dynamic>>()
        .toList();

bool validWashDetails(Map<String, dynamic> details) {
  final chemicals = detailItems(details, 'chemicals');
  if (details['chemical_status'] == 'used' &&
      (chemicals.isEmpty ||
          chemicals.any((c) => (c['name'] as String? ?? '').trim().isEmpty))) {
    return false;
  }
  return !detailItems(details, 'checklist').any(
    (c) => c['result'] == 'fail' && (c['note'] as String? ?? '').trim().isEmpty,
  );
}

String washCheckLabel(AppLocalizations l, String label) {
  final labels = <String>[
    l.washCheckExterior,
    l.washCheckGlass,
    l.washCheckWheels,
    l.washCheckCab,
    l.washCheckRinse,
  ];
  final index = washCheckLabels.indexOf(label);
  return index < 0 ? label : labels[index];
}

Map<String, String> washResultLabels(AppLocalizations l) => <String, String>{
      'not_checked': l.washNotChecked,
      'pass': l.washChecked,
      'fail': l.washIssueFound,
      'na': l.washNotApplicable,
    };
