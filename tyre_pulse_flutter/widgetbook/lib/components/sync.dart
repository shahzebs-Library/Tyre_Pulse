import 'package:flutter/material.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;
import 'package:widgetbook_workspace/components/catalogue_support.dart';

/// Every queue situation the field app can be in. Pending sync is the one a
/// worker most needs to see before closing the app.
const List<(String, TpSyncSummary)> _summaries = <(String, TpSyncSummary)>[
  ('Online, nothing queued', TpSyncSummary(connectivity: TpConnectivity.online)),
  ('Online, 3 pending', TpSyncSummary(connectivity: TpConnectivity.online, pendingCount: 3)),
  (
    'Syncing 2 of 5',
    TpSyncSummary(
      connectivity: TpConnectivity.online,
      pendingCount: 5,
      syncingCompleted: 2,
      syncingTotal: 5,
    ),
  ),
  ('Offline, 4 pending', TpSyncSummary(connectivity: TpConnectivity.offline, pendingCount: 4)),
  ('Offline, nothing queued', TpSyncSummary(connectivity: TpConnectivity.offline)),
  (
    'Needs attention',
    TpSyncSummary(connectivity: TpConnectivity.online, pendingCount: 2, attentionCount: 2),
  ),
  ('Connectivity unknown', TpSyncSummary.unknown()),
];

@widgetbook.UseCase(name: 'Every queue state', type: TpOfflineBanner, path: CataloguePath.sync)
Widget offlineBanners(BuildContext context) {
  return CatalogueFrame(
    children: <Widget>[
      for (final (String, TpSyncSummary) s in _summaries)
        Labelled(s.$1, TpOfflineBanner(summary: s.$2, onTap: noop)),
    ],
  );
}

@widgetbook.UseCase(name: 'Every queue state', type: TpSyncIndicator, path: CataloguePath.sync)
Widget syncIndicators(BuildContext context) {
  return CatalogueFrame(
    children: <Widget>[
      for (final (String, TpSyncSummary) s in _summaries)
        Labelled(
          s.$1,
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TpSyncIndicator(summary: s.$2, onTap: noop),
          ),
        ),
    ],
  );
}

@widgetbook.UseCase(name: 'Synced and pending', type: TpSyncLabel, path: CataloguePath.sync)
Widget syncLabel(BuildContext context) {
  final String label = labelKnob(context, 'Synced 2 min ago');
  return CatalogueFrame(
    children: <Widget>[
      Labelled('Synced', TpSyncLabel(label: label)),
      Labelled('Pending', TpSyncLabel(label: '3 waiting to sync', isPending: true)),
    ],
  );
}

/// Where the app actually places these: in the app bar's actions, which lay
/// their children out with unlimited width (My work, Vehicles, Report issue,
/// Inspection history). The render test fails if either throws here.
@widgetbook.UseCase(name: 'In the app bar', type: TpSyncIndicator, path: CataloguePath.sync)
Widget syncInAppBar(BuildContext context) {
  final String label = labelKnob(context, 'Synced 2 min ago');
  return Scaffold(
    appBar: TpAppBar(
      title: 'My work',
      showBack: false,
      actions: <Widget>[
        const Center(
          child: TpSyncIndicator(
            summary: TpSyncSummary(connectivity: TpConnectivity.offline, pendingCount: 4),
          ),
        ),
        Center(child: TpSyncLabel(label: label, isPending: true)),
        const SizedBox(width: 8),
      ],
    ),
    body: const SizedBox.shrink(),
  );
}
