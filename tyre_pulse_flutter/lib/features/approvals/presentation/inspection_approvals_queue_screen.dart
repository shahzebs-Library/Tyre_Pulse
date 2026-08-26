/// Inspection approvals - the supervisor's queue.
///
/// Lists inspections submitted from the field that are awaiting sign-off
/// (`approval_status = 'pending_approval'`), newest first. Each row opens
/// [InspectionApprovalReviewScreen], where the supervisor inspects the
/// recorded tyre conditions and the inspector's drawn signature and either
/// approves (with their own signature) or returns it.
///
/// Ported from `mobile/app/(app)/inspection/approvals/index.tsx`
/// (`mobile/` is READ-ONLY reference material). Access is gated by
/// `RouteModule.approvals` at the router (`app/router/route_access.dart`)
/// AND by the `inspections` RLS at the database, exactly as the mobile
/// screen's own comment states: "hiding the entry is never the only
/// defence" - so this screen, unlike its mobile counterpart, does not
/// re-implement its own `canAccess` gate at all.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/approvals/inspection_approvals_providers.dart';

class InspectionApprovalsQueueScreen extends ConsumerStatefulWidget {
  const InspectionApprovalsQueueScreen({required this.route, super.key});

  final InspectionApprovalsRoute route;

  @override
  ConsumerState<InspectionApprovalsQueueScreen> createState() =>
      _InspectionApprovalsQueueScreenState();
}

class _InspectionApprovalsQueueScreenState
    extends ConsumerState<InspectionApprovalsQueueScreen> {
  bool _loading = true;
  bool _refreshing = false;
  AppError? _error;
  List<InspectionApprovalItem> _items = const <InspectionApprovalItem>[];

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
    final String? country = ref.read(activeCountryProvider);
    try {
      final List<InspectionApprovalItem> items = await ref
          .read(inspectionApprovalRepositoryProvider)
          .listPending(country: country);
      if (!mounted) return;
      setState(() {
        _items = items;
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

  Future<void> _refresh() async {
    setState(() => _refreshing = true);
    await _load();
    if (mounted) setState(() => _refreshing = false);
  }

  void _open(InspectionApprovalItem item) {
    context.push(
      InspectionApprovalReviewRoute(
        inspectionId: InspectionId(item.id),
      ).location,
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.inspectionApprovalsTitle,
        subtitle: _loading
            ? null
            : l10n.inspectionApprovalsAwaitingCount(_items.length),
        backFallback: fallback,
      ),
      body: _body(l10n),
    );
  }

  Widget _body(AppLocalizations l10n) {
    if (_loading) return const TpLoadingState();
    if (_error != null) {
      return TpErrorState(error: _error!, onRetry: _load);
    }
    if (_items.isEmpty) {
      return RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          children: <Widget>[
            SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.6,
              child: TpEmptyState(
                icon: Icons.checklist_rtl_outlined,
                title: l10n.inspectionApprovalsEmptyTitle,
                message: l10n.inspectionApprovalsEmptyMessage,
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        itemCount: _items.length,
        itemBuilder: (BuildContext context, int index) => _QueueRow(
          item: _items[index],
          fallbackTitle: l10n.inspectionApprovalFallbackTitle,
          inspectorFallback: l10n.inspectionInspectorUnknown,
          pendingLabel: l10n.inspectionApprovalsPendingBadge,
          unavailableLabel: l10n.valueUnavailable,
          onTap: () => _open(_items[index]),
        ),
      ),
    );
  }
}

/// Mirrors `scan_lookup.dart`'s own private `_asAppError`: any
/// [AppError]/[SupabaseFailure] carries a message already safe to show;
/// anything else falls back to a translated generic sentence rather than a
/// raw driver message.
AppError _asAppError(BuildContext context, Object error) {
  if (error is AppError) return error;
  if (error is SupabaseFailure) return error.error;
  return AppError(
    kind: AppErrorKind.unknown,
    message: AppLocalizations.of(context).inspectionApprovalsLoadErrorMessage,
    technical: error.toString(),
    cause: error,
    isRetryable: true,
  );
}

class _QueueRow extends StatelessWidget {
  const _QueueRow({
    required this.item,
    required this.fallbackTitle,
    required this.inspectorFallback,
    required this.pendingLabel,
    required this.unavailableLabel,
    required this.onTap,
  });

  final InspectionApprovalItem item;
  final String fallbackTitle;
  final String inspectorFallback;
  final String pendingLabel;
  final String unavailableLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final bool isRtl = TpDirection.isRtl(context);
    final String heading = _headingFor(item, fallbackTitle);
    final String when = _formatDate(item.createdAt) ?? unavailableLabel;

    return TpCard(
      onTap: onTap,
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      child: Row(
        children: <Widget>[
          DecoratedBox(
            decoration: BoxDecoration(
              color: palette.forStatus(TpStatus.warning).soft,
              shape: BoxShape.circle,
            ),
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.sm),
              child: Icon(
                Icons.assignment_outlined,
                size: TpSizing.iconMd,
                color: palette.forStatus(TpStatus.warning).onSoft,
              ),
            ),
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  heading,
                  style: Theme.of(context).textTheme.titleSmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (item.site != null && item.site!.trim().isNotEmpty)
                  _MetaRow(icon: Icons.place_outlined, text: item.site!),
                _MetaRow(
                  icon: Icons.person_outline,
                  text: item.inspector?.trim().isNotEmpty == true
                      ? item.inspector!.trim()
                      : inspectorFallback,
                  trailing: when,
                ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          if (item.inspectorSignature != null &&
              item.inspectorSignature!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: TpSpace.xs),
              child: Icon(
                Icons.draw_outlined,
                size: TpSizing.iconSm,
                color: palette.forStatus(TpStatus.ok).base,
              ),
            ),
          TpStatusChip(
            status: TpStatus.warning,
            label: pendingLabel,
            isCompact: true,
          ),
          const SizedBox(width: TpSpace.xs),
          Icon(
            isRtl ? Icons.chevron_left : Icons.chevron_right,
            color: palette.textMuted,
          ),
        ],
      ),
    );
  }

  /// `[asset_no, vehicle_type].join(' - ')`, falling back to the row's own
  /// `title` and then to [fallbackTitle] - mirrors the mobile queue row's
  /// own `[s.asset_no, s.vehicle_type].filter(Boolean).join(' · ') ||
  /// s.title || 'Inspection'`.
  static String _headingFor(
    InspectionApprovalItem item,
    String fallbackTitle,
  ) {
    final String assetAndType = <String?>[item.assetNo, item.vehicleType]
        .where((String? v) => v != null && v.trim().isNotEmpty)
        .join(' - ');
    if (assetAndType.isNotEmpty) return assetAndType;
    final String title = item.title?.trim() ?? '';
    return title.isNotEmpty ? title : fallbackTitle;
  }

  static String? _formatDate(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    final DateTime? parsed = DateTime.tryParse(iso);
    if (parsed == null) return null;
    final DateTime local = parsed.toLocal();
    final String y = local.year.toString().padLeft(4, '0');
    final String m = local.month.toString().padLeft(2, '0');
    final String d = local.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }
}

class _MetaRow extends StatelessWidget {
  const _MetaRow({required this.icon, required this.text, this.trailing});

  final IconData icon;
  final String text;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextStyle? style = Theme.of(
      context,
    ).textTheme.bodySmall?.copyWith(color: palette.textMuted);
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Row(
        children: <Widget>[
          Icon(icon, size: TpSizing.iconSm, color: palette.textMuted),
          const SizedBox(width: TpSpace.xs),
          Flexible(
            child: Text(
              text,
              style: style,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (trailing != null) ...<Widget>[
            const SizedBox(width: TpSpace.xs),
            Text(trailing!, style: style),
          ],
        ],
      ),
    );
  }
}
