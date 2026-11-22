import 'package:flutter/material.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:widgetbook/widgetbook.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;
import 'package:widgetbook_workspace/app_assets.dart';
import 'package:widgetbook_workspace/components/catalogue_support.dart';

@widgetbook.UseCase(name: 'Title, subtitle, actions', type: TpAppBar, path: CataloguePath.navigation)
Widget appBar(BuildContext context) {
  final String title = labelKnob(context, 'Inspection TM-1042');
  final bool subtitle = context.knobs.boolean(label: 'Subtitle', initialValue: true);
  final bool back = context.knobs.boolean(label: 'Back button', initialValue: true);
  final bool actions = context.knobs.boolean(label: 'Actions', initialValue: true);
  return Scaffold(
    appBar: TpAppBar(
      title: title,
      subtitle: subtitle ? 'NHC Riyadh - draft' : null,
      showBack: back,
      onBack: noop,
      actions: actions
          ? <Widget>[
              IconButton(onPressed: noop, icon: const Icon(Icons.qr_code_scanner), tooltip: 'Scan'),
              IconButton(onPressed: noop, icon: const Icon(Icons.more_vert), tooltip: 'More'),
            ]
          : null,
    ),
    body: const SizedBox.shrink(),
  );
}

@widgetbook.UseCase(name: 'With banner and FAB', type: TpScaffold, path: CataloguePath.navigation)
Widget scaffold(BuildContext context) {
  final bool banner = context.knobs.boolean(label: 'Offline banner', initialValue: true);
  return TpScaffold(
    appBar: const TpAppBar(title: 'My work', showBack: false),
    banner: banner
        ? const TpOfflineBanner(
            summary: TpSyncSummary(connectivity: TpConnectivity.offline, pendingCount: 2),
          )
        : null,
    floatingActionButton: FloatingActionButton.extended(
      onPressed: noop,
      icon: const Icon(Icons.add),
      label: const Text('New inspection'),
    ),
    body: const TpEmptyState(),
  );
}

@widgetbook.UseCase(name: 'Full and compact', type: TpBrandLockup, path: CataloguePath.navigation)
Widget brandLockup(BuildContext context) {
  return withAppAssets(
    const CatalogueFrame(
      children: <Widget>[
        Labelled('Full', TpBrandLockup()),
        Labelled('Compact', TpBrandLockup(compact: true)),
      ],
    ),
  );
}
