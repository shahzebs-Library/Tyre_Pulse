/// Shared pieces of the stock item detail and store history screens: the
/// movement row, the in / out / net tiles and the receive-stock sheet.
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_history_repository.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_movement.dart';
import 'package:tyre_pulse/features/stock_count/presentation/store_history_copy.dart';

String formatQty(num value) => value == value.roundToDouble()
    ? value.toInt().toString()
    : value.toString();

String signedQty(num value) =>
    value > 0 ? '+${formatQty(value)}' : formatQty(value);

IconData movementIcon(MovementCategory category) => switch (category) {
      MovementCategory.receipt => Icons.call_received_rounded,
      MovementCategory.issue => Icons.call_made_rounded,
      MovementCategory.returned => Icons.undo_rounded,
      MovementCategory.transfer => Icons.swap_horiz_rounded,
      MovementCategory.adjustment => Icons.tune_rounded,
      MovementCategory.count => Icons.fact_check_outlined,
      MovementCategory.opening => Icons.flag_outlined,
      MovementCategory.erpLedger => Icons.receipt_long_outlined,
      MovementCategory.other => Icons.circle_outlined,
    };

class StockMovementTile extends StatelessWidget {
  const StockMovementTile({
    required this.movement,
    required this.balance,
    required this.copy,
    this.showItem = false,
    super.key,
  });

  final StockMovement movement;
  final num? balance;
  final StoreHistoryCopy copy;

  /// Store history shows which item moved; the item detail does not.
  final bool showItem;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String locale = Localizations.localeOf(context).toLanguageTag();
    final DateTime? at = movement.at?.toLocal();
    final String when = at == null
        ? '-'
        : '${DateFormat.yMMMd(locale).format(at)} ${DateFormat.Hm(locale).format(at)}';
    final Color changeColor = movement.change > 0
        ? palette.ok.base
        : movement.change < 0
            ? palette.critical.base
            : palette.textSecondary;
    final List<String> meta = <String>[
      when,
      if (movement.site != null && showItem) movement.site!,
      '${copy('by')}: ${movement.actorName ?? copy('unknownUser')}',
      if (movement.reference != null) '${copy('ref')}: ${movement.reference}',
    ];
    return TpCard(
      key: Key('stock.movement.${movement.id}'),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(movementIcon(movement.category), color: palette.textSecondary),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  copy.category(movement.category),
                  style: text.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                ),
                if (showItem && movement.description != null)
                  Text(movement.description!, style: text.bodyMedium),
                Text(
                  meta.join(' · '),
                  style: text.bodySmall?.copyWith(color: palette.textSecondary),
                ),
                if (movement.reason != null)
                  Text(
                    movement.reason!,
                    style:
                        text.bodySmall?.copyWith(color: palette.textSecondary),
                  ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Text(
                signedQty(movement.change),
                key: Key('stock.movement.change.${movement.id}'),
                style: text.titleMedium?.copyWith(
                  color: changeColor,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                '${copy('balanceAfter')} ${balance == null ? '-' : formatQty(balance!)}',
                key: Key('stock.movement.balance.${movement.id}'),
                style: text.bodySmall,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Stock in / out / net for a period, as three equal tiles that wrap their
/// labels instead of overflowing at large text sizes.
class MovementTotalsTiles extends StatelessWidget {
  const MovementTotalsTiles({
    required this.totals,
    required this.copy,
    super.key,
  });
  final MovementTotals totals;
  final StoreHistoryCopy copy;

  @override
  Widget build(BuildContext context) {
    Widget tile(String key, String value, String label) => Expanded(
          child: TpCard(
            key: Key('stock.totals.$key'),
            padding: const EdgeInsets.all(TpSpace.sm),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    value,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                Text(label, textAlign: TextAlign.center, maxLines: 2),
              ],
            ),
          ),
        );
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          tile('in', formatQty(totals.stockIn), copy('stockIn')),
          const SizedBox(width: TpSpace.sm),
          tile('out', formatQty(totals.stockOut), copy('stockOut')),
          const SizedBox(width: TpSpace.sm),
          tile('net', signedQty(totals.net), copy('net')),
        ],
      ),
    );
  }
}

/// Text for a failed history read or post.
String stockHistoryFailureText(
  Object error,
  StoreHistoryCopy copy, {
  required String fallbackKey,
}) {
  if (error is SupabaseFailure) {
    if (error.isConnectivity) return copy('postOffline');
    if (error.isPermissionDenied) return error.error.message;
  }
  return copy(fallbackKey);
}

/// Receive stock into an existing line through `post_stock_movement`.
/// Online only: a receipt is a ledger posting and is never queued, so a
/// replay can never post the same stock twice. Returns the server's answer,
/// or null when cancelled.
Future<StockPostResult?> showReceiveStockSheet(
  BuildContext context, {
  required StockItem item,
  required StoreHistoryCopy copy,
  required Future<StockPostResult> Function({
    required StockPostType type,
    required int quantity,
    String? reference,
    String? reason,
  }) post,
}) {
  return showModalBottomSheet<StockPostResult>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (BuildContext context) =>
        _ReceiveStockSheet(item: item, copy: copy, post: post),
  );
}

class _ReceiveStockSheet extends StatefulWidget {
  const _ReceiveStockSheet({
    required this.item,
    required this.copy,
    required this.post,
  });
  final StockItem item;
  final StoreHistoryCopy copy;
  final Future<StockPostResult> Function({
    required StockPostType type,
    required int quantity,
    String? reference,
    String? reason,
  }) post;

  @override
  State<_ReceiveStockSheet> createState() => _ReceiveStockSheetState();
}

class _ReceiveStockSheetState extends State<_ReceiveStockSheet> {
  final TextEditingController _qty = TextEditingController();
  final TextEditingController _ref = TextEditingController();
  final TextEditingController _reason = TextEditingController();
  StockPostType _type = StockPostType.receipt;
  bool _saving = false;
  String? _problem;
  StockPostResult? _result;

  @override
  void dispose() {
    _qty.dispose();
    _ref.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final StoreHistoryCopy copy = widget.copy;
    final String? invalid =
        validateStockPost(quantity: _qty.text, reference: _ref.text);
    if (invalid != null) {
      setState(() => _problem = copy(invalid));
      return;
    }
    setState(() {
      _saving = true;
      _problem = null;
    });
    try {
      final StockPostResult result = await widget.post(
        type: _type,
        quantity: num.parse(_qty.text.trim()).toInt(),
        reference: _ref.text,
        reason: _reason.text,
      );
      if (mounted) setState(() => _result = result);
    } on Object catch (e) {
      if (mounted) {
        setState(
          () => _problem =
              stockHistoryFailureText(e, copy, fallbackKey: 'postFailed'),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final StoreHistoryCopy copy = widget.copy;
    final StockPostResult? result = _result;
    return PopScope(
      canPop: !_saving,
      child: Padding(
        padding: EdgeInsets.only(
          left: TpSpace.lg,
          right: TpSpace.lg,
          top: TpSpace.lg,
          bottom: MediaQuery.viewInsetsOf(context).bottom + TpSpace.lg,
        ),
        child: SingleChildScrollView(
          child: result != null
              ? Column(
                  key: const Key('stock.receive.done'),
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Text(
                      copy('postedTitle'),
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: TpSpace.sm),
                    Text(
                      '${copy('postedBody')}: '
                      '${result.after == null ? '-' : formatQty(result.after!)}',
                      key: const Key('stock.receive.balance'),
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: TpSpace.lg),
                    FilledButton(
                      key: const Key('stock.receive.close'),
                      onPressed: () => Navigator.pop(context, result),
                      child: Text(copy('done')),
                    ),
                  ],
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Text(
                      copy('receive'),
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    Text(widget.item.description ?? copy('itemTitle')),
                    const SizedBox(height: TpSpace.xs),
                    Text(
                      copy('receiveNote'),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: TpSpace.md),
                    SegmentedButton<StockPostType>(
                      segments: <ButtonSegment<StockPostType>>[
                        ButtonSegment<StockPostType>(
                          value: StockPostType.receipt,
                          label: Text(copy('type_receipt')),
                        ),
                        ButtonSegment<StockPostType>(
                          value: StockPostType.returned,
                          label: Text(copy('type_returned')),
                        ),
                      ],
                      selected: <StockPostType>{_type},
                      onSelectionChanged: _saving
                          ? null
                          : (Set<StockPostType> v) =>
                              setState(() => _type = v.single),
                    ),
                    const SizedBox(height: TpSpace.sm),
                    TextField(
                      key: const Key('stock.receive.qty'),
                      controller: _qty,
                      enabled: !_saving,
                      keyboardType: TextInputType.number,
                      decoration: InputDecoration(labelText: copy('quantity')),
                    ),
                    TextField(
                      key: const Key('stock.receive.ref'),
                      controller: _ref,
                      enabled: !_saving,
                      decoration: InputDecoration(labelText: copy('reference')),
                    ),
                    TextField(
                      key: const Key('stock.receive.reason'),
                      controller: _reason,
                      enabled: !_saving,
                      decoration: InputDecoration(labelText: copy('reason')),
                    ),
                    if (_problem != null) ...<Widget>[
                      const SizedBox(height: TpSpace.sm),
                      Text(
                        _problem!,
                        key: const Key('stock.receive.problem'),
                        style: TextStyle(
                          color: TpPalette.of(context).critical.base,
                        ),
                      ),
                    ],
                    const SizedBox(height: TpSpace.md),
                    Wrap(
                      alignment: WrapAlignment.end,
                      spacing: TpSpace.sm,
                      children: <Widget>[
                        TextButton(
                          onPressed:
                              _saving ? null : () => Navigator.pop(context),
                          child: Text(copy('cancel')),
                        ),
                        FilledButton(
                          key: const Key('stock.receive.post'),
                          onPressed: _saving ? null : _submit,
                          child: _saving
                              ? const SizedBox.square(
                                  dimension: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Text(copy('post')),
                        ),
                      ],
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
