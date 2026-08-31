/// Inspection approvals - the supervisor's queue.
///
/// Lists inspections submitted from the field. Pending items
/// (`approval_status = 'pending_approval'`) await sign-off; the Approved and
/// Returned tabs read the same table already filtered to a decided status,
/// matching the approved mock's three-tab queue. Each pending row opens
/// [InspectionApprovalReviewScreen], where the supervisor inspects the
/// recorded tyre conditions and the inspector's drawn signature and either
/// approves (with their own signature) or returns it; a decided row still
/// opens the same review screen, read-only, so its history remains visible.
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
import 'package:tyre_pulse/features/approvals/domain/approval_date_grouping.dart';
import 'package:tyre_pulse/features/approvals/inspection_approvals_providers.dart';

/// Stable finders for the responsive approvals queue presentation.
@visibleForTesting
abstract final class InspectionApprovalsQueueKeys {
  static const Key summary = Key('inspection.approvals.summary');
  static const Key list = Key('inspection.approvals.list');

  static Key row(String id) => Key('inspection.approvals.row.$id');
  static Key heading(String id) => Key('inspection.approvals.heading.$id');
}

/// The three tabs the approved mock's queue shows, each a distinct real
/// `inspections.approval_status` value - never a client-side re-labelling of
/// the same rows.
enum InspectionApprovalTab { pending, approved, returned }

extension on InspectionApprovalTab {
  /// The exact `approval_status` this tab reads.
  String get statusValue => switch (this) {
        InspectionApprovalTab.pending => 'pending_approval',
        InspectionApprovalTab.approved => 'approved',
        InspectionApprovalTab.returned => 'rejected',
      };
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
  InspectionApprovalTab _tab = InspectionApprovalTab.pending;

  /// The Pending count shown on the tab strip, tracked separately from
  /// [_items] so switching to Approved/Returned does not make the Pending
  /// badge read 0 - the approved mock keeps that count visible on every tab.
  int? _pendingCount;

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
    final InspectionApprovalTab tab = _tab;
    try {
      final repository = ref.read(inspectionApprovalRepositoryProvider);
      final List<InspectionApprovalItem> items =
          tab == InspectionApprovalTab.pending
              ? await repository.listPending(country: country)
              : await repository.listByStatus(
                  tab.statusValue,
                  country: country,
                );
      if (!mounted) return;
      setState(() {
        _items = items;
        _pendingCount =
            tab == InspectionApprovalTab.pending ? items.length : _pendingCount;
        _loading = false;
      });
      if (tab == InspectionApprovalTab.pending) return;
      // The Pending badge must stay accurate even while looking at a
      // different tab. Best-effort and silent on failure: the badge simply
      // keeps whatever count it last knew, never a fabricated number.
      try {
        final int pending =
            (await repository.listPending(country: country)).length;
        if (mounted) setState(() => _pendingCount = pending);
      } on Object {
        // Deliberately ignored - see the comment above.
      }
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _asAppError(context, error);
        _loading = false;
      });
    }
  }

  Future<void> _refresh() => _load();

  void _changeTab(InspectionApprovalTab tab) {
    if (tab == _tab) return;
    setState(() => _tab = tab);
    unawaited(_load());
  }

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
    final Widget header = Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 900),
        child: _QueueSummary(
          tab: _tab,
          pendingCount: _pendingCount ?? _items.length,
          onTabChanged: _changeTab,
          onSearchChanged: (String value) => setState(() => _query = value),
        ),
      ),
    );

    if (_loading) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[header, const TpLoadingState()],
      );
    }
    if (_error != null) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          header,
          TpErrorState(error: _error!, onRetry: _load),
        ],
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

    final List<ApprovalDateGroup> groups = groupApprovalsByDate(
      visible,
      now: DateTime.now(),
      todayLabel: l10n.dateGroupToday,
      yesterdayLabel: l10n.dateGroupYesterday,
      unknownLabel: l10n.valueUnavailable,
    );

    // Flattened once so `ListView.builder` can mix section headers and rows
    // by a single integer index without rebuilding this list per frame.
    final List<Object> rows = <Object>[
      for (final ApprovalDateGroup group in groups) ...<Object>[
        group.label,
        ...group.items,
      ],
    ];

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
        itemCount: (rows.isEmpty ? 1 : rows.length) + 1,
        itemBuilder: (BuildContext context, int index) {
          if (index == 0) return header;
          if (rows.isEmpty) {
            return SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.42,
              child: TpEmptyState(
                icon: _items.isEmpty
                    ? Icons.checklist_rtl_outlined
                    : Icons.search_off_outlined,
                title: _items.isEmpty
                    ? _emptyTitleFor(_tab, l10n)
                    : l10n.globalSearchEmptyTitle,
                message: _items.isEmpty
                    ? _emptyMessageFor(_tab, l10n)
                    : l10n.vehiclesEmptySearchMessage,
              ),
            );
          }
          final Object row = rows[index - 1];
          if (row is String) {
            return Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 900),
                child: _DateGroupHeading(label: row),
              ),
            );
          }
          final InspectionApprovalItem item = row as InspectionApprovalItem;
          return Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 900),
              child: _QueueRow(
                item: item,
                tab: _tab,
                fallbackTitle: l10n.inspectionApprovalFallbackTitle,
                inspectorFallback: l10n.inspectionInspectorUnknown,
                pendingLabel: l10n.inspectionApprovalsPendingBadge,
                approvedLabel: l10n.inspectionApprovalsApprovedTab,
                returnedLabel: l10n.inspectionApprovalsReturnedTab,
                unavailableLabel: l10n.valueUnavailable,
                onTap: () => _open(item),
              ),
            ),
          );
        },
      ),
    );
  }

  static String _emptyTitleFor(
    InspectionApprovalTab tab,
    AppLocalizations l10n,
  ) =>
      tab == InspectionApprovalTab.pending
          ? l10n.inspectionApprovalsEmptyTitle
          : l10n.globalSearchEmptyTitle;

  static String _emptyMessageFor(
    InspectionApprovalTab tab,
    AppLocalizations l10n,
  ) =>
      tab == InspectionApprovalTab.pending
          ? l10n.inspectionApprovalsEmptyMessage
          : l10n.vehiclesEmptySearchMessage;
}

class _QueueSummary extends StatelessWidget {
  const _QueueSummary({
    required this.tab,
    required this.pendingCount,
    required this.onTabChanged,
    required this.onSearchChanged,
  });

  final InspectionApprovalTab tab;
  final int pendingCount;
  final ValueChanged<InspectionApprovalTab> onTabChanged;
  final ValueChanged<String> onSearchChanged;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpCard(
      key: InspectionApprovalsQueueKeys.summary,
      margin: const EdgeInsets.only(bottom: TpSpace.lg),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          TpSegmented<InspectionApprovalTab>(
            expanded: true,
            value: tab,
            onChanged: onTabChanged,
            options: <TpSegmentedOption<InspectionApprovalTab>>[
              TpSegmentedOption<InspectionApprovalTab>(
                value: InspectionApprovalTab.pending,
                label: '${l10n.inspectionApprovalsPendingBadge} '
                    '$pendingCount',
              ),
              TpSegmentedOption<InspectionApprovalTab>(
                value: InspectionApprovalTab.approved,
                label: l10n.inspectionApprovalsApprovedTab,
              ),
              TpSegmentedOption<InspectionApprovalTab>(
                value: InspectionApprovalTab.returned,
                label: l10n.inspectionApprovalsReturnedTab,
              ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          TpSearchField(onChanged: onSearchChanged),
        ],
      ),
    );
  }
}

class _DateGroupHeading extends StatelessWidget {
  const _DateGroupHeading({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(TpSpace.xs, TpSpace.md, 0, TpSpace.sm),
      child: Text(
        label.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: palette.textSecondary,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.5,
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
    required this.tab,
    required this.fallbackTitle,
    required this.inspectorFallback,
    required this.pendingLabel,
    required this.approvedLabel,
    required this.returnedLabel,
    required this.unavailableLabel,
    required this.onTap,
  });

  final InspectionApprovalItem item;
  final InspectionApprovalTab tab;
  final String fallbackTitle;
  final String inspectorFallback;
  final String pendingLabel;
  final String approvedLabel;
  final String returnedLabel;
  final String unavailableLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final bool isRtl = TpDirection.isRtl(context);
    final String heading = _headingFor(item, fallbackTitle);
    final String when = _formatDate(item.createdAt) ?? unavailableLabel;
    final (TpStatus status, String label) = switch (tab) {
      InspectionApprovalTab.pending => (TpStatus.warning, pendingLabel),
      InspectionApprovalTab.approved => (TpStatus.ok, approvedLabel),
      InspectionApprovalTab.returned => (TpStatus.info, returnedLabel),
    };

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
                  color: palette.forStatus(status).soft,
                  shape: BoxShape.circle,
                ),
                child: Padding(
                  padding: const EdgeInsets.all(TpSpace.sm),
                  child: Icon(
                    Icons.assignment_outlined,
                    size: TpSizing.iconMd,
                    color: palette.forStatus(status).onSoft,
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
                status: status,
                label: label,
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
