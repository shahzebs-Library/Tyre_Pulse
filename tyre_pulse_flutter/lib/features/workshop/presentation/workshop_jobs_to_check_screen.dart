/// "Jobs to check": a supervisor passes or returns a technician's finished
/// job on the phone, with everything the technician handed over - what was
/// done, parts, meters, before / after photos and the signature.
///
/// Two lists: To check (completions waiting for a decision) and Returned
/// (sent back, with the reason, for the data desk to reassign). The decision
/// is online only and goes through `decide_job_completion`, which enforces
/// the rules in the database: never your own job, one decision only, a
/// reason on every return.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_job_check_service.dart';
import 'package:tyre_pulse/features/workshop/presentation/workshop_copy.dart';
import 'package:tyre_pulse/features/workshop/workshop_providers.dart';

abstract final class WorkshopJobsToCheckKeys {
  static const Key screen = Key('workshop.jobsToCheck');
  static const Key tabToCheck = Key('workshop.jobsToCheck.tabToCheck');
  static const Key tabReturned = Key('workshop.jobsToCheck.tabReturned');
  static Key item(String id) => Key('workshop.jobsToCheck.item.$id');
  static const Key pass = Key('workshop.jobsToCheck.pass');
  static const Key returnJob = Key('workshop.jobsToCheck.return');
  static const Key returnNote = Key('workshop.jobsToCheck.returnNote');
  static const Key returnSend = Key('workshop.jobsToCheck.returnSend');
}

/// Opens the list. Pushed with [Navigator] from the Workshop board; the
/// router files are left as they are.
Future<void> openWorkshopJobsToCheck(BuildContext context) =>
    Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => const WorkshopJobsToCheckScreen(),
      ),
    );

class WorkshopJobsToCheckScreen extends ConsumerStatefulWidget {
  const WorkshopJobsToCheckScreen({super.key});

  @override
  ConsumerState<WorkshopJobsToCheckScreen> createState() =>
      _WorkshopJobsToCheckScreenState();
}

class _WorkshopJobsToCheckScreenState
    extends ConsumerState<WorkshopJobsToCheckScreen> {
  WorkshopCheckQueue _queue = WorkshopCheckQueue.toCheck;
  bool _loading = true;
  Object? _error;
  List<WorkshopCheckItem> _items = const <WorkshopCheckItem>[];

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final WorkshopCheckQueue queue = _queue;
    try {
      final List<WorkshopCheckItem> items =
          await ref.read(workshopJobCheckServiceProvider).list(queue);
      if (!mounted || queue != _queue) return;
      setState(() {
        _items = items;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted || queue != _queue) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  void _switch(WorkshopCheckQueue queue) {
    if (queue == _queue) return;
    setState(() => _queue = queue);
    unawaited(_load());
  }

  Future<void> _open(WorkshopCheckItem item) async {
    final bool? changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (_) => WorkshopJobCheckDetailScreen(item: item),
      ),
    );
    if (changed == true && mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final WorkshopCopy copy = WorkshopCopy.of(context);
    return TpScaffold(
      key: WorkshopJobsToCheckKeys.screen,
      backgroundColor: TpPalette.of(context).surface,
      appBar: TpAppBar(
        title: copy('jc_title'),
        subtitle: _loading ? null : '${_items.length}',
      ),
      body: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(
              TpSpace.lg,
              TpSpace.md,
              TpSpace.lg,
              TpSpace.sm,
            ),
            child: SegmentedButton<WorkshopCheckQueue>(
              showSelectedIcon: false,
              segments: <ButtonSegment<WorkshopCheckQueue>>[
                ButtonSegment<WorkshopCheckQueue>(
                  value: WorkshopCheckQueue.toCheck,
                  label: Text(
                    copy('jc_tabToCheck'),
                    key: WorkshopJobsToCheckKeys.tabToCheck,
                  ),
                ),
                ButtonSegment<WorkshopCheckQueue>(
                  value: WorkshopCheckQueue.returned,
                  label: Text(
                    copy('jc_tabReturned'),
                    key: WorkshopJobsToCheckKeys.tabReturned,
                  ),
                ),
              ],
              selected: <WorkshopCheckQueue>{_queue},
              onSelectionChanged: (Set<WorkshopCheckQueue> s) =>
                  _switch(s.first),
            ),
          ),
          Expanded(child: _body(copy)),
        ],
      ),
    );
  }

  Widget _body(WorkshopCopy copy) {
    if (_loading) return const TpLoadingState();
    final Object? error = _error;
    if (error != null) {
      final AppError appError = switch (error) {
        AppError() => error,
        SupabaseFailure() => error.error,
        _ => AppError(
            kind: AppErrorKind.unknown,
            message: copy('jc_loadError'),
            technical: error.toString(),
            cause: error,
            isRetryable: true,
          ),
      };
      return TpErrorState(error: appError, onRetry: _load);
    }
    if (_items.isEmpty) {
      return RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: <Widget>[
            const SizedBox(height: TpSpace.xxl),
            TpEmptyState(
              icon: Icons.fact_check_outlined,
              title: _queue == WorkshopCheckQueue.toCheck
                  ? copy('jc_emptyToCheck')
                  : copy('jc_emptyReturned'),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.sm,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        itemCount: _items.length,
        itemBuilder: (BuildContext context, int i) => _ItemCard(
          item: _items[i],
          copy: copy,
          onTap: () => unawaited(_open(_items[i])),
        ),
      ),
    );
  }
}

String _when(DateTime? at) {
  if (at == null) return '';
  String two(int v) => v.toString().padLeft(2, '0');
  return '${at.year}-${two(at.month)}-${two(at.day)} '
      '${two(at.hour)}:${two(at.minute)}';
}

class _ItemCard extends StatelessWidget {
  const _ItemCard({
    required this.item,
    required this.copy,
    required this.onTap,
  });

  final WorkshopCheckItem item;
  final WorkshopCopy copy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final bool returned = item.status == 'returned';
    return TpCard(
      key: WorkshopJobsToCheckKeys.item(item.id),
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  item.workOrderNo ?? item.jobId,
                  style: text.titleSmall,
                ),
              ),
              if (item.isExtra)
                TpStatusChip(
                  status: TpStatus.neutral,
                  label: copy('jc_extra'),
                  isCompact: true,
                )
              else if (returned)
                TpStatusChip(
                  status: TpStatus.warning,
                  label: copy('returned'),
                  isCompact: true,
                )
              else
                TpStatusChip(
                  status: TpStatus.info,
                  label: copy('jc_waiting'),
                  isCompact: true,
                ),
            ],
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            <String>[
              if (item.assetNo != null) item.assetNo!,
              if (item.site != null) item.site!,
              if (item.technicianName != null) item.technicianName!,
              _when(item.completedAt),
            ].where((String s) => s.isNotEmpty).join(' | '),
            style: text.bodySmall?.copyWith(color: palette.textSecondary),
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            returned && item.decisionNote != null
                ? '${copy('jc_returnReason')} ${item.decisionNote!}'
                : item.workDone,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: text.bodyMedium,
          ),
        ],
      ),
    );
  }
}

/// One completion, read in full, with Pass / Return for a waiting one.
class WorkshopJobCheckDetailScreen extends ConsumerStatefulWidget {
  const WorkshopJobCheckDetailScreen({required this.item, super.key});

  final WorkshopCheckItem item;

  @override
  ConsumerState<WorkshopJobCheckDetailScreen> createState() =>
      _WorkshopJobCheckDetailScreenState();
}

class _WorkshopJobCheckDetailScreenState
    extends ConsumerState<WorkshopJobCheckDetailScreen> {
  bool _busy = false;

  Future<void> _decide(String decision, {String? note}) async {
    if (_busy) return;
    final WorkshopCopy copy = WorkshopCopy.of(context);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    final NavigatorState nav = Navigator.of(context);
    setState(() => _busy = true);
    try {
      final WorkshopCheckDecision answer =
          await ref.read(workshopJobCheckServiceProvider).decide(
                completionId: widget.item.id,
                decision: decision,
                note: note,
              );
      if (!mounted) return;
      if (answer.ok) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              decision == 'pass' ? copy('jc_passed') : copy('jc_returnedOk'),
            ),
          ),
        );
        nav.pop(true);
        return;
      }
      messenger.showSnackBar(
        SnackBar(content: Text(answer.reason ?? copy('jc_decideError'))),
      );
    } on Object {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text(copy('jc_decideError'))),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _askReturn() async {
    final WorkshopCopy copy = WorkshopCopy.of(context);
    final String? note = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (BuildContext sheet) => _ReturnSheet(copy: copy),
    );
    if (note != null && note.trim().length >= 3) {
      await _decide('return', note: note.trim());
    }
  }

  @override
  Widget build(BuildContext context) {
    final WorkshopCopy copy = WorkshopCopy.of(context);
    final WorkshopCheckItem item = widget.item;
    final TextTheme text = Theme.of(context).textTheme;
    final TpPalette palette = TpPalette.of(context);
    final bool waiting = item.status == 'submitted';
    return TpScaffold(
      backgroundColor: palette.surface,
      appBar: TpAppBar(
        title: item.workOrderNo ?? copy('jc_title'),
        subtitle: item.assetNo,
      ),
      // The decision stays in reach while the evidence scrolls.
      bottomNavigationBar: waiting && !item.isExtra
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  TpSpace.lg,
                  TpSpace.sm,
                  TpSpace.lg,
                  TpSpace.sm,
                ),
                child: Row(
                  children: <Widget>[
                    Expanded(
                      child: TpButton.secondary(
                        key: WorkshopJobsToCheckKeys.returnJob,
                        label: copy('jc_return'),
                        icon: Icons.undo_rounded,
                        isFullWidth: true,
                        onPressed: _busy ? null : () => unawaited(_askReturn()),
                      ),
                    ),
                    const SizedBox(width: TpSpace.sm),
                    Expanded(
                      child: TpButton.primary(
                        key: WorkshopJobsToCheckKeys.pass,
                        label: copy('jc_pass'),
                        icon: Icons.check_circle_outline,
                        isBusy: _busy,
                        isFullWidth: true,
                        onPressed: () => unawaited(_decide('pass')),
                      ),
                    ),
                  ],
                ),
              ),
            )
          : null,
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.md,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          _Section(
            title: copy('jc_by'),
            child: Text(
              <String>[
                item.technicianName ?? '',
                _when(item.completedAt),
                if (item.site != null) item.site!,
              ].where((String s) => s.isNotEmpty).join(' | '),
              style: text.bodyMedium,
            ),
          ),
          if (item.status == 'returned' && item.decisionNote != null)
            _Section(
              title: copy('jc_returnReason'),
              child: Text(
                <String>[
                  item.decisionNote!,
                  if (item.decidedByName != null) '(${item.decidedByName})',
                ].join(' '),
                style: text.bodyMedium?.copyWith(color: palette.warning.base),
              ),
            ),
          _Section(
            title: copy('c_whatDone'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(item.workDone, style: text.bodyMedium),
                if (item.quickPicks.isNotEmpty) ...<Widget>[
                  const SizedBox(height: TpSpace.sm),
                  Wrap(
                    spacing: TpSpace.xs,
                    runSpacing: TpSpace.xs,
                    children: <Widget>[
                      for (final String p in item.quickPicks)
                        TpStatusChip(
                          status: TpStatus.neutral,
                          label: copy('qp_$p'),
                          isCompact: true,
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          _Section(
            title: copy('c_parts'),
            child: item.parts.isEmpty
                ? Text(copy('jc_noParts'), style: text.bodySmall)
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      for (final ({String name, num qty}) p in item.parts)
                        Padding(
                          padding: const EdgeInsets.only(bottom: TpSpace.xs),
                          child: Text(
                            '${p.name}  x${_num(p.qty)}',
                            style: text.bodyMedium,
                          ),
                        ),
                    ],
                  ),
          ),
          _Section(
            title: copy('c_meters'),
            child: item.km == null && item.engineHours == null
                ? Text(copy('jc_noMeters'), style: text.bodySmall)
                : Text(
                    <String>[
                      if (item.km != null) '${copy('c_km')}: ${_num(item.km!)}',
                      if (item.engineHours != null)
                        '${copy('c_hours')}: ${_num(item.engineHours!)}',
                    ].join('   '),
                    style: text.bodyMedium,
                  ),
          ),
          if (item.beforePhotos.isNotEmpty)
            _Section(
              title: copy('c_before'),
              child: _Photos(refs: item.beforePhotos, copy: copy),
            ),
          _Section(
            title: copy('c_after'),
            child: _Photos(refs: item.afterPhotos, copy: copy),
          ),
          _Section(
            title: copy('jc_signature'),
            child: _Signature(dataUrl: item.signature),
          ),
        ],
      ),
    );
  }
}

String _num(num v) =>
    v == v.roundToDouble() ? v.toInt().toString() : v.toString();

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => TpCard(
        margin: const EdgeInsets.only(bottom: TpSpace.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              title,
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: TpPalette.of(context).textSecondary,
                  ),
            ),
            const SizedBox(height: TpSpace.sm),
            child,
          ],
        ),
      );
}

class _Photos extends ConsumerWidget {
  const _Photos({required this.refs, required this.copy});

  final List<String> refs;
  final WorkshopCopy copy;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpPalette palette = TpPalette.of(context);
    return Wrap(
      spacing: TpSpace.sm,
      runSpacing: TpSpace.sm,
      children: <Widget>[
        for (final String r in refs)
          ClipRRect(
            borderRadius: BorderRadius.circular(TpRadius.md),
            child: SizedBox(
              width: 104,
              height: 104,
              child: ref.watch(privateStorageImageUrlProvider(r)).when(
                    data: (String url) => Image.network(
                      url,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) =>
                          _PhotoMissing(copy: copy, palette: palette),
                    ),
                    loading: () => ColoredBox(
                      color: palette.surfaceSunken,
                      child: const Center(
                        child: SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      ),
                    ),
                    error: (_, __) =>
                        _PhotoMissing(copy: copy, palette: palette),
                  ),
            ),
          ),
      ],
    );
  }
}

class _PhotoMissing extends StatelessWidget {
  const _PhotoMissing({required this.copy, required this.palette});

  final WorkshopCopy copy;
  final TpPalette palette;

  @override
  Widget build(BuildContext context) => ColoredBox(
        color: palette.surfaceSunken,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(TpSpace.xs),
            child: Text(
              copy('jc_photoUnavailable'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ),
      );
}

class _Signature extends StatelessWidget {
  const _Signature({required this.dataUrl});

  final String? dataUrl;

  @override
  Widget build(BuildContext context) {
    final String raw = dataUrl ?? '';
    final int comma = raw.indexOf(',');
    Uint8List? bytes;
    if (raw.startsWith('data:image/') && comma > 0) {
      try {
        bytes = base64Decode(raw.substring(comma + 1));
      } on FormatException {
        bytes = null;
      }
    }
    final TpPalette palette = TpPalette.of(context);
    return Container(
      height: 96,
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: palette.border),
      ),
      child: bytes == null
          ? const SizedBox.shrink()
          : Image.memory(
              bytes,
              fit: BoxFit.contain,
              errorBuilder: (_, __, ___) => const SizedBox.shrink(),
            ),
    );
  }
}

class _ReturnSheet extends StatefulWidget {
  const _ReturnSheet({required this.copy});

  final WorkshopCopy copy;

  @override
  State<_ReturnSheet> createState() => _ReturnSheetState();
}

class _ReturnSheetState extends State<_ReturnSheet> {
  final TextEditingController _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final WorkshopCopy copy = widget.copy;
    final bool ready = _note.text.trim().length >= 3;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        TpSpace.lg,
        0,
        TpSpace.lg,
        TpSpace.lg + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            copy('jc_returnTitle'),
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: TpSpace.sm),
          TextField(
            key: WorkshopJobsToCheckKeys.returnNote,
            controller: _note,
            autofocus: true,
            maxLength: 1000,
            minLines: 2,
            maxLines: 5,
            decoration: InputDecoration(hintText: copy('jc_returnHint')),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.danger(
            key: WorkshopJobsToCheckKeys.returnSend,
            label: copy('jc_returnSend'),
            icon: Icons.undo_rounded,
            isFullWidth: true,
            onPressed:
                ready ? () => Navigator.of(context).pop(_note.text) : null,
          ),
        ],
      ),
    );
  }
}
