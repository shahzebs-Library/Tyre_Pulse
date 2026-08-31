/// Vehicle-shaped position picker shared by the tyre-replacement flow.
///
/// The diagram receives V1 inspection slot ids while the replacement write
/// keeps using the V2 canonical code exposed by
/// [TyreReplacementPositionOption]. This adapter is deliberately the only
/// place where the visual selection crosses that vocabulary boundary.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_board.dart';
import 'package:tyre_pulse/features/tyre_exchange/domain/tyre_replacement_position.dart';

@visibleForTesting
abstract final class TyreReplacementPositionPickerKeys {
  static const Key diagram = Key('tyre-replacement.position.diagram');
  static const Key selected = Key('tyre-replacement.position.selected');
  static const Key spare = Key('tyre-replacement.position.spare');
}

class TyreReplacementPositionPicker extends StatelessWidget {
  const TyreReplacementPositionPicker({
    required this.vehicleType,
    required this.assetNo,
    required this.options,
    required this.selectedCode,
    required this.onSelected,
    super.key,
  });

  final String vehicleType;
  final String? assetNo;
  final List<TyreReplacementPositionOption> options;
  final String selectedCode;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final List<TyreReplacementPositionOption> diagramOptions = options
        .where(
          (TyreReplacementPositionOption option) =>
              option.diagramSlotId != null,
        )
        .toList(growable: false);
    final TyreReplacementPositionOption? spare = _firstWhereOrNull(
      options,
      (TyreReplacementPositionOption option) => option.diagramSlotId == null,
    );
    final TyreReplacementPositionOption? selected = _firstWhereOrNull(
      options,
      (TyreReplacementPositionOption option) =>
          option.code.toUpperCase() == selectedCode.toUpperCase() ||
          option.diagramSlotId?.toUpperCase() == selectedCode.toUpperCase(),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final double available =
                constraints.maxWidth.isFinite ? constraints.maxWidth : 380;
            return TyreDiagramBoard(
              key: TyreReplacementPositionPickerKeys.diagram,
              vehicleType: vehicleType,
              assetNo: assetNo,
              positions: <String>[
                for (final TyreReplacementPositionOption option
                    in diagramOptions)
                  option.diagramSlotId!,
              ],
              tyreData: const <String, Map<String, Object?>>{},
              selectedPosition: selected?.diagramSlotId,
              onPositionTap: (String slotId) {
                final TyreReplacementPositionOption? option = _firstWhereOrNull(
                  diagramOptions,
                  (TyreReplacementPositionOption candidate) =>
                      candidate.diagramSlotId?.toUpperCase() ==
                      slotId.toUpperCase(),
                );
                if (option != null) onSelected(option.code);
              },
              width: available.clamp(300, 380).toDouble(),
              compact: true,
              captureMode: true,
            );
          },
        ),
        if (selected != null) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TpStatusChip(
              key: TyreReplacementPositionPickerKeys.selected,
              status: TpStatus.info,
              icon: Icons.tire_repair_outlined,
              label: selected.code,
            ),
          ),
        ],
        if (spare != null) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: KeyedSubtree(
              key: TyreReplacementPositionPickerKeys.spare,
              child: TpTyreChip(
                data: TpTyreChipData(position: spare.code),
                isSelected:
                    spare.code.toUpperCase() == selectedCode.toUpperCase(),
                onTap: () => onSelected(spare.code),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

T? _firstWhereOrNull<T>(Iterable<T> values, bool Function(T value) test) {
  for (final T value in values) {
    if (test(value)) return value;
  }
  return null;
}
