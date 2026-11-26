/// Receive goods on the phone: pick an open purchase order line, enter what
/// arrived, optionally photograph the delivery note, send for approval.
///
/// Pushed with Navigator from Stock Count (router files are reserved, same as
/// Transfers). Online only, and it says so at the top of both screens: the
/// server checks the PO, the line's open quantity, the keeper's NAMED site and
/// refuses any price. Stock moves only when a different person approves.
///
/// One request key per PO line draft (storeReceiptKeysProvider), kept across
/// leaving and reopening the form and across edits until the server confirms,
/// so Send after a lost answer repeats the same request and never records
/// twice.
library;

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inventory/data/store_receipt_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/store_receipt.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_copy.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_widgets.dart';

String _qty(num v) =>
    v == v.roundToDouble() ? v.toInt().toString() : v.toString();

/// Server refusals this flow raises, matched on the (never displayed) server
/// text and shown as a sentence in the user's language. Anything else falls
/// back by kind; a raw database message is never shown.
const List<(String, String)> _refusals = <(String, String)>[
  ('assigned to you by name', 'sr_errSite'),
  ('approved or ordered', 'sr_errPoStatus'),
  ('already closed', 'sr_errLineClosed'),
  ('still open on this purchase order line', 'sr_overOpen'),
  ('cannot set a price', 'sr_noPrice'),
  ('photo was not found', 'sr_photoFailed'),
  ('delivery note photo must be stored', 'sr_photoFailed'),
  ('receiving location', 'sr_locationRequired'),
  ('say why goods were rejected', 'sr_reasonRequired'),
  ('only an approved store keeper', 'sr_errNotKeeper'),
];

/// The sentence for a failed send, in the user's language.
String storeReceiptFailureText(Object error, InventoryCopy copy) {
  if (error is SupabaseFailure) {
    if (error.isSchemaMismatch) return copy('notProvisionedBody');
    if (error.isConnectivity) return copy('sr_offline');
    final String raw = (error.rawMessage ?? '').toLowerCase();
    for (final (String needle, String key) in _refusals) {
      if (raw.contains(needle)) return copy(key);
    }
    if (error.error.kind == AppErrorKind.authorization) {
      return copy('sr_errNotKeeper');
    }
  }
  return copy('sr_failed');
}

/// "Needs a connection" at the top of both screens.
class _OnlineBanner extends StatelessWidget {
  const _OnlineBanner({required this.copy});

  final InventoryCopy copy;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Container(
      key: const Key('inventory.sr.online'),
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.md,
        vertical: TpSpace.sm,
      ),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.secondaryContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.wifi_rounded, size: 20, color: palette.textSecondary),
          const SizedBox(width: TpSpace.sm),
          Expanded(child: Text(copy('sr_onlineNote'))),
        ],
      ),
    );
  }
}

/// A full-width action button that grows with the text (never a fixed height).
Widget _actionButton({
  required Key key,
  required VoidCallback? onPressed,
  required Widget child,
  bool filled = true,
}) {
  const ButtonStyle style = ButtonStyle(
    minimumSize: WidgetStatePropertyAll<Size>(
      Size(double.infinity, inventoryTouchTarget),
    ),
  );
  return filled
      ? FilledButton(
          key: key,
          style: style,
          onPressed: onPressed,
          child: child,
        )
      : OutlinedButton(
          key: key,
          style: style,
          onPressed: onPressed,
          child: child,
        );
}

class StoreReceiptScreen extends ConsumerStatefulWidget {
  const StoreReceiptScreen({super.key});

  static Route<void> route() => MaterialPageRoute<void>(
        builder: (_) => const StoreReceiptScreen(),
        settings: const RouteSettings(name: 'inventory/receive-goods'),
      );

  @override
  ConsumerState<StoreReceiptScreen> createState() => _StoreReceiptScreenState();
}

class _StoreReceiptScreenState extends ConsumerState<StoreReceiptScreen> {
  final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool _matches(OpenPoLine l, String q) {
    if (q.isEmpty) return true;
    return <String?>[l.poNumber, l.itemCode, l.itemName, l.supplier, l.site]
        .any((String? v) => (v ?? '').toLowerCase().contains(q));
  }

  @override
  Widget build(BuildContext context) {
    final InventoryCopy copy = InventoryCopy.of(context);
    final TpPalette palette = TpPalette.of(context);
    final AsyncValue<StoreReceiptBoard> state =
        ref.watch(storeReceiptBoardProvider);
    Future<void> refresh() async {
      ref.invalidate(storeReceiptBoardProvider);
      await ref.read(storeReceiptBoardProvider.future).then(
            (_) {},
            onError: (Object _) {},
          );
    }

    return TpScaffold(
      appBar: TpAppBar(title: copy('sr_title')),
      body: state.when(
        loading: () => const TpLoadingState(),
        error: (Object error, StackTrace _) => Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.all(TpSpace.lg),
              child: _OnlineBanner(copy: copy),
            ),
            Expanded(
              child: InventoryFailureView(
                error: error,
                copy: copy,
                onRetry: () => ref.invalidate(storeReceiptBoardProvider),
              ),
            ),
          ],
        ),
        data: (StoreReceiptBoard board) {
          final String q = _search.text.trim().toLowerCase();
          final List<OpenPoLine> lines = board.lines
              .where((OpenPoLine l) => _matches(l, q))
              .toList(growable: false);
          // Lazily built rows: header widgets, then lines, then my receipts.
          final List<Widget Function()> rows = <Widget Function()>[
            () => _OnlineBanner(copy: copy),
            () => Padding(
                  padding: const EdgeInsets.only(top: TpSpace.sm),
                  child: Text(
                    copy('sr_intro'),
                    style: TextStyle(color: palette.textSecondary),
                  ),
                ),
            if (board.lines.isNotEmpty)
              () => Padding(
                    padding: const EdgeInsets.only(top: TpSpace.md),
                    child: TextField(
                      key: const Key('inventory.sr.search'),
                      controller: _search,
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(
                        labelText: copy('sr_search'),
                        prefixIcon: const Icon(Icons.search_rounded),
                      ),
                    ),
                  ),
            if (board.lines.isEmpty)
              () => TpEmptyState(
                    key: const Key('inventory.sr.empty'),
                    icon: Icons.move_to_inbox_outlined,
                    title: copy('sr_noLines'),
                    message: copy('sr_noLinesBody'),
                  )
            else if (lines.isEmpty)
              () => Padding(
                    padding: const EdgeInsets.all(TpSpace.lg),
                    child: Text(
                      copy('sr_noMatch'),
                      key: const Key('inventory.sr.noMatch'),
                    ),
                  ),
            for (final OpenPoLine line in lines)
              () => _LineCard(line: line, board: board, copy: copy),
            if (board.mine.isNotEmpty)
              () => Padding(
                    padding: const EdgeInsets.only(top: TpSpace.lg),
                    child: Text(
                      copy('sr_mine'),
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                  ),
            for (final MyStoreReceipt r in board.mine)
              () => _MineTile(receipt: r, copy: copy),
          ];
          return RefreshIndicator(
            onRefresh: refresh,
            child: ListView.builder(
              key: const Key('inventory.sr.list'),
              padding: const EdgeInsets.all(TpSpace.lg),
              itemCount: rows.length,
              itemBuilder: (BuildContext context, int i) => rows[i](),
            ),
          );
        },
      ),
    );
  }
}

class _LineCard extends ConsumerWidget {
  const _LineCard({
    required this.line,
    required this.board,
    required this.copy,
  });

  final OpenPoLine line;
  final StoreReceiptBoard board;
  final InventoryCopy copy;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      key: Key('inventory.sr.line.${line.poLineId}'),
      child: ListTile(
        minTileHeight: inventoryTouchTarget,
        title: Text(line.itemLabel.isEmpty ? line.poNumber : line.itemLabel),
        subtitle: Text(
          <String>[
            line.poNumber,
            if (line.supplier != null) line.supplier!,
            if (line.site != null) line.site!,
            copy('sr_ordered').replaceAll('%n', _qty(line.qtyOrdered)),
            copy('sr_open').replaceAll(
              '%n',
              '${_qty(line.qtyOpen)}${line.uom == null ? '' : ' ${line.uom}'}',
            ),
          ].join(' · '),
        ),
        onTap: () => unawaited(
          Navigator.of(context)
              .push<bool>(
                StoreReceiptFormScreen.route(
                  line: line,
                  locations: board.locationsFor(line),
                ),
              )
              .then((_) => ref.invalidate(storeReceiptBoardProvider)),
        ),
      ),
    );
  }
}

class _MineTile extends ConsumerStatefulWidget {
  const _MineTile({required this.receipt, required this.copy});

  final MyStoreReceipt receipt;
  final InventoryCopy copy;

  @override
  ConsumerState<_MineTile> createState() => _MineTileState();
}

class _MineTileState extends ConsumerState<_MineTile> {
  bool _busy = false;

  Future<void> _withdraw() async {
    if (_busy) return;
    final InventoryCopy copy = widget.copy;
    final bool? ok = await showDialog<bool>(
      context: context,
      builder: (BuildContext c) => AlertDialog(
        title: Text(copy('sr_withdrawTitle')),
        content: Text(copy('sr_withdrawBody')),
        actions: <Widget>[
          TextButton(
            key: const Key('inventory.sr.withdraw.keep'),
            onPressed: () => Navigator.of(c).pop(false),
            child: Text(copy('sr_keep')),
          ),
          FilledButton(
            key: const Key('inventory.sr.withdraw.confirm'),
            onPressed: () => Navigator.of(c).pop(true),
            child: Text(copy('sr_withdraw')),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(storeReceiptRepositoryProvider).cancel(widget.receipt.id);
      messenger.showSnackBar(SnackBar(content: Text(copy('sr_withdrawn'))));
    } on Object catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text(storeReceiptFailureText(e, copy))),
      );
    } finally {
      if (mounted) {
        setState(() => _busy = false);
        ref.invalidate(storeReceiptBoardProvider);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final MyStoreReceipt r = widget.receipt;
    final InventoryCopy copy = widget.copy;
    return Card(
      key: Key('inventory.sr.mine.${r.id}'),
      child: ListTile(
        minTileHeight: inventoryTouchTarget,
        title: Text(
          <String>[
            if (r.itemCode != null) r.itemCode!,
            if (r.itemName != null) r.itemName!,
          ].join(' '),
        ),
        subtitle: Text(
          <String>[
            if (r.poNumber != null) r.poNumber!,
            '${_qty(r.qtyReceived)}'
                '${r.qtyRejected > 0 ? ' (${copy('sr_qtyRejected')} ${_qty(r.qtyRejected)})' : ''}',
            copy.label('sr_status_', r.status),
            if (r.decisionNote != null) r.decisionNote!,
          ].join(' · '),
        ),
        trailing: r.isPending
            ? TextButton(
                key: Key('inventory.sr.withdraw.${r.id}'),
                onPressed: _busy ? null : () => unawaited(_withdraw()),
                child: Text(copy('sr_withdraw')),
              )
            : null,
      ),
    );
  }
}

/// Returns a picked photo's path, or null when cancelled. Overridable in tests.
typedef StoreReceiptPhotoPicker = Future<String?> Function();

class StoreReceiptFormScreen extends ConsumerStatefulWidget {
  const StoreReceiptFormScreen({
    required this.line,
    required this.locations,
    this.pickPhoto,
    this.readPhoto,
    super.key,
  });

  final OpenPoLine line;
  final List<ReceivingLocation> locations;

  /// Defaults to the camera (1280 px, quality 60).
  final StoreReceiptPhotoPicker? pickPhoto;

  /// Defaults to reading the file.
  final Future<Uint8List> Function(String path)? readPhoto;

  static Route<bool> route({
    required OpenPoLine line,
    required List<ReceivingLocation> locations,
  }) =>
      MaterialPageRoute<bool>(
        builder: (_) =>
            StoreReceiptFormScreen(line: line, locations: locations),
        settings: const RouteSettings(name: 'inventory/receive-goods/line'),
      );

  @override
  ConsumerState<StoreReceiptFormScreen> createState() =>
      _StoreReceiptFormScreenState();
}

class _StoreReceiptFormScreenState
    extends ConsumerState<StoreReceiptFormScreen> {
  // Empty on purpose: the keeper types what actually arrived.
  final TextEditingController _received = TextEditingController();
  final TextEditingController _rejected = TextEditingController();
  final TextEditingController _reason = TextEditingController();
  final TextEditingController _noteNo = TextEditingController();
  final TextEditingController _notes = TextEditingController();

  late String? _locationId =
      widget.locations.isEmpty ? null : widget.locations.first.id;
  String? _photoLocalPath;
  String? _photoUploadedPath;
  bool _sending = false;
  String? _problem;

  @override
  void dispose() {
    _received.dispose();
    _rejected.dispose();
    _reason.dispose();
    _noteNo.dispose();
    _notes.dispose();
    super.dispose();
  }

  StoreReceiptDraft _draft({String? photoPath}) => StoreReceiptDraft.fromText(
        line: widget.line,
        received: _received.text,
        rejected: _rejected.text,
        locationId: _locationId,
        rejectionReason: _reason.text,
        deliveryNoteNo: _noteNo.text,
        notes: _notes.text,
        deliveryNotePath: photoPath,
      );

  String _key() => ref
      .read(storeReceiptKeysProvider.notifier)
      .keyFor(widget.line.poLineId, ref.read(inventoryIdFactoryProvider));

  void _rejectedChanged(String _) {
    final num rej = parseReceiptQty(_rejected.text) ?? 0;
    setState(() {
      if (rej <= 0 && _reason.text.isNotEmpty) _reason.clear();
    });
  }

  Future<void> _takePhoto(InventoryCopy copy) async {
    // The photo is uploaded before the receipt is sent; say so up front
    // rather than after the keeper has framed the shot.
    final bool online = await ref.read(inventoryOnlineCheckProvider)();
    if (!mounted) return;
    if (!online) {
      setState(() => _problem = copy('sr_photoOffline'));
      return;
    }
    final StoreReceiptPhotoPicker pick = widget.pickPhoto ??
        () async {
          final XFile? f = await ImagePicker().pickImage(
            source: ImageSource.camera,
            maxWidth: 1280,
            maxHeight: 1280,
            imageQuality: 60,
          );
          return f?.path;
        };
    final String? path = await pick();
    if (path == null || !mounted) return;
    setState(() {
      _problem = null;
      _photoLocalPath = path;
      _photoUploadedPath = null;
    });
  }

  Future<void> _send(InventoryCopy copy) async {
    if (_sending) return;
    final String? invalid = _draft().validate();
    if (invalid != null) {
      setState(() => _problem = copy(invalid));
      return;
    }
    setState(() {
      _sending = true;
      _problem = null;
    });
    final String key = _key();
    final StoreReceiptRepository repo =
        ref.read(storeReceiptRepositoryProvider);
    try {
      if (_photoLocalPath != null && _photoUploadedPath == null) {
        final ctx = ref.read(workspaceContextProvider);
        // app_current_org() reads profiles.org_id (tenantId); the server
        // checks the photo path against it.
        final String? org = ctx?.tenantId ?? ctx?.companyId;
        if (org == null) {
          setState(() => _problem = copy('sr_photoFailed'));
          return;
        }
        final String path = storeReceiptPhotoPath(org, key);
        try {
          final Uint8List bytes = await (widget.readPhoto ??
              (String p) => File(p).readAsBytes())(_photoLocalPath!);
          await repo.uploadPhoto(path, bytes);
        } on Object {
          if (mounted) setState(() => _problem = copy('sr_photoFailed'));
          return;
        }
        _photoUploadedPath = path;
      }
      final StoreReceiptOutcome out = await repo.submit(
        _draft(photoPath: _photoUploadedPath),
        clientUuid: key,
      );
      ref
          .read(storeReceiptKeysProvider.notifier)
          .confirmed(widget.line.poLineId);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            out.replayed ? copy('sr_alreadySent') : copy('sr_sent'),
          ),
        ),
      );
      Navigator.of(context).pop(true);
    } on Object catch (error) {
      if (mounted) {
        setState(() => _problem = storeReceiptFailureText(error, copy));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final InventoryCopy copy = InventoryCopy.of(context);
    final ThemeData theme = Theme.of(context);
    final TpPalette palette = TpPalette.of(context);
    final OpenPoLine line = widget.line;
    final num rejected = parseReceiptQty(_rejected.text) ?? 0;
    return TpScaffold(
      appBar: TpAppBar(title: copy('sr_formTitle')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(TpSpace.lg),
          children: <Widget>[
            _OnlineBanner(copy: copy),
            const SizedBox(height: TpSpace.md),
            TpCard(
              key: const Key('inventory.sr.lineCard'),
              padding: const EdgeInsets.all(TpSpace.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    line.itemLabel.isEmpty ? line.poNumber : line.itemLabel,
                    style: theme.textTheme.titleSmall
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  Text(
                    <String>[
                      line.poNumber,
                      if (line.supplier != null) line.supplier!,
                      if (line.site != null) line.site!,
                    ].join(' · '),
                    style: TextStyle(color: palette.textSecondary),
                  ),
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    '${copy('sr_ordered').replaceAll('%n', _qty(line.qtyOrdered))}'
                    ' | ${copy('sr_open').replaceAll('%n', _qty(line.qtyOpen))}',
                  ),
                ],
              ),
            ),
            const SizedBox(height: TpSpace.lg),
            Text(copy('sr_qtyReceived'), style: theme.textTheme.titleSmall),
            const SizedBox(height: TpSpace.xs),
            InventoryQtyStepper(
              value: parseReceiptQty(_received.text),
              copy: copy,
              onChanged: (num v) => setState(() => _received.text = _qty(v)),
            ),
            TextField(
              key: const Key('inventory.sr.qty'),
              controller: _received,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(labelText: copy('sr_qtyReceived')),
            ),
            const SizedBox(height: TpSpace.md),
            TextField(
              key: const Key('inventory.sr.rejected'),
              controller: _rejected,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              onChanged: _rejectedChanged,
              decoration: InputDecoration(labelText: copy('sr_qtyRejected')),
            ),
            if (rejected > 0)
              TextField(
                key: const Key('inventory.sr.reason'),
                controller: _reason,
                decoration:
                    InputDecoration(labelText: copy('sr_rejectionReason')),
              ),
            const SizedBox(height: TpSpace.md),
            if (widget.locations.isEmpty)
              Text(
                copy('sr_noLocation'),
                key: const Key('inventory.sr.noLocation'),
                style: TextStyle(color: theme.colorScheme.error),
              )
            else
              DropdownButtonFormField<String>(
                key: const Key('inventory.sr.location'),
                initialValue: _locationId,
                isExpanded: true,
                decoration: InputDecoration(labelText: copy('sr_location')),
                items: <DropdownMenuItem<String>>[
                  for (final ReceivingLocation l in widget.locations)
                    DropdownMenuItem<String>(
                      value: l.id,
                      child: Text(l.label, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: (String? v) => setState(() => _locationId = v),
              ),
            const SizedBox(height: TpSpace.md),
            TextField(
              key: const Key('inventory.sr.noteNo'),
              controller: _noteNo,
              decoration: InputDecoration(labelText: copy('sr_deliveryNoteNo')),
            ),
            TextField(
              key: const Key('inventory.sr.notes'),
              controller: _notes,
              maxLines: 2,
              decoration: InputDecoration(labelText: copy('sr_notes')),
            ),
            const SizedBox(height: TpSpace.md),
            Row(
              children: <Widget>[
                Expanded(
                  child: _actionButton(
                    key: const Key('inventory.sr.photo'),
                    filled: false,
                    onPressed:
                        _sending ? null : () => unawaited(_takePhoto(copy)),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Icon(
                          _photoLocalPath == null
                              ? Icons.photo_camera_outlined
                              : Icons.check_circle_outline,
                        ),
                        const SizedBox(width: TpSpace.sm),
                        Flexible(
                          child: Text(
                            _photoLocalPath == null
                                ? copy('sr_photo')
                                : copy('sr_photoTaken'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (_photoLocalPath != null)
                  IconButton(
                    key: const Key('inventory.sr.photoRemove'),
                    tooltip: copy('sr_photoRemove'),
                    onPressed: _sending
                        ? null
                        : () => setState(() {
                              _photoLocalPath = null;
                              _photoUploadedPath = null;
                            }),
                    icon: const Icon(Icons.close_rounded),
                  ),
              ],
            ),
            const SizedBox(height: TpSpace.md),
            Text(
              copy('sr_noPrice'),
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: palette.textSecondary),
            ),
            if (_problem != null) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              Text(
                _problem!,
                key: const Key('inventory.sr.problem'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ],
            const SizedBox(height: TpSpace.lg),
            _actionButton(
              key: const Key('inventory.sr.send'),
              onPressed: _sending || widget.locations.isEmpty
                  ? null
                  : () => unawaited(_send(copy)),
              child: _sending
                  ? const SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(strokeWidth: 2.5),
                    )
                  : Text(copy('sr_send')),
            ),
          ],
        ),
      ),
    );
  }
}
