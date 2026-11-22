import 'package:flutter/material.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/inspection_signature_pad.dart';
import 'package:widgetbook/widgetbook.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;
import 'package:widgetbook_workspace/components/catalogue_support.dart';

/// One of the six near-identical signature pads in the app (inspection,
/// checklist, two approval pads, meter log, handover). Shown here so the
/// consolidation in Phase 4 has a reference.
@widgetbook.UseCase(name: 'Empty and read-only', type: InspectionSignaturePad, path: CataloguePath.capture)
Widget signaturePad(BuildContext context) {
  final bool readOnly = context.knobs.boolean(label: 'Read only', initialValue: false);
  return CatalogueFrame(
    children: <Widget>[
      Labelled('Draw here', InspectionSignaturePad(readOnly: readOnly, onChanged: (_) {})),
    ],
  );
}
