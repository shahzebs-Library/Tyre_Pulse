library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/rca/data/rca_photo_capture.dart';
import 'package:tyre_pulse/features/rca/data/rca_repository.dart';
import 'package:tyre_pulse/features/rca/domain/rca_record.dart';
import 'package:tyre_pulse/features/rca/presentation/rca_copy.dart';
import 'package:tyre_pulse/features/rca/rca_providers.dart';

class RcaScreen extends ConsumerStatefulWidget {
  const RcaScreen({required this.route, super.key});

  final RcaRoute route;

  @override
  ConsumerState<RcaScreen> createState() => _RcaScreenState();
}

class _RcaScreenState extends ConsumerState<RcaScreen> {
  bool _openedPrefill = false;

  @override
  Widget build(BuildContext context) {
    final RcaCopy copy = RcaCopy.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final AsyncValue<List<RcaRecord>> rows = ref.watch(rcaRecordsProvider);
    if (!_openedPrefill &&
        (widget.route.assetNo != null || widget.route.tyreSerial != null)) {
      _openedPrefill = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_openForm(copy));
      });
    }
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: copy('title'),
        subtitle: switch (rows) {
          AsyncData<List<RcaRecord>>(:final value) =>
            '${value.length} ${copy('records')}',
          _ => null,
        },
        backFallback: fallback,
        actions: <Widget>[
          IconButton(
            key: const Key('rca.add'),
            tooltip: copy('newRecord'),
            onPressed: () => unawaited(_openForm(copy)),
            icon: const Icon(Icons.add_rounded),
          ),
        ],
      ),
      body: rows.when(
        loading: () => const TpLoadingState(),
        error: (Object error, StackTrace stackTrace) => TpErrorState(
          error: switch (error) {
            final SupabaseFailure failure => failure.error,
            final AppError appError => appError,
            _ => AppError(
                kind: AppErrorKind.unknown,
                message: copy('loadFailed'),
                cause: error,
                isRetryable: true,
              ),
          },
          onRetry: () => ref.invalidate(rcaRecordsProvider),
        ),
        data: (List<RcaRecord> records) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(rcaRecordsProvider);
            await ref.read(rcaRecordsProvider.future);
          },
          child: records.isEmpty
              ? ListView(
                  key: const Key('rca.empty'),
                  physics: const AlwaysScrollableScrollPhysics(),
                  children: <Widget>[
                    SizedBox(
                      height: MediaQuery.sizeOf(context).height * 0.58,
                      child: TpEmptyState(
                        icon: Icons.account_tree_outlined,
                        title: copy('none'),
                        message: copy('noneBody'),
                      ),
                    ),
                  ],
                )
              : ListView.separated(
                  key: const Key('rca.list'),
                  padding: const EdgeInsets.all(TpSpace.lg),
                  itemCount: records.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: TpSpace.sm),
                  itemBuilder: (BuildContext context, int index) =>
                      _RcaCard(record: records[index], copy: copy),
                ),
        ),
      ),
    );
  }

  Future<void> _openForm(RcaCopy copy) async {
    final bool? saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (BuildContext context) => _RcaFormSheet(
        route: widget.route,
        copy: copy,
      ),
    );
    if (saved == true) ref.invalidate(rcaRecordsProvider);
  }
}

class _RcaCard extends StatelessWidget {
  const _RcaCard({required this.record, required this.copy});
  final RcaRecord record;
  final RcaCopy copy;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final List<String> meta = <String>[
      if (record.site != null) record.site!,
      if (record.failureDate != null) record.failureDate!,
      if (record.kmAtFailure != null) '${record.kmAtFailure} km',
    ];
    return TpCard(
      key: Key('rca.row.${record.id}'),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          CircleAvatar(
            backgroundColor: palette.primary.withValues(alpha: 0.12),
            foregroundColor: palette.primary,
            child: const Icon(Icons.account_tree_outlined),
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                TpIdentifierText(
                  <String>[
                    record.assetNo ?? copy('unknown'),
                    if (record.brand != null) record.brand!,
                  ].join(' / '),
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                if (record.rootCause != null) ...<Widget>[
                  const SizedBox(height: TpSpace.xs),
                  Text(record.rootCause!, maxLines: 3),
                ],
                if (record.contributingFactors.isNotEmpty) ...<Widget>[
                  const SizedBox(height: TpSpace.sm),
                  Wrap(
                    spacing: TpSpace.xs,
                    runSpacing: TpSpace.xs,
                    children: <Widget>[
                      for (final String factor
                          in record.contributingFactors.take(3))
                        Chip(
                          visualDensity: VisualDensity.compact,
                          label: Text(factor),
                        ),
                    ],
                  ),
                ],
                if (meta.isNotEmpty) ...<Widget>[
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    meta.join(' / '),
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(color: palette.textMuted),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RcaFormSheet extends ConsumerStatefulWidget {
  const _RcaFormSheet({required this.route, required this.copy});
  final RcaRoute route;
  final RcaCopy copy;

  @override
  ConsumerState<_RcaFormSheet> createState() => _RcaFormSheetState();
}

class _RcaFormSheetState extends ConsumerState<_RcaFormSheet> {
  late final TextEditingController asset =
      TextEditingController(text: widget.route.assetNo?.value ?? '');
  late final TextEditingController serial =
      TextEditingController(text: widget.route.tyreSerial?.value ?? '');
  late final TextEditingController brand =
      TextEditingController(text: widget.route.brand ?? '');
  late final TextEditingController site =
      TextEditingController(text: widget.route.siteName?.value ?? '');
  final TextEditingController km = TextEditingController();
  final TextEditingController cause = TextEditingController();
  final Set<String> factors = <String>{};
  final List<String> photos = <String>[];
  bool saving = false;

  @override
  void dispose() {
    for (final TextEditingController controller in <TextEditingController>[
      asset,
      serial,
      brand,
      site,
      km,
      cause,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final RcaCopy copy = widget.copy;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.md,
        TpSpace.lg,
        MediaQuery.viewInsetsOf(context).bottom + TpSpace.lg,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    copy('newRecord'),
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
            _RcaInput(
              controller: asset,
              label: copy('asset'),
              keyName: 'asset',
            ),
            _RcaInput(
              controller: serial,
              label: copy('serial'),
              keyName: 'serial',
            ),
            _RcaInput(
              controller: brand,
              label: copy('brand'),
              keyName: 'brand',
            ),
            _RcaInput(
              controller: site,
              label: copy('site'),
              keyName: 'site',
            ),
            _RcaInput(
              controller: km,
              label: copy('km'),
              keyName: 'km',
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
            ),
            const SizedBox(height: TpSpace.md),
            Text(
              copy('factors'),
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: TpSpace.sm),
            Wrap(
              spacing: TpSpace.xs,
              runSpacing: TpSpace.xs,
              children: <Widget>[
                for (final String factor in RcaFactor.all)
                  FilterChip(
                    key: Key('rca.factor.$factor'),
                    label: Text(factor),
                    selected: factors.contains(factor),
                    onSelected: (_) => setState(() {
                      if (!factors.add(factor)) factors.remove(factor);
                    }),
                  ),
              ],
            ),
            _RcaInput(
              controller: cause,
              label: copy('rootCause'),
              keyName: 'cause',
              minLines: 3,
            ),
            const SizedBox(height: TpSpace.md),
            Text(
              copy('photos'),
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: TpSpace.sm),
            Wrap(
              spacing: TpSpace.xs,
              runSpacing: TpSpace.xs,
              children: <Widget>[
                for (int i = 0; i < photos.length; i++)
                  InputChip(
                    label: Text('${copy('photo')} ${i + 1}'),
                    onDeleted: () => setState(() => photos.removeAt(i)),
                  ),
                if (photos.length < RcaPhotoCapture.maxPhotos)
                  ActionChip(
                    key: const Key('rca.addPhoto'),
                    avatar: const Icon(Icons.add_a_photo_outlined, size: 18),
                    label: Text(copy('addPhoto')),
                    onPressed: () => unawaited(_addPhoto(copy)),
                  ),
              ],
            ),
            const SizedBox(height: TpSpace.xl),
            FilledButton(
              key: const Key('rca.submit'),
              onPressed: saving ? null : () => unawaited(_save(copy)),
              child: Text(copy('save')),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _save(RcaCopy copy) async {
    if (cause.text.trim().isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(copy('missingCause'))));
      return;
    }
    final workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return;
    final String normalizedKm = km.text.trim().replaceAll(',', '');
    final num? reading =
        normalizedKm.isEmpty ? null : num.tryParse(normalizedKm);
    if (normalizedKm.isNotEmpty && reading == null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(copy('invalidKm'))));
      return;
    }
    setState(() => saving = true);
    try {
      await ref.read(rcaRepositoryProvider).submit(
            workspace: workspace,
            input: SubmitRcaInput(
              rootCause: cause.text,
              assetNo: asset.text,
              tyreSerial: serial.text,
              brand: brand.text,
              site: site.text,
              kmAtFailure: reading,
              contributingFactors: factors.toList(growable: false),
              photoLocalPaths: List<String>.unmodifiable(photos),
            ),
          );
      if (mounted) Navigator.pop(context, true);
    } on Object {
      if (mounted) {
        setState(() => saving = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(copy('saveFailed'))));
      }
    }
  }

  Future<void> _addPhoto(RcaCopy copy) async {
    final RcaPhotoSource? source = await showModalBottomSheet<RcaPhotoSource>(
      context: context,
      builder: (BuildContext context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: Text(copy('camera')),
              onTap: () => Navigator.pop(context, RcaPhotoSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: Text(copy('gallery')),
              onTap: () => Navigator.pop(context, RcaPhotoSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;
    try {
      final String? path =
          await ref.read(rcaPhotoCaptureProvider).captureAndStore(
                sessionKey: identityHashCode(this).toString(),
                index: photos.length,
                source: source,
              );
      if (path != null && mounted) setState(() => photos.add(path));
    } on Object {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(copy('photoFailed'))));
      }
    }
  }
}

class _RcaInput extends StatelessWidget {
  const _RcaInput({
    required this.controller,
    required this.label,
    required this.keyName,
    this.keyboardType,
    this.minLines = 1,
  });
  final TextEditingController controller;
  final String label;
  final String keyName;
  final TextInputType? keyboardType;
  final int minLines;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: TpSpace.md),
        child: TextField(
          key: Key('rca.$keyName'),
          controller: controller,
          keyboardType: keyboardType,
          minLines: minLines,
          maxLines: minLines == 1 ? 1 : 6,
          decoration: InputDecoration(labelText: label),
        ),
      );
}
