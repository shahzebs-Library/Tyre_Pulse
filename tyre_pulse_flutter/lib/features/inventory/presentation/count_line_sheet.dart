/// The editor for one count line: quantity (big stepper or keypad),
/// explicit confirmed zero, condition, photos and remarks.
///
/// It opens WITHOUT any number suggested. A pre-filled quantity is how a
/// "count" turns into a confirmation of the system figure; a blind count
/// starts empty.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_copy.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_widgets.dart';

@immutable
final class CountLineEdit {
  const CountLineEdit(this.line, {this.remove = false});
  final CountLine line;
  final bool remove;
}

/// Why a line cannot be saved yet, as a copy key, or null when it can.
String? countLineProblem({required num? qty, required bool confirmedZero}) {
  if (confirmedZero) return null;
  if (qty == null) return 'enterQty';
  if (qty < 0) return 'invalidQty';
  if (qty == 0) return 'confirmZeroFirst';
  return null;
}

Future<CountLineEdit?> showCountLineSheet({
  required BuildContext context,
  required CountLine line,
  required AuditCounterView view,
  required String auditId,
}) {
  return showModalBottomSheet<CountLineEdit>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (BuildContext context) =>
        _CountLineSheet(line: line, view: view, auditId: auditId),
  );
}

class _CountLineSheet extends ConsumerStatefulWidget {
  const _CountLineSheet({
    required this.line,
    required this.view,
    required this.auditId,
  });

  final CountLine line;
  final AuditCounterView view;
  final String auditId;

  @override
  ConsumerState<_CountLineSheet> createState() => _CountLineSheetState();
}

class _CountLineSheetState extends ConsumerState<_CountLineSheet> {
  late num? _qty = widget.line.countedQty;
  late bool _zero = widget.line.confirmedZero;
  late CountCondition _condition = widget.line.condition;
  late List<String> _photos = List<String>.of(widget.line.photoPaths);
  late final TextEditingController _remarks =
      TextEditingController(text: widget.line.remarks ?? '');
  late final TextEditingController _qtyText = TextEditingController(
    text: widget.line.countedQty?.toString() ?? '',
  );
  String? _problem;
  bool _capturing = false;

  @override
  void dispose() {
    _remarks.dispose();
    _qtyText.dispose();
    super.dispose();
  }

  void _setQty(num value) {
    setState(() {
      _qty = value;
      _zero = false;
      _qtyText.text = '$value';
      _problem = null;
    });
  }

  Future<void> _addPhoto() async {
    if (_capturing) return;
    setState(() => _capturing = true);
    try {
      final String? path = await ref.read(countPhotoCaptureProvider).capture(
            auditId: widget.auditId,
            clientUuid: widget.line.clientUuid,
          );
      if (path != null && mounted) {
        setState(() => _photos = <String>[..._photos, path]);
      }
    } on Object {
      if (mounted) {
        setState(() => _problem = 'photoFailed');
      }
    } finally {
      if (mounted) setState(() => _capturing = false);
    }
  }

  void _save() {
    final String? problem = countLineProblem(qty: _qty, confirmedZero: _zero);
    if (problem != null) {
      unawaited(HapticFeedback.heavyImpact());
      setState(() => _problem = problem);
      return;
    }
    Navigator.of(context).pop(
      CountLineEdit(
        widget.line.copyWith(
          countedQty: _zero ? 0 : _qty,
          confirmedZero: _zero,
          condition: _condition,
          photoPaths: _photos,
          remarks: _remarks.text,
          // The count happened now: a re-edit moves the counting moment,
          // which is what the server compares against the audit cutoff.
          countedAt: DateTime.now().toUtc(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final InventoryCopy copy = InventoryCopy.of(context);
    final ThemeData theme = Theme.of(context);
    final CountLine line = widget.line;
    AuditItemPrompt? prompt;
    for (final AuditItemPrompt p in widget.view.prompts) {
      if (p.itemId == line.itemId && p.locationId == line.locationId) {
        prompt = p;
      }
    }
    final bool serial = line.serialNo != null;
    return Padding(
      padding: EdgeInsets.only(
        left: TpSpace.lg,
        right: TpSpace.lg,
        top: TpSpace.md,
        bottom: MediaQuery.viewInsetsOf(context).bottom + TpSpace.lg,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              prompt?.description ?? line.serialNo ?? line.scannedCode,
              style: theme.textTheme.titleMedium,
            ),
            Text(
              <String>[
                if (prompt?.itemCode != null) prompt!.itemCode!,
                if (prompt?.uom != null) prompt!.uom!,
                if (line.unexpected) copy('unexpectedHint'),
              ].join(' · '),
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: TpSpace.md),
            if (!serial) ...<Widget>[
              InventoryQtyStepper(
                value: _zero ? 0 : _qty,
                copy: copy,
                onChanged: _setQty,
              ),
              const SizedBox(height: TpSpace.sm),
              TextField(
                key: const Key('inventory.line.qty'),
                controller: _qtyText,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: <TextInputFormatter>[
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                ],
                decoration: InputDecoration(labelText: copy('countedQty')),
                onChanged: (String v) => setState(() {
                  _qty = num.tryParse(v.trim());
                  _zero = false;
                  _problem = null;
                }),
              ),
              CheckboxListTile(
                key: const Key('inventory.line.confirmZero'),
                contentPadding: EdgeInsets.zero,
                value: _zero,
                title: Text(copy('confirmZero')),
                subtitle: Text(copy('confirmZeroHint')),
                onChanged: (bool? v) => setState(() {
                  _zero = v ?? false;
                  if (_zero) {
                    _qty = 0;
                    _qtyText.text = '0';
                  }
                  _problem = null;
                }),
              ),
            ] else
              Text(copy('serialOne')),
            const SizedBox(height: TpSpace.sm),
            DropdownButtonFormField<CountCondition>(
              key: const Key('inventory.line.condition'),
              initialValue: _condition,
              decoration: InputDecoration(labelText: copy('condition')),
              items: <DropdownMenuItem<CountCondition>>[
                for (final CountCondition c in CountCondition.values)
                  DropdownMenuItem<CountCondition>(
                    value: c,
                    child: Text(copy('condition_${c.wire}')),
                  ),
              ],
              onChanged: (CountCondition? c) =>
                  setState(() => _condition = c ?? _condition),
            ),
            const SizedBox(height: TpSpace.sm),
            TextField(
              key: const Key('inventory.line.remarks'),
              controller: _remarks,
              maxLines: 2,
              decoration: InputDecoration(labelText: copy('remarks')),
            ),
            const SizedBox(height: TpSpace.sm),
            Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.sm,
              children: <Widget>[
                for (final String path in _photos)
                  InputChip(
                    avatar: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: Image.file(
                        File(path),
                        width: 32,
                        height: 32,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) =>
                            const Icon(Icons.broken_image_outlined),
                      ),
                    ),
                    label: Text(copy('photo')),
                    onDeleted: () => setState(
                      () => _photos =
                          _photos.where((String p) => p != path).toList(),
                    ),
                  ),
                if (line.photoRefs.isNotEmpty)
                  Chip(
                    label: Text(copy.count('photosN', line.photoRefs.length)),
                  ),
                SizedBox(
                  height: inventoryTouchTarget,
                  child: OutlinedButton.icon(
                    key: const Key('inventory.line.photo'),
                    onPressed: _capturing ? null : () => unawaited(_addPhoto()),
                    icon: const Icon(Icons.add_a_photo_outlined),
                    label: Text(copy('addPhoto')),
                  ),
                ),
              ],
            ),
            if (_problem != null) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              Text(
                copy(_problem!),
                key: const Key('inventory.line.problem'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ],
            const SizedBox(height: TpSpace.md),
            Row(
              children: <Widget>[
                if (line.state != CountLineState.submitted)
                  SizedBox(
                    height: inventoryTouchTarget,
                    child: TextButton(
                      key: const Key('inventory.line.remove'),
                      onPressed: () => Navigator.of(context)
                          .pop(CountLineEdit(line, remove: true)),
                      child: Text(copy('removeLine')),
                    ),
                  ),
                const Spacer(),
                SizedBox(
                  height: inventoryTouchTarget,
                  child: FilledButton(
                    key: const Key('inventory.line.save'),
                    onPressed: _save,
                    child: Text(copy('saveLine')),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
