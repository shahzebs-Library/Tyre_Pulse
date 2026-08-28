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

/// Stable finders for the responsive approvals queue presentation.
@visibleForTesting
abstract final class InspectionApprovalsQueueKeys {
  static const Key summary = Key('inspection.approvals.summary');
  static const Key list = Key('inspection.approvals.list');

  static Key row(String id) => Key('inspection.approvals.row.$id');
  static Key heading(String id) => Key('inspection.approvals.heading.$id');
}

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
  AppError? _error;
  List<InspectionApprovalItem> _items = const <InspectionApprovalItem>[];
  String _query = '';

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

  Future<void> _refresh() => _load();

  void _open(InspectionApprovalItem item) {
    context.push(
      InspectionApprovalReviewRoute(inspectionId: InspectionId(item.id))
          .location,
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

    final String needle = _query.trim().toLowerCase();
    final List<InspectionApprovalItem> visible = needle.isEmpty
        ? _items
        : _items.where((InspectionApprovalItem item) {
            return <String?>[
              item.assetNo,
              item.vehicleType,
              item.site,
              item.inspector,
              item.title,
              item.id,
            ].any(
              (String? value) =>
                  value?.trim().toLowerCase().contains(needle) == true,
            );
          }).toList(growable: false);

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView.builder(
        key: InspectionApprovalsQueueKeys.list,
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        itemCount: visible.isEmpty ? 2 : visible.length + 1,
        itemBuilder: (BuildContext context, int index) {
          if (index == 0) {
            return Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 900),
                child: _QueueSummary(
                  count: _items.length,
                  onSearchChanged: (String value) {
                    setState(() => _query = value);
                  },
                ),
              ),
            );
          }
          if (visible.isEmpty) {
            return SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.42,
              child: TpEmptyState(
                icon: Icons.search_off_outlined,
                title: l10n.globalSearchEmptyTitle,
                message: l10n.vehiclesEmptySearchMessage,
              ),
            );
          }
          final InspectionApprovalItem item = visible[index - 1];
          return Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 900),
              child: _QueueRow(
                item: item,
                fallbackTitle: l10n.inspectionApprovalFallbackTitle,
                inspectorFallback: l10n.inspectionInspectorUnknown,
                pendingLabel: l10n.inspectionApprovalsPendingBadge,
                unavailableLabel: l10n.valueUnavailable,
                onTap: () => _open(item),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _QueueSummary extends StatelessWidget {
  const _QueueSummary({
    required this.count,
    required this.onSearchChanged,
  });

  final int count;
  final ValueChanged<String> onSearchChanged;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      key: InspectionApprovalsQueueKeys.summary,
      margin: const EdgeInsets.only(bottom: TpSpace.lg),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.pending_actions_outlined,
                color: palette.primary,
                size: TpSizing.iconMd,
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  l10n.inspectionApprovalsPendingBadge,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        color: palette.primary,
                        fontWeight: FontWeight.w800,
                      ),
                ),
              ),
              TpStatusChip(
                status: TpStatus.info,
                label: count.toString(),
                isCompact: true,
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          Container(
            height: 3,
            decoration: BoxDecoration(
              color: palette.primary,
              borderRadius: BorderRadius.circular(TpRadius.pill),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpSearchField(onChanged: onSearchChanged),
        ],
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
      key: InspectionApprovalsQueueKeys.row(item.id),
      onTap: onTap,
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      padding: const EdgeInsets.all(TpSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
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
                child: Text(
                  heading,
                  key: InspectionApprovalsQueueKeys.heading(item.id),
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Icon(
                isRtl ? Icons.chevron_left : Icons.chevron_right,
                color: palette.textMuted,
              ),
            ],
          ),
          if (item.site != null && item.site!.trim().isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            _MetaRow(icon: Icons.place_outlined, text: item.site!),
          ],
          const SizedBox(height: TpSpace.xs),
          _MetaRow(
            icon: Icons.person_outline,
            text: item.inspector?.trim().isNotEmpty == true
                ? item.inspector!.trim()
                : inspectorFallback,
          ),
          const SizedBox(height: TpSpace.md),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              _MetaPill(icon: Icons.event_outlined, text: when),
              if (item.inspectorSignature != null &&
                  item.inspectorSignature!.isNotEmpty)
                Icon(
                  Icons.draw_outlined,
                  size: TpSizing.iconSm,
                  color: palette.forStatus(TpStatus.ok).base,
                ),
              TpStatusChip(
                status: TpStatus.warning,
                label: pendingLabel,
                isCompact: true,
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// `[asset_no, vehicle_type].join(' - ')`, falling back to the row's own
  /// `title` and then to [fallbackTitle] - mirrors the mobile queue row's
  /// own `[s.asset_no, s.vehicle_type].filter(Boolean).join(' · ') ||
  /// s.title || 'Inspection'`.
  static String _headingFor(InspectionApprovalItem item, String fallbackTitle) {
    final String? assetNo = item.assetNo?.trim();
    final String? vehicleType = item.vehicleType?.trim();
    final String assetAndType = <String>[
      if (assetNo != null && assetNo.isNotEmpty)
        TpDirection.isolateLtr(assetNo),
      if (vehicleType != null && vehicleType.isNotEmpty) vehicleType,
    ].join(' - ');
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
  const _MetaRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextStyle? style = Theme.of(context)
        .textTheme
        .bodySmall
        ?.copyWith(color: palette.textMuted);
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Row(
        children: <Widget>[
          Icon(icon, size: TpSizing.iconSm, color: palette.textMuted),
          const SizedBox(width: TpSpace.xs),
          Flexible(
            child: Text(text, style: style),
          ),
        ],
      ),
    );
  }
}

class _MetaPill extends StatelessWidget {
  const _MetaPill({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.pill),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.sm,
          vertical: TpSpace.xs,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: TpSizing.iconSm, color: palette.textMuted),
            const SizedBox(width: TpSpace.xs),
            Text(
              text,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: palette.textMuted),
            ),
          ],
        ),
      ),
    );
  }
}
