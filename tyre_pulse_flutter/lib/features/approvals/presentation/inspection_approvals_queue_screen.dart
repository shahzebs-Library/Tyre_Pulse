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
import 'package:intl/intl.dart' show DateFormat;
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
import 'package:tyre_pulse/features/approvals/presentation/widgets/queue_list_kit.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/refresh_when_shown.dart';

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
    extends ConsumerState<InspectionApprovalsQueueScreen>
    with RefreshWhenShown<InspectionApprovalsQueueScreen> {
  bool _loading = true;
  AppError? _error;
  List<InspectionApprovalItem> _items = const <InspectionApprovalItem>[];
  String _query = '';
  InspectionApprovalTab _tab = InspectionApprovalTab.pending;

  /// The Pending count shown on the tab strip, tracked separately from
  /// [_items] so switching to Approved/Returned does not make the Pending
  /// badge read 0 - the approved mock keeps that count visible on every tab.
  int? _pendingCount;

  /// Bumped by every [_load]. Only the newest read may land, so a slow read
  /// that started before a refresh (or before a tab change) can never paint
  /// its older rows over the fresher ones.
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void refreshWhenShown() => unawaited(_load());

  Future<void> _load() async {
    final int generation = ++_loadGeneration;
    setState(() {
      // Keep the rows already on screen while re-reading: a refresh on
      // return must not flash the whole queue back to a spinner.
      _loading = _items.isEmpty;
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
      if (!mounted || generation != _loadGeneration) return;
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
        if (mounted && generation == _loadGeneration) {
          setState(() => _pendingCount = pending);
        }
      } on Object {
        // Deliberately ignored - see the comment above.
      }
    } on Object catch (error) {
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _error = _asAppError(context, error);
        _loading = false;
      });
    }
  }

  Future<void> _refresh() => _load();

  void _changeTab(InspectionApprovalTab tab) {
    if (tab == _tab) return;
    setState(() {
      _tab = tab;
      // The previous tab's rows are a different status; never show them
      // under this tab's heading while its own read is in flight.
      _items = const <InspectionApprovalItem>[];
    });
    unawaited(_load());
  }

  Future<void> _open(InspectionApprovalItem item) async {
    await context.push<Object?>(
      InspectionApprovalReviewRoute(inspectionId: InspectionId(item.id))
          .location,
    );
    // Back from the review: the row just decided has left this status, and
    // new submissions may have arrived while the review was open.
    if (mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);

    return TpScaffold(
      backFallback: fallback,
      // A softly tinted canvas so each date group reads as one white card,
      // the depth the mock family's list sections carry.
      backgroundColor: TpPalette.of(context).surfaceAlt,
      appBar: TpAppBar(
        title: l10n.inspectionApprovalsTitle,
        backFallback: fallback,
      ),
      body: _body(l10n),
    );
  }

  /// Centres [child] and caps it at the phone-first reading width so a
  /// tablet does not stretch a compact row edge to edge.
  static Widget _capped(Widget child) => Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 900),
          child: child,
        ),
      );

  Widget _body(AppLocalizations l10n) {
    final Widget header = _capped(
      _QueueSummary(
        tab: _tab,
        pendingCount: _pendingCount ?? _items.length,
        onTabChanged: _changeTab,
        onSearchChanged: (String value) => setState(() => _query = value),
      ),
    );

    if (_loading) {
      return ListView(
        padding: const EdgeInsets.only(bottom: TpSpace.xxl),
        children: <Widget>[
          header,
          const Padding(
            padding: EdgeInsets.all(TpSpace.lg),
            child: TpLoadingState(),
          ),
        ],
      );
    }
    if (_error != null) {
      return ListView(
        padding: const EdgeInsets.only(bottom: TpSpace.xxl),
        children: <Widget>[
          header,
          Padding(
            padding: const EdgeInsets.all(TpSpace.lg),
            child: TpErrorState(error: _error!, onRetry: _load),
          ),
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
    final String locale = Localizations.localeOf(context).toLanguageTag();

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView.builder(
        key: InspectionApprovalsQueueKeys.list,
        padding: const EdgeInsets.only(bottom: TpSpace.xxl),
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
            return _capped(QueueSectionHeader(title: row));
          }
          final InspectionApprovalItem item = row as InspectionApprovalItem;
          final bool lastInGroup =
              index == rows.length || rows[index] is String;
          final bool firstInGroup = index < 2 || rows[index - 2] is String;
          return _capped(
            _QueueRow(
              item: item,
              tab: _tab,
              locale: locale,
              showDivider: !lastInGroup,
              isFirst: firstInGroup,
              fallbackTitle: l10n.inspectionApprovalFallbackTitle,
              inspectorFallback: l10n.inspectionInspectorUnknown,
              pendingLabel: l10n.inspectionApprovalsPendingBadge,
              approvedLabel: l10n.inspectionApprovalsApprovedTab,
              returnedLabel: l10n.inspectionApprovalsReturnedTab,
              onTap: () => unawaited(_open(item)),
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
    final TpPalette palette = TpPalette.of(context);

    QueueFilterChip chip(InspectionApprovalTab value, String label) =>
        QueueFilterChip(
          label: label,
          selected: tab == value,
          onSelected: () => onTabChanged(value),
        );

    // An open band, not a card: the search box and the three status
    // filters (each a distinct real `approval_status`) sit on the page and
    // a single hairline separates them from the list below.
    return DecoratedBox(
      key: InspectionApprovalsQueueKeys.summary,
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(bottom: BorderSide(color: palette.border)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.md,
          TpSpace.lg,
          TpSpace.md,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            TpSearchField(onChanged: onSearchChanged),
            const SizedBox(height: TpSpace.md),
            Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.sm,
              children: <Widget>[
                chip(
                  InspectionApprovalTab.pending,
                  '${l10n.inspectionApprovalsPendingBadge} $pendingCount',
                ),
                chip(
                  InspectionApprovalTab.approved,
                  l10n.inspectionApprovalsApprovedTab,
                ),
                chip(
                  InspectionApprovalTab.returned,
                  l10n.inspectionApprovalsReturnedTab,
                ),
              ],
            ),
          ],
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
    required this.locale,
    required this.showDivider,
    required this.isFirst,
    required this.fallbackTitle,
    required this.inspectorFallback,
    required this.pendingLabel,
    required this.approvedLabel,
    required this.returnedLabel,
    required this.onTap,
  });

  final InspectionApprovalItem item;
  final InspectionApprovalTab tab;
  final String locale;
  final bool showDivider;
  final bool isFirst;
  final String fallbackTitle;
  final String inspectorFallback;
  final String pendingLabel;
  final String approvedLabel;
  final String returnedLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final (TpStatus status, String label) = switch (tab) {
      InspectionApprovalTab.pending => (TpStatus.warning, pendingLabel),
      InspectionApprovalTab.approved => (TpStatus.ok, approvedLabel),
      InspectionApprovalTab.returned => (TpStatus.info, returnedLabel),
    };
    final String inspector = item.inspector?.trim().isNotEmpty == true
        ? item.inspector!.trim()
        : inspectorFallback;
    final String? site = item.site?.trim();
    final bool signed =
        item.inspectorSignature != null && item.inspectorSignature!.isNotEmpty;

    return QueueListRow(
      key: InspectionApprovalsQueueKeys.row(item.id),
      titleKey: InspectionApprovalsQueueKeys.heading(item.id),
      icon: Icons.assignment_outlined,
      status: status,
      title: _headingFor(item, fallbackTitle),
      // The date already heads the group this row sits in, so the row
      // carries only the time of day - the mock's trailing "10m ago" slot.
      time: _formatTime(item.createdAt, locale),
      tags: <Widget>[
        QueueStatusTag(label: label, status: status),
        if (signed)
          Icon(
            Icons.draw_outlined,
            size: TpSizing.iconSm,
            color: palette.forStatus(TpStatus.ok).base,
          ),
      ],
      details: <String>[
        <String>[
          if (site != null && site.isNotEmpty) site,
          inspector,
        ].join(' • '),
      ],
      showDivider: showDivider,
      isFirst: isFirst,
      onTap: onTap,
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

  /// Local time of day, or `null` when the timestamp is missing or
  /// unparseable - that row already sits under the "unavailable" group, so
  /// repeating the word in the time slot would add nothing.
  static String? _formatTime(String? iso, String locale) {
    if (iso == null || iso.isEmpty) return null;
    final DateTime? parsed = DateTime.tryParse(iso);
    if (parsed == null) return null;
    return DateFormat.Hm(locale).format(parsed.toLocal());
  }
}
