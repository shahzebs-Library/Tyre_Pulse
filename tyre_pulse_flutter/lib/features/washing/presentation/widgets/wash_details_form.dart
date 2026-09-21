import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/washing/domain/wash_details.dart';
import 'package:uuid/uuid.dart';

class WashDetailsForm extends StatelessWidget {
  const WashDetailsForm({
    required this.value,
    required this.onChanged,
    super.key,
  });
  final Map<String, dynamic> value;
  final ValueChanged<Map<String, dynamic>> onChanged;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final chemicals = detailItems(value, 'chemicals'),
        checks = detailItems(value, 'checklist');
    void updateItem(
      String field,
      List<Map<String, dynamic>> items,
      int index,
      String key,
      String text,
    ) {
      onChanged({
        ...value,
        field: [
          for (var i = 0; i < items.length; i++)
            if (i == index) {...items[i], key: text} else items[i],
        ],
      });
    }

    return ExpansionTile(
      title: Text(l.washEvidenceTitle),
      childrenPadding: const EdgeInsets.all(12),
      children: [
        DropdownButtonFormField<String>(
          initialValue: value['chemical_status'] as String? ?? 'not_recorded',
          isExpanded: true,
          decoration: InputDecoration(labelText: l.washChemicalUseLabel),
          items: [
            DropdownMenuItem(
              value: 'not_recorded',
              child: Text(l.washNotRecorded),
            ),
            DropdownMenuItem(value: 'none', child: Text(l.washNoChemical)),
            DropdownMenuItem(value: 'used', child: Text(l.washChemicalUsed)),
          ],
          onChanged: (v) => onChanged({
            ...value,
            'chemical_status': v,
            'chemicals': v == 'used'
                ? <Map<String, dynamic>>[
                    {'id': const Uuid().v4(), 'name': ''},
                  ]
                : <Map<String, dynamic>>[],
          }),
        ),
        for (var i = 0; i < chemicals.length; i++)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              children: [
                for (final field in <String, String>{
                  'name': l.washProductName,
                  'manufacturer': l.washManufacturer,
                  'quantity': l.washQuantity,
                  'dilution': l.washDilution,
                }.entries)
                  TextFormField(
                    key: ValueKey(
                      'chemical-${chemicals[i]['id'] ?? i}-${field.key}',
                    ),
                    initialValue: chemicals[i][field.key] as String? ?? '',
                    maxLength: field.key == 'quantity'
                        ? 40
                        : field.key == 'dilution'
                            ? 120
                            : 160,
                    decoration: InputDecoration(
                      labelText: field.value,
                      counterText: '',
                    ),
                    onChanged: (v) =>
                        updateItem('chemicals', chemicals, i, field.key, v),
                  ),
                TextButton(
                  onPressed: () => onChanged({
                    ...value,
                    'chemicals': [
                      for (var n = 0; n < chemicals.length; n++)
                        if (n != i) chemicals[n],
                    ],
                  }),
                  child: Text(l.washRemoveProduct),
                ),
              ],
            ),
          ),
        if (value['chemical_status'] == 'used' && chemicals.length < 10)
          TextButton(
            onPressed: () => onChanged({
              ...value,
              'chemicals': [
                ...chemicals,
                {'id': const Uuid().v4(), 'name': ''},
              ],
            }),
            child: Text(l.washAddProduct),
          ),
        const SizedBox(height: 12),
        Text(
          l.washChecklistTitle,
          style: Theme.of(context).textTheme.titleSmall,
        ),
        for (var i = 0; i < checks.length; i++)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(washCheckLabel(l, checks[i]['label'] as String)),
                DropdownButtonFormField<String>(
                  key: ValueKey('check-$i-${checks[i]['result']}'),
                  initialValue: checks[i]['result'] as String,
                  isExpanded: true,
                  items: washResultLabels(l)
                      .entries
                      .map(
                        (e) => DropdownMenuItem(
                          value: e.key,
                          child: Text(e.value),
                        ),
                      )
                      .toList(),
                  onChanged: (v) => updateItem(
                    'checklist',
                    checks,
                    i,
                    'result',
                    v ?? 'not_checked',
                  ),
                ),
                if (checks[i]['result'] == 'fail' ||
                    (checks[i]['note'] as String? ?? '').isNotEmpty)
                  TextFormField(
                    initialValue: checks[i]['note'] as String? ?? '',
                    maxLength: 1000,
                    decoration: InputDecoration(labelText: l.washIssueNote),
                    onChanged: (v) =>
                        updateItem('checklist', checks, i, 'note', v),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
