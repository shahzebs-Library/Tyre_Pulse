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
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_header.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_mock_kit.dart';

class AccidentTimelineMockWorkspace extends ConsumerStatefulWidget {
  const AccidentTimelineMockWorkspace({
    required this.snapshot,
    required this.onNavigate,
    this.clock,
    super.key,
  });

  final AccidentCaseSnapshot snapshot;
  final void Function(String workspaceKey) onNavigate;

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
  Timer? _ticker;
  late DateTime _now;

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
    return WsKitCopy(context).t(
      'The timeline could not be loaded. Try again.',
      'تعذر تحميل السجل. حاول مرة أخرى.',
      'ٹائم لائن لوڈ نہیں ہو سکی۔ دوبارہ کوشش کریں۔',
    );
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
    final TextEditingController controller = TextEditingController();
    final WsKitCopy c = WsKitCopy(context);
    final bool? confirmed = await TpBottomSheet.show<bool>(
      context: context,
      title: c.t('Add timeline note', 'إضافة ملاحظة', 'ٹائم لائن نوٹ'),
      builder: (BuildContext sheet) => SingleChildScrollView(
        padding: const EdgeInsets.all(TpSpace.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            TpInput(
              label: c.t('Note', 'الملاحظة', 'نوٹ'),
              controller: controller,
              maxLines: 4,
              isRequired: true,
              autofocus: true,
            ),
            const SizedBox(height: TpSpace.md),
            TpButton.primary(
              label: c.t('Save note', 'حفظ الملاحظة', 'نوٹ محفوظ کریں'),
              onPressed: () => Navigator.of(sheet).pop(true),
            ),
          ],
        ),
      ),
    );
    final String body = controller.text;
    controller.dispose();
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
    final TextEditingController subject = TextEditingController();
    final TextEditingController body = TextEditingController();
    final Set<String> groups = <String>{};
    final bool? confirmed = await TpBottomSheet.show<bool>(
      context: context,
      title: c.t('Notify participants', 'إشعار المشاركين', 'شرکاء کو اطلاع'),
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
                text: c.t(
                  'This logs the notification on the case ledger. Delivery '
                  'to people is done by the server notification engine.',
                  'يسجل هذا الإشعار في سجل القضية. التسليم للأشخاص يتم عبر '
                      'محرك إشعارات الخادم.',
                  'یہ اطلاع کیس لیجر میں درج ہوتی ہے۔ افراد تک ترسیل سرور '
                      'کا نوٹیفکیشن انجن کرتا ہے۔',
                ),
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
                label: c.t('Subject', 'الموضوع', 'موضوع'),
                controller: subject,
                isRequired: true,
              ),
              const SizedBox(height: TpSpace.sm),
              TpInput(
                label: c.t('Message', 'الرسالة', 'پیغام'),
                controller: body,
                maxLines: 4,
              ),
              const SizedBox(height: TpSpace.md),
              TpButton.primary(
                label: c.t('Log notification', 'تسجيل الإشعار', 'اطلاع درج'),
                onPressed: () => Navigator.of(sheet).pop(true),
              ),
            ],
          ),
        ),
      ),
    );
    final String subjectText = subject.text;
    final String bodyText = body.text;
    subject.dispose();
    body.dispose();
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
      title: c.t(
        'Manage recipient groups',
        'إدارة مجموعات المستلمين',
        'وصول کنندگان کے گروپس',
      ),
      builder: (BuildContext sheet) => SingleChildScrollView(
        padding: const EdgeInsets.all(TpSpace.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              c.t(
                'Recipients are set by Admin per event and role. The groups '
                'below are the roles each event reaches; membership comes '
                'from user profiles.',
                'يحدد المسؤول المستلمين لكل حدث ودور. المجموعات أدناه هي '
                    'الأدوار التي يصل إليها كل حدث؛ العضوية من ملفات '
                    'المستخدمين.',
                'وصول کنندگان ایڈمن ہر ایونٹ اور کردار کے لیے مقرر کرتا ہے۔ '
                    'نیچے دیے گئے گروپ وہ کردار ہیں جن تک ہر ایونٹ پہنچتا '
                    'ہے؛ رکنیت صارف پروفائلز سے آتی ہے۔',
              ),
            ),
            const SizedBox(height: TpSpace.md),
            for (final NotifyRole role in notifyRoles)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.groups_outlined),
                title: Text(role.label),
                subtitle: Text(role.roles.join(', ')),
                trailing: role.visibilityOnly
                    ? Text(c.t('Visibility', 'اطلاع', 'صرف دیکھنا'))
                    : null,
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
      title: entry.title,
      builder: (BuildContext sheet) => SingleChildScrollView(
        padding: const EdgeInsets.all(TpSpace.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            AccidentMockFacts(
              items: <(String, String?)>[
                (
                  c.t('Time', 'الوقت', 'وقت'),
                  accidentMockDateTime(context, entry.at)
                ),
                (c.t('By', 'بواسطة', 'از'), entry.actor),
                (c.t('To', 'إلى', 'کو'), entry.audience),
                (
                  c.t('Status', 'الحالة', 'حالت'),
                  entry.status == null ? null : _statusLabel(c, entry.status!)
                ),
                (
                  c.t('Elapsed', 'المدة', 'گزرا وقت'),
                  entry.elapsed == null ? null : formatElapsed(entry.elapsed!)
                ),
              ],
            ),
            for (final String detail in entry.details) Text('• $detail'),
            for (final String warning in entry.warnings)
              Text(
                '• $warning',
                style: TextStyle(
                  color: TpPalette.of(context)
                      .forStatus(TpStatus.warning)
                      .onSoft,
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
    final AccidentSlaRow? next =
        data == null ? null : nextSla(data.slas, _now);
    final String? dueIn = dueInLabel(next, _now);
    final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
    final bool isAdmin =
        workspace != null &&
            (workspace.role.isAdministrator || workspace.isSuperAdmin);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AccidentWorkstreamHeader(
          snapshot: widget.snapshot,
          workstreamKey: 'timeline',
          now: widget.clock?.call(),
        ),
        const SizedBox(height: TpSpace.md),
        AccidentMockTitle(
          c.t(
            'Case timeline & notifications',
            'سجل القضية والإشعارات',
            'کیس کی ٹائم لائن اور اطلاعات',
          ),
        ),
        TpIdentifierText('${record.reference} · ${record.assetNo}'),
        const SizedBox(height: TpSpace.sm),
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            AccidentMockChip(
              key: const Key('accident.timeline.open'),
              label: c.t('Open', 'مفتوحة', 'کھلا'),
              value: age == null ? c.notSet : formatElapsed(age),
              tone: TpStatus.info,
            ),
            AccidentMockChip(
              label: c.t('Current owner', 'المسؤول الحالي', 'موجودہ ذمہ دار'),
              value: c.value(currentOwner(widget.snapshot)),
            ),
            AccidentMockChip(
              label: c.t('Next SLA', 'المهلة التالية', 'اگلی مقررہ مدت'),
              value: c.value(next?.name ?? next?.slaKey),
              tone: next == null ? TpStatus.neutral : TpStatus.info,
            ),
            AccidentMockChip(
              key: const Key('accident.timeline.dueIn'),
              label: c.t('Due in', 'متبقي للموعد', 'مقررہ وقت میں باقی'),
              value: c.value(dueIn),
              tone: dueIn == null
                  ? TpStatus.neutral
                  : dueIn.startsWith('Overdue')
                      ? TpStatus.critical
                      : TpStatus.warning,
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
            label: c.t('Retry', 'إعادة المحاولة', 'دوبارہ کوشش کریں'),
            onPressed: _load,
          ),
        ] else if (data != null) ...<Widget>[
          ..._ledgerNotes(c, data),
          if (_actionError != null) ...<Widget>[
            AccidentMockNotice(tone: TpStatus.critical, text: _actionError!),
            const SizedBox(height: TpSpace.md),
          ],
          switch (_tab) {
            0 => _timelineTab(c, data),
            1 => _notificationsTab(c, data, isAdmin),
            _ => _participantsTab(c),
          },
          const SizedBox(height: TpSpace.md),
          AccidentMockActions(
            actions: <(String, IconData, VoidCallback?)>[
              (
                c.t(
                  'Add timeline note',
                  'إضافة ملاحظة للسجل',
                  'ٹائم لائن میں نوٹ شامل کریں',
                ),
                Icons.edit_outlined,
                _busy || _ledgerMissing(data)
                    ? null
                    : () => unawaited(_addNote())
              ),
              (
                c.t(
                  'Notify participants',
                  'إشعار المشاركين',
                  'شرکاء کو اطلاع دیں',
                ),
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
              '${c.t(
            'not provisioned yet on this database',
            'غير مفعل بعد في قاعدة البيانات',
            'اس ڈیٹا بیس میں ابھی فراہم نہیں',
          )}',
        ),
      );
      notes.add(const SizedBox(height: TpSpace.sm));
    }
    for (final String ledger in data.failed) {
      notes.add(
        AccidentMockNotice(
          text: '${_ledgerLabel(c, ledger)}: '
              '${c.t(
            'could not be read; the feed omits it',
            'تعذرت قراءته؛ السجل لا يتضمنه',
            'پڑھا نہیں جا سکا؛ فیڈ میں شامل نہیں',
          )}',
        ),
      );
      notes.add(const SizedBox(height: TpSpace.sm));
    }
    return notes;
  }

  String _ledgerLabel(WsKitCopy c, String ledger) => switch (ledger) {
        TimelineLedger.communications =>
          c.t('Communications', 'المراسلات', 'مواصلات'),
        TimelineLedger.evidence => c.t('Evidence', 'الأدلة', 'ثبوت'),
        TimelineLedger.sla => c.t('SLA clocks', 'مهل الخدمة', 'مقررہ مدتیں'),
        TimelineLedger.dispatch => c.t('Dispatch leg', 'الإرسال', 'روانگی'),
        TimelineLedger.gps => c.t('GPS fix', 'موقع GPS', 'GPS مقام'),
        _ => ledger,
      };

  String _tabLabel(WsKitCopy c, String tab) => switch (tab) {
        'Timeline' => c.t('Timeline', 'السجل الزمني', 'ٹائم لائن'),
        'Notifications' => c.t('Notifications', 'الإشعارات', 'اطلاعات'),
        _ => c.t('Participants', 'المشاركون', 'شرکاء'),
      };

  String _filterLabel(WsKitCopy c, String filter) => switch (filter) {
        'all' => c.t('All', 'الكل', 'سب'),
        'actions' => c.t('Actions', 'الإجراءات', 'کارروائیاں'),
        'documents' => c.t('Documents', 'المستندات', 'دستاویزات'),
        'sla' => c.t('SLA', 'المهل', 'مدت'),
        _ => c.t('Emails', 'البريد', 'ای میلز'),
      };

  String _statusLabel(WsKitCopy c, TimelineStatus status) => switch (status) {
        TimelineStatus.completed => c.t('Completed', 'مكتمل', 'مکمل'),
        TimelineStatus.inTransit => c.t('In transit', 'قيد النقل', 'راستے میں'),
        TimelineStatus.pending => c.t('Pending', 'قيد الانتظار', 'زیر التوا'),
      };

  // ── Timeline tab ──────────────────────────────────────────────────────

  Widget _timelineTab(WsKitCopy c, AccidentTimelineData data) {
    final List<TimelineEntry> rows =
        filterTimeline(buildTimelineFeed(_input(data)), _filter);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.xs,
          children: <Widget>[
            for (final String filter in timelineFilters)
              ChoiceChip(
                key: Key('accident.timeline.filter.$filter'),
                label: Text(_filterLabel(c, filter)),
                selected: _filter == filter,
                onSelected: (_) => setState(() => _filter = filter),
              ),
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        AccidentMockPanel(
          child: rows.isEmpty
              ? Text(
                  c.t(
                    'No recorded events for this filter.',
                    'لا توجد أحداث مسجلة لهذا المرشح.',
                    'اس فلٹر کے لیے کوئی درج شدہ واقعہ نہیں۔',
                  ),
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    for (final TimelineEntry entry in rows)
                      _TimelineRow(
                        entry: entry,
                        statusLabel: entry.status == null
                            ? null
                            : _statusLabel(c, entry.status!),
                        onTap: () => unawaited(_showEntry(entry)),
                      ),
                  ],
                ),
        ),
      ],
    );
  }

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
          title: c.t(
            'Notification delivery log',
            'سجل تسليم الإشعارات',
            'اطلاعات کی ترسیل کا ریکارڈ',
          ),
          child: rows.isEmpty
              ? Text(
                  c.t(
                    'No notifications recorded for this case.',
                    'لا توجد إشعارات مسجلة لهذه القضية.',
                    'اس کیس کے لیے کوئی اطلاع درج نہیں۔',
                  ),
                )
              : SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    columnSpacing: TpSpace.lg,
                    horizontalMargin: 0,
                    columns: <DataColumn>[
                      DataColumn(
                        label: Text(
                          c.t('Trigger', 'المحفز', 'محرک'),
                          style: head,
                        ),
                      ),
                      DataColumn(
                        label: Text(
                          c.t('Recipients', 'المستلمون', 'وصول کنندگان'),
                          style: head,
                        ),
                      ),
                      DataColumn(
                        label: Text(
                          c.t('Channel', 'القناة', 'چینل'),
                          style: head,
                        ),
                      ),
                      DataColumn(
                        label: Text(
                          c.t('Status', 'الحالة', 'حالت'),
                          style: head,
                        ),
                      ),
                      DataColumn(
                        label: Text(c.t('Time', 'الوقت', 'وقت'), style: head),
                      ),
                      const DataColumn(label: SizedBox.shrink()),
                    ],
                    rows: <DataRow>[
                      for (final DeliveryLogRow row in rows)
                        DataRow(
                          cells: <DataCell>[
                            DataCell(Text(row.trigger)),
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
                            DataCell(Text(row.channel)),
                            DataCell(Text(row.status)),
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
                                          '${row.trigger} · ${row.status}',
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
                                      c.t(
                                        'Show status',
                                        'عرض الحالة',
                                        'حالت دکھائیں',
                                      ),
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
            c.t(
              'View all notifications',
              'عرض جميع الإشعارات',
              'تمام اطلاعات دیکھیں',
            ),
          ),
        ),
        const SizedBox(height: TpSpace.sm),
        OutlinedButton.icon(
          key: const Key('accident.timeline.manageRecipients'),
          onPressed: isAdmin ? () => unawaited(_manageRecipients()) : null,
          icon: const Icon(Icons.groups_outlined),
          label: Text(
            c.t(
              'Manage recipient groups',
              'إدارة مجموعات المستلمين',
              'وصول کنندگان کے گروپس سنبھالیں',
            ),
          ),
        ),
        Text(
          c.t(
            'Recipients are set by Admin per event and role.',
            'يحدد المسؤول المستلمين لكل حدث ودور.',
            'وصول کنندگان ایڈمن ہر ایونٹ اور کردار کے لیے مقرر کرتا ہے۔',
          ),
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
        title: c.t(
          'Participants and ownership',
          'المشاركون والمسؤولية',
          'شرکاء اور ذمہ داری',
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (final (String, String) row
                in participantRows(widget.snapshot))
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
  });
  final TimelineEntry entry;
  final String? statusLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final WsKitCopy c = WsKitCopy(context);
    final TpPalette palette = TpPalette.of(context);
    final TpStatus tone = switch (entry.status) {
      TimelineStatus.completed => TpStatus.ok,
      TimelineStatus.inTransit => TpStatus.warning,
      TimelineStatus.pending => TpStatus.info,
      null => TpStatus.neutral,
    };
    final IconData icon = switch (entry.category) {
      TimelineCategory.actions => Icons.history,
      TimelineCategory.documents => Icons.description_outlined,
      TimelineCategory.sla => Icons.timer_outlined,
      TimelineCategory.emails => Icons.mail_outline,
    };
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.md),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: palette.border)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: palette.primarySoft,
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: palette.primary, size: 20),
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    accidentMockDateTime(context, entry.at),
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                  Text(
                    entry.title,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  if (entry.actor != null)
                    Text('${c.t('by', 'بواسطة', 'از')} ${entry.actor}'),
                  if (entry.audience != null)
                    Text('${c.t('to', 'إلى', 'کو')} ${entry.audience}'),
                  for (final String detail in entry.details)
                    Text(
                      detail,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  for (final String warning in entry.warnings)
                    Text(
                      warning,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: palette.forStatus(TpStatus.warning).onSoft,
                            fontWeight: FontWeight.w700,
                          ),
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
                          label: c.t(
                            'SLA met',
                            'تم الالتزام بالمهلة',
                            'مدت پوری',
                          ),
                          icon: Icons.verified_outlined,
                          isCompact: true,
                        ),
                    ],
                  ),
                ],
              ),
            ),
            Icon(
              TpDirection.isRtl(context)
                  ? Icons.chevron_left
                  : Icons.chevron_right,
              color: palette.textMuted,
            ),
          ],
        ),
      ),
    );
  }
}
