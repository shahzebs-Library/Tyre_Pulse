/// Accident register - the landing screen of the Accidents tab.
///
/// A paged, permission-scoped read of real accident cases with search and
/// quiet filters, drawn in the approved mock family's list language: one
/// full-width primary "Report accident" action, an open intro header and
/// hairline-divided rows. No KPI is computed here - every row value is a
/// column the register read returned.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/navigation/list_drilldown.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_mock_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/queue_list_kit.dart';

enum _StatusFilter { all, open, closed }

abstract final class AccidentDashboardScreenKeys {
  static const Key reportAction = Key('accident.dashboard.reportAction');

  /// Always-visible app-bar entry, so reporting an accident stays one tap
  /// away after the in-list primary button scrolls off screen.
  static const Key search = Key('accident.dashboard.search');
  static const Key allCases = Key('accident.dashboard.allCases');
  static const Key reportedByMe = Key('accident.dashboard.reportedByMe');

  static Key status(String value) => Key('accident.dashboard.status.$value');
  static Key card(String id) => Key('accident.dashboard.card.$id');
}

class AccidentDashboardScreen extends ConsumerStatefulWidget {
  const AccidentDashboardScreen({required this.route, super.key});
  final AccidentDashboardRoute route;

  @override
  ConsumerState<AccidentDashboardScreen> createState() =>
      _AccidentDashboardScreenState();
}

class _AccidentDashboardScreenState
    extends ConsumerState<AccidentDashboardScreen> {
  static const int _pageSize = 40;
  final TextEditingController _search = TextEditingController();
  final List<AccidentRecord> _items = <AccidentRecord>[];
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  bool _mine = false;
  _StatusFilter _status = _StatusFilter.all;
  AppError? _error;

  @override
  void initState() {
    super.initState();
    // Home's "Open accidents" tile opens this register on the Open filter,
    // the same closed-token rule its count uses (`accidentRecordIsClosed`).
    // This screen is a shell branch root kept alive by the indexed stack, so
    // it must react to EVERY tap while mounted, not only the first build.
    _drilldown = ListDrilldownController.watch(
      ref,
      ListDrilldown.openAccidents,
      _applyOpenDrilldown,
    );
    _initialised = true;
    unawaited(_load(reset: true));
  }

  ProviderSubscription<ListDrilldownRequest?>? _drilldown;
  bool _initialised = false;

  void _applyOpenDrilldown() {
    void apply() {
      _status = _StatusFilter.open;
      _search.clear();
    }

    if (!_initialised) {
      apply(); // fired immediately from initState: no setState yet
      return;
    }
    if (mounted) setState(apply);
  }

  @override
  void dispose() {
    _drilldown?.close();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({required bool reset}) async {
    if (reset) {
      setState(() {
        _loading = true;
        _error = null;
      });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final workspace = ref.read(workspaceContextProvider);
      // C2: "Mine" also covers cases where a step is assigned to me. A failed
      // task read falls back to "reported by me" rather than failing the list.
      Set<String> assigned = const <String>{};
      if (_mine) {
        try {
          assigned =
              (await ref.read(accidentMyTasksProvider.future)).accidentIds;
        } on Object {
          assigned = const <String>{};
        }
      }
      final AccidentListPage page =
          await ref.read(accidentRepositoryProvider).list(
                offset: reset ? 0 : _items.length,
                pageSize: _pageSize,
                country: workspace?.activeCountry,
                reporterId: _mine ? workspace?.userId : null,
                assignedAccidentIds: assigned,
              );
      if (!mounted) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll(page.items);
        // A later page that loads clears an earlier load-more failure;
        // otherwise the inline error banner outlives the problem it reports.
        _error = null;
        _hasMore = page.hasMore;
        _loading = false;
        _loadingMore = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = accidentAppError(error, AccidentCopy.of(context));
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  List<AccidentRecord> get _shown {
    final String query = _search.text.trim().toLowerCase();
    final AccidentMockCopy mockCopy = AccidentMockCopy.of(context);
    return _items.where((AccidentRecord item) {
      final bool closed = accidentRecordIsClosed(item);
      if (_status == _StatusFilter.open && closed) return false;
      if (_status == _StatusFilter.closed && !closed) return false;
      if (query.isEmpty) return true;
      return <String?>[
        item.assetNo,
        item.site,
        item.referenceNo,
        item.location,
        item.accidentType,
        humaniseAccidentToken(item.accidentType),
        item.displayStatus,
        humaniseAccidentToken(item.displayStatus),
        item.severity,
        humaniseAccidentToken(item.severity),
        accidentSeverityLevel(mockCopy, item.severity),
        item.reporterName,
      ].any((String? value) => value?.toLowerCase().contains(query) ?? false);
    }).toList(growable: false);
  }

  void _report() => context.push(const AccidentReportRoute().location);

  @override
  Widget build(BuildContext context) {
    final AccidentCopy copy = AccidentCopy.of(context);
    return TpScaffold(
      // The mock family's tinted canvas: a white command band with one
      // lifted green primary action, then the register as one grouped card.
      backgroundColor: TpPalette.of(context).background,
      appBar: TpAppBar(
        title: copy('dashboardTitle'),
      ),
      body: _body(copy),
    );
  }

  /// Centres [child] at the phone-first reading width.
  static Widget _capped(Widget child) => Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 900),
          child: child,
        ),
      );

  Widget _intro(AccidentCopy copy) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        0,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          // The single full-width green primary action of the mock family.
          QueuePrimaryLift(
            child: TpButton.primary(
              key: AccidentDashboardScreenKeys.reportAction,
              label: copy('reportAction'),
              icon: Icons.add_a_photo_outlined,
              isFullWidth: true,
              onPressed: _report,
            ),
          ),
          const SizedBox(height: TpSpace.lg),
          TpSearchField(
            key: AccidentDashboardScreenKeys.search,
            controller: _search,
            hint: copy('searchHint'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: TpSpace.md),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.md,
            children: <Widget>[
              QueueFilterChip(
                key: AccidentDashboardScreenKeys.allCases,
                label: copy('allCases'),
                selected: !_mine,
                onSelected: () {
                  setState(() => _mine = false);
                  unawaited(_load(reset: true));
                },
              ),
              QueueFilterChip(
                key: AccidentDashboardScreenKeys.reportedByMe,
                label: AppLocalizations.of(context).accidentRegisterMine,
                selected: _mine,
                onSelected: () {
                  setState(() => _mine = true);
                  unawaited(_load(reset: true));
                },
              ),
              for (final _StatusFilter status in _StatusFilter.values)
                QueueFilterChip(
                  key: AccidentDashboardScreenKeys.status(status.name),
                  label: switch (status) {
                    _StatusFilter.all => copy('anyStatus'),
                    _StatusFilter.open => copy('open'),
                    _StatusFilter.closed => copy('closed'),
                  },
                  selected: _status == status,
                  onSelected: () => setState(() => _status = status),
                ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
        ],
      ),
    );
  }

  Widget _body(AccidentCopy copy) {
    if (_loading) {
      return TpLoadingState(message: copy('loadingRegister'));
    }
    if (_error != null && _items.isEmpty) {
      return TpErrorState(error: _error!, onRetry: () => _load(reset: true));
    }
    final TpPalette palette = TpPalette.of(context);
    final List<AccidentRecord> shown = _shown;
    return RefreshIndicator(
      onRefresh: () => _load(reset: true),
      child: ListView(
        padding: const EdgeInsets.only(bottom: TpSpace.xxl),
        children: <Widget>[
          ColoredBox(color: palette.surface, child: _capped(_intro(copy))),
          Divider(height: 1, thickness: 1, color: palette.border),
          const SizedBox(height: TpSpace.lg),
          if (_error != null)
            // A later page failed while earlier cases are still on screen:
            // keep them, and say plainly that the register is incomplete.
            _capped(
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  TpSpace.lg,
                  TpSpace.md,
                  TpSpace.lg,
                  0,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Icon(
                      Icons.error_outline,
                      size: TpSizing.iconMd,
                      color: palette.forStatus(TpStatus.critical).base,
                    ),
                    const SizedBox(width: TpSpace.sm),
                    Expanded(
                      child: Text(
                        _error!.message,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: palette.forStatus(TpStatus.critical).base,
                            ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (shown.isEmpty)
            SizedBox(
              height: 360,
              child: TpEmptyState(
                icon: Icons.car_crash_outlined,
                title: copy('noMatches'),
                message: copy('noMatchesMessage'),
              ),
            )
          else
            for (int i = 0; i < shown.length; i++)
              _capped(
                _AccidentRow(
                  key: AccidentDashboardScreenKeys.card(shown[i].id),
                  item: shown[i],
                  showDivider: i < shown.length - 1,
                  isFirst: i == 0,
                  notRecordedLabel: copy('notRecorded'),
                  severityLabel: (shown[i].severity?.trim().isEmpty ?? true)
                      ? copy('notRecorded')
                      : accidentSeverityLevel(
                          AccidentMockCopy.of(context),
                          shown[i].severity,
                        ),
                  unrecordedAssetLabel: copy('unrecordedAsset'),
                  onTap: () => context.push(
                    AccidentDetailRoute(accidentId: AccidentId(shown[i].id))
                        .location,
                  ),
                ),
              ),
          if (_hasMore)
            _capped(
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  TpSpace.lg,
                  TpSpace.lg,
                  TpSpace.lg,
                  0,
                ),
                child: TpButton.secondary(
                  label: _loadingMore ? copy('loading') : copy('loadMore'),
                  onPressed: _loadingMore ? null : () => _load(reset: false),
                  isBusy: _loadingMore,
                  isFullWidth: true,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// One register row in the mock family's compact list shape. Every value is
/// a column the paged register read already returned.
class _AccidentRow extends StatelessWidget {
  const _AccidentRow({
    required this.item,
    required this.onTap,
    required this.showDivider,
    required this.isFirst,
    required this.notRecordedLabel,
    required this.severityLabel,
    required this.unrecordedAssetLabel,
    super.key,
  });
  final AccidentRecord item;
  final VoidCallback onTap;
  final bool showDivider;
  final bool isFirst;
  final String notRecordedLabel;

  /// The canonical Minor / Moderate / Major level, already localised. The
  /// stored token is never shown raw: `severe` (and legacy `fatal` /
  /// `total loss`) read Major, matching the web ladder in accidentVocab.js.
  final String severityLabel;
  final String unrecordedAssetLabel;

  @override
  Widget build(BuildContext context) {
    final TpStatus severityTone = accidentTone(item.severity);
    final TpStatus statusTone = accidentTone(item.displayStatus);
    return QueueListRow(
      icon: Icons.car_crash_outlined,
      status: severityTone,
      title: item.assetNo.trim().isEmpty
          ? unrecordedAssetLabel
          : TpDirection.isolateLtr(item.assetNo.trim()),
      titleMaxLines: 2,
      time: formatAccidentIncidentDate(context, item.incidentDate),
      tags: <Widget>[
        QueueStatusTag(
          label: _humanisedOr(item.displayStatus, notRecordedLabel),
          status: statusTone,
        ),
        QueueStatusTag(
          label: severityLabel,
          status: severityTone,
        ),
      ],
      details: <String>[
        _joined(<String?>[item.reference, item.site]),
        _joined(<String?>[
          _humanisedOr(item.accidentType, notRecordedLabel),
          item.location,
        ]),
      ],
      showDivider: showDivider,
      isFirst: isFirst,
      onTap: onTap,
    );
  }
}

String _humanisedOr(String? token, String fallback) {
  final String label = humaniseAccidentToken(token);
  return label.isEmpty ? fallback : label;
}

String _joined(List<String?> parts) => parts
    .map((String? value) => value?.trim() ?? '')
    .where((String value) => value.isNotEmpty)
    .join(' • ');
