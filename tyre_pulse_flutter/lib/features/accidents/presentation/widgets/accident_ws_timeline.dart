/// M1 "Case timeline & notifications" - field for field against the owner's
/// mock, on the live case ledgers.
///
/// The feed and the delivery log are pure ([buildTimelineFeed],
/// [buildDeliveryLog]); this widget only loads through
/// [accidentTimelineRepositoryProvider], renders, and writes two things
/// online: a timeline note and a logged participant notification.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_timeline_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_handover_gating.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_timeline_feed.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_mock_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_timeline_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_header.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_mock_kit.dart';

class AccidentTimelineMockWorkspace extends ConsumerStatefulWidget {
  const AccidentTimelineMockWorkspace({
    required this.snapshot,
    required this.onNavigate,
    this.showWorkstreamHeader = true,
    this.clock,
    super.key,
  });

  final AccidentCaseSnapshot snapshot;
  final void Function(String workspaceKey) onNavigate;

  /// False when the case screen already shows the single workstream header
  /// above this workspace, so the step is never stated twice.
  final bool showWorkstreamHeader;

  /// Injected clock for deterministic tests; production leaves it null.
  final DateTime Function()? clock;

  @override
  ConsumerState<AccidentTimelineMockWorkspace> createState() => _State();
}

class _State extends ConsumerState<AccidentTimelineMockWorkspace> {
  AccidentTimelineData? _data;
  bool _loading = true;
  Object? _error;
  bool _busy = false;
  String? _actionError;
  int _tab = 0;
  String _filter = 'all';
  bool _logExpanded = true;
  Timer? _ticker;
  late DateTime _now;
  // Sheet controllers live with the workspace, not the sheet call: a bottom
  // sheet keeps rebuilding through its close animation, so a controller
  // disposed the moment the sheet returns is used after disposal.
  final TextEditingController _noteController = TextEditingController();
  final TextEditingController _notifySubject = TextEditingController();
  final TextEditingController _notifyBody = TextEditingController();

  DateTime _clock() => widget.clock?.call() ?? DateTime.now();

  @override
  void initState() {
    super.initState();
    _now = _clock();
    // Production ticks the age / due-in chips; a test hands in a fixed
    // clock and gets no timer to leak.
    if (widget.clock == null) {
      _ticker = Timer.periodic(const Duration(minutes: 1), (_) {
        if (mounted) setState(() => _now = _clock());
      });
    }
    unawaited(_load());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _noteController.dispose();
    _notifySubject.dispose();
    _notifyBody.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final AccidentTimelineData data = await ref
          .read(accidentTimelineRepositoryProvider)
          .load(widget.snapshot.accident.id);
      if (!mounted) return;
      setState(() {
        _data = data;
        _loading = false;
        _now = _clock();
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _actionError = null;
    });
    try {
      await action();
      await _load();
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _actionError = _errorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _errorText(Object error) {
    if (error is SupabaseFailure) return error.error.message;
    if (error is ArgumentError) return error.message.toString();
    return WsKitCopy(context).l10n.accTlLoadFailed;
  }

  WorkspaceContext? get _workspace => ref.read(workspaceContextProvider);

  TimelineFeedInput _input(AccidentTimelineData data) => TimelineFeedInput(
        snapshot: widget.snapshot,
        now: _now,
        communications: data.communications,
        evidence: data.evidence,
        slas: data.slas,
        dispatch: data.dispatch,
        gps: data.gps,
      );

  // ── actions ───────────────────────────────────────────────────────────

  Future<void> _addNote() async {
    final TextEditingController controller = _noteController..clear();
    final WsKitCopy c = WsKitCopy(context);
    final bool? confirmed = await TpBottomSheet.show<bool>(
      context: context,
      title: c.l10n.accTlAddTimelineNote,
      builder: (BuildContext sheet) => SingleChildScrollView(
        padding: const EdgeInsets.all(TpSpace.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            TpInput(
              label: c.l10n.accTlNote,
              controller: controller,
              maxLines: 4,
              isRequired: true,
              autofocus: true,
            ),
            const SizedBox(height: TpSpace.md),
            TpButton.primary(
              label: c.l10n.accTlSaveNote,
              onPressed: () => Navigator.of(sheet).pop(true),
            ),
          ],
        ),
      ),
    );
    final String body = controller.text;
    if (confirmed != true) return;
    await _run(
      () => ref.read(accidentTimelineRepositoryProvider).addNote(
            accidentId: widget.snapshot.accident.id,
            body: body,
            authorName: _workspace?.fullName,
            country: _workspace?.activeCountry,
            site: widget.snapshot.accident.site,
          ),
    );
  }

  Future<void> _notifyParticipants() async {
    final WsKitCopy c = WsKitCopy(context);
    final TextEditingController subject = _notifySubject..clear();
    final TextEditingController body = _notifyBody..clear();
    final Set<String> groups = <String>{};
    final bool? confirmed = await TpBottomSheet.show<bool>(
      context: context,
      title: c.l10n.accTlNotifyParticipants,
      builder: (BuildContext sheet) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setSheet) =>
            SingleChildScrollView(
          padding: const EdgeInsets.all(TpSpace.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              AccidentMockNotice(
                tone: TpStatus.info,
                text: c.l10n.accTlThisLogsTheNotificationOnThe,
              ),
              const SizedBox(height: TpSpace.md),
              for (final NotifyRole role in notifyRoles)
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: groups.contains(role.label),
                  onChanged: (bool? on) => setSheet(() {
                    if (on ?? false) {
                      groups.add(role.label);
                    } else {
                      groups.remove(role.label);
                    }
                  }),
                  title: Text(role.label),
                  subtitle: Text(role.roles.join(', ')),
                ),
              TpInput(
                label: c.l10n.accTlSubject,
                controller: subject,
                isRequired: true,
              ),
              const SizedBox(height: TpSpace.sm),
              TpInput(
                label: c.l10n.accTlMessage,
                controller: body,
                maxLines: 4,
              ),
              const SizedBox(height: TpSpace.md),
              TpButton.primary(
                label: c.l10n.accTlLogNotification,
                onPressed: () => Navigator.of(sheet).pop(true),
              ),
            ],
          ),
        ),
      ),
    );
    final String subjectText = subject.text;
    final String bodyText = body.text;
    if (confirmed != true) return;
    await _run(
      () => ref.read(accidentTimelineRepositoryProvider).notifyParticipants(
            accidentId: widget.snapshot.accident.id,
            subject: subjectText,
            body: bodyText,
            toGroups: groups.toList(growable: false),
            authorName: _workspace?.fullName,
            country: _workspace?.activeCountry,
            site: widget.snapshot.accident.site,
          ),
    );
  }

  Future<void> _manageRecipients() async {
    final WsKitCopy c = WsKitCopy(context);
    await TpBottomSheet.show<void>(
      context: context,
      title: c.l10n.accTlManageRecipientGroups,
      builder: (BuildContext sheet) => SingleChildScrollView(
        padding: const EdgeInsets.all(TpSpace.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              c.l10n.accTlRecipientsAreSetByAdminPer,
            ),
            const SizedBox(height: TpSpace.md),
            for (final NotifyRole role in notifyRoles)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.groups_outlined),
                title: Text(role.label),
                subtitle: Text(role.roles.join(', ')),
                trailing:
                    role.visibilityOnly ? Text(c.l10n.accTlVisibility) : null,
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _showEntry(TimelineEntry entry) async {
    final WsKitCopy c = WsKitCopy(context);
    await TpBottomSheet.show<void>(
      context: context,
      title: accidentTimelineText(context, entry.title),
      builder: (BuildContext sheet) => SingleChildScrollView(
        padding: const EdgeInsets.all(TpSpace.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            AccidentMockFacts(
              items: <(String, String?)>[
                (c.l10n.accTlTime, accidentMockDateTime(context, entry.at)),
                (c.l10n.accTlBy, entry.actor),
                (c.l10n.accTlTo, entry.audience),
                (
                  c.l10n.accTlStatus,
                  entry.status == null ? null : _statusLabel(c, entry.status!)
                ),
                (
                  c.l10n.accTlElapsed,
                  entry.elapsed == null ? null : formatElapsed(entry.elapsed!)
                ),
              ],
            ),
            for (final String detail in entry.details)
              Text('• ${accidentTimelineText(context, detail)}'),
            for (final String warning in entry.warnings)
              Text(
                '• $warning',
                style: TextStyle(
                  color:
                      TpPalette.of(context).forStatus(TpStatus.warning).onSoft,
                ),
              ),
            if (entry.body != null) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              Text(entry.body!),
            ],
          ],
        ),
      ),
    );
  }

  // ── build ─────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final WsKitCopy c = WsKitCopy(context);
    final AccidentRecord record = widget.snapshot.accident;
    final AccidentTimelineData? data = _data;
    final Duration? age = caseOpenAge(record, _now);
    final AccidentSlaRow? next = data == null ? null : nextSla(data.slas, _now);
    final String? dueIn = dueInLabel(next, _now);
    final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
    final bool isAdmin = workspace != null &&
        (workspace.role.isAdministrator || workspace.isSuperAdmin);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (widget.showWorkstreamHeader) ...<Widget>[
          AccidentWorkstreamHeader(
            snapshot: widget.snapshot,
            workstreamKey: 'timeline',
            now: widget.clock?.call(),
          ),
          const SizedBox(height: TpSpace.md),
        ],
        AccidentMockTitle(
          c.l10n.accTlCaseTimelineNotifications,
        ),
        TpIdentifierText('${record.reference} · ${record.assetNo}'),
        const SizedBox(height: TpSpace.sm),
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            AccidentMockChip(
              key: const Key('accident.timeline.open'),
              label: c.l10n.accTlOpen,
              value: age == null ? c.notSet : formatElapsed(age),
              tone: TpStatus.ok,
              icon: Icons.schedule_outlined,
            ),
            AccidentMockChip(
              label: c.l10n.accTlCurrentOwner,
              value: c.value(
                _ownerText(context, currentOwner(widget.snapshot)),
              ),
              icon: Icons.person_outline,
            ),
            AccidentMockChip(
              label: c.l10n.accTlNextSla,
              value: c.value(next?.name ?? next?.slaKey),
              tone: next == null ? TpStatus.neutral : TpStatus.warning,
              icon: Icons.access_time,
            ),
            AccidentMockChip(
              key: const Key('accident.timeline.dueIn'),
              label: c.l10n.accTlDueIn,
              value: dueIn != null && dueIn.startsWith('Overdue ')
                  ? c.l10n.accTlOverdueBy(dueIn.substring('Overdue '.length))
                  : c.value(dueIn),
              tone: dueIn == null
                  ? TpStatus.neutral
                  : dueIn.startsWith('Overdue')
                      ? TpStatus.critical
                      : TpStatus.warning,
              icon: Icons.timer_outlined,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        TpSegmented<int>(
          value: _tab,
          expanded: true,
          options: <TpSegmentedOption<int>>[
            for (int i = 0; i < timelineTabs.length; i++)
              TpSegmentedOption<int>(
                value: i,
                label: _tabLabel(c, timelineTabs[i]),
              ),
          ],
          onChanged: (int value) => setState(() => _tab = value),
        ),
        const SizedBox(height: TpSpace.md),
        if (_loading)
          const TpLoadingState()
        else if (_error != null) ...<Widget>[
          AccidentMockNotice(
            tone: TpStatus.critical,
            text: _errorText(_error!),
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.secondary(
            label: c.l10n.accDhRetry,
            onPressed: _load,
          ),
        ] else if (data != null) ...<Widget>[
          ..._ledgerNotes(c, data),
          if (_actionError != null) ...<Widget>[
            AccidentMockNotice(tone: TpStatus.critical, text: _actionError!),
            const SizedBox(height: TpSpace.md),
          ],
          switch (_tab) {
            0 => _timelineTab(c, data, isAdmin),
            1 => _notificationsTab(c, data, isAdmin),
            _ => _participantsTab(c),
          },
          const SizedBox(height: TpSpace.md),
          AccidentMockActions(
            emphasiseLast: true,
            actions: <(String, IconData, VoidCallback?)>[
              (
                c.l10n.accTlAddTimelineNote2,
                Icons.edit_outlined,
                _busy || _ledgerMissing(data)
                    ? null
                    : () => unawaited(_addNote())
              ),
              (
                c.l10n.accTlNotifyParticipants2,
                Icons.campaign_outlined,
                _busy || _ledgerMissing(data)
                    ? null
                    : () => unawaited(_notifyParticipants())
              ),
            ],
          ),
        ],
      ],
    );
  }

  static bool _ledgerMissing(AccidentTimelineData data) =>
      data.unavailable.contains(TimelineLedger.communications);

  List<Widget> _ledgerNotes(WsKitCopy c, AccidentTimelineData data) {
    final List<Widget> notes = <Widget>[];
    for (final String ledger in data.unavailable) {
      notes.add(
        AccidentMockNotice(
          tone: TpStatus.info,
          text: '${_ledgerLabel(c, ledger)}: '
              '${c.l10n.accTlNotProvisionedYetOnThisDatabase}',
        ),
      );
      notes.add(const SizedBox(height: TpSpace.sm));
    }
    for (final String ledger in data.failed) {
      notes.add(
        AccidentMockNotice(
          text: '${_ledgerLabel(c, ledger)}: '
              '${c.l10n.accTlCouldNotBeReadTheFeed}',
        ),
      );
      notes.add(const SizedBox(height: TpSpace.sm));
    }
    return notes;
  }

  String _ledgerLabel(WsKitCopy c, String ledger) => switch (ledger) {
        TimelineLedger.communications => c.l10n.accTlCommunications,
        TimelineLedger.evidence => c.l10n.accTlEvidence,
        TimelineLedger.sla => c.l10n.accTlSlaClocks,
        TimelineLedger.dispatch => c.l10n.accTlDispatchLeg,
        TimelineLedger.gps => c.l10n.accTlGpsFix,
        _ => ledger,
      };

  String _tabLabel(WsKitCopy c, String tab) => switch (tab) {
        'Timeline' => c.l10n.accTlTimeline,
        'Notifications' => c.l10n.accTlNotifications,
        _ => c.l10n.accTlParticipants,
      };

  String _filterLabel(WsKitCopy c, String filter) => switch (filter) {
        'all' => c.l10n.accTlAll,
        'actions' => c.l10n.accTlActions,
        'documents' => c.l10n.accTlDocuments,
        'sla' => c.l10n.accTlSla,
        _ => c.l10n.accTlEmails,
      };

  String _statusLabel(WsKitCopy c, TimelineStatus status) => switch (status) {
        TimelineStatus.completed => c.l10n.accTlCompleted,
        TimelineStatus.inTransit => c.l10n.accTlInTransit,
        TimelineStatus.pending => c.l10n.accDhPending,
      };

  // ── Timeline tab ──────────────────────────────────────────────────────

  Widget _timelineTab(WsKitCopy c, AccidentTimelineData data, bool isAdmin) {
    final List<TimelineEntry> rows =
        filterTimeline(buildTimelineFeed(_input(data)), _filter);
    final List<DeliveryLogRow> log = buildDeliveryLog(_input(data));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        // One scrollable row of filters, as the mock draws it; the
        // selected filter is the filled navy chip.
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: <Widget>[
              for (final String filter in timelineFilters) ...<Widget>[
                if (filter != timelineFilters.first)
                  const SizedBox(width: TpSpace.sm),
                ChoiceChip(
                  key: Key('accident.timeline.filter.$filter'),
                  showCheckmark: false,
                  avatar: filter == 'all'
                      ? null
                      : Icon(
                          _filterIcon(filter),
                          size: TpSizing.iconSm,
                          color: _filter == filter
                              ? TpPalette.of(context).textInverse
                              : null,
                        ),
                  label: Text(_filterLabel(c, filter)),
                  labelStyle: _filter == filter
                      ? TextStyle(
                          color: TpPalette.of(context).textInverse,
                          fontWeight: FontWeight.w700,
                        )
                      : null,
                  selectedColor: TpPalette.of(context).text,
                  selected: _filter == filter,
                  onSelected: (_) => setState(() => _filter = filter),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: TpSpace.sm),
        AccidentMockPanel(
          child: rows.isEmpty
              ? Text(
                  c.l10n.accTlNoRecordedEventsForThisFilter,
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    for (int i = 0; i < rows.length; i++)
                      _TimelineRow(
                        entry: rows[i],
                        isFirst: i == 0,
                        isLast: i == rows.length - 1,
                        statusLabel: rows[i].status == null
                            ? null
                            : _statusLabel(c, rows[i].status!),
                        onTap: () => unawaited(_showEntry(rows[i])),
                      ),
                  ],
                ),
        ),
        const SizedBox(height: TpSpace.md),
        _DeliveryLogPreview(
          rows: log,
          expanded: _logExpanded,
          onToggle: () => setState(() => _logExpanded = !_logExpanded),
          onViewAll: () => setState(() => _tab = 1),
        ),
        const SizedBox(height: TpSpace.md),
        TpCard(
          key: const Key('accident.timeline.manageRecipientsCard'),
          onTap: isAdmin ? () => unawaited(_manageRecipients()) : null,
          padding: const EdgeInsets.all(TpSpace.md),
          child: Row(
            children: <Widget>[
              Icon(
                Icons.settings_outlined,
                color: TpPalette.of(context).primary,
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      c.l10n.accTlManageRecipientGroups2,
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    Text(
                      c.l10n.accTlRecipientsAreSetByAdminPer2,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              if (isAdmin)
                Icon(
                  // Flutter mirrors chevron_right in RTL (matchTextDirection).
                  Icons.chevron_right,
                  color: TpPalette.of(context).textMuted,
                ),
            ],
          ),
        ),
      ],
    );
  }

  IconData _filterIcon(String filter) => switch (filter) {
        'actions' => Icons.bolt_outlined,
        'documents' => Icons.description_outlined,
        'sla' => Icons.shield_outlined,
        'emails' => Icons.mail_outline,
        _ => Icons.list,
      };

  // ── Notifications tab ─────────────────────────────────────────────────

  Widget _notificationsTab(
    WsKitCopy c,
    AccidentTimelineData data,
    bool isAdmin,
  ) {
    final List<DeliveryLogRow> rows = buildDeliveryLog(_input(data));
    final TextStyle? head = Theme.of(context)
        .textTheme
        .labelSmall
        ?.copyWith(fontWeight: FontWeight.w800);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AccidentMockSection(
          icon: Icons.mail_outline,
          title: c.l10n.accTlNotificationDeliveryLog,
          child: rows.isEmpty
              ? Text(
                  c.l10n.accTlNoNotificationsRecordedForThisCase,
                )
              : SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    columnSpacing: TpSpace.lg,
                    horizontalMargin: 0,
                    columns: <DataColumn>[
                      DataColumn(
                        label: Text(
                          c.l10n.accTlTrigger,
                          style: head,
                        ),
                      ),
                      DataColumn(
                        label: Text(
                          c.l10n.accTlRecipients,
                          style: head,
                        ),
                      ),
                      DataColumn(
                        label: Text(
                          c.l10n.accTlChannel,
                          style: head,
                        ),
                      ),
                      DataColumn(
                        label: Text(
                          c.l10n.accTlStatus,
                          style: head,
                        ),
                      ),
                      DataColumn(
                        label: Text(c.l10n.accTlTime, style: head),
                      ),
                      const DataColumn(label: SizedBox.shrink()),
                    ],
                    rows: <DataRow>[
                      for (final DeliveryLogRow row in rows)
                        DataRow(
                          cells: <DataCell>[
                            DataCell(
                              Text(accidentTimelineText(context, row.trigger)),
                            ),
                            DataCell(
                              Text(
                                row.recipients.isEmpty
                                    ? c.notSet
                                    : row.recipientCount > 1
                                        ? '${row.recipients} · '
                                            '${row.recipientCount}'
                                        : row.recipients,
                              ),
                            ),
                            DataCell(
                              Text(accidentTimelineText(context, row.channel)),
                            ),
                            DataCell(
                              Text(accidentTimelineText(context, row.status)),
                            ),
                            DataCell(
                              Text(
                                row.at == null
                                    ? c.notSet
                                    : accidentMockDateTime(context, row.at!),
                              ),
                            ),
                            DataCell(
                              PopupMenuButton<String>(
                                icon: const Icon(Icons.more_vert),
                                onSelected: (String value) {
                                  if (value == 'copy') {
                                    ScaffoldMessenger.maybeOf(context)
                                        ?.showSnackBar(
                                      SnackBar(
                                        content: Text(
                                          '${accidentTimelineText(context, row.trigger)} · '
                                          '${accidentTimelineText(context, row.status)}',
                                        ),
                                      ),
                                    );
                                  }
                                },
                                itemBuilder: (BuildContext context) =>
                                    <PopupMenuEntry<String>>[
                                  PopupMenuItem<String>(
                                    value: 'copy',
                                    child: Text(
                                      c.l10n.accTlShowStatus,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
        ),
        const SizedBox(height: TpSpace.sm),
        OutlinedButton.icon(
          key: const Key('accident.timeline.viewAll'),
          onPressed: () => context.push(const NotificationsRoute().location),
          icon: const Icon(Icons.notifications_none),
          label: Text(
            c.l10n.accTlViewAllNotifications,
          ),
        ),
        const SizedBox(height: TpSpace.sm),
        OutlinedButton.icon(
          key: const Key('accident.timeline.manageRecipients'),
          onPressed: isAdmin ? () => unawaited(_manageRecipients()) : null,
          icon: const Icon(Icons.groups_outlined),
          label: Text(
            c.l10n.accTlManageRecipientGroups2,
          ),
        ),
        Text(
          c.l10n.accTlRecipientsAreSetByAdminPer2,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: TpPalette.of(context).textMuted,
              ),
        ),
      ],
    );
  }

  // ── Participants tab ──────────────────────────────────────────────────

  Widget _participantsTab(WsKitCopy c) => AccidentMockSection(
        icon: Icons.people_outline,
        title: c.l10n.accTlParticipantsAndOwnership,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (final (String, String) row in participantRows(widget.snapshot))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Icon(
                      Icons.person_outline,
                      color: TpPalette.of(context).primary,
                    ),
                    const SizedBox(width: TpSpace.sm),
                    Expanded(child: Text('${row.$1}: ${row.$2}')),
                  ],
                ),
              ),
          ],
        ),
      );
}

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({
    required this.entry,
    required this.statusLabel,
    required this.onTap,
    this.isFirst = false,
    this.isLast = false,
  });
  final TimelineEntry entry;
  final String? statusLabel;
  final VoidCallback onTap;
  final bool isFirst;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final WsKitCopy c = WsKitCopy(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String locale = Localizations.localeOf(context).toLanguageTag();
    final DateTime local = entry.at.toLocal();
    // Mock colours: done = green, on the road = blue, waiting = orange.
    final TpStatus tone = switch (entry.status) {
      TimelineStatus.completed => TpStatus.ok,
      TimelineStatus.inTransit => TpStatus.info,
      TimelineStatus.pending => TpStatus.warning,
      null => TpStatus.neutral,
    };
    final TpStatusColors colors = palette.forStatus(tone);
    final IconData icon = switch (entry.category) {
      TimelineCategory.actions => Icons.history,
      TimelineCategory.documents => Icons.description_outlined,
      TimelineCategory.sla => Icons.timer_outlined,
      TimelineCategory.emails => Icons.mail_outline,
    };
    final IconData dot = switch (entry.status) {
      TimelineStatus.completed => Icons.check_circle,
      TimelineStatus.inTransit => Icons.radio_button_checked,
      TimelineStatus.pending => Icons.radio_button_checked,
      null => Icons.circle_outlined,
    };
    final Color rail = palette.border;
    return InkWell(
      onTap: onTap,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            // Rail: a status dot on a vertical line joining the entries.
            SizedBox(
              width: 22,
              child: Column(
                children: <Widget>[
                  SizedBox(
                    height: TpSpace.md,
                    child: isFirst
                        ? null
                        : VerticalDivider(width: 2, thickness: 2, color: rail),
                  ),
                  Icon(
                    dot,
                    size: 18,
                    color:
                        entry.status == null ? palette.textMuted : colors.base,
                  ),
                  Expanded(
                    child: isLast
                        ? const SizedBox.shrink()
                        : VerticalDivider(width: 2, thickness: 2, color: rail),
                  ),
                ],
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: TpSpace.md),
                decoration: BoxDecoration(
                  border: isLast
                      ? null
                      : Border(bottom: BorderSide(color: palette.border)),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    SizedBox(
                      width: 52,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            DateFormat('d MMM', locale).format(local),
                            style: text.labelMedium
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          Text(
                            DateFormat.Hm(locale).format(local),
                            style: text.labelSmall,
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: entry.status == TimelineStatus.pending
                            ? colors.soft
                            : palette.primarySoft,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        icon,
                        color: entry.status == TimelineStatus.pending
                            ? colors.base
                            : palette.primary,
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: TpSpace.sm),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            accidentTimelineText(context, entry.title),
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                          if (entry.actor != null)
                            Text('${c.l10n.accTlBy2} ${entry.actor}'),
                          if (entry.audience != null)
                            Text('${c.l10n.accTlTo2} ${entry.audience}'),
                          for (final String detail in entry.details)
                            Text(
                              accidentTimelineText(context, detail),
                              style: text.bodySmall,
                            ),
                          for (final String warning in entry.warnings)
                            Row(
                              children: <Widget>[
                                Icon(
                                  Icons.warning_amber_rounded,
                                  size: TpSizing.iconSm,
                                  color:
                                      palette.forStatus(TpStatus.warning).base,
                                ),
                                const SizedBox(width: TpSpace.xs),
                                Flexible(
                                  child: Text(
                                    accidentTimelineText(context, warning),
                                    style: text.bodySmall?.copyWith(
                                      color: palette
                                          .forStatus(TpStatus.warning)
                                          .onSoft,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          const SizedBox(height: TpSpace.xs),
                          Wrap(
                            spacing: TpSpace.xs,
                            runSpacing: TpSpace.xs,
                            children: <Widget>[
                              if (statusLabel != null)
                                TpStatusChip(
                                  status: tone,
                                  label: statusLabel,
                                  isCompact: true,
                                ),
                              if (entry.elapsed != null)
                                TpStatusChip(
                                  status: TpStatus.neutral,
                                  label: formatElapsed(entry.elapsed!),
                                  icon: Icons.schedule_outlined,
                                  isCompact: true,
                                ),
                              if (entry.slaMet)
                                TpStatusChip(
                                  status: TpStatus.ok,
                                  label: c.l10n.accTlSlaMet,
                                  icon: Icons.verified_outlined,
                                  isCompact: true,
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    Icon(
                      // Flutter mirrors chevron_right in RTL (matchTextDirection).
                      Icons.chevron_right,
                      color: palette.textMuted,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The collapsible "Notification delivery log" card under the timeline:
/// the newest three logged notifications, with "View all" opening the
/// Notifications tab (the full table). Rows come from [buildDeliveryLog],
/// so a status is only ever what the communications ledger recorded.
class _DeliveryLogPreview extends StatelessWidget {
  const _DeliveryLogPreview({
    required this.rows,
    required this.expanded,
    required this.onToggle,
    required this.onViewAll,
  });
  final List<DeliveryLogRow> rows;
  final bool expanded;
  final VoidCallback onToggle;
  final VoidCallback onViewAll;

  static const int _previewCount = 3;

  @override
  Widget build(BuildContext context) {
    final WsKitCopy c = WsKitCopy(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final List<DeliveryLogRow> shown = rows.take(_previewCount).toList();
    return TpCard(
      key: const Key('accident.timeline.logPreview'),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          InkWell(
            key: const Key('accident.timeline.logPreview.toggle'),
            onTap: onToggle,
            child: Row(
              children: <Widget>[
                Icon(Icons.mail_outline, color: palette.primary),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: Text(
                    c.l10n.accTlNotificationDeliveryLog,
                    style:
                        text.titleSmall?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                Icon(
                  expanded
                      ? Icons.keyboard_arrow_up_rounded
                      : Icons.keyboard_arrow_down_rounded,
                  color: palette.textMuted,
                ),
              ],
            ),
          ),
          if (expanded) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            if (shown.isEmpty)
              Text(
                c.l10n.accTlNoNotificationsRecordedForThisCase,
                style: text.bodySmall,
              ),
            for (final DeliveryLogRow row in shown)
              Container(
                padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
                decoration: BoxDecoration(
                  border: Border(top: BorderSide(color: palette.border)),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            accidentTimelineText(context, row.trigger),
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          Text(
                            <String>[
                              if (row.recipients.isEmpty)
                                c.notSet
                              else if (row.recipientCount > 1)
                                '${row.recipients} · ${row.recipientCount}'
                              else
                                row.recipients,
                              accidentTimelineText(context, row.channel),
                            ].join(' · '),
                            style: text.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: TpSpace.sm),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: <Widget>[
                        Text(
                          accidentTimelineText(context, row.status),
                          style: text.bodySmall?.copyWith(
                            fontWeight: FontWeight.w700,
                            color: palette.primary,
                          ),
                        ),
                        Text(
                          row.at == null
                              ? c.notSet
                              : accidentMockDateTime(context, row.at!),
                          style: text.labelSmall,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            const SizedBox(height: TpSpace.sm),
            OutlinedButton(
              key: const Key('accident.timeline.logPreview.viewAll'),
              onPressed: onViewAll,
              child: Text(c.l10n.accTlViewAllNotifications),
            ),
          ],
        ],
      ),
    );
  }
}

/// The current owner in the reader's language when it is a case-flow team.
String? _ownerText(BuildContext context, String? owner) {
  final String v = owner?.trim() ?? '';
  if (v.isEmpty) return owner;
  return accidentOwnerLabel(AccidentMockCopy.of(context), v);
}
