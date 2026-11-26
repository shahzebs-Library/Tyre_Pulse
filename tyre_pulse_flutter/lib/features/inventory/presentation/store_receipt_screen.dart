/// Receive goods on the phone: pick an open purchase order line, enter what
/// arrived, optionally photograph the delivery note, send for approval.
///
/// Pushed with Navigator from Stock Count (router files are reserved, same as
/// Transfers). Online only: the server checks the PO, the line's open
/// quantity, the keeper's NAMED site and refuses any price. Stock moves only
/// when a different person approves. One client_uuid per distinct request, so
/// Send after a timeout repeats the same request and never records twice.
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
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inventory/data/store_receipt_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/store_receipt.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_copy.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_widgets.dart';

String _qty(num v) =>
    v == v.roundToDouble() ? v.toInt().toString() : v.toString();

/// The sentence for a failed send (never a raw database text).
String storeReceiptFailureText(Object error, InventoryCopy copy) {
  if (error is SupabaseFailure) {
    if (error.isSchemaMismatch) return copy('notProvisionedBody');
    if (error.isConnectivity) return copy('sr_offline');
    return error.error.message;
  }
  return copy('sr_failed');
}

class StoreReceiptScreen extends ConsumerWidget {
  const StoreReceiptScreen({super.key});

  static Route<void> route() => MaterialPageRoute<void>(
        builder: (_) => const StoreReceiptScreen(),
        settings: const RouteSettings(name: 'inventory/receive-goods'),
      );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
        error: (Object error, StackTrace _) => InventoryFailureView(
          error: error,
          copy: copy,
          onRetry: () => ref.invalidate(storeReceiptBoardProvider),
        ),
        data: (StoreReceiptBoard board) => RefreshIndicator(
          onRefresh: refresh,
          child: ListView(
            key: const Key('inventory.sr.list'),
            padding: const EdgeInsets.all(TpSpace.lg),
            children: <Widget>[
              Text(
                copy('sr_intro'),
                style: TextStyle(color: palette.textSecondary),
              ),
              const SizedBox(height: TpSpace.md),
              if (board.lines.isEmpty)
                TpEmptyState(
                  key: const Key('inventory.sr.empty'),
                  icon: Icons.move_to_inbox_outlined,
                  title: copy('sr_noLines'),
                  message: copy('sr_noLinesBody'),
                )
              else
                for (final OpenPoLine line in board.lines)
                  Card(
                    key: Key('inventory.sr.line.${line.poLineId}'),
                    child: ListTile(
                      minTileHeight: inventoryTouchTarget,
                      title: Text(
                        line.itemLabel.isEmpty ? line.poNumber : line.itemLabel,
                      ),
                      subtitle: Text(
                        <String>[
                          line.poNumber,
                          if (line.supplier != null) line.supplier!,
                          if (line.site != null) line.site!,
                          copy('sr_ordered')
                              .replaceAll('%n', _qty(line.qtyOrdered)),
                        ].join(' · '),
                      ),
                      trailing: Text(
                        copy('sr_open').replaceAll(
                          '%n',
                          '${_qty(line.qtyOpen)}'
                              '${line.uom == null ? '' : ' ${line.uom}'}',
                        ),
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      onTap: () => unawaited(
                        Navigator.of(context)
                            .push<bool>(
                              StoreReceiptFormScreen.route(
                                line: line,
                                locations: board.locationsFor(line),
                              ),
                            )
                            .then(
                              (_) => ref.invalidate(storeReceiptBoardProvider),
                            ),
                      ),
                    ),
                  ),
              if (board.mine.isNotEmpty) ...<Widget>[
                const SizedBox(height: TpSpace.lg),
                Text(
                  copy('sr_mine'),
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                for (final MyStoreReceipt r in board.mine)
                  _MineTile(receipt: r, copy: copy),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _MineTile extends ConsumerWidget {
  const _MineTile({required this.receipt, required this.copy});

  final MyStoreReceipt receipt;
  final InventoryCopy copy;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final MyStoreReceipt r = receipt;
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
                '${r.qtyRejected > 0 ? ' (-${_qty(r.qtyRejected)})' : ''}',
            copy.label('sr_status_', r.status),
            if (r.decisionNote != null) r.decisionNote!,
          ].join(' · '),
        ),
        trailing: r.isPending
            ? TextButton(
                key: Key('inventory.sr.withdraw.${r.id}'),
                onPressed: () async {
                  final ScaffoldMessengerState m =
                      ScaffoldMessenger.of(context);
                  try {
                    await ref.read(storeReceiptRepositoryProvider).cancel(r.id);
                    m.showSnackBar(
                      SnackBar(content: Text(copy('sr_withdrawn'))),
                    );
                  } on Object catch (e) {
                    m.showSnackBar(
                      SnackBar(content: Text(storeReceiptFailureText(e, copy))),
                    );
                  }
                  ref.invalidate(storeReceiptBoardProvider);
                },
                child: Text(copy('sr_withdraw')),
              )
            : null,
      ),
    );
  }
}

/// Reads a picked photo's bytes. Overridable in tests.
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
  late final TextEditingController _received =
      TextEditingController(text: _qty(widget.line.qtyOpen));
  final TextEditingController _rejected = TextEditingController(text: '0');
  final TextEditingController _reason = TextEditingController();
  final TextEditingController _noteNo = TextEditingController();
  final TextEditingController _notes = TextEditingController();

  late String? _locationId =
      widget.locations.isEmpty ? null : widget.locations.first.id;
  String? _photoLocalPath;
  String? _photoUploadedPath;
  String? _key;
  String? _keySignature;
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

  StoreReceiptDraft _draft({String? photoPath}) => StoreReceiptDraft(
        line: widget.line,
        qtyReceived: parseReceiptQty(_received.text),
        qtyRejected: parseReceiptQty(_rejected.text) ?? 0,
        locationId: _locationId,
        rejectionReason: _reason.text,
        deliveryNoteNo: _noteNo.text,
        notes: _notes.text,
        deliveryNotePath: photoPath,
      );

  Future<void> _takePhoto() async {
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
      _photoLocalPath = path;
      _photoUploadedPath = null;
    });
  }

  Future<void> _send(InventoryCopy copy) async {
    final StoreReceiptDraft check = _draft();
    final String? invalid = check.validate();
    if (invalid != null) {
      setState(() => _problem = copy(invalid));
      return;
    }
    final String signature = '${check.signature}|$_photoLocalPath';
    if (_keySignature != signature) {
      _key = ref.read(inventoryIdFactoryProvider)();
      _keySignature = signature;
      _photoUploadedPath = null;
    }
    setState(() {
      _sending = true;
      _problem = null;
    });
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
        final String path = storeReceiptPhotoPath(org, _key!);
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
        clientUuid: _key!,
      );
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
              onChanged: (_) => setState(() {}),
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
                  child: SizedBox(
                    height: inventoryTouchTarget,
                    child: OutlinedButton.icon(
                      key: const Key('inventory.sr.photo'),
                      onPressed:
                          _sending ? null : () => unawaited(_takePhoto()),
                      icon: Icon(
                        _photoLocalPath == null
                            ? Icons.photo_camera_outlined
                            : Icons.check_circle_outline,
                      ),
                      label: Text(
                        _photoLocalPath == null
                            ? copy('sr_photo')
                            : copy('sr_photoTaken'),
                      ),
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
              '${copy('sr_noPrice')} ${copy('sr_onlineNote')}',
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
            SizedBox(
              height: inventoryTouchTarget,
              child: FilledButton(
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
            ),
          ],
        ),
      ),
    );
  }
}
