/// Checklist and chemicals for one wash. The collapsed header already says
/// how far the checklist got ("3 of 5 checked", products, issues), so a
/// supervisor can read it without opening the panel.
///
/// What is stored is unchanged: `wash_details` keeps `chemical_status`,
/// `chemicals[]` and `checklist[]` with `result` in
/// not_checked / pass / fail / na. Tapping the chosen result again clears it
/// back to not_checked.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/features/washing/domain/wash_details.dart';
import 'package:uuid/uuid.dart';

/// Checklist items that carry a result other than "not checked".
int washChecklistDone(Map<String, dynamic> details) =>
    detailItems(details, 'checklist')
        .where(
          (c) => (c['result'] as String? ?? 'not_checked') != 'not_checked',
        )
        .length;

int washChecklistIssues(Map<String, dynamic> details) => detailItems(
      details,
      'checklist',
    ).where((c) => c['result'] == 'fail').length;

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
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final chemicals = detailItems(value, 'chemicals'),
        checks = detailItems(value, 'checklist');
    final String chemicalStatus =
        value['chemical_status'] as String? ?? 'not_recorded';
    final int done = washChecklistDone(value);
    final int issues = washChecklistIssues(value);

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

    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: Material(
        type: MaterialType.transparency,
        child: ExpansionTile(
          tilePadding: EdgeInsets.zero,
          childrenPadding: const EdgeInsets.only(bottom: TpSpace.sm),
          leading: Icon(Icons.fact_check_rounded, color: palette.primary),
          title: Text(
            l.washChecklistProgress(done, checks.length),
            style: text.titleSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          subtitle: Text(
            [
              if (chemicalStatus == 'used')
                l.washProductsCount(chemicals.length)
              else if (chemicalStatus == 'none')
                l.washNoChemical
              else
                '${l.washChemicalUseLabel}: ${l.washNotRecorded}',
              if (issues > 0) l.washIssuesCount(issues),
            ].join(' · '),
            style: text.bodySmall?.copyWith(
              color: issues > 0 ? palette.warning.base : palette.textSecondary,
            ),
          ),
          children: [
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Text(l.washChecklistTitle, style: text.labelLarge),
            ),
            for (var i = 0; i < checks.length; i++)
              _CheckRow(
                key: ValueKey<String>('washing.checkRow.$i'),
                label: washCheckLabel(l, checks[i]['label'] as String),
                result: checks[i]['result'] as String? ?? 'not_checked',
                note: checks[i]['note'] as String? ?? '',
                onResult: (r) =>
                    updateItem('checklist', checks, i, 'result', r),
                onNote: (v) => updateItem('checklist', checks, i, 'note', v),
              ),
            const SizedBox(height: TpSpace.md),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Text(l.washChemicalUseLabel, style: text.labelLarge),
            ),
            const SizedBox(height: TpSpace.xs),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Wrap(
                spacing: TpSpace.sm,
                runSpacing: TpSpace.xs,
                children: [
                  for (final MapEntry<String, String> option
                      in <String, String>{
                    'not_recorded': l.washNotRecorded,
                    'none': l.washNoChemical,
                    'used': l.washChemicalUsed,
                  }.entries)
                    ChoiceChip(
                      key: ValueKey<String>('washing.chemical.${option.key}'),
                      label: Text(option.value),
                      selected: chemicalStatus == option.key,
                      onSelected: (_) => onChanged({
                        ...value,
                        'chemical_status': option.key,
                        'chemicals': option.key == 'used'
                            ? (chemicals.isEmpty
                                ? <Map<String, dynamic>>[
                                    {'id': const Uuid().v4(), 'name': ''},
                                  ]
                                : chemicals)
                            : <Map<String, dynamic>>[],
                      }),
                    ),
                ],
              ),
            ),
            for (var i = 0; i < chemicals.length; i++)
              Container(
                margin: const EdgeInsets.only(top: TpSpace.sm),
                padding: const EdgeInsets.all(TpSpace.md),
                decoration: BoxDecoration(
                  color: palette.surfaceAlt,
                  borderRadius: BorderRadius.circular(TpRadius.md),
                ),
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
                    Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: TextButton.icon(
                        icon: const Icon(Icons.delete_outline_rounded),
                        onPressed: () => onChanged({
                          ...value,
                          'chemicals': [
                            for (var n = 0; n < chemicals.length; n++)
                              if (n != i) chemicals[n],
                          ],
                        }),
                        label: Text(l.washRemoveProduct),
                      ),
                    ),
                  ],
                ),
              ),
            if (chemicalStatus == 'used' && chemicals.length < 10)
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton.icon(
                  icon: const Icon(Icons.science_rounded),
                  onPressed: () => onChanged({
                    ...value,
                    'chemicals': [
                      ...chemicals,
                      {'id': const Uuid().v4(), 'name': ''},
                    ],
                  }),
                  label: Text(l.washAddProduct),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _CheckRow extends StatelessWidget {
  const _CheckRow({
    required this.label,
    required this.result,
    required this.note,
    required this.onResult,
    required this.onNote,
    super.key,
  });

  final String label;
  final String result;
  final String note;
  final ValueChanged<String> onResult;
  final ValueChanged<String> onNote;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final (IconData icon, Color color) = switch (result) {
      'pass' => (Icons.check_circle_rounded, palette.ok.base),
      'fail' => (Icons.error_rounded, palette.critical.base),
      'na' => (Icons.remove_circle_outline_rounded, palette.textMuted),
      _ => (Icons.radio_button_unchecked_rounded, palette.textMuted),
    };
    final Map<String, (String, TpStatusColors)> options =
        <String, (String, TpStatusColors)>{
      'pass': (l.washChecked, palette.ok),
      'fail': (l.washIssueFound, palette.critical),
      'na': (l.washNotApplicable, palette.neutral),
    };
    return Container(
      margin: const EdgeInsets.only(top: TpSpace.sm),
      padding: const EdgeInsets.all(TpSpace.md),
      decoration: BoxDecoration(
        color: palette.surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(
          color: result == 'fail' ? palette.critical.base : palette.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 22),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  label,
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.xs,
            children: [
              for (final MapEntry<String, (String, TpStatusColors)> o
                  in options.entries)
                ChoiceChip(
                  key: ValueKey<String>('washing.checkResult.${o.key}'),
                  label: Text(o.value.$1),
                  selected: result == o.key,
                  selectedColor: o.value.$2.soft,
                  labelStyle: result == o.key
                      ? TextStyle(
                          color: o.value.$2.onSoft,
                          fontWeight: FontWeight.w800,
                        )
                      : null,
                  onSelected: (_) =>
                      onResult(result == o.key ? 'not_checked' : o.key),
                ),
            ],
          ),
          if (result == 'fail' || note.isNotEmpty)
            TextFormField(
              initialValue: note,
              maxLength: 1000,
              decoration: InputDecoration(labelText: l.washIssueNote),
              onChanged: onNote,
            ),
        ],
      ),
    );
  }
}
