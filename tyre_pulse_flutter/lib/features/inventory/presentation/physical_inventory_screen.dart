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
import 'package:tyre_pulse/features/inventory/domain/inventory_scan.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/physical_inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_copy.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_theme.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_widgets.dart';
import 'package:tyre_pulse/features/inventory/presentation/physical_capture_widgets.dart';

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
  InventoryPlace? _storePick;
  InventoryPlace? _bin;
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
      'part_number',
    ])
      k: TextEditingController(),
  };
  String _condition = 'new';
  String _ownership = 'owned';

  /// The counter's own claim for an item that matched nothing. It is sent as
  /// an entered reference (`classification_claim`) for the reviewer; it does
  /// NOT set the variant classification, which needs evidence on review.
  String _classification = 'unknown';
  String? _scanned;
  MaterialPick? _pick;
  List<MaterialPick> _results = const <MaterialPick>[];

  /// One photo per evidence slot, keyed by its role (item / label /
  /// location, plus damage when the condition calls for it).
  final Map<String, String> _slotPhotos = <String, String>{};
  bool? _online;
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
    _net = Connectivity().onConnectivityChanged.listen(
      (List<ConnectivityResult> r) {
        final bool online =
            r.any((ConnectivityResult x) => x != ConnectivityResult.none);
        if (mounted) setState(() => _online = online);
        if (online) unawaited(_flush());
      },
      onError: (Object _) {
        // No connectivity plugin (tests, unsupported platform): the pill
        // shows the pending count only.
      },
    );
    unawaited(_checkOnline());
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

  Future<void> _checkOnline() async {
    try {
      final List<ConnectivityResult> r =
          await Connectivity().checkConnectivity();
      if (mounted) {
        setState(
          () => _online =
              r.any((ConnectivityResult x) => x != ConnectivityResult.none),
        );
      }
    } on Object {
      // Unknown: the pill falls back to the pending count.
    }
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
    final InventoryPlace? store = _storePick;
    final String? country =
        store?.country ?? ref.read(workspaceContextProvider)?.activeCountry;
    if (store == null || country == null) {
      setState(() => _message = copy('pi_pickStore'));
      return;
    }
    setState(() => _busy = true);
    try {
      final PhysicalSession s =
          await ref.read(physicalInventoryRepositoryProvider).startSession(
                idempotencyKey: _startKey,
                country: country,
                site: store.site,
                locationId: store.id,
              );
      _startKey = ref.read(inventoryIdFactoryProvider)();
      setState(() {
        _session = s;
        _bin = null;
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

  /// A scan in the capture view: a `TP:LOC:` label selects the bin, anything
  /// else is searched as an item code.
  Future<void> _onCaptureScan(String raw, InventoryCopy copy) async {
    final InventoryScan? scan = parseInventoryScan(raw);
    if (scan == null) return;
    if (scan.kind == InventoryScanKind.location) {
      await _selectBin(scan.value, copy);
      return;
    }
    await _search(scan.value, copy);
  }

  Future<void> _selectBin(String id, InventoryCopy copy) async {
    final PhysicalSession? s = _session;
    if (s == null) return;
    try {
      final InventoryPlace? place =
          await ref.read(physicalInventoryRepositoryProvider).placeById(id);
      if (!mounted) return;
      if (place == null) {
        setState(() => _message = copy('pi_binUnknown'));
        return;
      }
      if (place.site.toUpperCase() != s.site.toUpperCase()) {
        setState(() => _message = copy('pi_binOtherStore'));
        return;
      }
      setState(() {
        _bin = place;
        _message = null;
      });
    } on SupabaseFailure catch (f) {
      if (!mounted) return;
      if (f.isConnectivity) {
        // Offline: keep the scanned label; the server checks it on send.
        setState(() {
          _bin = InventoryPlace(
            id: id,
            site: s.site,
            code: id.length > 8 ? id.substring(0, 8) : id,
            locationType: 'bin',
            country: s.country,
          );
          _message = copy('pi_binOffline');
        });
      } else {
        setState(() => _message = f.error.message);
      }
    }
  }

  /// A scan on the start view: a `TP:LOC:` label picks its store.
  Future<void> _onStartScan(
    String raw,
    List<InventoryPlace> stores,
    InventoryCopy copy,
  ) async {
    final InventoryScan? scan = parseInventoryScan(raw);
    if (scan == null || scan.kind != InventoryScanKind.location) {
      setState(() => _message = copy('pi_scanStoreLabel'));
      return;
    }
    InventoryPlace? store;
    for (final InventoryPlace p in stores) {
      if (p.id == scan.value) store = p;
    }
    if (store == null) {
      try {
        final InventoryPlace? place = await ref
            .read(physicalInventoryRepositoryProvider)
            .placeById(scan.value);
        if (place != null) store = storeForPlace(place, stores);
      } on SupabaseFailure {
        store = null;
      }
    }
    if (!mounted) return;
    setState(() {
      if (store == null) {
        _message = copy('pi_binUnknown');
      } else {
        _storePick = store;
        _message = null;
      }
    });
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

  Future<void> _takePhoto(String role) async {
    final String? path = await ref.read(countPhotoCaptureProvider).capture(
          auditId: 'pi_${_session?.id ?? 'session'}',
          clientUuid: '${_captureUuid}_$role',
        );
    if (path != null && mounted) {
      setState(() {
        _slotPhotos[role] = path;
        _message = null;
      });
    }
  }

  /// The evidence slots shown for the current condition. Damage gets its own
  /// slot only when the condition says the item is not sound.
  List<String> get _slots => <String>[
        'item',
        'label',
        'location',
        if (const <String>{'damaged', 'repairable', 'scrap'}
            .contains(_condition))
          'damage',
      ];

  Future<void> _save(InventoryCopy copy) async {
    final PhysicalSession? s = _session;
    final String? user = _userId;
    final double? qty = parseQty(_qty.text);
    if (s == null) return;
    if (qty == null) {
      setState(() => _message = copy('pi_qtyInvalid'));
      return;
    }
    final List<MapEntry<String, String>> photos = <MapEntry<String, String>>[
      for (final String role in _slots)
        if (_slotPhotos[role] != null)
          MapEntry<String, String>(role, _slotPhotos[role]!),
    ];
    if (photos.isEmpty) {
      setState(() => _message = copy('pi_photoRequired'));
      return;
    }
    if (user == null) return;
    final Map<String, String> refs = <String, String>{
      for (final MapEntry<String, TextEditingController> e in _refs.entries)
        if (e.value.text.trim().isNotEmpty) e.key: e.value.text.trim(),
      if (_pick == null && _classification != 'unknown')
        'classification_claim': _classification,
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
      locationId: _bin?.id ?? s.locationId,
      locationHint: _hint.text.trim().isEmpty ? null : _hint.text.trim(),
      remarks: _remarks.text.trim().isEmpty ? null : _remarks.text.trim(),
      photos: <PendingPhoto>[
        for (final MapEntry<String, String> p in photos)
          PendingPhoto(clientUuid: id(), localPath: p.value, role: p.key),
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
        _slotPhotos.clear();
        _classification = 'unknown';
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
    ValueChanged<String>? onChanged, {
    Key? key,
    bool isRequired = true,
  }) =>
      TpDropdown<String>(
        key: key,
        label: label,
        value: value,
        isRequired: isRequired,
        items: <TpDropdownItem<String>>[
          for (final String v in values)
            TpDropdownItem<String>(value: v, label: copy.label(prefix, v)),
        ],
        onChanged: onChanged == null
            ? null
            : (String? v) => v == null ? null : onChanged(v),
      );

  /// Opens the bin picker: scan a `TP:LOC:` bin label, note the rack/shelf
  /// text, or clear the bin back to the whole store.
  Future<void> _openLocationSheet(InventoryCopy copy) =>
      TpBottomSheet.show<void>(
        context: _themedContext ?? context,
        title: copy('pi_location'),
        builder: (BuildContext sheet) => Padding(
          padding: const EdgeInsets.all(TpSpace.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              InventoryScanField(
                key: const Key('pi.binScan'),
                hint: copy('pi_scanBin'),
                copy: copy,
                onScan: (String code) {
                  Navigator.of(sheet).pop();
                  unawaited(_onCaptureScan(code, copy));
                },
              ),
              const SizedBox(height: TpSpace.md),
              TpInput(
                label: copy('pi_locationHint'),
                controller: _hint,
                onChanged: (_) => setState(() {}),
              ),
              if (_bin != null) ...<Widget>[
                const SizedBox(height: TpSpace.md),
                // Material button, not TpButton.secondary: that one inks its
                // label with the accent, which is yellow here.
                OutlinedButton.icon(
                  key: const Key('pi.clearBin'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(inventoryTouchTarget),
                  ),
                  label: Text(copy('pi_clearBin')),
                  icon: const Icon(Icons.close),
                  onPressed: () {
                    setState(() => _bin = null);
                    Navigator.of(sheet).pop();
                  },
                ),
              ],
            ],
          ),
        ),
      );

  /// The context under the scoped inventory theme, so a bottom sheet opened
  /// from this screen captures the same yellow accent.
  BuildContext? _themedContext;

  @override
  Widget build(BuildContext context) {
    // Owner mockup: the same safety-yellow accent in light and dark, scoped
    // to this screen only (the rest of the light app stays fleet green).
    return Theme(
      data: inventoryThemeFor(Theme.of(context).brightness),
      child: Builder(builder: _buildScreen),
    );
  }

  Widget _buildScreen(BuildContext context) {
    _themedContext = context;
    final InventoryCopy copy = InventoryCopy.of(context);
    final PhysicalSession? s = _session;
    final AsyncValue<List<PhysicalSession>> open =
        ref.watch(openPhysicalSessionsProvider);
    final AsyncValue<List<InventoryPlace>> stores =
        ref.watch(physicalStoresProvider);
    return TpScaffold(
      appBar: TpAppBar(
        title: copy('pi_title'),
        subtitle: s == null ? null : '${s.reference} · ${s.site}',
        actions: <Widget>[
          if (_pending > 0 && s == null)
            TextButton.icon(
              key: const Key('pi.pending'),
              onPressed: () => unawaited(_flush()),
              icon: const Icon(Icons.cloud_upload_outlined),
              label: Text(copy.count('pi_pendingN', _pending)),
            ),
        ],
      ),
      // Save and next stays at the bottom edge, in thumb reach, however far
      // the form is scrolled.
      bottomNavigationBar: s == null
          ? null
          : SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  TpSpace.lg,
                  TpSpace.sm,
                  TpSpace.lg,
                  TpSpace.md,
                ),
                child: SizedBox(
                  height: inventoryTouchTarget,
                  child: TpButton.primary(
                    key: const Key('pi.save'),
                    label: copy('pi_saveCountNext'),
                    icon: Icons.check_rounded,
                    isBusy: _busy,
                    isFullWidth: true,
                    onPressed: _busy ? null : () => unawaited(_save(copy)),
                  ),
                ),
              ),
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
            Text(
              copy('pi_store'),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: TpSpace.sm),
            ...stores.when(
              loading: () => <Widget>[const TpLoadingState()],
              error: (Object e, StackTrace _) => <Widget>[
                InventoryFailureView(
                  error: e,
                  copy: copy,
                  onRetry: () => ref.invalidate(physicalStoresProvider),
                ),
              ],
              data: (List<InventoryPlace> rows) => <Widget>[
                if (rows.isEmpty)
                  Text(copy('pi_noStores'), key: const Key('pi.noStores')),
                for (final InventoryPlace p in rows)
                  Card(
                    child: ListTile(
                      key: Key('pi.store.${p.id}'),
                      minTileHeight: inventoryTouchTarget,
                      selected: _storePick?.id == p.id,
                      leading: Icon(
                        _storePick?.id == p.id
                            ? Icons.radio_button_checked
                            : Icons.radio_button_off,
                      ),
                      title: Text(p.title),
                      subtitle: Text(p.site),
                      onTap: () => setState(() {
                        _storePick = p;
                        _message = null;
                      }),
                    ),
                  ),
                if (rows.isNotEmpty) ...<Widget>[
                  const SizedBox(height: TpSpace.sm),
                  InventoryScanField(
                    key: const Key('pi.storeScan'),
                    hint: copy('pi_scanStoreLabel'),
                    copy: copy,
                    autofocus: false,
                    onScan: (String code) =>
                        unawaited(_onStartScan(code, rows, copy)),
                  ),
                ],
              ],
            ),
            const SizedBox(height: TpSpace.md),
            TpButton.primary(
              key: const Key('pi.start'),
              label: copy('pi_start'),
              icon: Icons.play_arrow_rounded,
              isBusy: _busy,
              isFullWidth: true,
              onPressed: _busy || _storePick == null
                  ? null
                  : () => unawaited(_start(copy)),
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
                      onTap: () => setState(() {
                        _session = o;
                        _bin = null;
                      }),
                    ),
                  ),
              ],
            ),
          ] else ...<Widget>[
            Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.sm,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                Text(
                  copy('pi_captureTitle'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                PiConnectionPill(
                  key: const Key('pi.connection'),
                  online: _online,
                  pending: _pending,
                  copy: copy,
                  onTap: () => unawaited(_flush()),
                ),
              ],
            ),
            const SizedBox(height: TpSpace.md),
            PiLocationBar(
              key: Key(_bin == null ? 'pi.location' : 'pi.bin'),
              parts: <String?>[
                _storePick?.id == s.locationId ? _storePick?.title : s.site,
                _bin?.title,
                _hint.text,
              ],
              placeholder: copy('pi_chooseBin'),
              semanticLabel: copy('pi_location'),
              onTap: () => unawaited(_openLocationSheet(copy)),
            ),
            const SizedBox(height: TpSpace.md),
            InventoryScanField(
              hint: copy('pi_searchHint'),
              copy: copy,
              onScan: (String code) => unawaited(_onCaptureScan(code, copy)),
            ),
            if (_scanned != null)
              Padding(
                padding: const EdgeInsets.only(top: TpSpace.sm),
                child: Text('${copy('pi_scanned')}: $_scanned'),
              ),
            const SizedBox(height: TpSpace.md),
            if (_pick != null)
              PiMatchedItemCard(
                key: const Key('pi.picked'),
                pick: _pick!,
                copy: copy,
                onClear: () => setState(() => _pick = null),
              )
            else
              for (final MaterialPick p in _results)
                Card(
                  child: ListTile(
                    minTileHeight: inventoryTouchTarget,
                    leading: const Icon(Icons.inventory_2_outlined),
                    title: Text(p.label),
                    subtitle: Text(
                      p.classification == null
                          ? copy('pi_variantUnknown')
                          : copy.label('pi_cls_', p.classification!),
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => setState(() => _pick = p),
                  ),
                ),
            const SizedBox(height: TpSpace.md),
            TpInput(
              key: const Key('pi.ref.oem'),
              label: copy('pi_ref_oem'),
              controller: _refs['oem'],
            ),
            const SizedBox(height: TpSpace.md),
            TpInput(
              key: const Key('pi.ref.part_number'),
              label: copy('pi_ref_part_number'),
              controller: _refs['part_number'],
            ),
            const SizedBox(height: TpSpace.md),
            if (_pick != null)
              _dropdown(
                copy('pi_classification'),
                piClassificationFor(_pick!.classification),
                piClassificationChoices,
                'pi_clsPick_',
                copy,
                null,
                key: const Key('pi.classification'),
              )
            else
              _dropdown(
                copy('pi_classification'),
                _classification,
                piClassificationChoices,
                'pi_clsPick_',
                copy,
                (String v) => setState(() => _classification = v),
                key: const Key('pi.classification'),
              ),
            if (_pick != null)
              Padding(
                padding: const EdgeInsets.only(top: TpSpace.xs),
                child: Text(
                  copy('pi_clsFromCatalog'),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            const SizedBox(height: TpSpace.lg),
            PiFieldLabel(copy('pi_qty'), required: true),
            PiQtyStepper(
              controller: _qty,
              copy: copy,
              onChanged: () => setState(() {}),
            ),
            const SizedBox(height: TpSpace.lg),
            PiFieldLabel(copy('pi_condition'), required: true),
            PiChoiceChips(
              values: piConditions,
              selected: _condition,
              labelOf: (String v) => copy.label('pi_cond_', v),
              onSelected: (String v) => setState(() {
                _condition = v;
                // A damage photo only belongs to a damaged item.
                if (!_slots.contains('damage')) _slotPhotos.remove('damage');
              }),
            ),
            const SizedBox(height: TpSpace.lg),
            _dropdown(
              copy('pi_ownership'),
              _ownership,
              piOwnerships,
              'pi_own_',
              copy,
              (String v) => setState(() => _ownership = v),
              key: const Key('pi.ownership'),
            ),
            const SizedBox(height: TpSpace.lg),
            PiFieldLabel(copy('pi_photoEvidence'), required: true),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                for (final String role in _slots) ...<Widget>[
                  if (role != _slots.first) const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: PiPhotoSlot(
                      role: role,
                      label: role == 'label'
                          ? copy('pi_slot_label')
                          : copy.label('pi_role_', role),
                      path: _slotPhotos[role],
                      removeLabel: copy('pi_removePhoto'),
                      onCapture:
                          _busy ? null : () => unawaited(_takePhoto(role)),
                      onRemove: () => setState(() => _slotPhotos.remove(role)),
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: TpSpace.lg),
            TpInput(
              key: const Key('pi.remarks'),
              label: copy('pi_remarks'),
              controller: _remarks,
              maxLines: 3,
              maxLength: 250,
            ),
            ExpansionTile(
              key: const Key('pi.describe'),
              tilePadding: EdgeInsets.zero,
              title: Text(
                _pick == null && _scanned != null && _results.isEmpty
                    ? copy('pi_describe')
                    : copy('pi_moreDetails'),
              ),
              initiallyExpanded: _scanned != null && _results.isEmpty,
              children: <Widget>[
                for (final String k in <String>[
                  'description',
                  'manufacturer',
                  'aftermarket',
                  'company_sku',
                ]) ...<Widget>[
                  TpInput(
                    label: copy.label('pi_ref_', k),
                    controller: _refs[k],
                  ),
                  const SizedBox(height: TpSpace.sm),
                ],
                TpInput(label: copy('pi_uom'), controller: _uom),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
                  child: Text(copy('pi_unidentifiedHint')),
                ),
              ],
            ),
            const SizedBox(height: TpSpace.md),
            TextButton(
              key: const Key('pi.leave'),
              style: TextButton.styleFrom(
                minimumSize: const Size.fromHeight(TpSizing.minTouchTarget),
              ),
              onPressed: () => setState(() {
                _session = null;
                _bin = null;
              }),
              child: Text(copy('pi_leave')),
            ),
            const SizedBox(height: TpSpace.sm),
            Text(copy('pi_ledgerRule')),
          ],
        ],
      ),
    );
  }
}
