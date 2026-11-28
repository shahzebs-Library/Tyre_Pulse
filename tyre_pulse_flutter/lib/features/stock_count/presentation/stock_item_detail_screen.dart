/// One stock line on the phone: what is on hand, reserved and available,
/// the reorder levels (read only: an admin sets them on the web), receive
/// stock into it, and its movements newest first with the balance after
/// each one.
///
/// Pushed from the Stock Count screen with Navigator, behind the same
/// `stock` module gate; it adds no route and no role.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/devices/label_encoder.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/devices/presentation/label_print_action.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_history_repository.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_movement.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_movement_pager.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_movement_widgets.dart';
import 'package:tyre_pulse/features/stock_count/presentation/store_history_copy.dart';
import 'package:tyre_pulse/features/stock_count/presentation/store_history_screen.dart';
import 'package:tyre_pulse/features/stock_count/stock_count_providers.dart';

/// Error shown for a failed ledger read, keeping the connectivity /
/// permission meaning of a [SupabaseFailure].
AppError stockHistoryAppError(Object error, StoreHistoryCopy copy) =>
    switch (error) {
      final SupabaseFailure failure => failure.error,
      final AppError appError => appError,
      _ => AppError(
          kind: AppErrorKind.unknown,
          message: copy('loadFailed'),
          cause: error,
          isRetryable: true,
        ),
    };

class StockItemDetailScreen extends ConsumerStatefulWidget {
  const StockItemDetailScreen({required this.item, super.key});
  final StockItem item;

  static Route<void> route(StockItem item) => MaterialPageRoute<void>(
        builder: (_) => StockItemDetailScreen(item: item),
        settings: const RouteSettings(name: 'stock/item'),
      );

  @override
  ConsumerState<StockItemDetailScreen> createState() =>
      _StockItemDetailScreenState();
}

class _StockItemDetailScreenState extends ConsumerState<StockItemDetailScreen> {
  late final StockMovementPager _pager = StockMovementPager(
    repository: ref.read(stockHistoryRepositoryProvider),
    pageSize: 20,
  );
  late StockItem _item = widget.item;

  StockHistoryQuery get _query => StockHistoryQuery(stockId: _item.id);

  @override
  void initState() {
    super.initState();
    _pager.addListener(_onPager);
    unawaited(_pager.refresh(_query));
  }

  @override
  void dispose() {
    _pager
      ..removeListener(_onPager)
      ..dispose();
    super.dispose();
  }

  void _onPager() {
    if (mounted) setState(() {});
  }

  Future<void> _reload() async {
    ref.invalidate(stockItemsProvider);
    try {
      final List<StockItem> rows = await ref.read(stockItemsProvider.future);
      for (final StockItem row in rows) {
        if (row.id == _item.id) {
          if (mounted) setState(() => _item = row);
          break;
        }
      }
    } on Object {
      // The list read failing keeps the last known header; the movements
      // below still report their own error state.
    }
    await _pager.refresh(_query);
  }

  Future<void> _receive(StoreHistoryCopy copy) async {
    final StockHistoryRepository repo =
        ref.read(stockHistoryRepositoryProvider);
    final StockPostResult? result = await showReceiveStockSheet(
      context,
      item: _item,
      copy: copy,
      post: ({
        required StockPostType type,
        required int quantity,
        String? reference,
        String? reason,
      }) =>
          repo.post(
        item: _item,
        type: type,
        quantity: quantity,
        reference: reference,
        reason: reason,
      ),
    );
    if (result == null) return;
    await _reload();
  }

  @override
  Widget build(BuildContext context) {
    final StoreHistoryCopy copy = StoreHistoryCopy.of(context);
    return TpScaffold(
      appBar: TpAppBar(
        title: copy('itemTitle'),
        actions: <Widget>[
          LabelPrintButton(
            label: LabelData(
              code: _item.itemId ?? _item.id,
              name: _item.description ?? (_item.itemId ?? _item.id),
              caption: _item.site,
            ),
          ),
          IconButton(
            key: const Key('stock.item.history'),
            tooltip: copy('fullHistory'),
            icon: const Icon(Icons.history_rounded),
            onPressed: () => unawaited(
              Navigator.of(context).push(
                StoreHistoryScreen.route(
                  stockId: _item.id,
                  itemLabel: _item.description,
                ),
              ),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.md,
            TpSpace.lg,
            TpSpace.xxxl,
          ),
          children: <Widget>[
            _Header(item: _item, copy: copy),
            const SizedBox(height: TpSpace.md),
            FilledButton.icon(
              key: const Key('stock.item.receive'),
              onPressed: () => unawaited(_receive(copy)),
              icon: const Icon(Icons.add_box_outlined),
              label: Text(copy('receive')),
            ),
            const SizedBox(height: TpSpace.lg),
            Text(
              copy('recent'),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: TpSpace.sm),
            ..._movements(copy),
          ],
        ),
      ),
    );
  }

  List<Widget> _movements(StoreHistoryCopy copy) {
    final List<StockMovement> rows = _pager.rows;
    if (rows.isEmpty && _pager.loading) {
      return const <Widget>[
        SizedBox(height: 160, child: TpLoadingState()),
      ];
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
          title: copy('noMovements'),
          message: copy('noMovementsBody'),
        ),
      ];
    }
    final List<num?> balances =
        resolveBalances(rows, currentQuantity: _item.quantity);
    return <Widget>[
      for (int i = 0; i < rows.length; i++) ...<Widget>[
        StockMovementTile(movement: rows[i], balance: balances[i], copy: copy),
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
          key: const Key('stock.item.loadMore'),
          onPressed: _pager.loading ? null : () => unawaited(_pager.loadMore()),
          child: Text(copy('loadMore')),
        ),
    ];
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.item, required this.copy});
  final StockItem item;
  final StoreHistoryCopy copy;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String status =
        stockStatus(item.quantity, item.minimum, item.critical);
    Widget fact(String key, String label, String value) => SizedBox(
          width: 140,
          child: Column(
            key: Key('stock.item.fact.$key'),
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                label,
                style: text.bodySmall?.copyWith(color: palette.textSecondary),
              ),
              Text(value, style: text.titleMedium),
            ],
          ),
        );
    return TpCard(
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            item.description ?? copy('itemTitle'),
            style: text.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          if (item.site != null)
            Text(item.site!, style: TextStyle(color: palette.textSecondary)),
          const SizedBox(height: TpSpace.xs),
          TpStatusChip(
            status: switch (status) {
              'Critical' => TpStatus.critical,
              'Low' => TpStatus.warning,
              _ => TpStatus.ok,
            },
          ),
          const SizedBox(height: TpSpace.md),
          Wrap(
            spacing: TpSpace.md,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              fact('onHand', copy('onHand'), formatQty(item.quantity)),
              if (item.reserved != null)
                fact('reserved', copy('reserved'), formatQty(item.reserved!)),
              fact('available', copy('available'), formatQty(item.available)),
              fact('min', copy('minLevel'), formatQty(item.minimum)),
              fact('critical', copy('criticalLevel'), formatQty(item.critical)),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          Text(
            copy('levelsNote'),
            style: text.bodySmall?.copyWith(color: palette.textSecondary),
          ),
        ],
      ),
    );
  }
}
