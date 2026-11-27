/// The list of concerns. For a driver: their own cases plus anything still
/// waiting on the phone to be sent. For a fleet pool role: the cases in their
/// area that are NOT sensitive (the database never returns a sensitive one to
/// them). Same screen; the row-level security decides the rows.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/features/driver_concerns/data/driver_concern_repository.dart';
import 'package:tyre_pulse/features/driver_concerns/domain/driver_concern_rules.dart';
import 'package:tyre_pulse/features/driver_concerns/presentation/concern_detail_screen.dart';
import 'package:tyre_pulse/features/driver_concerns/presentation/driver_concerns_copy.dart';
import 'package:tyre_pulse/features/driver_concerns/presentation/raise_concern_screen.dart';

abstract final class MyConcernsKeys {
  static const Key raise = Key('dc.list.raise');
  static Key row(String id) => Key('dc.list.row.$id');
}

class MyConcernsScreen extends ConsumerStatefulWidget {
  const MyConcernsScreen({this.handlerView = false, super.key});

  /// True for the fleet pool roles: no Raise button, a different title.
  final bool handlerView;

  @override
  ConsumerState<MyConcernsScreen> createState() => _MyConcernsScreenState();
}

class _MyConcernsScreenState extends ConsumerState<MyConcernsScreen> {
  List<DriverConcern> _rows = const <DriverConcern>[];
  List<ConcernDraft> _pending = const <ConcernDraft>[];
  bool _loading = true;
  Object? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final DriverConcernRepository repo =
        ref.read(driverConcernRepositoryProvider);
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      if (!widget.handlerView) await repo.flushOutbox();
      final List<DriverConcern> rows = await repo.list();
      final List<ConcernDraft> pending =
          widget.handlerView ? const <ConcernDraft>[] : await repo.pending();
      if (!mounted) return;
      setState(() {
        _rows = rows;
        _pending = pending;
        _loading = false;
      });
    } on Object catch (e) {
      final List<ConcernDraft> pending =
          widget.handlerView ? const <ConcernDraft>[] : await repo.pending();
      if (!mounted) return;
      setState(() {
        _error = e;
        _pending = pending;
        _loading = false;
      });
    }
  }

  Future<void> _raise() async {
    final bool? sent = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(builder: (_) => const RaiseConcernScreen()),
    );
    if (sent == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final DriverConcernsCopy c = DriverConcernsCopy.of(context);
    final ThemeData theme = Theme.of(context);
    final DateTime now = DateTime.now();
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.handlerView ? c('handlerTitle') : c('title')),
      ),
      floatingActionButton: widget.handlerView
          ? null
          : FloatingActionButton.extended(
              key: MyConcernsKeys.raise,
              onPressed: _raise,
              icon: const Icon(Icons.add_comment_outlined),
              label: Text(c('raise')),
            ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
          children: <Widget>[
            if (_loading && _rows.isEmpty)
              const Padding(
                padding: EdgeInsets.all(32),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (_error != null)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.cloud_off_outlined),
                  title: Text(c('error')),
                  trailing:
                      TextButton(onPressed: _load, child: Text(c('retry'))),
                ),
              ),
            for (final ConcernDraft d in _pending)
              Card(
                child: ListTile(
                  leading: Icon(
                    d.error == null
                        ? Icons.schedule_send_outlined
                        : Icons.error_outline,
                  ),
                  title: Text(
                    '${c('category.${d.category}')} · ${c('subtype.${d.subtype}')}',
                  ),
                  subtitle: Text(
                    d.error == null
                        ? c('pending')
                        : d.error == 'photo_missing'
                            ? c('photoMissing')
                            : '${c('failed')}: ${d.error}',
                  ),
                  trailing: Wrap(
                    children: <Widget>[
                      IconButton(
                        tooltip: c('retry'),
                        icon: const Icon(Icons.refresh),
                        onPressed: () async {
                          await ref
                              .read(driverConcernRepositoryProvider)
                              .retry(d.clientUuid);
                          unawaited(_load());
                        },
                      ),
                      IconButton(
                        tooltip: c('discard'),
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () async {
                          await ref
                              .read(driverConcernRepositoryProvider)
                              .discard(d.clientUuid);
                          unawaited(_load());
                        },
                      ),
                    ],
                  ),
                ),
              ),
            if (!_loading &&
                _error == null &&
                _rows.isEmpty &&
                _pending.isEmpty)
              Padding(
                padding: const EdgeInsets.all(32),
                child: Center(
                  child: Text(
                    widget.handlerView ? c('emptyHandler') : c('emptyMine'),
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            for (final DriverConcern r in _rows)
              Card(
                key: MyConcernsKeys.row(r.id),
                child: ListTile(
                  leading:
                      Icon(categoryFor(r.category)?.icon ?? Icons.help_outline),
                  title: Text(
                    '${c('category.${r.category}')} · ${c('subtype.${r.subtype}')}',
                  ),
                  subtitle: Text(
                    '${r.caseNo} · ${c('status.${r.status}')}${widget.handlerView ? ' · ${c('level.${r.level}')}' : ''}',
                  ),
                  trailing: _DeadlineDot(state: deadlineState(r, now)),
                  onTap: () async {
                    await Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (_) => ConcernDetailScreen(concernId: r.id),
                      ),
                    );
                    unawaited(_load());
                  },
                ),
              ),
            if (!widget.handlerView)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  c('labourOffice'),
                  style: theme.textTheme.bodySmall,
                  textAlign: TextAlign.center,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _DeadlineDot extends StatelessWidget {
  const _DeadlineDot({required this.state});
  final ConcernDeadline? state;

  @override
  Widget build(BuildContext context) {
    if (state == null) return const SizedBox.shrink();
    final Color color = switch (state!) {
      ConcernDeadline.overdue => Colors.red.shade600,
      ConcernDeadline.dueSoon => Colors.amber.shade700,
      ConcernDeadline.ok => Colors.green.shade600,
    };
    return Icon(Icons.circle, size: 12, color: color);
  }
}
