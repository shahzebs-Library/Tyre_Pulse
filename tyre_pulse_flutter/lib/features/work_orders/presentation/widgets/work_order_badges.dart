/// Renders `domain/work_order_status.dart`'s pure tone/label logic as
/// [TpStatusChip]s and localised strings - the list row, the detail
/// screen and the create sheet all need the exact same mapping, so it
/// lives here once rather than several times.
///
/// Mirrors
/// `features/approvals/presentation/widgets/checklist_approval_status_chip
/// .dart`'s own split exactly: the domain file stays pure Dart with no
/// design-system or localisation dependency, and this file is the later
/// UI task that reads its tone/holder-shaped output and picks the matching
/// [TpStatus] and ARB string.
///
/// # Status and priority BADGES show the row's own raw text, never a
/// # translated word
///
/// `work_orders.status`/`work_orders.priority` are free text on the live
/// schema (see `work_order_status.dart`'s own library comment), and the
/// reference screen itself renders `item.status`/`item.priority` verbatim
/// - `<Badge>{item.status ?? t('modules.workOrders.statusOpen')}</Badge>`,
/// `<Badge>{item.priority}</Badge>` with no badge at all when priority is
/// null. [workOrderStatusLabel]/[workOrderPriorityLabel] reproduce exactly
/// that: the stored value verbatim when present (so a legacy or
/// unexpected casing is never silently rewritten into something the fleet
/// never actually recorded), and a translated fallback ONLY for the one
/// case the reference itself falls back for - a blank status. There is no
/// translated fallback for a blank priority because the reference renders
/// no badge at all in that case; [WorkOrderPriorityChip] mirrors that by
/// simply not being built when [WorkOrderItem.priority] is blank (see its
/// call sites).
///
/// # The CREATE FORM'S options are translated; a saved row's value is not
///
/// [workOrderWorkTypeOptionLabel]/[workOrderPriorityOptionLabel] translate
/// the SIX fixed work types and FOUR fixed priorities for the picker in
/// the create sheet, mirroring the reference's own `t('modules.workTypes
/// .${w}')`/`t('modules.priority.${p}')`. Once a value is stored, it is
/// read back and shown as the raw English word it was written as - see
/// the section above.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/work_orders/domain/work_order_status.dart';

TpStatus workOrderToneToStatus(WorkOrderTone tone) => switch (tone) {
      WorkOrderTone.info => TpStatus.info,
      WorkOrderTone.ok => TpStatus.ok,
      WorkOrderTone.warning => TpStatus.warning,
      WorkOrderTone.critical => TpStatus.critical,
      WorkOrderTone.neutral => TpStatus.neutral,
    };

/// The words shown on a status badge for [status]. See the library
/// comment: the raw value wins whenever one exists.
String workOrderStatusLabel(AppLocalizations l10n, String? status) {
  final String trimmed = status?.trim() ?? '';
  return trimmed.isEmpty ? l10n.workOrdersStatusOpenFallback : trimmed;
}

/// The words shown for [workType] in a list row or the detail screen. See
/// the library comment: the raw value wins whenever one exists.
String workOrderWorkTypeLabel(AppLocalizations l10n, String? workType) {
  final String trimmed = workType?.trim() ?? '';
  return trimmed.isEmpty ? l10n.workOrdersWorkTypeFallback : trimmed;
}

/// The translated option label for one of [kWorkOrderWorkTypes], for the
/// create sheet's picker only. Falls back to [type] itself for a value
/// this vocabulary somehow does not carry a translation for, so the
/// picker can never render a blank option.
String workOrderWorkTypeOptionLabel(AppLocalizations l10n, String type) {
  switch (type) {
    case 'Tyre Change':
      return l10n.workOrderWorkTypeTyreChange;
    case 'Repair':
      return l10n.workOrderWorkTypeRepair;
    case 'Rotation':
      return l10n.workOrderWorkTypeRotation;
    case 'Alignment':
      return l10n.workOrderWorkTypeAlignment;
    case 'Inspection':
      return l10n.workOrderWorkTypeInspection;
    case 'Other':
      return l10n.workOrderWorkTypeOther;
    default:
      return type;
  }
}

/// The translated option label for one of [kWorkOrderPriorities], for the
/// create sheet's picker only. Falls back to [priority] itself for the
/// same reason as [workOrderWorkTypeOptionLabel].
String workOrderPriorityOptionLabel(AppLocalizations l10n, String priority) {
  switch (priority) {
    case 'Low':
      return l10n.workOrderPriorityLow;
    case 'Medium':
      return l10n.workOrderPriorityMedium;
    case 'High':
      return l10n.workOrderPriorityHigh;
    case 'Critical':
      return l10n.workOrderPriorityCritical;
    default:
      return priority;
  }
}

/// A [TpStatusChip] for a work order's status.
class WorkOrderStatusChip extends StatelessWidget {
  const WorkOrderStatusChip({
    required this.status,
    this.isCompact = false,
    super.key,
  });

  final String? status;
  final bool isCompact;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpStatusChip(
      status: workOrderToneToStatus(workOrderStatusTone(status)),
      label: workOrderStatusLabel(l10n, status),
      isCompact: isCompact,
    );
  }
}

/// A [TpStatusChip] for a work order's priority.
///
/// Callers should not build this at all when [priority] is blank - see the
/// library comment on why the reference shows no priority badge in that
/// case.
class WorkOrderPriorityChip extends StatelessWidget {
  const WorkOrderPriorityChip({
    required this.priority,
    this.isCompact = false,
    super.key,
  });

  final String priority;
  final bool isCompact;

  @override
  Widget build(BuildContext context) {
    return TpStatusChip(
      status: workOrderToneToStatus(workOrderPriorityTone(priority)),
      label: priority,
      isCompact: isCompact,
    );
  }
}
