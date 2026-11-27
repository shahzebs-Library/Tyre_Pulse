/// The Store item card: what a Store Keeper needs about ONE item on the
/// shelf, and the place to add what is missing.
///
/// Shows the item's photos, where it sits (every bin and the quantity there,
/// with totals), its company SKU, brand and category, its part numbers per
/// brand, its barcodes and other numbers, and its recent movements. Lets the
/// person add a photo, a part number (with a brand picked from the company's
/// shared list or a new one), a barcode, correct the brand, propose an item
/// that is not in the company catalogue yet, and move it to another bin.
///
/// Every addition goes through the same governed proposal RPCs as the web
/// (see `store_item_repository.dart`): a part number, barcode or brand is
/// shared with the whole company and approved by a second person, so the
/// card says "Pending approval" rather than pretending it is final. Actions
/// the person may not do are hidden; the server stays the boundary.
///
/// Pushed with Navigator from the Stock Count list, behind the same `stock`
/// module gate; it adds no route and no role.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/transfers_screen.dart';
import 'package:tyre_pulse/features/scanning/presentation/asset_camera_scanner_dialog.dart';
import 'package:tyre_pulse/features/stock_count/data/store_item_repository.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_movement.dart';
import 'package:tyre_pulse/features/stock_count/domain/store_item_card.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_count_copy.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_item_detail_screen.dart'
    show StockItemDetailScreen, stockHistoryAppError;
import 'package:tyre_pulse/features/stock_count/presentation/stock_movement_pager.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_movement_widgets.dart';
import 'package:tyre_pulse/features/stock_count/presentation/store_history_copy.dart';
import 'package:tyre_pulse/features/stock_count/presentation/store_item_copy.dart';
import 'package:tyre_pulse/features/stock_count/stock_count_providers.dart';
import 'package:tyre_pulse/features/stock_count/store_item_providers.dart';

class StoreItemScreen extends ConsumerStatefulWidget {
  const StoreItemScreen({required this.item, super.key});
  final StockItem item;

  static Route<void> route(StockItem item) => MaterialPageRoute<void>(
        builder: (_) => StoreItemScreen(item: item),
        settings: const RouteSettings(name: 'stock/storeItem'),
      );

  @override
  ConsumerState<StoreItemScreen> createState() => _StoreItemScreenState();
}

class _StoreItemScreenState extends ConsumerState<StoreItemScreen> {
  late final StockMovementPager _pager = StockMovementPager(
    repository: ref.read(stockHistoryRepositoryProvider),
    pageSize: 10,
  );
  bool _busy = false;

  StockHistoryQuery get _query => StockHistoryQuery(stockId: widget.item.id);

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
    ref.invalidate(storeItemCardProvider(widget.item));
    await Future.wait(<Future<void>>[
      ref
          .read(storeItemCardProvider(widget.item).future)
          .then<void>((_) {}, onError: (Object _) {}),
      _pager.refresh(_query),
    ]);
  }

  void _say(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
  }

  /// Runs one write, says what happened, and re-reads the card. Never throws.
  Future<void> _send(
    StoreItemCopy copy,
    Future<void> Function() call, {
    required String doneKey,
    String offlineKey = 'needsConnection',
  }) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await call();
      _say(copy(doneKey));
      ref.invalidate(storeBrandsProvider);
      ref.invalidate(storeItemCardProvider(widget.item));
    } on SupabaseFailure catch (f) {
      _say(
        f.isConnectivity
            ? copy(offlineKey)
            : '${copy('failed')} ${f.error.message}',
      );
    } on Object {
      _say(
        copy(
          offlineKey == 'photoNeedsConnection'
              ? 'photoFailed'
              : 'needsConnection',
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _newId() => ref.read(inventoryIdFactoryProvider)();

  Future<void> _addPhoto(StoreItemCopy copy, StoreItemCard card) async {
    final StoreCatalogueEntry? cat = card.catalogue;
    if (cat == null) return;
    final bool? camera = await showModalBottomSheet<bool>(
      context: context,
      builder: (BuildContext context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            ListTile(
              key: const Key('storeItem.photo.camera'),
              leading: const Icon(Icons.photo_camera_outlined),
              title: Text(copy('camera')),
              onTap: () => Navigator.pop(context, true),
            ),
            ListTile(
              key: const Key('storeItem.photo.gallery'),
              leading: const Icon(Icons.photo_library_outlined),
              title: Text(copy('gallery')),
              onTap: () => Navigator.pop(context, false),
            ),
          ],
        ),
      ),
    );
    if (camera == null || !mounted) return;
    Uint8List? bytes;
    try {
      bytes = await ref.read(storeItemPhotoPickerProvider)(camera: camera);
    } on Object {
      _say(copy('photoFailed'));
      return;
    }
    if (bytes == null || bytes.isEmpty) return;
    final workspace = ref.read(workspaceContextProvider);
    final String? org = workspace?.tenantId ?? workspace?.companyId;
    if (org == null || org.isEmpty) {
      _say(copy('photoFailed'));
      return;
    }
    final Uint8List data = bytes;
    await _send(
      copy,
      () => ref.read(storeItemRepositoryProvider).addPhoto(
            orgId: org,
            canonicalId: cat.id,
            bytes: data,
            clientUuid: _newId(),
          ),
      doneKey: 'photoAdded',
      offlineKey: 'photoNeedsConnection',
    );
  }

  Future<void> _addPartNumber(StoreItemCopy copy, StoreItemCard card) async {
    final StoreCatalogueEntry? cat = card.catalogue;
    if (cat == null) return;
    final _FormResult? r = await _StoreForm.show(
      context,
      copy: copy,
      title: copy('addPartNumber'),
      fields: const <_Field>[
        _Field.brand,
        _Field.partNumber,
        _Field.manufacturer,
      ],
      initialBrand: card.brand,
    );
    if (r == null || !mounted) return;
    final String key = _newId();
    await _send(
      copy,
      () => ref.read(storeItemRepositoryProvider).addPartNumber(
            canonicalId: cat.id,
            brand: r.brand,
            partNumber: r.value,
            manufacturer: r.manufacturer,
            idempotencyKey: key,
          ),
      doneKey: 'partNumberSent',
    );
  }

  Future<void> _addBarcode(StoreItemCopy copy, StoreItemCard card) async {
    final StoreCatalogueEntry? cat = card.catalogue;
    if (cat == null) return;
    final _FormResult? r = await _StoreForm.show(
      context,
      copy: copy,
      title: copy('addBarcode'),
      fields: const <_Field>[_Field.numberType, _Field.barcode],
    );
    if (r == null || !mounted) return;
    final String key = _newId();
    await _send(
      copy,
      () => ref.read(storeItemRepositoryProvider).addReference(
            canonicalId: cat.id,
            aliasType: r.aliasType,
            value: r.value,
            reason: copy('defaultReason'),
            idempotencyKey: key,
          ),
      doneKey: 'barcodeSent',
    );
  }

  Future<void> _setBrand(StoreItemCopy copy, StoreItemCard card) async {
    final StoreCatalogueEntry? cat = card.catalogue;
    if (cat == null) return;
    final _FormResult? r = await _StoreForm.show(
      context,
      copy: copy,
      title: copy('setBrand'),
      fields: const <_Field>[_Field.brand, _Field.reason],
      initialBrand: card.brand,
    );
    if (r == null || !mounted) return;
    final String key = _newId();
    await _send(
      copy,
      () => ref.read(storeItemRepositoryProvider).correctBrand(
            targetKind: 'canonical',
            targetId: cat.id,
            brand: r.brand,
            reason: r.reason,
            idempotencyKey: key,
          ),
      doneKey: 'brandSent',
    );
  }

  Future<void> _propose(StoreItemCopy copy, StoreItemCard card) async {
    final _FormResult? r = await _StoreForm.show(
      context,
      copy: copy,
      title: copy('proposeTitle'),
      fields: const <_Field>[
        _Field.description,
        _Field.brandOptional,
        _Field.partNumberOptional,
        _Field.barcodeOptional,
      ],
      initialDescription:
          card.name.isEmpty ? widget.item.description : card.name,
      initialBrand: card.brand,
    );
    if (r == null || !mounted) return;
    final String key = _newId();
    await _send(
      copy,
      () => ref.read(storeItemRepositoryProvider).proposeCatalogueEntry(
            item: widget.item,
            description: r.description,
            brand: r.brand.isEmpty ? null : r.brand,
            partNumber: r.value.isEmpty ? null : r.value,
            barcode: r.barcode.isEmpty ? null : r.barcode,
            idempotencyKey: key,
          ),
      doneKey: 'proposeSent',
    );
  }

  @override
  Widget build(BuildContext context) {
    final StoreItemCopy copy = StoreItemCopy.of(context);
    final AsyncValue<StoreItemCard> card =
        ref.watch(storeItemCardProvider(widget.item));
    final StoreItemPermissions perms =
        ref.watch(storeItemPermissionsProvider).asData?.value ??
            const StoreItemPermissions();
    return TpScaffold(
      appBar: TpAppBar(
        title: copy('title'),
        actions: <Widget>[
          // Reorder levels and receiving stock live on the line's detail.
          IconButton(
            key: const Key('storeItem.levels'),
            tooltip: copy('levelsReceive'),
            icon: const Icon(Icons.tune_rounded),
            onPressed: () => unawaited(
              Navigator.of(context)
                  .push(StockItemDetailScreen.route(widget.item))
                  .then((_) => _reload()),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: switch (card) {
          AsyncData<StoreItemCard>(:final value) =>
            _content(copy, value, perms),
          AsyncError<StoreItemCard>(:final error) => ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: <Widget>[
                TpErrorState(
                  key: const Key('storeItem.error'),
                  error: switch (error) {
                    final SupabaseFailure f => f.error,
                    _ => AppError(
                        kind: AppErrorKind.unknown,
                        message: copy('loadFailed'),
                        cause: error,
                        isRetryable: true,
                      ),
                  },
                  onRetry: () =>
                      ref.invalidate(storeItemCardProvider(widget.item)),
                ),
              ],
            ),
          _ => const TpLoadingState(key: Key('storeItem.loading')),
        },
      ),
    );
  }

  Widget _content(
    StoreItemCopy copy,
    StoreItemCard card,
    StoreItemPermissions perms,
  ) {
    final TextTheme text = Theme.of(context).textTheme;
    final bool linked = card.linked;
    final bool can = perms.canPropose && !_busy;
    Widget section(String title, {Widget? action}) => Padding(
          padding: const EdgeInsets.only(top: TpSpace.lg, bottom: TpSpace.sm),
          // A Wrap, not a Row: on a narrow phone (or a long Arabic / Urdu
          // label) the action drops under the title instead of overflowing.
          child: Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            runSpacing: TpSpace.xs,
            children: <Widget>[
              Text(title, style: text.titleMedium),
              if (action != null) action,
            ],
          ),
        );
    Widget addButton(String key, String label, VoidCallback onPressed) =>
        TextButton.icon(
          key: Key(key),
          onPressed: _busy ? null : onPressed,
          icon: const Icon(Icons.add_rounded),
          label: Text(label),
        );
    return ListView(
      key: const Key('storeItem.content'),
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.md,
        TpSpace.lg,
        TpSpace.xxxl,
      ),
      children: <Widget>[
        _Photos(
          photos: card.photos,
          copy: copy,
          onAdd: linked && perms.canPropose
              ? () => unawaited(_addPhoto(copy, card))
              : null,
          busy: _busy,
        ),
        const SizedBox(height: TpSpace.md),
        _Identity(
          card: card,
          copy: copy,
          onSetBrand:
              linked && can ? () => unawaited(_setBrand(copy, card)) : null,
        ),
        if (!linked) ...<Widget>[
          const SizedBox(height: TpSpace.md),
          TpCard(
            key: const Key('storeItem.notLinked'),
            padding: const EdgeInsets.all(TpSpace.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  copy('notLinked'),
                  style: text.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: TpSpace.xs),
                Text(copy('notLinkedBody')),
                if (perms.canPropose) ...<Widget>[
                  const SizedBox(height: TpSpace.sm),
                  FilledButton.icon(
                    key: const Key('storeItem.propose'),
                    onPressed:
                        can ? () => unawaited(_propose(copy, card)) : null,
                    icon: const Icon(Icons.playlist_add_rounded),
                    label: Text(copy('propose')),
                  ),
                ],
              ],
            ),
          ),
        ],
        section(
          copy('whereItIs'),
          action: perms.canTransfer
              ? TextButton.icon(
                  key: const Key('storeItem.moveBin'),
                  onPressed: () => unawaited(
                    Navigator.of(context).push(TransfersScreen.route()),
                  ),
                  icon: const Icon(Icons.swap_horiz_rounded),
                  label: Text(copy('moveBin')),
                )
              : null,
        ),
        _Bins(card: card, copy: copy),
        section(
          copy('partNumbers'),
          action: linked && perms.canPropose
              ? addButton(
                  'storeItem.addPartNumber',
                  copy('addPartNumber'),
                  () => unawaited(_addPartNumber(copy, card)),
                )
              : null,
        ),
        if (card.partNumbers.isEmpty)
          Text(copy('noPartNumbers'), key: const Key('storeItem.noParts'))
        else
          for (final StorePartNumber p in card.partNumbers)
            _RefRow(
              key: Key('storeItem.part.${p.id}'),
              title: <String?>[p.brand, p.partNumber]
                  .whereType<String>()
                  .join(' · '),
              subtitle: p.manufacturer,
              verified: p.verified,
              copy: copy,
            ),
        section(
          copy('barcodes'),
          action: linked && perms.canPropose
              ? addButton(
                  'storeItem.addBarcode',
                  copy('addBarcode'),
                  () => unawaited(_addBarcode(copy, card)),
                )
              : null,
        ),
        if (card.barcodes.isEmpty && card.otherNumbers.isEmpty)
          Text(copy('noBarcodes'), key: const Key('storeItem.noBarcodes'))
        else
          for (final StoreItemReference r in <StoreItemReference>[
            ...card.barcodes,
            ...card.otherNumbers,
          ])
            _RefRow(
              title: r.value,
              subtitle: copy(
                switch (r.type) {
                  'barcode' => 'typeBarcode',
                  'oem' => 'typeOem',
                  _ => 'typeAlternative',
                },
              ),
              verified: r.verified,
              copy: copy,
            ),
        if (card.pendingChanges.isNotEmpty) ...<Widget>[
          section(copy('pendingChanges')),
          for (final StorePendingChange c in card.pendingChanges)
            _RefRow(
              title: c.newValue,
              subtitle: c.topic,
              verified: false,
              copy: copy,
            ),
        ],
        section(copy('recent')),
        ..._movements(),
      ],
    );
  }

  List<Widget> _movements() {
    final StoreHistoryCopy copy = StoreHistoryCopy.of(context);
    final List<StockMovement> rows = _pager.rows;
    if (rows.isEmpty && _pager.loading) {
      return const <Widget>[SizedBox(height: 120, child: TpLoadingState())];
    }
    final Object? error = _pager.error;
    if (rows.isEmpty && error != null) {
      if (error is SupabaseFailure && error.isConnectivity) {
        return <Widget>[
          TpEmptyState(
            key: const Key('storeItem.movementsOffline'),
            icon: Icons.cloud_off_rounded,
            title: StockCountCopy.of(context)('movementsOffline'),
            actionLabel: AppLocalizations.of(context).actionRetry,
            onAction: () => unawaited(_pager.refresh(_query)),
          ),
        ];
      }
      return <Widget>[
        TpErrorState(
          error: stockHistoryAppError(error, copy),
          onRetry: () => unawaited(_pager.refresh(_query)),
        ),
      ];
    }
    if (rows.isEmpty) {
      return <Widget>[Text(copy('noMovements'))];
    }
    final List<num?> balances =
        resolveBalances(rows, currentQuantity: widget.item.quantity);
    return <Widget>[
      for (int i = 0; i < rows.length; i++) ...<Widget>[
        StockMovementTile(movement: rows[i], balance: balances[i], copy: copy),
        const SizedBox(height: TpSpace.sm),
      ],
    ];
  }
}

class _Photos extends ConsumerWidget {
  const _Photos({
    required this.photos,
    required this.copy,
    required this.onAdd,
    required this.busy,
  });
  final List<String> photos;
  final StoreItemCopy copy;
  final VoidCallback? onAdd;
  final bool busy;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpPalette palette = TpPalette.of(context);
    final Widget add = onAdd == null
        ? const SizedBox.shrink()
        : OutlinedButton.icon(
            key: const Key('storeItem.addPhoto'),
            onPressed: busy ? null : onAdd,
            icon: const Icon(Icons.add_a_photo_outlined),
            label: Text(copy('addPhoto')),
          );
    if (photos.isEmpty) {
      return TpCard(
        key: const Key('storeItem.noPhoto'),
        padding: const EdgeInsets.all(TpSpace.md),
        child: Column(
          children: <Widget>[
            Icon(Icons.image_outlined, size: 48, color: palette.textSecondary),
            const SizedBox(height: TpSpace.xs),
            Text(
              copy('noPhoto'),
              style: TextStyle(color: palette.textSecondary),
            ),
            const SizedBox(height: TpSpace.sm),
            add,
          ],
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        SizedBox(
          height: 200,
          child: PageView.builder(
            key: const Key('storeItem.photos'),
            itemCount: photos.length,
            itemBuilder: (BuildContext context, int i) => Padding(
              padding: const EdgeInsets.symmetric(horizontal: TpSpace.xs),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: _SignedImage(reference: photos[i]),
              ),
            ),
          ),
        ),
        if (onAdd != null) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          Align(alignment: AlignmentDirectional.centerStart, child: add),
        ],
      ],
    );
  }
}

class _SignedImage extends ConsumerWidget {
  const _SignedImage({required this.reference, super.key});
  final String reference;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpPalette palette = TpPalette.of(context);
    return ref.watch(privateStorageImageUrlProvider(reference)).when(
          data: (String url) => Image.network(
            url,
            fit: BoxFit.cover,
            errorBuilder: (_, __, ___) => _broken(palette),
          ),
          loading: () => ColoredBox(
            color: palette.surfaceSunken,
            child:
                const Center(child: CircularProgressIndicator(strokeWidth: 2)),
          ),
          error: (_, __) => _broken(palette),
        );
  }

  Widget _broken(TpPalette palette) => ColoredBox(
        color: palette.surfaceSunken,
        child: Center(
          child:
              Icon(Icons.broken_image_outlined, color: palette.textSecondary),
        ),
      );
}

class _Identity extends StatelessWidget {
  const _Identity({
    required this.card,
    required this.copy,
    required this.onSetBrand,
  });
  final StoreItemCard card;
  final StoreItemCopy copy;
  final VoidCallback? onSetBrand;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    Widget fact(String key, String label, String? value) => SizedBox(
          width: 140,
          child: Column(
            key: Key('storeItem.fact.$key'),
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                label,
                style: text.bodySmall?.copyWith(color: palette.textSecondary),
              ),
              Text(value ?? '-', style: text.titleSmall),
            ],
          ),
        );
    final StoreCatalogueEntry? cat = card.catalogue;
    return TpCard(
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            card.name.isEmpty ? copy('title') : card.name,
            style: text.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          if (cat != null && cat.pending) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            TpStatusChip(
              status: TpStatus.warning,
              label: copy('pendingApproval'),
              isCompact: true,
            ),
          ],
          const SizedBox(height: TpSpace.sm),
          Wrap(
            spacing: TpSpace.md,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              fact('sku', copy('companySku'), cat?.companySku),
              fact('code', copy('itemCode'), card.itemCode),
              fact('brand', copy('brand'), card.brand ?? copy('noBrand')),
              fact('category', copy('category'), card.category),
              if (card.uom != null) fact('uom', copy('unit'), card.uom),
            ],
          ),
          if (onSetBrand != null)
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TextButton.icon(
                key: const Key('storeItem.setBrand'),
                onPressed: onSetBrand,
                icon: const Icon(Icons.edit_outlined),
                label: Text(copy('setBrand')),
              ),
            ),
        ],
      ),
    );
  }
}

class _Bins extends StatelessWidget {
  const _Bins({required this.card, required this.copy});
  final StoreItemCard card;
  final StoreItemCopy copy;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return TpCard(
      key: const Key('storeItem.bins'),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (final StoreItemBin b in card.bins)
            Padding(
              key: Key('storeItem.bin.${b.stockId}'),
              padding: const EdgeInsets.only(bottom: TpSpace.sm),
              child: Row(
                children: <Widget>[
                  Icon(Icons.shelves, size: 20, color: palette.textSecondary),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          b.locationCode ?? copy('noBin'),
                          style: text.titleSmall,
                        ),
                        Text(
                          <String?>[b.site, b.condition]
                              .whereType<String>()
                              .join(' · '),
                          style: text.bodySmall
                              ?.copyWith(color: palette.textSecondary),
                        ),
                      ],
                    ),
                  ),
                  Text(formatQty(b.quantity), style: text.titleMedium),
                ],
              ),
            ),
          const Divider(),
          Wrap(
            spacing: TpSpace.lg,
            runSpacing: TpSpace.xs,
            children: <Widget>[
              Text(
                '${copy('total')}: ${formatQty(card.totalQuantity)}',
                key: const Key('storeItem.total'),
                style: text.titleSmall,
              ),
              Text('${copy('reserved')}: ${formatQty(card.totalReserved)}'),
              Text('${copy('available')}: ${formatQty(card.totalAvailable)}'),
            ],
          ),
        ],
      ),
    );
  }
}

class _RefRow extends StatelessWidget {
  const _RefRow({
    required this.title,
    required this.verified,
    required this.copy,
    this.subtitle,
    super.key,
  });
  final String title;
  final String? subtitle;
  final bool verified;
  final StoreItemCopy copy;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.sm),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(title, style: Theme.of(context).textTheme.titleSmall),
                if (subtitle != null && subtitle!.isNotEmpty)
                  Text(
                    subtitle!,
                    style: TextStyle(color: palette.textSecondary),
                  ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          TpStatusChip(
            status: verified ? TpStatus.ok : TpStatus.warning,
            label: copy(verified ? 'verified' : 'pendingApproval'),
            isCompact: true,
          ),
        ],
      ),
    );
  }
}

/// The photo thumbnail for one stock line (the item's first catalogue
/// photo), or an icon when it has none. Reads [stockItemFacesProvider] with
/// the list's own [facesKey] so a whole list costs three queries.
class StockItemThumb extends ConsumerWidget {
  const StockItemThumb({
    required this.item,
    this.facesKey,
    this.size = 44,
    super.key,
  });
  final StockItem item;

  /// [stockFacesKey] of the list the line is in; null reads this line alone.
  final String? facesKey;
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpPalette palette = TpPalette.of(context);
    final String? itemId = item.itemId;
    final String key = facesKey ?? stockFacesKey(<StockItem>[item]);
    final String? photo = itemId == null
        ? null
        : ref.watch(stockItemFacesProvider(key)).asData?.value[itemId]?.photo;
    return SizedBox.square(
      dimension: size,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: photo == null
            ? ColoredBox(
                key: Key('stock.thumb.icon.${item.id}'),
                color: palette.surfaceSunken,
                child: Icon(
                  Icons.inventory_2_outlined,
                  size: size * 0.5,
                  color: palette.textSecondary,
                ),
              )
            : _SignedImage(
                key: Key('stock.thumb.photo.${item.id}'),
                reference: photo,
              ),
      ),
    );
  }
}

/// The brand for one stock line from the same batch read, or null.
String? stockItemBrand(WidgetRef ref, StockItem item, {String? facesKey}) {
  final String? itemId = item.itemId;
  if (itemId == null) return null;
  return ref
      .watch(
        stockItemFacesProvider(facesKey ?? stockFacesKey(<StockItem>[item])),
      )
      .asData
      ?.value[itemId]
      ?.brand;
}

enum _Field {
  brand,
  brandOptional,
  partNumber,
  partNumberOptional,
  manufacturer,
  numberType,
  barcode,
  barcodeOptional,
  reason,
  description,
}

final class _FormResult {
  const _FormResult({
    this.brand = '',
    this.value = '',
    this.manufacturer,
    this.aliasType = 'barcode',
    this.barcode = '',
    this.reason = '',
    this.description = '',
  });
  final String brand;

  /// The part number, or the barcode / number for an add-barcode form.
  final String value;
  final String? manufacturer;
  final String aliasType;
  final String barcode;
  final String reason;
  final String description;
}

/// One bottom-sheet form for every card action. The brand field searches
/// the company's shared brand list as the person types and offers the typed
/// name as a NEW brand when it is not in the list.
class _StoreForm extends ConsumerStatefulWidget {
  const _StoreForm({
    required this.copy,
    required this.title,
    required this.fields,
    this.initialBrand,
    this.initialDescription,
  });
  final StoreItemCopy copy;
  final String title;
  final List<_Field> fields;
  final String? initialBrand;
  final String? initialDescription;

  static Future<_FormResult?> show(
    BuildContext context, {
    required StoreItemCopy copy,
    required String title,
    required List<_Field> fields,
    String? initialBrand,
    String? initialDescription,
  }) =>
      showModalBottomSheet<_FormResult>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (BuildContext context) => _StoreForm(
          copy: copy,
          title: title,
          fields: fields,
          initialBrand: initialBrand,
          initialDescription: initialDescription,
        ),
      );

  @override
  ConsumerState<_StoreForm> createState() => _StoreFormState();
}

class _StoreFormState extends ConsumerState<_StoreForm> {
  late final TextEditingController _brand =
      TextEditingController(text: widget.initialBrand ?? '');
  final TextEditingController _value = TextEditingController();
  final TextEditingController _manufacturer = TextEditingController();
  final TextEditingController _barcode = TextEditingController();
  final TextEditingController _reason = TextEditingController();
  late final TextEditingController _description =
      TextEditingController(text: widget.initialDescription ?? '');
  String _aliasType = 'barcode';
  String? _problem;

  bool _has(_Field f) => widget.fields.contains(f);

  @override
  void dispose() {
    for (final TextEditingController c in <TextEditingController>[
      _brand,
      _value,
      _manufacturer,
      _barcode,
      _reason,
      _description,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _scan(TextEditingController target) async {
    final String? code = await showAssetCameraScanner(context);
    if (code != null && code.trim().isNotEmpty && mounted) {
      setState(() => target.text = code.trim());
    }
  }

  void _submit() {
    final StoreItemCopy copy = widget.copy;
    final String brand = _brand.text.trim();
    final String? issue = switch (true) {
      _ when _has(_Field.description) && _description.text.trim().length < 2 =>
        copy('descriptionRequired'),
      _ when _has(_Field.brand) && brand.isEmpty => copy('brandRequired'),
      _ when _has(_Field.partNumber) && _value.text.trim().isEmpty =>
        copy('partNumberRequired'),
      _ when _has(_Field.barcode) && _barcode.text.trim().isEmpty =>
        copy('valueRequired'),
      _ when _has(_Field.reason) && _reason.text.trim().length < 3 =>
        copy('reasonRequired'),
      _ => null,
    };
    if (issue != null) {
      setState(() => _problem = issue);
      return;
    }
    Navigator.pop(
      context,
      _FormResult(
        brand: brand,
        value: _has(_Field.barcode) ? _barcode.text.trim() : _value.text.trim(),
        manufacturer: _manufacturer.text.trim(),
        aliasType: _aliasType,
        barcode: _barcode.text.trim(),
        reason: _reason.text.trim(),
        description: _description.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final StoreItemCopy copy = widget.copy;
    final EdgeInsets inset = MediaQuery.viewInsetsOf(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.md,
        TpSpace.lg,
        TpSpace.lg + inset.bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(widget.title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: TpSpace.md),
            if (_has(_Field.description))
              TextField(
                key: const Key('storeItem.field.description'),
                controller: _description,
                decoration: InputDecoration(labelText: copy('description')),
              ),
            if (_has(_Field.brand) || _has(_Field.brandOptional)) _brandField(),
            if (_has(_Field.numberType))
              Padding(
                padding: const EdgeInsets.only(bottom: TpSpace.sm),
                child: Wrap(
                  key: const Key('storeItem.field.type'),
                  spacing: TpSpace.xs,
                  runSpacing: TpSpace.xs,
                  children: <Widget>[
                    for (final (String value, String label)
                        in <(String, String)>[
                      ('barcode', 'typeBarcode'),
                      ('oem', 'typeOem'),
                      ('alternative', 'typeAlternative'),
                    ])
                      ChoiceChip(
                        key: Key('storeItem.type.$value'),
                        label: Text(copy(label)),
                        selected: _aliasType == value,
                        onSelected: (_) => setState(() => _aliasType = value),
                      ),
                  ],
                ),
              ),
            if (_has(_Field.partNumber) || _has(_Field.partNumberOptional))
              TextField(
                key: const Key('storeItem.field.partNumber'),
                controller: _value,
                decoration: InputDecoration(labelText: copy('partNumber')),
              ),
            if (_has(_Field.manufacturer))
              TextField(
                key: const Key('storeItem.field.manufacturer'),
                controller: _manufacturer,
                decoration: InputDecoration(labelText: copy('manufacturer')),
              ),
            if (_has(_Field.barcode) || _has(_Field.barcodeOptional))
              TextField(
                key: const Key('storeItem.field.barcode'),
                controller: _barcode,
                decoration: InputDecoration(
                  labelText: copy('barcode'),
                  suffixIcon: IconButton(
                    key: const Key('storeItem.scan'),
                    tooltip: copy('scan'),
                    icon: const Icon(Icons.qr_code_scanner_rounded),
                    onPressed: () => unawaited(_scan(_barcode)),
                  ),
                ),
              ),
            if (_has(_Field.reason))
              TextField(
                key: const Key('storeItem.field.reason'),
                controller: _reason,
                decoration: InputDecoration(labelText: copy('reason')),
              ),
            if (_problem != null) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              Text(
                _problem!,
                key: const Key('storeItem.problem'),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: TpSpace.md),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: <Widget>[
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: Text(copy('cancel')),
                ),
                const SizedBox(width: TpSpace.sm),
                FilledButton(
                  key: const Key('storeItem.send'),
                  onPressed: _submit,
                  child: Text(copy('send')),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _brandField() {
    final StoreItemCopy copy = widget.copy;
    final AsyncValue<List<String>> brands = ref.watch(storeBrandsProvider);
    final List<String> all = brands.asData?.value ?? const <String>[];
    final String typed = _brand.text.trim();
    final bool isNew = typed.isNotEmpty &&
        !all.any((String b) => b.toLowerCase() == typed.toLowerCase());
    // A brand already picked (or prefilled) shows the whole list again, so
    // the person can switch to another one without clearing the field.
    final List<String> matches =
        filterBrands(all, isNew ? typed : '').take(12).toList();
    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          TextField(
            key: const Key('storeItem.field.brand'),
            controller: _brand,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: copy('brand'),
              hintText: copy('searchBrand'),
              prefixIcon: const Icon(Icons.search_rounded),
            ),
          ),
          if (brands.hasError)
            Text(
              copy('brandsFailed'),
              key: const Key('storeItem.brandsFailed'),
            ),
          const SizedBox(height: TpSpace.xs),
          Wrap(
            spacing: TpSpace.xs,
            runSpacing: TpSpace.xs,
            children: <Widget>[
              for (final String b in matches)
                ChoiceChip(
                  key: Key('storeItem.brand.$b'),
                  label: Text(b),
                  selected: b.toLowerCase() == typed.toLowerCase(),
                  onSelected: (_) => setState(() => _brand.text = b),
                ),
              if (isNew)
                ActionChip(
                  key: const Key('storeItem.newBrand'),
                  avatar: const Icon(Icons.add_rounded, size: 18),
                  label: Text('${copy('newBrand')}: $typed'),
                  onPressed: () => setState(() {}),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
