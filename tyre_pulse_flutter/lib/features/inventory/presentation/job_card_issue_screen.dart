/// Issue one stock line to a job card, or take stock back from one.
///
/// Pushed with Navigator from Stock Count (the router files are reserved,
/// same as Transfers). Online only: the server decides with the live balance,
/// the person's `issue` capability and their site scope. The form keeps one
/// idempotency key per distinct request, so Send after a timeout repeats the
/// same request and never posts twice.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/inventory/domain/job_card_issue.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_copy.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_widgets.dart';
import 'package:tyre_pulse/features/scanning/presentation/asset_camera_scanner_dialog.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';

/// The sentence for a failed move (never a raw database text).
String jobCardMoveFailureText(Object error, InventoryCopy copy) {
  if (error is SupabaseFailure) {
    if (error.isSchemaMismatch) return copy('notProvisionedBody');
    if (error.isConnectivity) return copy('jc_offline');
    return error.error.message;
  }
  return copy('jc_failed');
}

String _qty(num v) =>
    v == v.roundToDouble() ? v.toInt().toString() : v.toString();

enum _Lookup { idle, checking, found, notFound, failed }

class JobCardIssueScreen extends ConsumerStatefulWidget {
  const JobCardIssueScreen({required this.item, required this.move, super.key});

  final StockItem item;
  final JobCardMove move;

  static Route<bool> route({
    required StockItem item,
    required JobCardMove move,
  }) =>
      MaterialPageRoute<bool>(
        builder: (_) => JobCardIssueScreen(item: item, move: move),
        settings: RouteSettings(
          name: move == JobCardMove.issue
              ? 'inventory/issue-job-card'
              : 'inventory/return-job-card',
        ),
      );

  @override
  ConsumerState<JobCardIssueScreen> createState() => _JobCardIssueScreenState();
}

class _JobCardIssueScreenState extends ConsumerState<JobCardIssueScreen> {
  final TextEditingController _jobCard = TextEditingController();
  final TextEditingController _qtyText = TextEditingController(text: '1');
  final TextEditingController _reason = TextEditingController();

  String? _key;
  String? _keySignature;
  _Lookup _lookup = _Lookup.idle;
  JobCardRef? _found;
  bool _sending = false;
  String? _problem;

  bool get _isIssue => widget.move == JobCardMove.issue;

  @override
  void dispose() {
    _jobCard.dispose();
    _qtyText.dispose();
    _reason.dispose();
    super.dispose();
  }

  JobCardMoveDraft _draft() => JobCardMoveDraft(
        move: widget.move,
        stockId: widget.item.id,
        jobCard: _jobCard.text,
        qty: parseMoveQty(_qtyText.text),
        reason: _reason.text,
        available: _isIssue ? widget.item.available : null,
      );

  void _jobCardChanged() {
    if (_lookup == _Lookup.idle && _found == null) return;
    setState(() {
      _lookup = _Lookup.idle;
      _found = null;
    });
  }

  Future<void> _check(InventoryCopy copy) async {
    final String? jc = normalizeJobCard(_jobCard.text);
    if (jc == null) {
      setState(() => _problem = copy('jc_needJobCard'));
      return;
    }
    setState(() {
      _lookup = _Lookup.checking;
      _problem = null;
    });
    try {
      final JobCardRef? hit =
          await ref.read(jobCardIssueRepositoryProvider).findJobCard(jc);
      if (!mounted) return;
      setState(() {
        _found = hit;
        _lookup = hit == null ? _Lookup.notFound : _Lookup.found;
      });
    } on Object {
      if (mounted) setState(() => _lookup = _Lookup.failed);
    }
  }

  Future<void> _scan(InventoryCopy copy) async {
    final String? code = await showAssetCameraScanner(context);
    if (code == null || code.trim().isEmpty || !mounted) return;
    _jobCard.text = code.trim();
    await _check(copy);
  }

  Future<void> _send(InventoryCopy copy) async {
    final JobCardMoveDraft draft = _draft();
    final String? invalid = draft.validate();
    if (invalid != null) {
      setState(() => _problem = copy(invalid));
      return;
    }
    if (_lookup != _Lookup.found || _found == null) {
      setState(() => _problem = copy('jc_checkFirst'));
      return;
    }
    if (_isIssue && _found!.isClosed) {
      setState(() => _problem = copy('jc_closed'));
      return;
    }
    // One key per distinct request: an identical retry reuses it (the
    // server answers the stored result), a changed request gets a new one.
    if (_keySignature != draft.signature) {
      _key = ref.read(inventoryIdFactoryProvider)();
      _keySignature = draft.signature;
    }
    setState(() {
      _sending = true;
      _problem = null;
    });
    try {
      final JobCardMoveOutcome out =
          await ref.read(jobCardIssueRepositoryProvider).post(
                draft,
                idempotencyKey: _key!,
              );
      if (!mounted) return;
      switch (out) {
        case JobCardMoveShortage(:final num? available):
          setState(
            () => _problem = copy('jc_shortage')
                .replaceAll('%n', available == null ? '0' : _qty(available)),
          );
        case JobCardMovePosted(:final bool replayed):
          final String text = replayed
              ? copy('jc_alreadyPosted')
              : (_isIssue ? copy('jc_issued') : copy('jc_returned'));
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(text)));
          Navigator.of(context).pop(true);
      }
    } on Object catch (error) {
      if (mounted) {
        setState(() => _problem = jobCardMoveFailureText(error, copy));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Widget _lookupLine(InventoryCopy copy, TpPalette palette) {
    final TextStyle muted = TextStyle(color: palette.textSecondary);
    return switch (_lookup) {
      _Lookup.idle => const SizedBox.shrink(),
      _Lookup.checking => const Padding(
          padding: EdgeInsets.only(top: TpSpace.sm),
          child: LinearProgressIndicator(),
        ),
      _Lookup.notFound => Padding(
          padding: const EdgeInsets.only(top: TpSpace.sm),
          child: Text(
            copy('jc_notFound'),
            key: const Key('inventory.jc.notFound'),
            style: muted,
          ),
        ),
      _Lookup.failed => Padding(
          padding: const EdgeInsets.only(top: TpSpace.sm),
          child: Text(
            copy('jc_lookupFailed'),
            key: const Key('inventory.jc.lookupFailed'),
            style: muted,
          ),
        ),
      _Lookup.found => Padding(
          padding: const EdgeInsets.only(top: TpSpace.sm),
          child: Text(
            <String>[
              _found!.workOrderNo,
              if ((_found!.assetNo ?? '').isNotEmpty)
                '${copy('jc_asset')} ${_found!.assetNo}',
              if ((_found!.site ?? '').isNotEmpty) _found!.site!,
              if ((_found!.status ?? '').isNotEmpty)
                '${copy('jc_status')} ${_found!.status}',
            ].join(' | '),
            key: const Key('inventory.jc.found'),
          ),
        ),
    };
  }

  @override
  Widget build(BuildContext context) {
    final InventoryCopy copy = InventoryCopy.of(context);
    final ThemeData theme = Theme.of(context);
    final TpPalette palette = TpPalette.of(context);
    final StockItem item = widget.item;
    final num? stepperValue = parseMoveQty(_qtyText.text);
    return TpScaffold(
      appBar: TpAppBar(
        title: _isIssue ? copy('jc_issueTitle') : copy('jc_returnTitle'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(TpSpace.lg),
          children: <Widget>[
            TpCard(
              key: const Key('inventory.jc.stock'),
              padding: const EdgeInsets.all(TpSpace.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    item.description ?? copy('jc_stockLine'),
                    style: theme.textTheme.titleSmall
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  if ((item.site ?? '').isNotEmpty)
                    Text(
                      item.site!,
                      style: TextStyle(color: palette.textSecondary),
                    ),
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    '${copy('jc_onHand')} ${_qty(item.quantity)}'
                    '${_isIssue ? ' | ${copy('jc_available')} ${_qty(item.available)}' : ''}',
                  ),
                ],
              ),
            ),
            const SizedBox(height: TpSpace.lg),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: TextField(
                    key: const Key('inventory.jc.jobCard'),
                    controller: _jobCard,
                    textCapitalization: TextCapitalization.characters,
                    textInputAction: TextInputAction.search,
                    onChanged: (_) => _jobCardChanged(),
                    onSubmitted: (_) => unawaited(_check(copy)),
                    decoration: InputDecoration(labelText: copy('jc_jobCard')),
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                SizedBox(
                  width: inventoryTouchTarget,
                  height: inventoryTouchTarget,
                  child: IconButton.filled(
                    key: const Key('inventory.jc.scan'),
                    tooltip: copy('scanCamera'),
                    onPressed: () => unawaited(_scan(copy)),
                    icon: const Icon(Icons.photo_camera_outlined),
                  ),
                ),
              ],
            ),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: SizedBox(
                height: inventoryTouchTarget,
                child: TextButton(
                  key: const Key('inventory.jc.check'),
                  onPressed: _lookup == _Lookup.checking
                      ? null
                      : () => unawaited(_check(copy)),
                  child: Text(copy('jc_find')),
                ),
              ),
            ),
            _lookupLine(copy, palette),
            const SizedBox(height: TpSpace.lg),
            Text(copy('jc_qty'), style: theme.textTheme.titleSmall),
            const SizedBox(height: TpSpace.xs),
            InventoryQtyStepper(
              value: stepperValue,
              copy: copy,
              onChanged: (num v) => setState(() => _qtyText.text = _qty(v)),
            ),
            TextField(
              key: const Key('inventory.jc.qty'),
              controller: _qtyText,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(labelText: copy('jc_qty')),
            ),
            const SizedBox(height: TpSpace.md),
            TextField(
              key: const Key('inventory.jc.reason'),
              controller: _reason,
              decoration: InputDecoration(
                labelText:
                    _isIssue ? copy('jc_reasonOptional') : copy('jc_reason'),
              ),
            ),
            const SizedBox(height: TpSpace.md),
            Text(
              _isIssue ? copy('jc_onlineNote') : copy('jc_returnNote'),
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: palette.textSecondary),
            ),
            if (_problem != null) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              Text(
                _problem!,
                key: const Key('inventory.jc.problem'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ],
            const SizedBox(height: TpSpace.lg),
            SizedBox(
              height: inventoryTouchTarget,
              child: FilledButton(
                key: const Key('inventory.jc.send'),
                onPressed: _sending ? null : () => unawaited(_send(copy)),
                child: _sending
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(strokeWidth: 2.5),
                      )
                    : Text(_isIssue ? copy('jc_send') : copy('jc_sendReturn')),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
