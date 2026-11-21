/// Start Physical Inventory on the phone: pick a store, then scan / search /
/// describe each item, enter the quantity, condition and ownership, take
/// photos and "Save and next". Works offline: captures and photos go to an
/// encrypted per-user outbox and are sent when the network comes back. A
/// capture never changes official stock (docs/inventory/102 section 1).
///
/// Pushed with Navigator from the stock screen: new routes belong in the
/// reserved router files (docs/inventory_reserved_patch.md), so this screen
/// reuses the same `stock` module gate as My counts and Transfers.
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inventory/data/physical_capture_outbox.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/physical_inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_copy.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_widgets.dart';

class PhysicalInventoryScreen extends ConsumerStatefulWidget {
  const PhysicalInventoryScreen({super.key});

  static Route<void> route() => MaterialPageRoute<void>(
        builder: (_) => const PhysicalInventoryScreen(),
        settings: const RouteSettings(name: 'inventory/physical'),
      );

  @override
  ConsumerState<PhysicalInventoryScreen> createState() =>
      _PhysicalInventoryScreenState();
}

class _PhysicalInventoryScreenState
    extends ConsumerState<PhysicalInventoryScreen> with WidgetsBindingObserver {
  PhysicalSession? _session;
  final TextEditingController _store = TextEditingController();
  final TextEditingController _qty = TextEditingController();
  final TextEditingController _uom = TextEditingController();
  final TextEditingController _hint = TextEditingController();
  final TextEditingController _remarks = TextEditingController();
  final Map<String, TextEditingController> _refs =
      <String, TextEditingController>{
    for (final String k in <String>[
      'description',
      'manufacturer',
      'oem',
      'aftermarket',
      'company_sku',
    ])
      k: TextEditingController(),
  };
  String _condition = 'new';
  String _ownership = 'owned';
  String _photoRole = 'item';
  String? _scanned;
  MaterialPick? _pick;
  List<MaterialPick> _results = const <MaterialPick>[];
  final List<String> _photos = <String>[];
  String _captureUuid = '';
  String _startKey = '';
  bool _busy = false;
  int _pending = 0;
  List<PendingCapture> _attention = const <PendingCapture>[];
  String? _message;
  StreamSubscription<List<ConnectivityResult>>? _net;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _captureUuid = ref.read(inventoryIdFactoryProvider)();
    _startKey = ref.read(inventoryIdFactoryProvider)();
    final List<String> sites =
        ref.read(workspaceContextProvider)?.activeSites ?? const <String>[];
    if (sites.isNotEmpty) _store.text = sites.first;
    _net = Connectivity()
        .onConnectivityChanged
        .listen((List<ConnectivityResult> r) {
      if (r.any((ConnectivityResult x) => x != ConnectivityResult.none)) {
        unawaited(_flush());
      }
    });
    unawaited(_flush());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_flush());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_net?.cancel());
    for (final TextEditingController c in <TextEditingController>[
      _store,
      _qty,
      _uom,
      _hint,
      _remarks,
      ..._refs.values,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  String? get _userId => ref.read(workspaceContextProvider)?.userId;
  String? get _orgId {
    final ctx = ref.read(workspaceContextProvider);
    // app_current_org() reads profiles.org_id (tenantId); the server checks the
    // photo path against it.
    return ctx?.tenantId ?? ctx?.companyId;
  }

  Future<void> _flush() async {
    final String? user = _userId;
    final String? org = _orgId;
    if (user == null || org == null) return;
    final PhysicalCaptureOutbox outbox =
        ref.read(physicalCaptureOutboxProvider);
    try {
      final String device = await ref.read(inventoryDeviceIdProvider.future);
      final OutboxFlushResult r = await outbox.flush(
        userId: user,
        orgId: org,
        repository: ref.read(physicalInventoryRepositoryProvider),
        deviceId: device,
      );
      final List<PendingCapture> left = await outbox.pending(user);
      if (mounted) {
        setState(() {
          _pending = r.remaining;
          _attention = left
              .where((PendingCapture c) => c.lastError != null)
              .toList(growable: false);
        });
      }
    } on Object {
      // The outbox keeps everything; the pending count is refreshed next time.
      try {
        final int n = (await outbox.pending(user)).length;
        if (mounted) setState(() => _pending = n);
      } on Object {
        // unreadable store: leave the counter as it was
      }
    }
  }

  Future<void> _dismiss(PendingCapture c) async {
    final String? user = _userId;
    if (user == null) return;
    try {
      await ref.read(physicalCaptureOutboxProvider).dismiss(user, c.clientUuid);
    } on Object {
      // unreadable store: nothing removed; shown again next flush
    }
    await _flush();
  }

  Future<void> _start(InventoryCopy copy) async {
    final String? country = ref.read(workspaceContextProvider)?.activeCountry;
    if (country == null || _store.text.trim().isEmpty) {
      setState(() => _message = copy('pi_pickStore'));
      return;
    }
    setState(() => _busy = true);
    try {
      final PhysicalSession s =
          await ref.read(physicalInventoryRepositoryProvider).startSession(
                idempotencyKey: _startKey,
                country: country,
                site: _store.text.trim(),
              );
      _startKey = ref.read(inventoryIdFactoryProvider)();
      setState(() {
        _session = s;
        _message = null;
      });
    } on SupabaseFailure catch (f) {
      setState(
        () => _message =
            f.isSchemaMismatch ? copy('notProvisionedBody') : f.error.message,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _search(String code, InventoryCopy copy) async {
    setState(() {
      _scanned = code;
      _pick = null;
      _message = null;
    });
    try {
      final List<MaterialPick> r =
          await ref.read(physicalInventoryRepositoryProvider).search(code);
      if (mounted) {
        setState(() {
          _results = r;
          if (r.isEmpty) _message = copy('pi_noMatch');
        });
      }
    } on SupabaseFailure catch (f) {
      // Offline: the code is kept and the item can still be described.
      if (mounted) {
        setState(
          () => _message =
              f.isConnectivity ? copy('pi_searchOffline') : f.error.message,
        );
      }
    }
  }

  Future<void> _takePhoto() async {
    final String? path = await ref.read(countPhotoCaptureProvider).capture(
          auditId: 'pi_${_session?.id ?? 'session'}',
          clientUuid: '${_captureUuid}_${_photos.length}',
        );
    if (path != null && mounted) setState(() => _photos.add(path));
  }

  Future<void> _save(InventoryCopy copy) async {
    final PhysicalSession? s = _session;
    final String? user = _userId;
    final double? qty = parseQty(_qty.text);
    if (s == null || user == null) return;
    if (qty == null) {
      setState(() => _message = copy('pi_qtyInvalid'));
      return;
    }
    final Map<String, String> refs = <String, String>{
      for (final MapEntry<String, TextEditingController> e in _refs.entries)
        if (e.value.text.trim().isNotEmpty) e.key: e.value.text.trim(),
    };
    final String Function() id = ref.read(inventoryIdFactoryProvider);
    final PendingCapture capture = PendingCapture(
      clientUuid: _captureUuid,
      userId: user,
      sessionId: s.id,
      kind: captureKindFor(canonicalId: _pick?.canonicalId, refs: refs),
      quantity: qty,
      capturedAt: DateTime.now(),
      canonicalId: _pick?.canonicalId,
      variantId: _pick?.variantId,
      label: _pick?.label ?? refs['description'] ?? _scanned,
      refs: refs,
      scannedCode: _scanned,
      uom: _uom.text.trim().isEmpty ? null : _uom.text.trim(),
      condition: _condition,
      ownership: _ownership,
      locationId: s.locationId,
      locationHint: _hint.text.trim().isEmpty ? null : _hint.text.trim(),
      remarks: _remarks.text.trim().isEmpty ? null : _remarks.text.trim(),
      photos: <PendingPhoto>[
        for (final String p in _photos)
          PendingPhoto(clientUuid: id(), localPath: p, role: _photoRole),
      ],
    );
    setState(() => _busy = true);
    try {
      await ref.read(physicalCaptureOutboxProvider).add(capture);
      _captureUuid = id();
      _qty.clear();
      _remarks.clear();
      for (final TextEditingController c in _refs.values) {
        c.clear();
      }
      setState(() {
        _pick = null;
        _scanned = null;
        _results = const <MaterialPick>[];
        _photos.clear();
        _message = copy('pi_savedLocal');
      });
      unawaited(_flush());
    } on Object {
      setState(() => _message = copy('pi_saveFailed'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _dropdown(
    String label,
    String value,
    List<String> values,
    String prefix,
    InventoryCopy copy,
    ValueChanged<String> onChanged,
  ) =>
      DropdownButtonFormField<String>(
        initialValue: value,
        decoration: InputDecoration(labelText: label),
        items: <DropdownMenuItem<String>>[
          for (final String v in values)
            DropdownMenuItem<String>(
              value: v,
              child: Text(copy.label(prefix, v)),
            ),
        ],
        onChanged: (String? v) => v == null ? null : onChanged(v),
      );

  @override
  Widget build(BuildContext context) {
    final InventoryCopy copy = InventoryCopy.of(context);
    final PhysicalSession? s = _session;
    final AsyncValue<List<PhysicalSession>> open =
        ref.watch(openPhysicalSessionsProvider);
    return TpScaffold(
      appBar: TpAppBar(
        title: copy('pi_title'),
        subtitle: s == null ? null : '${s.reference} · ${s.site}',
        actions: <Widget>[
          if (_pending > 0)
            TextButton.icon(
              key: const Key('pi.pending'),
              onPressed: () => unawaited(_flush()),
              icon: const Icon(Icons.cloud_upload_outlined),
              label: Text(copy.count('pi_pendingN', _pending)),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(TpSpace.lg),
        children: <Widget>[
          for (final PendingCapture a in _attention)
            Card(
              key: Key('pi.attention.${a.clientUuid}'),
              child: ListTile(
                leading: const Icon(Icons.warning_amber_rounded),
                title: Text(a.tempRef ?? a.label ?? copy('pi_attention')),
                subtitle: Text(
                  switch (a.lastError) {
                    piErrPhotoMissing => copy('pi_err_photo_missing'),
                    piErrPhotoReadFailed => copy('pi_err_photo_read_failed'),
                    _ => a.lastError ?? '',
                  },
                ),
                trailing: a.captureSent
                    ? TextButton(
                        onPressed: () => unawaited(_dismiss(a)),
                        child: Text(copy('pi_dismiss')),
                      )
                    : null,
              ),
            ),
          if (_message != null)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.md),
              child: Text(_message!, key: const Key('pi.message')),
            ),
          if (s == null) ...<Widget>[
            Text(copy('pi_startLead')),
            const SizedBox(height: TpSpace.md),
            TextField(
              key: const Key('pi.store'),
              controller: _store,
              decoration: InputDecoration(labelText: copy('pi_store')),
              textCapitalization: TextCapitalization.characters,
            ),
            const SizedBox(height: TpSpace.md),
            TpButton.primary(
              key: const Key('pi.start'),
              label: copy('pi_start'),
              icon: Icons.play_arrow_rounded,
              isBusy: _busy,
              isFullWidth: true,
              onPressed: _busy ? null : () => unawaited(_start(copy)),
            ),
            const SizedBox(height: TpSpace.lg),
            ...open.when(
              loading: () => <Widget>[const TpLoadingState()],
              error: (Object e, StackTrace _) => <Widget>[
                InventoryFailureView(
                  error: e,
                  copy: copy,
                  onRetry: () => ref.invalidate(openPhysicalSessionsProvider),
                ),
              ],
              data: (List<PhysicalSession> rows) => <Widget>[
                for (final PhysicalSession o in rows)
                  Card(
                    child: ListTile(
                      key: Key('pi.session.${o.id}'),
                      minTileHeight: inventoryTouchTarget,
                      title: Text(o.reference),
                      subtitle: Text(o.site),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => setState(() => _session = o),
                    ),
                  ),
              ],
            ),
          ] else ...<Widget>[
            InventoryScanField(
              hint: copy('pi_scanHint'),
              copy: copy,
              onScan: (String code) => unawaited(_search(code, copy)),
            ),
            if (_scanned != null) Text('${copy('pi_scanned')}: $_scanned'),
            if (_pick != null)
              Card(
                child: ListTile(
                  key: const Key('pi.picked'),
                  leading: const Icon(Icons.check_circle_outline),
                  title: Text(_pick!.label),
                  subtitle: _pick!.classification == null
                      ? null
                      : Text(copy.label('pi_cls_', _pick!.classification!)),
                  trailing: IconButton(
                    tooltip: copy('pi_change'),
                    icon: const Icon(Icons.close),
                    onPressed: () => setState(() => _pick = null),
                  ),
                ),
              )
            else ...<Widget>[
              for (final MaterialPick p in _results)
                ListTile(
                  minTileHeight: inventoryTouchTarget,
                  title: Text(p.label),
                  subtitle: Text(
                    p.classification == null
                        ? copy('pi_variantUnknown')
                        : copy.label('pi_cls_', p.classification!),
                  ),
                  onTap: () => setState(() => _pick = p),
                ),
              ExpansionTile(
                key: const Key('pi.describe'),
                title: Text(copy('pi_describe')),
                initiallyExpanded: _scanned != null && _results.isEmpty,
                children: <Widget>[
                  for (final MapEntry<String, TextEditingController> e
                      in _refs.entries)
                    TextField(
                      controller: e.value,
                      decoration: InputDecoration(
                        labelText: copy.label('pi_ref_', e.key),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
                    child: Text(copy('pi_unidentifiedHint')),
                  ),
                ],
              ),
            ],
            const SizedBox(height: TpSpace.md),
            Row(
              children: <Widget>[
                Expanded(
                  child: TextField(
                    key: const Key('pi.qty'),
                    controller: _qty,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration: InputDecoration(labelText: copy('pi_qty')),
                  ),
                ),
                const SizedBox(width: TpSpace.md),
                Expanded(
                  child: TextField(
                    controller: _uom,
                    decoration: InputDecoration(labelText: copy('pi_uom')),
                  ),
                ),
              ],
            ),
            const SizedBox(height: TpSpace.md),
            _dropdown(
              copy('pi_condition'),
              _condition,
              piConditions,
              'pi_cond_',
              copy,
              (String v) => setState(() => _condition = v),
            ),
            const SizedBox(height: TpSpace.md),
            _dropdown(
              copy('pi_ownership'),
              _ownership,
              piOwnerships,
              'pi_own_',
              copy,
              (String v) => setState(() => _ownership = v),
            ),
            const SizedBox(height: TpSpace.md),
            TextField(
              controller: _hint,
              decoration: InputDecoration(labelText: copy('pi_locationHint')),
            ),
            TextField(
              controller: _remarks,
              decoration: InputDecoration(labelText: copy('pi_remarks')),
            ),
            const SizedBox(height: TpSpace.md),
            Row(
              children: <Widget>[
                Expanded(
                  child: _dropdown(
                    copy('pi_photoRole'),
                    _photoRole,
                    piPhotoRoles,
                    'pi_role_',
                    copy,
                    (String v) => setState(() => _photoRole = v),
                  ),
                ),
                const SizedBox(width: TpSpace.md),
                IconButton.filledTonal(
                  key: const Key('pi.photo'),
                  tooltip: copy('pi_takePhoto'),
                  iconSize: 28,
                  icon: const Icon(Icons.photo_camera_outlined),
                  onPressed: _photos.length >= 6
                      ? null
                      : () => unawaited(_takePhoto()),
                ),
              ],
            ),
            Text(copy.count('pi_photosN', _photos.length)),
            const SizedBox(height: TpSpace.lg),
            TpButton.primary(
              key: const Key('pi.save'),
              label: copy('pi_saveNext'),
              icon: Icons.save_outlined,
              isBusy: _busy,
              isFullWidth: true,
              onPressed: _busy ? null : () => unawaited(_save(copy)),
            ),
            const SizedBox(height: TpSpace.sm),
            TpButton.secondary(
              label: copy('pi_leave'),
              isFullWidth: true,
              onPressed: () => setState(() => _session = null),
            ),
            const SizedBox(height: TpSpace.md),
            Text(copy('pi_ledgerRule')),
          ],
        ],
      ),
    );
  }
}
