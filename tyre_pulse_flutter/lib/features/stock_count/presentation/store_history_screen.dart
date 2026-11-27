/// Store history: every stock movement the reader may see (receipts, issues,
/// returns, transfers, corrections, counts, ERP ledger postings), filtered by
/// date range, movement type, location and item, with stock in / out / net
/// totals for the filter and per month.
///
/// Quantities only. Values are deliberately not totalled here: the ledger
/// carries several currencies and a blended money total is not a quantity of
/// anything.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_movement.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_item_detail_screen.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_movement_pager.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_movement_widgets.dart';
import 'package:tyre_pulse/features/stock_count/presentation/store_history_copy.dart';
import 'package:tyre_pulse/features/stock_count/stock_count_providers.dart';

class StoreHistoryScreen extends ConsumerStatefulWidget {
  const StoreHistoryScreen({this.stockId, this.itemLabel, super.key});

  /// Narrows the history to one stock line (opened from its detail screen).
  final String? stockId;
  final String? itemLabel;

  static Route<void> route({String? stockId, String? itemLabel}) =>
      MaterialPageRoute<void>(
        builder: (_) =>
            StoreHistoryScreen(stockId: stockId, itemLabel: itemLabel),
        settings: const RouteSettings(name: 'stock/history'),
      );

  @override
  ConsumerState<StoreHistoryScreen> createState() => _StoreHistoryScreenState();
}

class _StoreHistoryScreenState extends ConsumerState<StoreHistoryScreen> {
  late final StockMovementPager _pager =
      StockMovementPager(repository: ref.read(stockHistoryRepositoryProvider));
  final TextEditingController _search = TextEditingController();
  Timer? _debounce;
  late StockHistoryQuery _query = StockHistoryQuery(
    stockId: widget.stockId,
    country: ref.read(activeCountryProvider),
  );

  @override
  void initState() {
    super.initState();
    _pager.addListener(_onPager);
    unawaited(_pager.refresh(_query));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    _pager
      ..removeListener(_onPager)
      ..dispose();
    super.dispose();
  }

  void _onPager() {
    if (mounted) setState(() {});
  }

  void _apply(StockHistoryQuery next) {
    if (next == _query) return;
    setState(() => _query = next);
    unawaited(_pager.refresh(next));
  }

  void _onSearch(String value) {
    _debounce?.cancel();
    _debounce = Timer(
      const Duration(milliseconds: 350),
      () => _apply(_query.copyWith(search: value.trim())),
    );
  }

  Future<void> _pickDates() async {
    final DateTime now = DateTime.now();
    final DateTimeRange? range = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 10),
      lastDate: DateTime(now.year, now.month, now.day),
      initialDateRange: _query.from != null && _query.to != null
          ? DateTimeRange(start: _query.from!, end: _query.to!)
          : null,
    );
    if (range == null) return;
    _apply(_query.copyWith(from: range.start, to: range.end));
  }

  Future<void> _refresh() async {
    ref.invalidate(stockHistorySummaryProvider(_query));
    await _pager.refresh(_query);
  }

  Future<void> _openItem(String stockId) async {
    final List<StockItem> items = await ref
        .read(stockItemsProvider.future)
        .catchError((Object _) => const <StockItem>[]);
    StockItem? item;
    for (final StockItem row in items) {
      if (row.id == stockId) item = row;
    }
    if (item == null || !mounted) return;
    await Navigator.of(context).push(StockItemDetailScreen.route(item));
  }

  @override
  Widget build(BuildContext context) {
    final StoreHistoryCopy copy = StoreHistoryCopy.of(context);
    final String locale = Localizations.localeOf(context).toLanguageTag();
    final List<String> sites = switch (ref.watch(stockItemsProvider)) {
      AsyncData<List<StockItem>>(:final value) => (<String>{
          for (final StockItem row in value)
            if ((row.site ?? '').trim().isNotEmpty) row.site!.trim(),
        }.toList()
          ..sort()),
      _ => const <String>[],
    };
    final bool filtered = _query.site != null ||
        _query.type != MovementTypeFilter.all ||
        _query.from != null ||
        (_query.search ?? '').isNotEmpty;
    final String dates = _query.from == null || _query.to == null
        ? copy('anyDate')
        : '${DateFormat.yMMMd(locale).format(_query.from!)} - '
            '${DateFormat.yMMMd(locale).format(_query.to!)}';

    return TpScaffold(
      appBar: TpAppBar(
        title: copy('historyTitle'),
        subtitle: widget.itemLabel,
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.md,
            TpSpace.lg,
            TpSpace.xxxl,
          ),
          children: <Widget>[
            if (widget.stockId == null) ...<Widget>[
              TextField(
                key: const Key('stock.history.search'),
                controller: _search,
                onChanged: _onSearch,
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search_rounded),
                  hintText: copy('searchItem'),
                ),
              ),
              const SizedBox(height: TpSpace.sm),
            ],
            Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.sm,
              children: <Widget>[
                ActionChip(
                  key: const Key('stock.history.dates'),
                  avatar: const Icon(Icons.date_range_rounded, size: 18),
                  label: Text(dates),
                  onPressed: () => unawaited(_pickDates()),
                ),
                _MenuChip<MovementTypeFilter>(
                  key: const Key('stock.history.type'),
                  icon: Icons.filter_list_rounded,
                  label: copy.filter(_query.type),
                  values: MovementTypeFilter.values,
                  labelOf: copy.filter,
                  onSelected: (MovementTypeFilter v) =>
                      _apply(_query.copyWith(type: v)),
                ),
                if (widget.stockId == null)
                  _MenuChip<String?>(
                    key: const Key('stock.history.site'),
                    icon: Icons.place_outlined,
                    label: _query.site ?? copy('allLocations'),
                    values: <String?>[null, ...sites],
                    labelOf: (String? s) => s ?? copy('allLocations'),
                    onSelected: (String? v) => _apply(
                      v == null
                          ? _query.copyWith(clearSite: true)
                          : _query.copyWith(site: v),
                    ),
                  ),
                if (filtered)
                  ActionChip(
                    key: const Key('stock.history.clear'),
                    avatar: const Icon(Icons.clear_rounded, size: 18),
                    label: Text(copy('clearFilters')),
                    onPressed: () {
                      _search.clear();
                      _apply(
                        StockHistoryQuery(
                          stockId: widget.stockId,
                          country: _query.country,
                        ),
                      );
                    },
                  ),
              ],
            ),
            const SizedBox(height: TpSpace.md),
            _Summary(query: _query, copy: copy, locale: locale),
            const SizedBox(height: TpSpace.md),
            ..._list(copy, filtered),
          ],
        ),
      ),
    );
  }

  List<Widget> _list(StoreHistoryCopy copy, bool filtered) {
    final List<StockMovement> rows = _pager.rows;
    if (rows.isEmpty && _pager.loading) {
      return const <Widget>[SizedBox(height: 160, child: TpLoadingState())];
    }
    if (rows.isEmpty && _pager.error != null) {
      return <Widget>[
        TpErrorState(
          error: stockHistoryAppError(_pager.error!, copy),
          onRetry: () => unawaited(_pager.refresh(_query)),
        ),
      ];
    }
    if (rows.isEmpty) {
      return <Widget>[
        TpEmptyState(
          icon: Icons.history_rounded,
          title: filtered ? copy('noMatch') : copy('noMovements'),
          message: filtered ? copy('noMatchBody') : copy('noMovementsBody'),
        ),
      ];
    }
    // A running balance can only be walked back for one item's unfiltered
    // run; otherwise only the ledger's own qty_after is shown.
    final List<num?> balances = resolveBalances(rows);
    return <Widget>[
      for (int i = 0; i < rows.length; i++) ...<Widget>[
        InkWell(
          onTap: widget.stockId == null && rows[i].stockId != null
              ? () => unawaited(_openItem(rows[i].stockId!))
              : null,
          child: StockMovementTile(
            movement: rows[i],
            balance: balances[i],
            copy: copy,
            showItem: widget.stockId == null,
          ),
        ),
        const SizedBox(height: TpSpace.sm),
      ],
      if (_pager.error != null)
        Text(
          stockHistoryFailureText(
            _pager.error!,
            copy,
            fallbackKey: 'loadFailed',
          ),
          style: TextStyle(color: TpPalette.of(context).critical.base),
        ),
      if (_pager.hasMore)
        OutlinedButton(
          key: const Key('stock.history.loadMore'),
          onPressed: _pager.loading ? null : () => unawaited(_pager.loadMore()),
          child: Text(copy('loadMore')),
        ),
    ];
  }
}

class _Summary extends ConsumerWidget {
  const _Summary({
    required this.query,
    required this.copy,
    required this.locale,
  });
  final StockHistoryQuery query;
  final StoreHistoryCopy copy;
  final String locale;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<MovementSummary> state =
        ref.watch(stockHistorySummaryProvider(query));
    final TextTheme text = Theme.of(context).textTheme;
    final Color muted = TpPalette.of(context).textSecondary;
    return switch (state) {
      AsyncData<MovementSummary>(:final value) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            MovementTotalsTiles(totals: value.total, copy: copy),
            if (value.total.openings > 0)
              Padding(
                padding: const EdgeInsets.only(top: TpSpace.xs),
                child: Text(
                  copy('openingsNote'),
                  style: text.bodySmall?.copyWith(color: muted),
                ),
              ),
            if (value.byMonth.length > 1) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              ExpansionTile(
                key: const Key('stock.history.byMonth'),
                tilePadding: EdgeInsets.zero,
                title: Text(copy('byMonth')),
                children: <Widget>[
                  for (final PeriodTotals p in value.byMonth)
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text(DateFormat.yMMM(locale).format(p.month)),
                      subtitle: Text(
                        '${copy('stockIn')} ${formatQty(p.totals.stockIn)} · '
                        '${copy('stockOut')} ${formatQty(p.totals.stockOut)} · '
                        '${copy('net')} ${signedQty(p.totals.net)}',
                      ),
                    ),
                ],
              ),
            ],
          ],
        ),
      AsyncError<MovementSummary>(:final error) => Text(
          error is StateError ? copy('summaryCapped') : copy('summaryFailed'),
          key: const Key('stock.history.summaryError'),
          style: text.bodySmall?.copyWith(color: muted),
        ),
      _ => const SizedBox(height: 72, child: TpLoadingState()),
    };
  }
}

class _MenuChip<T> extends StatelessWidget {
  const _MenuChip({
    required this.icon,
    required this.label,
    required this.values,
    required this.labelOf,
    required this.onSelected,
    super.key,
  });
  final IconData icon;
  final String label;
  final List<T> values;
  final String Function(T) labelOf;
  final ValueChanged<T> onSelected;

  @override
  Widget build(BuildContext context) => PopupMenuButton<int>(
        tooltip: label,
        onSelected: (int i) => onSelected(values[i]),
        itemBuilder: (BuildContext context) => <PopupMenuEntry<int>>[
          for (int i = 0; i < values.length; i++)
            PopupMenuItem<int>(value: i, child: Text(labelOf(values[i]))),
        ],
        child: Chip(
          avatar: Icon(icon, size: 18),
          label: Text(label),
        ),
      );
}
