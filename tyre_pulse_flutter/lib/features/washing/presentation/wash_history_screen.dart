/// Wash history, opened from the wash screen's history button.
///
/// Replaces the old "Recent washes" bottom sheet with a full page: summary
/// numbers at the top (washes in the last 7 days and this month, the asset
/// washed most this month), then filters (date range, wash type, asset or
/// person search, my entries only) and one row per wash with its coloured
/// type chip and photo count. Tapping a row opens [WashRecordViewer].
///
/// Every number comes from the rows `WashRepository.listRecentWashes`
/// returns; see `wash_insights.dart`. Loading, error (with retry), empty and
/// "nothing matches these filters" each have their own state.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/washing/data/wash_record.dart';
import 'package:tyre_pulse/features/washing/domain/wash_insights.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_record_viewer.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_ui.dart';
import 'package:tyre_pulse/features/washing/washing_providers.dart';

enum _DateRange { all, sevenDays, thirtyDays, custom }

abstract final class WashHistoryKeys {
  static const ValueKey<String> search = ValueKey<String>('washHistory.search');
  static const ValueKey<String> stats = ValueKey<String>('washHistory.stats');
  static const ValueKey<String> list = ValueKey<String>('washHistory.list');
  static ValueKey<String> typeFilter(String? type) =>
      ValueKey<String>('washHistory.type.${type ?? 'all'}');
  static ValueKey<String> range(String name) =>
      ValueKey<String>('washHistory.range.$name');
}

class WashHistoryScreen extends ConsumerStatefulWidget {
  const WashHistoryScreen({this.now, super.key});

  /// Test seam for "today"; null uses the device clock.
  final DateTime? now;

  @override
  ConsumerState<WashHistoryScreen> createState() => _WashHistoryScreenState();
}

class _WashHistoryScreenState extends ConsumerState<WashHistoryScreen> {
  bool _loading = true;
  AppError? _error;
  List<WashRecord> _washes = const <WashRecord>[];
  int _loadTicket = 0;

  _DateRange _range = _DateRange.all;
  DateTimeRange? _customRange;
  String? _type;
  String _query = '';
  bool _mine = false;
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  DateTime get _now => widget.now ?? DateTime.now();

  Future<void> _load() async {
    final int ticket = ++_loadTicket;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<WashRecord> washes =
          await ref.read(washRepositoryProvider).listRecentWashes();
      if (!mounted || ticket != _loadTicket) return;
      setState(() {
        _washes = washes;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted || ticket != _loadTicket) return;
      final AppLocalizations l10n = AppLocalizations.of(context);
      setState(() {
        _error = _asAppError(error, l10n.washRecentLoadErrorMessage);
        _loading = false;
      });
    }
  }

  static AppError _asAppError(Object error, String fallbackMessage) {
    if (error is AppError) return error;
    if (error is SupabaseFailure) return error.error;
    return AppError(
      kind: AppErrorKind.unknown,
      message: fallbackMessage,
      technical: error.toString(),
      cause: error,
      isRetryable: true,
    );
  }

  WashHistoryFilter get _filter {
    final DateTime today = DateTime(_now.year, _now.month, _now.day);
    DateTime? from;
    DateTime? to;
    switch (_range) {
      case _DateRange.all:
        break;
      case _DateRange.sevenDays:
        from = today.subtract(const Duration(days: 6));
        to = today;
      case _DateRange.thirtyDays:
        from = today.subtract(const Duration(days: 29));
        to = today;
      case _DateRange.custom:
        from = _customRange?.start;
        to = _customRange?.end;
    }
    return WashHistoryFilter(
      from: from,
      to: to,
      washType: _type,
      query: _query,
      mineOnly: _mine,
    );
  }

  Future<void> _pickRange() async {
    final DateTime today = DateTime(_now.year, _now.month, _now.day);
    final DateTimeRange? picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(today.year - 5),
      lastDate: today,
      initialDateRange: _customRange,
    );
    if (!mounted || picked == null) return;
    setState(() {
      _customRange = picked;
      _range = _DateRange.custom;
    });
  }

  void _clearFilters() {
    _searchController.clear();
    setState(() {
      _range = _DateRange.all;
      _customRange = null;
      _type = null;
      _query = '';
      _mine = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    ref.listen(workspaceContextProvider, (previous, next) {
      if (previous?.userId != next?.userId ||
          previous?.companyId != next?.companyId ||
          previous?.activeCountry != next?.activeCountry ||
          previous?.activeSites != next?.activeSites) {
        unawaited(_load());
      }
    });

    final Widget body;
    if (_loading) {
      body = const TpLoadingState();
    } else if (_error != null) {
      body = TpErrorState(error: _error!, onRetry: _load);
    } else if (_washes.isEmpty) {
      body = TpEmptyState(message: l10n.washRecentEmptyMessage);
    } else {
      body = _buildContent(context, l10n);
    }

    return TpScaffold(
      appBar: TpAppBar(title: l10n.washHistoryTitle),
      body: body,
    );
  }

  Widget _buildContent(BuildContext context, AppLocalizations l10n) {
    final TpPalette palette = TpPalette.of(context);
    final String? userId = ref.watch(workspaceContextProvider)?.userId;
    final WashHistoryStats stats = washHistoryStats(_washes, now: _now);
    final WashHistoryFilter filter = _filter;
    final List<WashRecord> visible =
        filterWashHistory(_washes, filter, userId: userId);
    final List<String> types = <String>{
      ...kWashTypes,
      for (final WashRecord w in _washes)
        if (w.washType != null && !kWashTypes.contains(w.washType)) w.washType!,
    }.toList();

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        key: WashHistoryKeys.list,
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        itemCount: visible.length + 2,
        itemBuilder: (BuildContext context, int index) {
          if (index == 0) {
            return _StatsRow(stats: stats);
          }
          if (index == 1) {
            return Padding(
              padding: const EdgeInsets.only(
                top: TpSpace.lg,
                bottom: TpSpace.md,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  TextField(
                    key: WashHistoryKeys.search,
                    controller: _searchController,
                    decoration: InputDecoration(
                      labelText: l10n.washSearchHistory,
                      prefixIcon: const Icon(Icons.search_rounded),
                    ),
                    onChanged: (String v) => setState(() => _query = v),
                  ),
                  const SizedBox(height: TpSpace.sm),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: <Widget>[
                        _chip(
                          WashHistoryKeys.range('all'),
                          l10n.washFilterAllDates,
                          _range == _DateRange.all,
                          () => setState(() => _range = _DateRange.all),
                        ),
                        _chip(
                          WashHistoryKeys.range('7'),
                          l10n.washFilterSevenDays,
                          _range == _DateRange.sevenDays,
                          () => setState(() => _range = _DateRange.sevenDays),
                        ),
                        _chip(
                          WashHistoryKeys.range('30'),
                          l10n.washFilterThirtyDays,
                          _range == _DateRange.thirtyDays,
                          () => setState(() => _range = _DateRange.thirtyDays),
                        ),
                        _chip(
                          WashHistoryKeys.range('custom'),
                          _range == _DateRange.custom && _customRange != null
                              ? '${_iso(_customRange!.start)} - ${_iso(_customRange!.end)}'
                              : l10n.washFilterPickDates,
                          _range == _DateRange.custom,
                          _pickRange,
                          icon: Icons.date_range_rounded,
                        ),
                        _chip(
                          null,
                          l10n.washMyEntries,
                          _mine,
                          () => setState(() => _mine = !_mine),
                          icon: Icons.person_outline_rounded,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: TpSpace.xs),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: <Widget>[
                        _chip(
                          WashHistoryKeys.typeFilter(null),
                          l10n.washFilterAllTypes,
                          _type == null,
                          () => setState(() => _type = null),
                        ),
                        for (final String type in types)
                          _chip(
                            WashHistoryKeys.typeFilter(type),
                            washTypeName(l10n, type),
                            _type == type,
                            () => setState(
                              () => _type = _type == type ? null : type,
                            ),
                            icon: WashTypeStyle.of(type).icon,
                            tone: WashTypeStyle.of(type).tone,
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: TpSpace.sm),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          l10n.washCount(visible.length),
                          style: Theme.of(context)
                              .textTheme
                              .labelLarge
                              ?.copyWith(color: palette.textSecondary),
                        ),
                      ),
                      if (filter.isActive)
                        TextButton.icon(
                          onPressed: _clearFilters,
                          icon: const Icon(Icons.filter_alt_off_outlined),
                          label: Text(l10n.washFilterClear),
                        ),
                    ],
                  ),
                  if (visible.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: TpSpace.xl),
                      child: TpEmptyState(message: l10n.washHistoryNoMatch),
                    ),
                ],
              ),
            );
          }
          return Padding(
            padding: const EdgeInsets.only(bottom: TpSpace.sm),
            child: _WashHistoryRow(wash: visible[index - 2]),
          );
        },
      ),
    );
  }

  Widget _chip(
    Key? key,
    String label,
    bool selected,
    VoidCallback onTap, {
    IconData? icon,
    TpGemTone? tone,
  }) {
    final ({Color background, Color foreground})? tint =
        tone == null ? null : washToneColors(context, tone);
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: TpSpace.sm),
      child: FilterChip(
        key: key,
        avatar:
            icon == null ? null : Icon(icon, size: 16, color: tint?.foreground),
        label: Text(label),
        selected: selected,
        showCheckmark: icon == null,
        selectedColor: tint?.background,
        onSelected: (_) => onTap(),
      ),
    );
  }

  static String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

class _StatsRow extends StatelessWidget {
  const _StatsRow({required this.stats});

  final WashHistoryStats stats;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return LayoutBuilder(
      key: WashHistoryKeys.stats,
      builder: (BuildContext context, BoxConstraints constraints) {
        final List<Widget> tiles = <Widget>[
          _StatTile(
            icon: Icons.today_rounded,
            tone: TpGemTone.teal,
            label: l10n.washStatLastSevenDays,
            value: '${stats.lastSevenDays}',
          ),
          _StatTile(
            icon: Icons.calendar_month_rounded,
            tone: TpGemTone.blue,
            label: l10n.washStatThisMonth,
            value: '${stats.thisMonth}',
          ),
          _StatTile(
            icon: Icons.leaderboard_rounded,
            tone: TpGemTone.violet,
            label: l10n.washStatTopAsset,
            value: stats.topAsset ?? l10n.washStatNone,
            detail: stats.topAsset == null
                ? null
                : l10n.washCount(stats.topAssetCount),
          ),
        ];
        if (constraints.maxWidth >= 560) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              for (int i = 0; i < tiles.length; i++) ...<Widget>[
                if (i > 0) const SizedBox(width: TpSpace.sm),
                Expanded(child: tiles[i]),
              ],
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(child: tiles[0]),
                const SizedBox(width: TpSpace.sm),
                Expanded(child: tiles[1]),
              ],
            ),
            const SizedBox(height: TpSpace.sm),
            tiles[2],
          ],
        );
      },
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.icon,
    required this.tone,
    required this.label,
    required this.value,
    this.detail,
  });

  final IconData icon;
  final TpGemTone tone;
  final String label;
  final String value;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return TpCard(
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        children: <Widget>[
          WashGem(icon: icon, tone: tone, size: 40),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.titleLarge?.copyWith(
                    color: palette.text,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Text(
                  detail == null ? label : '$label · $detail',
                  style: text.labelSmall?.copyWith(color: palette.textMuted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _WashHistoryRow extends StatelessWidget {
  const _WashHistoryRow({required this.wash});

  final WashRecord wash;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final WashTypeStyle style = WashTypeStyle.of(wash.washType);
    final int photos = wash.photos?.length ?? 0;
    final String when = <String>[
      if (wash.washDate != null) wash.washDate!,
      if (wash.washTime != null) wash.washTime!,
    ].join(' ');
    final String person = wash.entryName ??
        wash.entryUsername ??
        wash.washedBy ??
        l10n.washNotRecorded;

    return TpCard(
      padding: const EdgeInsets.all(TpSpace.md),
      onTap: () => Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (_) => WashRecordViewer(wash: wash),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          WashGem(icon: style.icon, tone: style.tone, size: 40),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  wash.assetNo,
                  style: text.titleSmall?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: TpSpace.xs),
                Wrap(
                  spacing: TpSpace.sm,
                  runSpacing: TpSpace.xs,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    if (wash.washType != null)
                      WashTypeChip(type: wash.washType!),
                    if (photos > 0)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Icon(
                            Icons.photo_library_outlined,
                            size: 14,
                            color: palette.textMuted,
                          ),
                          const SizedBox(width: 2),
                          Text(
                            l10n.washPhotoCountShort(photos),
                            style: text.labelSmall
                                ?.copyWith(color: palette.textMuted),
                          ),
                        ],
                      ),
                  ],
                ),
                const SizedBox(height: TpSpace.xs),
                Text(
                  <String>[
                    if (when.isNotEmpty) when,
                    if (wash.site != null) wash.site!,
                    '${l10n.washEnteredByLabel}: $person',
                  ].join(' · '),
                  style: text.bodySmall?.copyWith(color: palette.textSecondary),
                ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.xs),
          Icon(Icons.chevron_right, color: palette.textMuted),
        ],
      ),
    );
  }
}
