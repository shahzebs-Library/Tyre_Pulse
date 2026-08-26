/// One work order, in full.
///
/// # A genuinely NEW surface, not a literal port of a modal
///
/// `routes.dart`'s own doc comment on [WorkOrderDetailRoute] is explicit:
/// "There is no work order detail route in the production app - both list
/// screens open a record in an in-page modal." This screen has no direct
/// reference counterpart to port field-for-field. It exists because the
/// route, the guard and a documented future notification journey
/// ("the notification must push this so Back gives Work Order, Workshop,
/// Home" - see `app/router/notification_routing.dart`'s own handling of a
/// work-order-carrying notification, which already resolves straight to
/// [WorkOrderDetailRoute]) were all decided in an earlier phase of this
/// migration, before this feature existed. So it must stand on its own:
/// it fetches its OWN copy of the row by id
/// (`WorkOrderRepository.byId`) rather than assuming
/// [WorkOrdersListScreen] already loaded it, exactly the way a
/// notification tap would reach it with nothing else in memory.
///
/// Shows every field [WorkOrdersListScreen]'s row already carries, plus
/// the three real, already-written columns that only make sense once a
/// job has moved (`started_at`, `completed_at`, `country` -
/// `data/work_order_item.dart`'s own [workOrderDetailColumns]), and offers
/// the SAME status-advance action the list row does - see
/// `work_orders_list_screen.dart`'s own library comment for why reaching
/// this screen at all is already the authorisation to act on it, with no
/// separate `mayEdit` check layered on top.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_item.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_repository.dart';
import 'package:tyre_pulse/features/work_orders/domain/work_order_status.dart';
import 'package:tyre_pulse/features/work_orders/presentation/widgets/work_order_badges.dart';
import 'package:tyre_pulse/features/work_orders/work_orders_providers.dart';

class WorkOrderDetailScreen extends ConsumerStatefulWidget {
  const WorkOrderDetailScreen({required this.route, super.key});

  final WorkOrderDetailRoute route;

  @override
  ConsumerState<WorkOrderDetailScreen> createState() =>
      _WorkOrderDetailScreenState();
}

class _WorkOrderDetailScreenState extends ConsumerState<WorkOrderDetailScreen> {
  bool _loading = true;
  AppError? _error;
  WorkOrderItem? _item;
  bool _advancing = false;

  String get _workOrderId => widget.route.workOrderId.value;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final WorkOrderItem? item = await ref
          .read(workOrderRepositoryProvider)
          .byId(_workOrderId);
      if (!mounted) return;
      setState(() {
        _item = item;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _asAppError(context, error);
        _loading = false;
      });
    }
  }

  Future<void> _advance() async {
    final WorkOrderItem? item = _item;
    if (item == null || _advancing) return;
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return;

    setState(() => _advancing = true);
    try {
      await ref
          .read(workOrderRepositoryProvider)
          .advanceStatus(workspace: workspace, current: item);
      if (!mounted) return;
      // Reload IN PLACE rather than navigating away - mirrors
      // `InspectionApprovalReviewScreen._decide`'s own choice: this is the
      // record the person is looking at, and staying on it shows the new
      // state as proof the action was recorded, rather than assuming they
      // wanted to leave.
      await _load();
      if (!mounted) return;
      final AppLocalizations l10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(content: Text(l10n.workOrderStatusQueuedMessage)),
        );
    } on Object {
      if (!mounted) return;
      final AppLocalizations l10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(content: Text(l10n.workOrderSaveFailedMessage)),
        );
    } finally {
      if (mounted) setState(() => _advancing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final WorkOrderItem? item = _item;

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: item?.assetNo?.trim().isNotEmpty == true
            ? TpDirection.isolateLtr(item!.assetNo!.trim())
            : l10n.workOrderDetailTitle,
        // A plain string slot - see `vehicle_detail_screen.dart`'s own
        // comment on why an identifier placed directly in `TpAppBar`'s
        // subtitle slot is isolated rather than wrapped in
        // [TpIdentifierText], which needs a widget slot this one is not.
        subtitle: item?.workOrderNo != null
            ? TpDirection.isolateLtr(item!.workOrderNo!)
            : null,
        backFallback: fallback,
      ),
      body: _body(l10n, item),
    );
  }

  Widget _body(AppLocalizations l10n, WorkOrderItem? item) {
    if (_loading) return const TpLoadingState();
    if (_error != null) {
      return TpErrorState(error: _error!, onRetry: _load);
    }
    if (item == null) {
      return TpEmptyState(
        icon: Icons.help_outline,
        title: l10n.workOrderNotFoundTitle,
        message: l10n.workOrderNotFoundMessage,
      );
    }

    final TpPalette palette = TpPalette.of(context);
    final String? next = nextWorkOrderStatus(item.status);
    final String workType = workOrderWorkTypeLabel(l10n, item.workType);

    final List<(String, String?)> fields = <(String, String?)>[
      (l10n.workOrderFieldWorkOrderNo, item.workOrderNo),
      (l10n.workOrderFieldWorkType, workType),
      (l10n.workOrderFieldSite, item.site),
      (l10n.workOrderFieldCountry, item.country),
      (l10n.workOrderFieldOpened, _formatTimestamp(item.openedAt)),
      (l10n.workOrderFieldStarted, _formatTimestamp(item.startedAt)),
      (l10n.workOrderFieldCompleted, _formatTimestamp(item.completedAt)),
    ];

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.xxxl,
      ),
      children: <Widget>[
        TpCard(
          margin: const EdgeInsets.only(bottom: TpSpace.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              TpIdentifierText(
                item.assetNo ?? l10n.valueNotMeasured,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: TpSpace.sm),
              Wrap(
                spacing: TpSpace.xs,
                runSpacing: TpSpace.xs,
                children: <Widget>[
                  WorkOrderStatusChip(status: item.status),
                  if (item.priority != null && item.priority!.trim().isNotEmpty)
                    WorkOrderPriorityChip(priority: item.priority!.trim()),
                ],
              ),
            ],
          ),
        ),
        if (item.description != null && item.description!.trim().isNotEmpty)
          TpCard(
            margin: const EdgeInsets.only(bottom: TpSpace.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.workOrderFieldDescription,
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                const SizedBox(height: TpSpace.xs),
                Text(
                  item.description!.trim(),
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
              ],
            ),
          ),
        TpCard(
          margin: const EdgeInsets.only(bottom: TpSpace.lg),
          padding: EdgeInsets.zero,
          child: Column(
            children: <Widget>[
              for (int i = 0; i < fields.length; i++)
                _FieldRow(
                  label: fields[i].$1,
                  value: fields[i].$2,
                  showDivider: i < fields.length - 1,
                  borderColor: palette.border,
                ),
            ],
          ),
        ),
        if (next != null)
          TpButton.primary(
            label: next == kWorkOrderStatusInProgress
                ? l10n.workOrderAdvanceToInProgress
                : l10n.workOrderAdvanceToCompleted,
            icon: Icons.arrow_forward_ios_rounded,
            isBusy: _advancing,
            isFullWidth: true,
            onPressed: _advancing ? null : _advance,
          ),
      ],
    );
  }

  static String? _formatTimestamp(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    final DateTime? parsed = DateTime.tryParse(iso);
    if (parsed == null) return null;
    final DateTime local = parsed.toLocal();
    final String y = local.year.toString().padLeft(4, '0');
    final String m = local.month.toString().padLeft(2, '0');
    final String d = local.day.toString().padLeft(2, '0');
    final String hh = local.hour.toString().padLeft(2, '0');
    final String mm = local.minute.toString().padLeft(2, '0');
    return '$y-$m-$d $hh:$mm';
  }
}

/// Mirrors `work_orders_list_screen.dart`'s own private `_asAppError`.
AppError _asAppError(BuildContext context, Object error) {
  if (error is AppError) return error;
  if (error is SupabaseFailure) return error.error;
  return AppError(
    kind: AppErrorKind.unknown,
    message: AppLocalizations.of(context).workOrderLoadErrorMessage,
    technical: error.toString(),
    cause: error,
    isRetryable: true,
  );
}

/// A labelled field, mirroring `vehicle_detail_screen.dart`'s own
/// `_FieldRow` shape. Each feature keeps its own copy of this small widget
/// rather than sharing one across top-level features, matching this
/// codebase's established convention (see, for one example among several,
/// `inspection_approval_signature_pad.dart`'s own library comment on why
/// sibling top-level features keep their own copies even of widgets that
/// look similar).
class _FieldRow extends StatelessWidget {
  const _FieldRow({
    required this.label,
    required this.value,
    required this.showDivider,
    required this.borderColor,
  });

  final String label;
  final String? value;
  final bool showDivider;
  final Color borderColor;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String display = value?.trim().isNotEmpty == true
        ? value!.trim()
        : l10n.valueNotMeasured;

    return Container(
      decoration: showDivider
          ? BoxDecoration(
              border: Border(bottom: BorderSide(color: borderColor)),
            )
          : null,
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.lg,
        vertical: TpSpace.md,
      ),
      child: Row(
        children: <Widget>[
          Expanded(flex: 2, child: Text(label, style: text.labelMedium)),
          Expanded(
            flex: 3,
            child: Text(
              display,
              style: text.bodyLarge,
              textAlign: TextAlign.end,
            ),
          ),
        ],
      ),
    );
  }
}
