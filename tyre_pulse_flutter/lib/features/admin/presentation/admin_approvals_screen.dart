/// `/admin/approvals` - both sign-off queues in one place.
///
/// Deliberately owns NO approval logic. Each tab is the existing queue screen
/// from `features/approvals` - the same repository, offline decision queue and
/// review screen the Approvals tab uses - so there is one implementation of
/// who may sign what, not two.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/approvals/presentation/'
    'checklist_approvals_queue_screen.dart';
import 'package:tyre_pulse/features/approvals/presentation/'
    'inspection_approvals_queue_screen.dart';

enum AdminApprovalsTab { inspections, checklists }

class AdminApprovalsScreen extends StatefulWidget {
  const AdminApprovalsScreen({
    required this.route,
    this.inspectionsBuilder,
    this.checklistsBuilder,
    super.key,
  });

  final AdminApprovalsRoute route;

  /// Test seams. Production uses the real queue screens.
  final WidgetBuilder? inspectionsBuilder;
  final WidgetBuilder? checklistsBuilder;

  @override
  State<AdminApprovalsScreen> createState() => _AdminApprovalsScreenState();
}

class _AdminApprovalsScreenState extends State<AdminApprovalsScreen> {
  AdminApprovalsTab _tab = AdminApprovalsTab.inspections;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final TpPalette palette = TpPalette.of(context);
    return TpScaffold(
      backFallback: fallback,
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          color: palette.surface,
          border: Border(top: BorderSide(color: palette.border)),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.all(TpSpace.md),
            child: TpSegmented<AdminApprovalsTab>(
              key: const Key('admin.approvals.tabs'),
              expanded: true,
              value: _tab,
              onChanged: (AdminApprovalsTab tab) => setState(() => _tab = tab),
              options: <TpSegmentedOption<AdminApprovalsTab>>[
                TpSegmentedOption<AdminApprovalsTab>(
                  value: AdminApprovalsTab.inspections,
                  label: l10n.adminApprovalsTabInspections,
                  icon: Icons.fact_check_outlined,
                ),
                TpSegmentedOption<AdminApprovalsTab>(
                  value: AdminApprovalsTab.checklists,
                  label: l10n.adminApprovalsTabChecklists,
                  icon: Icons.checklist_rtl_outlined,
                ),
              ],
            ),
          ),
        ),
      ),
      // IndexedStack keeps both queues alive, so switching back does not
      // re-fetch or lose a scroll position.
      body: IndexedStack(
        index: _tab.index,
        children: <Widget>[
          (widget.inspectionsBuilder ??
              (BuildContext _) => const InspectionApprovalsQueueScreen(
                    route: InspectionApprovalsRoute(),
                  ))(
            context,
          ),
          (widget.checklistsBuilder ??
              (BuildContext _) => const ChecklistApprovalsQueueScreen(
                    route: ChecklistApprovalsRoute(),
                  ))(
            context,
          ),
        ],
      ),
    );
  }
}
