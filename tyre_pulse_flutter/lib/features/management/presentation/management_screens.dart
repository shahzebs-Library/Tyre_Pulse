library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/management/domain/management_models.dart';
import 'package:tyre_pulse/features/management/management_providers.dart';
import 'package:tyre_pulse/features/management/presentation/management_copy.dart';
import 'package:url_launcher/url_launcher.dart';

/// What a management fleet screen is for. Overview and Analytics read the
/// same authoritative aggregate (`get_mobile_analytics`) but answer different
/// questions: Overview is the at-a-glance health of the fleet and each site,
/// Analytics is the drill-down with a site filter and full distributions.
enum _FleetView { overview, analytics }

class OverviewScreen extends StatelessWidget {
  const OverviewScreen({required this.route, super.key});
  final OverviewRoute route;

  @override
  Widget build(BuildContext context) => _AnalyticsView(
        route: route,
        titleKey: 'overviewTitle',
        view: _FleetView.overview,
      );
}

class AnalyticsScreen extends StatelessWidget {
  const AnalyticsScreen({required this.route, super.key});
  final AnalyticsRoute route;

  @override
  Widget build(BuildContext context) => _AnalyticsView(
        route: route,
        titleKey: 'analyticsTitle',
        view: _FleetView.analytics,
      );
}

class _AnalyticsView extends ConsumerStatefulWidget {
  const _AnalyticsView({
    required this.route,
    required this.titleKey,
    required this.view,
  });
  final TpRoute route;
  final String titleKey;
  final _FleetView view;

  @override
  ConsumerState<_AnalyticsView> createState() => _AnalyticsViewState();
}

class _AnalyticsViewState extends ConsumerState<_AnalyticsView> {
  FleetAnalytics? _data;
  Object? _error;
  bool _loading = true;
  int _period = 90;
  String? _site;

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
      final FleetAnalytics result =
          await ref.read(managementRepositoryProvider).analytics(
                country: ref.read(activeCountryProvider),
                site: _site,
                from: DateTime.now().subtract(Duration(days: _period)),
                to: DateTime.now(),
              );
      if (!mounted) return;
      setState(() {
        _data = result;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final ManagementCopy copy = ManagementCopy.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: copy(widget.titleKey),
        subtitle: '${copy('last')} $_period ${copy('days')}',
        backFallback: fallback,
      ),
      body: _body(copy),
    );
  }

  Widget _body(ManagementCopy copy) {
    if (_loading) return const TpLoadingState();
    if (_error != null) {
      return TpErrorState(
        error: _asError(_error!, copy('analyticsFailed')),
        onRetry: _load,
      );
    }
    final FleetAnalytics data = _data!;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.md,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          SegmentedButton<int>(
            segments: <ButtonSegment<int>>[
              ButtonSegment<int>(value: 30, label: Text(copy('days30'))),
              ButtonSegment<int>(value: 90, label: Text(copy('days90'))),
              ButtonSegment<int>(value: 365, label: Text(copy('year1'))),
            ],
            selected: <int>{_period},
            onSelectionChanged: (Set<int> value) {
              setState(() => _period = value.single);
              unawaited(_load());
            },
          ),
          if (widget.view == _FleetView.analytics &&
              data.sites.isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            SizedBox(
              height: 42,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: <Widget>[
                  ChoiceChip(
                    label: Text(copy('allSites')),
                    selected: _site == null,
                    onSelected: (_) {
                      setState(() => _site = null);
                      unawaited(_load());
                    },
                  ),
                  for (final String site in data.sites) ...<Widget>[
                    const SizedBox(width: TpSpace.xs),
                    ChoiceChip(
                      label: Text(site),
                      selected: _site == site,
                      onSelected: (_) {
                        setState(() => _site = site);
                        unawaited(_load());
                      },
                    ),
                  ],
                ],
              ),
            ),
          ],
          const SizedBox(height: TpSpace.md),
          if (widget.view == _FleetView.overview)
            ..._overview(copy, data)
          else
            ..._analytics(copy, data),
        ],
      ),
    );
  }

  /// The at-a-glance fleet health: headline KPIs, the share of tyres at
  /// high or critical risk, spend, and a per-site rollup. Every figure comes
  /// from the loaded aggregate; nothing is derived that the server did not
  /// measure (a share is only shown when the tyre total is not zero).
  List<Widget> _overview(ManagementCopy copy, FleetAnalytics data) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? currency = ref.watch(activeCurrencyProvider);
    final num atRisk = data.tyresCritical + data.tyresHigh;
    return <Widget>[
      _MetricGrid(
        values: <MapEntry<String, num>>[
          MapEntry<String, num>(copy('tyres'), data.tyresTotal),
          MapEntry<String, num>(copy('vehicles'), data.vehiclesTotal),
          MapEntry<String, num>(copy('openActions'), data.openActions),
          MapEntry<String, num>(copy('inspections30'), data.inspections30d),
        ],
      ),
      const SizedBox(height: TpSpace.sm),
      _ShareCard(
        key: const Key('overview.atRisk'),
        label: l10n.managementOverviewAtRiskShare,
        value: atRisk,
        total: data.tyresTotal,
      ),
      if (data.tyreSpend != null) ...<Widget>[
        const SizedBox(height: TpSpace.sm),
        _CostValueCard(
          label: copy('tyreSpend'),
          value: data.tyreSpend!,
          currency: currency,
        ),
      ],
      const SizedBox(height: TpSpace.xl),
      Text(
        l10n.managementOverviewSiteRollup,
        style: Theme.of(context).textTheme.titleMedium,
      ),
      const SizedBox(height: TpSpace.sm),
      if (data.bySite.isEmpty)
        TpEmptyState(
          icon: Icons.location_off_outlined,
          title: l10n.managementOverviewSiteRollupEmpty,
        )
      else
        for (final MetricSlice site in data.bySite)
          _SiteRollupRow(
            site: site,
            total: data.tyresTotal,
            currency: currency,
          ),
    ];
  }

  /// The drill-down: the full KPI grid and every distribution.
  List<Widget> _analytics(ManagementCopy copy, FleetAnalytics data) => <Widget>[
        _MetricGrid(
          values: <MapEntry<String, num>>[
            MapEntry<String, num>(copy('tyres'), data.tyresTotal),
            MapEntry<String, num>(copy('vehicles'), data.vehiclesTotal),
            MapEntry<String, num>(copy('critical'), data.tyresCritical),
            MapEntry<String, num>(copy('openActions'), data.openActions),
            MapEntry<String, num>(copy('highRisk'), data.tyresHigh),
            MapEntry<String, num>(copy('inspections30'), data.inspections30d),
          ],
        ),
        if (data.tyreSpend != null) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          _ValueCard(label: copy('tyreSpend'), value: data.tyreSpend!),
        ],
        _Distribution(title: copy('risk'), rows: data.byRisk),
        _Distribution(title: copy('sites'), rows: data.bySite),
        _Distribution(title: copy('brands'), rows: data.byBrand),
      ];
}

/// A count out of a total, shown as a share. The share is `-` when the total
/// is zero: a 0% would read as a real, reassuring measurement.
class _ShareCard extends StatelessWidget {
  const _ShareCard({
    required this.label,
    required this.value,
    required this.total,
    super.key,
  });
  final String label;
  final num value;
  final num total;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final double? ratio = total > 0 ? (value / total).clamp(0, 1) : null;
    return TpCard(
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              Text(
                ratio == null ? '-' : '${(ratio * 100).round()}%',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          LinearProgressIndicator(
            value: ratio ?? 0,
            color: palette.critical.base,
            backgroundColor: palette.surfaceAlt,
            minHeight: 8,
            borderRadius: BorderRadius.circular(TpRadius.pill),
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            '${_compact(value)} / ${_compact(total)}',
            style: TextStyle(color: palette.textSecondary),
          ),
        ],
      ),
    );
  }
}

/// One site of the overview rollup: its tyre count, its share of the fleet's
/// tyres and, when the server supplied it (single-country scope), its spend.
class _SiteRollupRow extends StatelessWidget {
  const _SiteRollupRow({
    required this.site,
    required this.total,
    required this.currency,
  });
  final MetricSlice site;
  final num total;
  final String? currency;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      key: Key('overview.site.${site.label}'),
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        children: <Widget>[
          Icon(Icons.location_on_outlined, color: palette.primaryDark),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  site.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                Text(
                  <String>[
                    l10n.managementOverviewSiteTyres(_compact(site.count)),
                    if (total > 0)
                      l10n.managementOverviewSiteShare(
                        '${(site.count / total * 100).round()}',
                      ),
                  ].join(' · '),
                  style: TextStyle(color: palette.textSecondary),
                ),
              ],
            ),
          ),
          if (site.cost != null)
            Text(
              _money(site.cost!, currency),
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
        ],
      ),
    );
  }
}

class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({required this.route, super.key});
  final ReportsRoute route;

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  ExecutiveSnapshot? _snapshot;
  Object? _error;
  bool _loading = true;
  bool _sharing = false;
  int _period = 30;

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
      final DateTime now = DateTime.now();
      final ExecutiveSnapshot value =
          await ref.read(managementRepositoryProvider).report(
                country: ref.read(activeCountryProvider),
                from: now.subtract(Duration(days: _period)),
                to: now,
              );
      if (!mounted) return;
      setState(() {
        _snapshot = value;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  /// Shares the report that is on screen as a PDF: the same authoritative
  /// snapshot, the same period, only the values the screen shows (a null
  /// cost is omitted, never printed as zero).
  ///
  /// The PDF is written in English on purpose: the default PDF font has no
  /// Arabic-script glyphs and none is bundled, so a localized PDF would print
  /// empty boxes. Its labels still come from the ARB catalog.
  Future<void> _share() async {
    final ExecutiveSnapshot? snapshot = _snapshot;
    if (snapshot == null || !snapshot.available || _sharing) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? currency = ref.read(activeCurrencyProvider);
    final ScaffoldMessengerState? messenger =
        ScaffoldMessenger.maybeOf(context);
    setState(() => _sharing = true);
    try {
      final AppLocalizations en =
          await AppLocalizations.delegate.load(const Locale('en'));
      final ManagementCopy copy = ManagementCopy.fromL10n(en);
      final pw.Document document =
          buildManagementReportPdf(snapshot, copy, en, _period, currency);
      await Printing.sharePdf(
        bytes: await document.save(),
        filename: 'fleet-financial-report-${_period}d.pdf',
      );
    } on Object {
      messenger?.showSnackBar(
        SnackBar(content: Text(l10n.managementReportsShareError)),
      );
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ManagementCopy copy = ManagementCopy.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final bool canShare =
        !_loading && _error == null && (_snapshot?.available ?? false);
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: copy('reportsTitle'),
        subtitle: copy('reportsSubtitle'),
        backFallback: fallback,
        actions: <Widget>[
          IconButton(
            key: const Key('reports.share'),
            tooltip: l10n.managementReportsShare,
            icon: const Icon(Icons.ios_share_rounded),
            onPressed: canShare && !_sharing ? _share : null,
          ),
        ],
      ),
      body: _body(copy),
    );
  }

  Widget _body(ManagementCopy copy) {
    if (_loading) return const TpLoadingState();
    if (_error != null) {
      return TpErrorState(
        error: _asError(_error!, copy('reportsFailed')),
        onRetry: _load,
      );
    }
    final ExecutiveSnapshot snapshot = _snapshot!;
    final String? currency = ref.watch(activeCurrencyProvider);
    if (!snapshot.available) {
      return TpEmptyState(
        icon: Icons.cloud_off_outlined,
        title: copy('reportUnavailable'),
        message: copy('reportUnavailableBody'),
        actionLabel: copy('retry'),
        onAction: _load,
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.md,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          _FinancialReportHeader(
            company: snapshot.company,
            generatedAt: snapshot.generatedAt,
            currency: currency,
            generatedLabel: copy('generated'),
          ),
          const SizedBox(height: TpSpace.lg),
          SegmentedButton<int>(
            segments: <ButtonSegment<int>>[
              ButtonSegment<int>(value: 30, label: Text(copy('days30'))),
              ButtonSegment<int>(value: 90, label: Text(copy('days90'))),
              ButtonSegment<int>(value: 365, label: Text(copy('year1'))),
            ],
            selected: <int>{_period},
            onSelectionChanged: (Set<int> value) {
              setState(() => _period = value.single);
              unawaited(_load());
            },
          ),
          const SizedBox(height: TpSpace.lg),
          _MetricGrid(
            values: snapshot.kpis.entries
                .map(
                  (MapEntry<String, num> entry) =>
                      MapEntry<String, num>(copy(entry.key), entry.value),
                )
                .toList(growable: false),
          ),
          const SizedBox(height: TpSpace.xl),
          Text(
            copy('costPerformance'),
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w900,
                ),
          ),
          const SizedBox(height: TpSpace.sm),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              for (final MapEntry<String, num?> entry in snapshot.cost.entries)
                if (entry.value != null)
                  SizedBox(
                    width: (MediaQuery.sizeOf(context).width -
                            (TpSpace.lg * 2) -
                            TpSpace.sm) /
                        2,
                    child: _CostValueCard(
                      label: copy(entry.key),
                      value: entry.value!,
                      currency: currency,
                    ),
                  ),
            ],
          ),
          for (final MapEntry<String, List<MetricSlice>> entry
              in snapshot.breakdowns.entries) ...<Widget>[
            if (entry.value.any((MetricSlice row) => row.cost != null))
              _CostComposition(
                title: copy(entry.key),
                rows: entry.value,
                currency: currency,
              )
            else
              _Distribution(title: copy(entry.key), rows: entry.value),
          ],
        ],
      ),
    );
  }
}

class TeamScreen extends ConsumerStatefulWidget {
  const TeamScreen({required this.route, super.key});
  final TeamRoute route;

  @override
  ConsumerState<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends ConsumerState<TeamScreen> {
  final TextEditingController _search = TextEditingController();
  List<TeamMember> _members = const <TeamMember>[];
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<TeamMember> rows =
          await ref.read(managementRepositoryProvider).team();
      if (!mounted) return;
      setState(() {
        _members = rows;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final ManagementCopy copy = ManagementCopy.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: copy('teamTitle'),
        subtitle: '${_members.length} ${copy('members')}',
        backFallback: fallback,
      ),
      body: _body(copy),
    );
  }

  /// The member's detail, from the fields the roster already loaded. No
  /// extra query: the roster select carries every field shown here.
  Future<void> _showMember(TeamMember member, ManagementCopy copy) =>
      TpBottomSheet.show<void>(
        context: context,
        title: member.displayName,
        builder: (BuildContext context) => _MemberDetail(
          member: member,
          copy: copy,
        ),
      );

  Widget _body(ManagementCopy copy) {
    if (_loading) return const TpLoadingState();
    if (_error != null) {
      return TpErrorState(
        error: _asError(_error!, copy('teamFailed')),
        onRetry: _load,
      );
    }
    final String term = _search.text.trim().toLowerCase();
    final List<TeamMember> shown = _members.where((TeamMember member) {
      if (term.isEmpty) return true;
      return member.displayName.toLowerCase().contains(term) ||
          (member.role ?? '').toLowerCase().contains(term) ||
          (member.site ?? '').toLowerCase().contains(term);
    }).toList(growable: false);
    final int pending =
        _members.where((TeamMember member) => member.approved == false).length;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.md,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: _ValueCard(
                  label: copy('active'),
                  value: _members.length - pending,
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: _ValueCard(label: copy('pending'), value: pending),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          TextField(
            key: const Key('team.search'),
            controller: _search,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search_rounded),
              hintText: copy('teamSearch'),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          if (shown.isEmpty)
            TpEmptyState(
              icon: Icons.people_outline,
              title: copy('noMembers'),
              message: copy('trySearch'),
            )
          else
            for (final TeamMember member in shown) ...<Widget>[
              _MemberCard(
                member: member,
                copy: copy,
                onTap: () => _showMember(member, copy),
              ),
              const SizedBox(height: TpSpace.sm),
            ],
        ],
      ),
    );
  }
}

class _MetricGrid extends StatelessWidget {
  const _MetricGrid({required this.values});
  final List<MapEntry<String, num>> values;

  @override
  Widget build(BuildContext context) => Wrap(
        spacing: TpSpace.sm,
        runSpacing: TpSpace.sm,
        children: <Widget>[
          for (final MapEntry<String, num> value in values)
            SizedBox(
              width: (MediaQuery.sizeOf(context).width -
                      (TpSpace.lg * 2) -
                      TpSpace.sm) /
                  2,
              child: _ValueCard(label: value.key, value: value.value),
            ),
        ],
      );
}

class _FinancialReportHeader extends StatelessWidget {
  const _FinancialReportHeader({
    required this.company,
    required this.generatedAt,
    required this.currency,
    required this.generatedLabel,
  });

  final String company;
  final DateTime? generatedAt;
  final String? currency;
  final String generatedLabel;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      background: palette.surfaceAlt,
      child: Row(
        children: <Widget>[
          DecoratedBox(
            decoration: BoxDecoration(
              color: palette.primarySoft,
              borderRadius: BorderRadius.circular(TpRadius.md),
            ),
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Icon(
                Icons.assessment_outlined,
                color: palette.primaryDark,
                size: 32,
              ),
            ),
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  company,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w900,
                      ),
                ),
                if (generatedAt != null) ...<Widget>[
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    '$generatedLabel ${MaterialLocalizations.of(context).formatMediumDate(generatedAt!.toLocal())}',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: palette.textSecondary,
                        ),
                  ),
                ],
              ],
            ),
          ),
          TpStatusChip(
            status: currency == null || currency!.trim().isEmpty
                ? TpStatus.unknown
                : TpStatus.info,
            label: currency == null || currency!.trim().isEmpty
                ? '-'
                : currency!.trim().toUpperCase(),
            isCompact: true,
          ),
        ],
      ),
    );
  }
}

class _CostValueCard extends StatelessWidget {
  const _CostValueCard({
    required this.label,
    required this.value,
    required this.currency,
  });

  final String label;
  final num value;
  final String? currency;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            _money(value, currency),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w900,
                ),
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            label,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: palette.textSecondary,
                ),
          ),
        ],
      ),
    );
  }
}

class _CostComposition extends StatelessWidget {
  const _CostComposition({
    required this.title,
    required this.rows,
    required this.currency,
  });

  final String title;
  final List<MetricSlice> rows;
  final String? currency;

  @override
  Widget build(BuildContext context) {
    final List<MetricSlice> measured = rows
        .where((MetricSlice row) => row.cost != null && row.cost! >= 0)
        .toList(growable: false);
    if (measured.isEmpty) return const SizedBox.shrink();
    final TpPalette palette = TpPalette.of(context);
    final num total = measured.fold<num>(
      0,
      (num value, MetricSlice row) => value + row.cost!,
    );
    final List<Color> colors = <Color>[
      palette.primary,
      palette.info.base,
      palette.warning.base,
      palette.unknown.base,
      palette.critical.base,
    ];
    return Padding(
      padding: const EdgeInsets.only(top: TpSpace.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            title,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w900,
                ),
          ),
          const SizedBox(height: TpSpace.sm),
          TpCard(
            child: Column(
              children: <Widget>[
                if (total > 0)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(TpRadius.pill),
                    child: SizedBox(
                      height: 18,
                      child: Row(
                        children: <Widget>[
                          for (int index = 0; index < measured.length; index++)
                            Expanded(
                              flex: (measured[index].cost! / total * 1000)
                                  .round()
                                  .clamp(1, 1000)
                                  .toInt(),
                              child: ColoredBox(
                                color: colors[index % colors.length],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                if (total > 0) const SizedBox(height: TpSpace.md),
                for (int index = 0;
                    index < measured.length;
                    index++) ...<Widget>[
                  Row(
                    children: <Widget>[
                      Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          color: colors[index % colors.length],
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: TpSpace.sm),
                      Expanded(
                        child: Text(
                          measured[index].label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        _money(measured[index].cost!, currency),
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      if (total > 0) ...<Widget>[
                        const SizedBox(width: TpSpace.xs),
                        Text(
                          '${(measured[index].cost! / total * 100).round()}%',
                          style: TextStyle(color: palette.textMuted),
                        ),
                      ],
                    ],
                  ),
                  if (index != measured.length - 1)
                    const SizedBox(height: TpSpace.sm),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ValueCard extends StatelessWidget {
  const _ValueCard({required this.label, required this.value});
  final String label;
  final num value;

  @override
  Widget build(BuildContext context) => TpCard(
        margin: const EdgeInsets.only(bottom: TpSpace.xs),
        padding: const EdgeInsets.all(TpSpace.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              _compact(value),
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            Text(label),
          ],
        ),
      );
}

class _Distribution extends StatelessWidget {
  const _Distribution({required this.title, required this.rows});
  final String title;
  final List<MetricSlice> rows;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return const SizedBox.shrink();
    final TpPalette palette = TpPalette.of(context);
    final num max = rows.fold<num>(
      1,
      (num value, MetricSlice row) => row.count > value ? row.count : value,
    );
    return Padding(
      padding: const EdgeInsets.only(top: TpSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: TpSpace.sm),
          TpCard(
            padding: const EdgeInsets.all(TpSpace.md),
            child: Column(
              children: <Widget>[
                for (final MetricSlice row in rows) ...<Widget>[
                  Row(
                    children: <Widget>[
                      SizedBox(
                        width: 92,
                        child: Text(
                          row.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Expanded(
                        child: LinearProgressIndicator(
                          value: max == 0 ? 0 : row.count / max,
                          color: palette.primary,
                          backgroundColor: palette.surfaceAlt,
                          minHeight: 8,
                          borderRadius: BorderRadius.circular(TpRadius.pill),
                        ),
                      ),
                      const SizedBox(width: TpSpace.sm),
                      Text(_compact(row.count)),
                    ],
                  ),
                  const SizedBox(height: TpSpace.sm),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MemberCard extends StatelessWidget {
  const _MemberCard({
    required this.member,
    required this.copy,
    required this.onTap,
  });
  final TeamMember member;
  final ManagementCopy copy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      key: Key('team.member.${member.id}'),
      padding: const EdgeInsets.all(TpSpace.md),
      onTap: onTap,
      child: Row(
        children: <Widget>[
          CircleAvatar(
            backgroundColor: palette.primarySoft,
            foregroundColor: palette.primaryDark,
            child: Text(member.initials),
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  member.displayName,
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                Text(
                  <String>[
                    if (member.role != null) member.role!,
                    if (member.site != null) member.site!,
                  ].join(' / '),
                  style: TextStyle(color: palette.textSecondary),
                ),
              ],
            ),
          ),
          if (member.approved == false)
            TpStatusChip(
              status: TpStatus.warning,
              label: copy('pending'),
              isCompact: true,
            ),
          const SizedBox(width: TpSpace.xs),
          Icon(Icons.chevron_right, color: palette.textMuted),
        ],
      ),
    );
  }
}

class _MemberDetail extends StatefulWidget {
  const _MemberDetail({required this.member, required this.copy});
  final TeamMember member;
  final ManagementCopy copy;

  @override
  State<_MemberDetail> createState() => _MemberDetailState();
}

class _MemberDetailState extends State<_MemberDetail> {
  bool _launchFailed = false;

  Future<void> _launch(Uri uri) async {
    setState(() => _launchFailed = false);
    bool ok = false;
    try {
      ok = await launchUrl(uri);
    } on Object {
      ok = false;
    }
    if (!ok && mounted) setState(() => _launchFailed = true);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TeamMember member = widget.member;
    final String missing = l10n.managementTeamNotRecorded;
    final DateTime? lastLogin = member.lastLoginAt;
    final List<MapEntry<String, String>> rows = <MapEntry<String, String>>[
      MapEntry<String, String>(l10n.managementTeamRole, member.role ?? missing),
      MapEntry<String, String>(
        l10n.managementTeamUsername,
        member.username ?? missing,
      ),
      MapEntry<String, String>(l10n.managementTeamSite, member.site ?? missing),
      MapEntry<String, String>(
        l10n.managementTeamCountry,
        member.country ?? missing,
      ),
      MapEntry<String, String>(
        l10n.managementTeamPhone,
        member.phone ?? missing,
      ),
      MapEntry<String, String>(
        l10n.managementTeamEmail,
        member.email ?? missing,
      ),
      MapEntry<String, String>(
        l10n.managementTeamStatus,
        switch (member.approved) {
          true => l10n.managementTeamApproved,
          false => widget.copy('pending'),
          null => missing,
        },
      ),
      MapEntry<String, String>(
        l10n.managementTeamLastLogin,
        lastLogin == null
            ? missing
            : MaterialLocalizations.of(context)
                .formatMediumDate(lastLogin.toLocal()),
      ),
    ];
    return ListView(
      key: Key('team.detail.${member.id}'),
      shrinkWrap: true,
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
      children: <Widget>[
        for (final MapEntry<String, String> row in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: TpSpace.sm),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                SizedBox(
                  width: 112,
                  child: Text(
                    row.key,
                    style: TextStyle(color: palette.textSecondary),
                  ),
                ),
                Expanded(
                  child: Text(
                    row.value,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
          ),
        if (member.phone != null || member.email != null) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              if (member.phone != null)
                TpButton.secondary(
                  label: l10n.managementTeamCall,
                  icon: Icons.call_outlined,
                  onPressed: () =>
                      _launch(Uri(scheme: 'tel', path: member.phone)),
                ),
              if (member.email != null)
                TpButton.secondary(
                  label: l10n.managementTeamSendEmail,
                  icon: Icons.mail_outline,
                  onPressed: () =>
                      _launch(Uri(scheme: 'mailto', path: member.email)),
                ),
            ],
          ),
        ],
        if (_launchFailed) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          Text(
            l10n.managementTeamActionError,
            style: TextStyle(color: palette.critical.base),
          ),
        ],
      ],
    );
  }
}

/// Builds the PDF of the report on screen. Public for tests.
@visibleForTesting
pw.Document buildManagementReportPdf(
  ExecutiveSnapshot snapshot,
  ManagementCopy copy,
  AppLocalizations l10n,
  int periodDays,
  String? currency,
) {
  final String code = (currency ?? '').trim().toUpperCase();
  final pw.Document document = pw.Document();
  final List<List<String>> kpis = <List<String>>[
    for (final MapEntry<String, num> entry in snapshot.kpis.entries)
      <String>[copy(entry.key), _compact(entry.value)],
  ];
  final List<List<String>> costs = <List<String>>[
    for (final MapEntry<String, num?> entry in snapshot.cost.entries)
      if (entry.value != null)
        <String>[copy(entry.key), _money(entry.value!, currency)],
  ];
  document.addPage(
    pw.MultiPage(
      build: (pw.Context context) => <pw.Widget>[
        pw.Header(level: 0, text: copy('reportsTitle')),
        pw.Text(snapshot.company),
        pw.Text(l10n.managementReportsPdfPeriod(periodDays)),
        if (code.isNotEmpty) pw.Text(l10n.managementReportsPdfCurrency(code)),
        if (snapshot.generatedAt != null)
          pw.Text(
            '${copy('generated')} ${_isoDate(snapshot.generatedAt!.toLocal())}',
          ),
        pw.SizedBox(height: 12),
        pw.TableHelper.fromTextArray(
          headers: <String>[
            l10n.managementReportsPdfMetric,
            l10n.managementReportsPdfValue,
          ],
          data: kpis,
        ),
        if (costs.isNotEmpty) ...<pw.Widget>[
          pw.SizedBox(height: 12),
          pw.Header(level: 1, text: copy('costPerformance')),
          pw.TableHelper.fromTextArray(
            headers: <String>[
              l10n.managementReportsPdfMetric,
              l10n.managementReportsPdfValue,
            ],
            data: costs,
          ),
        ],
        for (final MapEntry<String, List<MetricSlice>> entry
            in snapshot.breakdowns.entries)
          if (entry.value.isNotEmpty) ...<pw.Widget>[
            pw.SizedBox(height: 12),
            pw.Header(level: 1, text: copy(entry.key)),
            pw.TableHelper.fromTextArray(
              headers: <String>[
                l10n.managementReportsPdfMetric,
                l10n.managementReportsPdfValue,
              ],
              data: <List<String>>[
                for (final MetricSlice row in entry.value)
                  <String>[
                    row.label,
                    row.cost == null
                        ? _compact(row.count)
                        : _money(row.cost!, currency),
                  ],
              ],
            ),
          ],
      ],
    ),
  );
  return document;
}

String _isoDate(DateTime value) => '${value.year.toString().padLeft(4, '0')}-'
    '${value.month.toString().padLeft(2, '0')}-'
    '${value.day.toString().padLeft(2, '0')}';

AppError _asError(Object error, String fallback) => switch (error) {
      final SupabaseFailure failure => failure.error,
      final AppError appError => appError,
      _ => AppError(
          kind: AppErrorKind.unknown,
          message: fallback,
          cause: error,
          isRetryable: true,
        ),
    };

String _compact(num value) {
  final num absolute = value.abs();
  if (absolute >= 1000000) return '${(value / 1000000).toStringAsFixed(1)}M';
  if (absolute >= 1000) return '${(value / 1000).toStringAsFixed(1)}K';
  return value.round().toString();
}

String _money(num value, String? currency) {
  final String code = (currency ?? '').trim().toUpperCase();
  if (code.isEmpty) return '-';
  return '$code ${_compact(value)}';
}
