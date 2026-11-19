/// Stock transfers on the phone: dispatch (scan from-location, to-location,
/// items) and receive (confirm what arrived, line by line).
///
/// Online only by design (see `InventoryTransferRepository`). Each form keeps
/// ONE idempotency key for its whole life, so pressing Send again after a
/// timeout repeats the same request instead of creating a second movement.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/inventory_scan.dart';
import 'package:tyre_pulse/features/inventory/domain/transfer_models.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_copy.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_widgets.dart';

/// The sentence for a failed transfer write.
String transferFailureText(Object error, InventoryCopy copy) {
  if (error is SupabaseFailure) {
    if (error.isSchemaMismatch) return copy('notProvisionedBody');
    if (error.isConnectivity) return copy('transferOffline');
    return error.error.message;
  }
  return copy('transferFailed');
}

class TransfersScreen extends ConsumerWidget {
  const TransfersScreen({super.key});

  static Route<void> route() => MaterialPageRoute<void>(
        builder: (_) => const TransfersScreen(),
        settings: const RouteSettings(name: 'inventory/transfers'),
      );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final InventoryCopy copy = InventoryCopy.of(context);
    final AsyncValue<List<StockTransfer>> state =
        ref.watch(stockTransfersProvider);
    return TpScaffold(
      appBar: TpAppBar(
        title: copy('transfersTitle'),
        actions: <Widget>[
          IconButton(
            key: const Key('inventory.transfer.new'),
            tooltip: copy('dispatchTitle'),
            icon: const Icon(Icons.local_shipping_outlined),
            onPressed: () => unawaited(
              Navigator.of(context)
                  .push(DispatchScreen.route())
                  .then((_) => ref.invalidate(stockTransfersProvider)),
            ),
          ),
        ],
      ),
      body: state.when(
        loading: () => const TpLoadingState(),
        error: (Object error, StackTrace _) => InventoryFailureView(
          error: error,
          copy: copy,
          onRetry: () => ref.invalidate(stockTransfersProvider),
        ),
        data: (List<StockTransfer> rows) => rows.isEmpty
            ? TpEmptyState(
                icon: Icons.swap_horiz_rounded,
                title: copy('noTransfers'),
                message: copy('noTransfersBody'),
              )
            : RefreshIndicator(
                onRefresh: () async {
                  ref.invalidate(stockTransfersProvider);
                  await ref.read(stockTransfersProvider.future).then(
                        (_) {},
                        onError: (Object _) {},
                      );
                },
                child: ListView(
                  padding: const EdgeInsets.all(TpSpace.lg),
                  children: <Widget>[
                    for (final StockTransfer t in rows)
                      Card(
                        key: Key('inventory.transfer.${t.id}'),
                        child: ListTile(
                          minTileHeight: inventoryTouchTarget,
                          title: Text(t.reference ?? copy('transfer')),
                          subtitle: Text(
                            '${t.fromLabel ?? '-'} -> ${t.toLabel ?? '-'} · '
                            '${copy.label('tstatus_', t.status ?? 'unknown')} · '
                            '${copy.count('linesN', t.lines.length)}',
                          ),
                          trailing: t.awaitingReceipt
                              ? const Icon(Icons.move_to_inbox_outlined)
                              : null,
                          onTap: t.awaitingReceipt
                              ? () => unawaited(
                                    Navigator.of(context)
                                        .push(ReceiveScreen.route(t))
                                        .then(
                                          (_) => ref.invalidate(
                                            stockTransfersProvider,
                                          ),
                                        ),
                                  )
                              : null,
                        ),
                      ),
                  ],
                ),
              ),
      ),
    );
  }
}

class DispatchScreen extends ConsumerStatefulWidget {
  const DispatchScreen({super.key});

  static Route<void> route() => MaterialPageRoute<void>(
        builder: (_) => const DispatchScreen(),
        settings: const RouteSettings(name: 'inventory/dispatch'),
      );

  @override
  ConsumerState<DispatchScreen> createState() => _DispatchScreenState();
}

class _DispatchScreenState extends ConsumerState<DispatchScreen> {
  late final String _key = ref.read(inventoryIdFactoryProvider)();
  final TextEditingController _remarks = TextEditingController();
  String? _from;
  String? _to;
  final List<DispatchLineDraft> _lines = <DispatchLineDraft>[];
  bool _sending = false;
  String? _problem;

  @override
  void dispose() {
    _remarks.dispose();
    super.dispose();
  }

  void _onScan(String raw) {
    final InventoryScan? scan = parseInventoryScan(raw);
    if (scan == null) return;
    setState(() {
      _problem = null;
      if (scan.kind == InventoryScanKind.location) {
        if (_from == null) {
          _from = scan.value;
        } else if (_to == null && scan.value != _from) {
          _to = scan.value;
        }
        return;
      }
      final String key = scanIdentityKey(scan.value);
      final int i = _lines
          .indexWhere((DispatchLineDraft l) => scanIdentityKey(l.code) == key);
      if (i >= 0) {
        _lines[i] = _lines[i].withQty(_lines[i].qty + 1);
      } else {
        _lines.add(DispatchLineDraft(code: scan.value));
      }
    });
  }

  Future<void> _send(InventoryCopy copy) async {
    final String? problem = dispatchProblem(
      fromLocationId: _from,
      toLocationId: _to,
      lines: _lines,
    );
    if (problem != null) {
      setState(() => _problem = copy(problem));
      return;
    }
    setState(() => _sending = true);
    try {
      await ref.read(inventoryTransferRepositoryProvider).dispatch(
            idempotencyKey: _key,
            fromLocationId: _from!,
            toLocationId: _to!,
            lines: List<DispatchLineDraft>.of(_lines),
            remarks: _remarks.text,
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(copy('dispatchDone'))));
      Navigator.of(context).pop();
    } on Object catch (error) {
      if (mounted) setState(() => _problem = transferFailureText(error, copy));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final InventoryCopy copy = InventoryCopy.of(context);
    final ThemeData theme = Theme.of(context);
    return TpScaffold(
      appBar: TpAppBar(title: copy('dispatchTitle')),
      body: ListView(
        padding: const EdgeInsets.all(TpSpace.lg),
        children: <Widget>[
          InventoryScanField(
            copy: copy,
            hint: _from == null
                ? copy('scanFrom')
                : _to == null
                    ? copy('scanTo')
                    : copy('scanItem'),
            onScan: _onScan,
          ),
          const SizedBox(height: TpSpace.md),
          _LocationRow(
            label: copy('from'),
            value: _from,
            onClear: () => setState(() => _from = null),
          ),
          _LocationRow(
            label: copy('to'),
            value: _to,
            onClear: () => setState(() => _to = null),
          ),
          const SizedBox(height: TpSpace.md),
          Text(copy('items'), style: theme.textTheme.titleSmall),
          if (_lines.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
              child: Text(copy('noItemsScanned')),
            ),
          for (int i = 0; i < _lines.length; i++)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Expanded(child: Text(_lines[i].code)),
                      IconButton(
                        tooltip: copy('removeLine'),
                        onPressed: () => setState(() => _lines.removeAt(i)),
                        icon: const Icon(Icons.delete_outline),
                      ),
                    ],
                  ),
                  InventoryQtyStepper(
                    value: _lines[i].qty,
                    copy: copy,
                    onChanged: (num v) =>
                        setState(() => _lines[i] = _lines[i].withQty(v)),
                  ),
                ],
              ),
            ),
          TextField(
            controller: _remarks,
            decoration: InputDecoration(labelText: copy('remarks')),
          ),
          if (_problem != null) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Text(
              _problem!,
              key: const Key('inventory.dispatch.problem'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ],
          const SizedBox(height: TpSpace.lg),
          SizedBox(
            height: inventoryTouchTarget,
            child: FilledButton(
              key: const Key('inventory.dispatch.send'),
              onPressed: _sending ? null : () => unawaited(_send(copy)),
              child: Text(copy('dispatchSend')),
            ),
          ),
        ],
      ),
    );
  }
}

class _LocationRow extends StatelessWidget {
  const _LocationRow({
    required this.label,
    required this.value,
    required this.onClear,
  });

  final String label;
  final String? value;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) => ListTile(
        minTileHeight: inventoryTouchTarget,
        contentPadding: EdgeInsets.zero,
        leading: const Icon(Icons.place_outlined),
        title: Text(label),
        subtitle: Text(value ?? '-'),
        trailing: value == null
            ? null
            : IconButton(
                onPressed: onClear,
                icon: const Icon(Icons.close_rounded),
              ),
      );
}

class ReceiveScreen extends ConsumerStatefulWidget {
  const ReceiveScreen({required this.transfer, super.key});

  final StockTransfer transfer;

  static Route<void> route(StockTransfer transfer) => MaterialPageRoute<void>(
        builder: (_) => ReceiveScreen(transfer: transfer),
        settings: const RouteSettings(name: 'inventory/receive'),
      );

  @override
  ConsumerState<ReceiveScreen> createState() => _ReceiveScreenState();
}

class _ReceiveScreenState extends ConsumerState<ReceiveScreen> {
  late final String _key = ref.read(inventoryIdFactoryProvider)();

  /// Blank until the receiver enters a number: the outstanding quantity is
  /// shown as a reference, never pre-filled as the answer.
  late final Map<String, num?> _received = <String, num?>{
    for (final StockTransferLine l in widget.transfer.lines) l.id: null,
  };
  late final Map<String, CountCondition> _condition = <String, CountCondition>{
    for (final StockTransferLine l in widget.transfer.lines)
      l.id: CountCondition.good,
  };
  bool _sending = false;
  String? _problem;

  Future<void> _send(InventoryCopy copy) async {
    final List<ReceiveLineDraft> lines = <ReceiveLineDraft>[
      for (final MapEntry<String, num?> e in _received.entries)
        if (e.value != null)
          ReceiveLineDraft(
            lineId: e.key,
            receivedQty: e.value!,
            condition: _condition[e.key] ?? CountCondition.good,
          ),
    ];
    final String? problem = receiveProblem(lines);
    if (problem != null) {
      setState(() => _problem = copy(problem));
      return;
    }
    setState(() => _sending = true);
    try {
      await ref.read(inventoryTransferRepositoryProvider).receive(
            idempotencyKey: _key,
            transferId: widget.transfer.id,
            lines: lines,
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(copy('receiveDone'))));
      Navigator.of(context).pop();
    } on Object catch (error) {
      if (mounted) setState(() => _problem = transferFailureText(error, copy));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final InventoryCopy copy = InventoryCopy.of(context);
    final ThemeData theme = Theme.of(context);
    final StockTransfer t = widget.transfer;
    return TpScaffold(
      appBar: TpAppBar(
        title: copy('receiveTitle'),
        subtitle: t.reference,
      ),
      body: ListView(
        padding: const EdgeInsets.all(TpSpace.lg),
        children: <Widget>[
          if (t.lines.isEmpty) Text(copy('noLines')),
          for (final StockTransferLine line in t.lines)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(TpSpace.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(line.display, style: theme.textTheme.titleSmall),
                    Text(
                      line.outstanding == null
                          ? copy('outstandingUnknown')
                          : '${copy('outstanding')}: ${line.outstanding}',
                      style: theme.textTheme.bodySmall,
                    ),
                    const SizedBox(height: TpSpace.sm),
                    InventoryQtyStepper(
                      value: _received[line.id],
                      copy: copy,
                      onChanged: (num v) =>
                          setState(() => _received[line.id] = v),
                    ),
                    DropdownButton<CountCondition>(
                      value: _condition[line.id],
                      isExpanded: true,
                      items: <DropdownMenuItem<CountCondition>>[
                        for (final CountCondition c in CountCondition.values)
                          DropdownMenuItem<CountCondition>(
                            value: c,
                            child: Text(copy('condition_${c.wire}')),
                          ),
                      ],
                      onChanged: (CountCondition? c) => setState(
                        () => _condition[line.id] = c ?? CountCondition.good,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (_problem != null) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Text(
              _problem!,
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ],
          const SizedBox(height: TpSpace.lg),
          SizedBox(
            height: inventoryTouchTarget,
            child: FilledButton(
              key: const Key('inventory.receive.send'),
              onPressed: _sending ? null : () => unawaited(_send(copy)),
              child: Text(copy('receiveSend')),
            ),
          ),
        ],
      ),
    );
  }
}
