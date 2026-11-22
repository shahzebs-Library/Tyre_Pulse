import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/queue_list_kit.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;
import 'package:widgetbook_workspace/components/catalogue_support.dart';

@widgetbook.UseCase(name: 'Settings-style rows', type: TpActionRow, path: CataloguePath.lists)
Widget actionRows(BuildContext context) {
  final String label = labelKnob(context, 'Language');
  final TpPalette p = TpPalette.of(context);
  return ColoredBox(
    color: p.surface,
    child: ListView(
      children: <Widget>[
        TpActionRow(label: label, value: 'English', icon: Icons.language, onTap: noop),
        const TpActionRow(label: 'Signed in as', value: 'Inspector', icon: Icons.person_outline),
        TpActionRow(
          label: 'Pending uploads',
          value: '3',
          icon: Icons.cloud_upload_outlined,
          tone: TpStatus.warning,
          onTap: noop,
        ),
        TpActionRow(
          label: 'Dark theme',
          icon: Icons.dark_mode_outlined,
          trailing: Switch(value: false, onChanged: (_) {}),
        ),
        TpActionRow(
          label: 'Sign out',
          icon: Icons.logout,
          tone: TpStatus.critical,
          onTap: noop,
          showDivider: false,
        ),
      ],
    ),
  );
}

@widgetbook.UseCase(name: 'Queue rows', type: QueueListRow, path: CataloguePath.lists)
Widget queueRows(BuildContext context) {
  final String title = labelKnob(context, 'TM-1042 daily inspection');
  final TpPalette p = TpPalette.of(context);
  return ColoredBox(
    color: p.surface,
    child: ListView(
      children: <Widget>[
        QueueSectionHeader(title: 'Waiting for you', actionLabel: 'See all', onAction: noop),
        QueueListRow(
          icon: Icons.fact_check_outlined,
          status: TpStatus.warning,
          title: title,
          tags: const <Widget>[QueueStatusTag(label: 'Pending', status: TpStatus.warning)],
          time: '08:40',
          details: const <String>['NHC Riyadh', 'Ahmed K.'],
          onTap: noop,
          isFirst: true,
        ),
        QueueListRow(
          icon: Icons.car_crash_outlined,
          status: TpStatus.critical,
          title: 'Accident ACC-2026-0148',
          tags: const <Widget>[
            QueueStatusTag(label: 'Major', status: TpStatus.critical),
            QueueStatusTag(label: 'Insurance', status: TpStatus.info),
          ],
          time: 'Yesterday',
          details: const <String>['CP-045'],
          onTap: noop,
        ),
        const QueueListRow(
          icon: Icons.checklist,
          status: TpStatus.unknown,
          title: 'Workshop daily checklist',
          details: <String>['Not started'],
          showDivider: false,
        ),
      ],
    ),
  );
}

@widgetbook.UseCase(name: 'Filter chips and tags', type: QueueFilterChip, path: CataloguePath.lists)
Widget queueFilters(BuildContext context) {
  return CatalogueFrame(
    children: <Widget>[
      Labelled(
        'Filter chips',
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: <Widget>[
            QueueFilterChip(label: 'All', selected: true, onSelected: noop),
            QueueFilterChip(label: 'Inspections', selected: false, onSelected: noop),
            QueueFilterChip(label: labelKnob(context, 'Checklists'), selected: false, onSelected: noop),
          ],
        ),
      ),
      Labelled(
        'Status tags',
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: <Widget>[
            for (final TpStatus s in TpStatus.values) QueueStatusTag(label: s.name, status: s),
          ],
        ),
      ),
      Labelled(
        'Primary lift',
        QueuePrimaryLift(child: TpButton(label: 'Approve all', onPressed: noop, isFullWidth: true)),
      ),
    ],
  );
}
