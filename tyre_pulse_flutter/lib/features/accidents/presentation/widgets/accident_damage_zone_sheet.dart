/// The bottom sheet opened by tapping one zone on [VehicleDamageDiagram] -
/// mirrors `TyrePositionEditorSheet`'s role for the tyre diagram, but for a
/// single damage mark rather than a running draft field.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_damage_copy.dart';

/// Opens the sheet for [zoneId], seeded from [existing] when the zone
/// already carries a mark. Resolves to the mark to save, or `null` when the
/// user removed the mark (or dismissed the sheet with no change to make -
/// [_AccidentDamageZoneSheetState] only ever pops `null` for "remove", never
/// for "cancelled with the existing mark untouched", so the caller cannot
/// mistake a dismiss for a deliberate removal).
Future<AccidentDamageZoneSheetResult?> showAccidentDamageZoneSheet(
  BuildContext context, {
  required AccidentDamageMark draft,
  required AccidentDamageMark? existing,
}) {
  return showModalBottomSheet<AccidentDamageZoneSheetResult>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (BuildContext context) => Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: _AccidentDamageZoneSheet(draft: draft, existing: existing),
    ),
  );
}

/// What the sheet resolved to: a mark to save, or a removal.
sealed class AccidentDamageZoneSheetResult {
  const AccidentDamageZoneSheetResult();
}

final class AccidentDamageZoneSheetSaved extends AccidentDamageZoneSheetResult {
  const AccidentDamageZoneSheetSaved(this.mark);
  final AccidentDamageMark mark;
}

final class AccidentDamageZoneSheetRemoved
    extends AccidentDamageZoneSheetResult {
  const AccidentDamageZoneSheetRemoved();
}

class _AccidentDamageZoneSheet extends StatefulWidget {
  const _AccidentDamageZoneSheet({required this.draft, required this.existing});

  final AccidentDamageMark draft;
  final AccidentDamageMark? existing;

  @override
  State<_AccidentDamageZoneSheet> createState() =>
      _AccidentDamageZoneSheetState();
}

class _AccidentDamageZoneSheetState extends State<_AccidentDamageZoneSheet> {
  late AccidentDamageSeverity _severity =
      widget.existing?.severity ?? AccidentDamageSeverity.minor;
  late final TextEditingController _area =
      TextEditingController(text: widget.draft.areaLabel ?? '');
  late final TextEditingController _note =
      TextEditingController(text: widget.existing?.note ?? '');

  @override
  void dispose() {
    _area.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AccidentCopy copy = AccidentCopy.of(context);
    final TpPalette palette = TpPalette.of(context);

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.xl,
        TpSpace.sm,
        TpSpace.xl,
        TpSpace.xl,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  color: palette.forStatus(TpStatus.warning).soft,
                  borderRadius: BorderRadius.circular(TpRadius.md),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(TpSpace.sm),
                  child: Icon(
                    Icons.warning_amber_rounded,
                    color: palette.forStatus(TpStatus.warning).onSoft,
                  ),
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      widget.draft.view == null
                          ? accidentDamageZoneLabel(
                              copy,
                              widget.draft.zoneId,
                            )
                          : accidentDamageViewLabel(
                              copy,
                              widget.draft.view!,
                            ),
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    if (widget.draft.hasExactPoint)
                      Text(
                        'X ${(widget.draft.normalizedX! * 100).round()}% / '
                        'Y ${(widget.draft.normalizedY! * 100).round()}%',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.xl),
          TpInput(
            label: copy('damage'),
            controller: _area,
            isRequired: true,
            prefixIcon: Icons.place_outlined,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: TpSpace.lg),
          Text(
            copy('damageMarkSeverityLabel'),
            style: Theme.of(context).textTheme.labelLarge,
          ),
          const SizedBox(height: TpSpace.sm),
          TpSegmented<AccidentDamageSeverity>(
            expanded: true,
            value: _severity,
            onChanged: (AccidentDamageSeverity value) =>
                setState(() => _severity = value),
            options: <TpSegmentedOption<AccidentDamageSeverity>>[
              for (final AccidentDamageSeverity severity
                  in AccidentDamageSeverity.values)
                TpSegmentedOption<AccidentDamageSeverity>(
                  value: severity,
                  label: accidentDamageSeverityLabel(copy, severity),
                ),
            ],
          ),
          const SizedBox(height: TpSpace.lg),
          TpInput(
            label: copy('damageMarkNoteLabel'),
            controller: _note,
            maxLines: 3,
          ),
          const SizedBox(height: TpSpace.xl),
          if (widget.existing != null) ...<Widget>[
            TpButton.secondary(
              label: copy('damageMarkRemove'),
              icon: Icons.delete_outline,
              isFullWidth: true,
              onPressed: () => Navigator.of(context).pop(
                const AccidentDamageZoneSheetRemoved(),
              ),
            ),
            const SizedBox(height: TpSpace.sm),
          ],
          TpButton.primary(
            label: copy('damageMarkSave'),
            icon: Icons.check,
            isFullWidth: true,
            onPressed: _area.text.trim().isEmpty
                ? null
                : () => Navigator.of(context).pop(
                      AccidentDamageZoneSheetSaved(
                        widget.draft.copyWith(
                          severity: _severity,
                          note: _note.text.trim().isEmpty
                              ? null
                              : _note.text.trim(),
                          areaLabel: _area.text.trim(),
                        ),
                      ),
                    ),
          ),
        ],
      ),
    );
  }
}
