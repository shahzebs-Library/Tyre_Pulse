import 'package:flutter/material.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_board.dart';
import 'package:widgetbook/widgetbook.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;

/// Sample readings only for the catalogue: nothing here reaches the app.
Map<String, Map<String, Object?>> _readings(
  List<String> positions,
  String Function(int index) conditionAt,
) {
  return <String, Map<String, Object?>>{
    for (int i = 0; i < positions.length; i++)
      positions[i]: <String, Object?>{
        'position': positions[i],
        'condition': conditionAt(i),
        'pressure_psi': 110 + (i % 3) * 5,
        'tread_depth_mm': 12 - (i % 4) * 2,
        'checked': true,
      },
  };
}

Widget _board(
  BuildContext context, {
  required String vehicleType,
  required Map<String, Map<String, Object?>> Function(List<String>) data,
}) {
  final bool capture = context.knobs.boolean(
    label: 'Capture map (inspection style)',
    initialValue: true,
  );
  final List<String> positions = diagramPositions(vehicleType);
  return SingleChildScrollView(
    padding: const EdgeInsets.all(16),
    child: TyreDiagramBoard(
      vehicleType: vehicleType,
      positions: positions,
      tyreData: data(positions),
      width: 360,
      compact: true,
      captureMode: capture,
      onPositionTap: (_) {},
    ),
  );
}

@widgetbook.UseCase(name: 'Mixer - no readings', type: TyreDiagramBoard)
Widget mixerEmpty(BuildContext context) => _board(
      context,
      vehicleType: 'TR-MIXER',
      data: (_) => const <String, Map<String, Object?>>{},
    );

@widgetbook.UseCase(name: 'Mixer - all good', type: TyreDiagramBoard)
Widget mixerGood(BuildContext context) => _board(
      context,
      vehicleType: 'TR-MIXER',
      data: (List<String> p) => _readings(p, (_) => 'Good'),
    );

@widgetbook.UseCase(name: 'Mixer - mixed faults', type: TyreDiagramBoard)
Widget mixerMixed(BuildContext context) => _board(
      context,
      vehicleType: 'TR-MIXER',
      data: (List<String> p) => _readings(
        p,
        (int i) => const <String>['Good', 'Worn', 'Good', 'Damaged', 'Flat'][i % 5],
      ),
    );

@widgetbook.UseCase(name: 'Wheel loader - all good', type: TyreDiagramBoard)
Widget loaderGood(BuildContext context) => _board(
      context,
      vehicleType: 'WHEEL_LOADER',
      data: (List<String> p) => _readings(p, (_) => 'Good'),
    );

@widgetbook.UseCase(name: 'Pump - half recorded', type: TyreDiagramBoard)
Widget pumpHalf(BuildContext context) => _board(
      context,
      vehicleType: 'PUMPS',
      data: (List<String> p) =>
          _readings(p.take(p.length ~/ 2).toList(), (_) => 'Good'),
    );
