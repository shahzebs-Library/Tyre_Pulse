/// M2 "Dispatch & Handover (external workshop)" - field for field against
/// the owner's mock, on live rows.
///
/// Reads through [accidentDispatchRepositoryProvider]; writes are online
/// (vendor details, the outgoing leg, the signed vehicle acceptance). Every
/// blank prints "Not set"; every time printed is a recorded time. The one
/// clock that ticks is the transit timer, and it ticks only between a
/// recorded departure and a recorded arrival.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_dispatch_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_photo_capture.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_handover_gating.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_header.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_mock_kit.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/inspection_signature_pad.dart';
import 'package:url_launcher/url_launcher.dart';

class AccidentDispatchHandoverMockWorkspace extends ConsumerStatefulWidget {
  const AccidentDispatchHandoverMockWorkspace({
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
  ConsumerState<AccidentDispatchHandoverMockWorkspace> createState() =>
      _State();
}

class _State extends ConsumerState<AccidentDispatchHandoverMockWorkspace> {
  AccidentDispatchBundle? _bundle;
  bool _loading = true;
  Object? _error;
  bool _busy = false;
  String? _actionError;
  bool _editingVendor = false;
  bool _recordingDispatch = false;
  HandoverReceiptDraft _receipt = const HandoverReceiptDraft();
  Timer? _ticker;
  late DateTime _now;

  // Vendor form.
  final TextEditingController _vName = TextEditingController();
  final TextEditingController _vCity = TextEditingController();
  final TextEditingController _vContact = TextEditingController();
  final TextEditingController _vPhone = TextEditingController();
  final TextEditingController _vEmail = TextEditingController();
  final TextEditingController _vReg = TextEditingController();
  final TextEditingController _vInspector = TextEditingController();

  // Dispatch form.
  final TextEditingController _dDestination = TextEditingController();
  final TextEditingController _dCarrier = TextEditingController();
  final TextEditingController _dDriver = TextEditingController();
  final TextEditingController _dRecovery = TextEditingController();
  final TextEditingController _dOrigin = TextEditingController();
  final TextEditingController _dOdo = TextEditingController();
  final TextEditingController _dHours = TextEditingController();
  final TextEditingController _dFuel = TextEditingController();
  final TextEditingController _dKeys = TextEditingController();
  final TextEditingController _dDocs = TextEditingController();
  final TextEditingController _dAccessories = TextEditingController();
  final TextEditingController _dSignedBy = TextEditingController();
  DateTime? _dDeparture;
  DateTime? _dEta;
  final List<String> _dPhotos = <String>[];
  String? _dSignature;

  // Receipt form.
  final TextEditingController _rName = TextEditingController();
  final TextEditingController _rDesignation = TextEditingController();
  final TextEditingController _rOdo = TextEditingController();
  final TextEditingController _rHours = TextEditingController();
  final TextEditingController _rFuel = TextEditingController();
  final TextEditingController _rRemarks = TextEditingController();

  DateTime _clock() => widget.clock?.call() ?? DateTime.now();

  @override
  void initState() {
    super.initState();
    _now = _clock();
    // Production ticks the transit chip; a test hands in a fixed clock and
    // gets no timer to leak.
    if (widget.clock == null) {
      _ticker = Timer.periodic(const Duration(seconds: 30), (_) {
        if (mounted) setState(() => _now = _clock());
      });
    }
    unawaited(_load());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    for (final TextEditingController c in <TextEditingController>[
      _vName,
      _vCity,
      _vContact,
      _vPhone,
      _vEmail,
      _vReg,
      _vInspector,
      _dDestination,
      _dCarrier,
      _dDriver,
      _dRecovery,
      _dOrigin,
      _dOdo,
      _dHours,
      _dFuel,
      _dKeys,
      _dDocs,
      _dAccessories,
      _dSignedBy,
      _rName,
      _rDesignation,
      _rOdo,
      _rHours,
      _rFuel,
      _rRemarks,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final AccidentDispatchBundle bundle = await ref
          .read(accidentDispatchRepositoryProvider)
          .load(widget.snapshot.accident.id);
      if (!mounted) return;
      setState(() {
        _bundle = bundle;
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
    if (error is FormatException) return error.message;
    return WsKitCopy(context).t(
      'The change could not be saved. Try again.',
      'تعذر حفظ التغيير. حاول مرة أخرى.',
      'تبدیلی محفوظ نہیں ہو سکی۔ دوبارہ کوشش کریں۔',
    );
  }

  WorkspaceContext? get _workspace => ref.read(workspaceContextProvider);

  // ── actions ───────────────────────────────────────────────────────────

  void _startVendorEdit() {
    final AccidentVendorDetails? v = _bundle?.vendor;
    _vName.text = v?.displayName ?? widget.snapshot.accident.workshopName ?? '';
    _vCity.text = v?.vendorCity ?? '';
    _vContact.text = v?.contactName ?? '';
    _vPhone.text = v?.contactPhone ?? '';
    _vEmail.text = v?.contactEmail ?? '';
    _vReg.text = v?.registrationNo ?? '';
    _vInspector.text = v?.inspectorName ?? '';
    setState(() => _editingVendor = true);
  }

  Future<void> _saveVendor() => _run(() async {
        await ref.read(accidentDispatchRepositoryProvider).saveVendorDetails(
              accidentId: widget.snapshot.accident.id,
              repairOrderId: _bundle?.vendor?.repairOrderId,
              country: _workspace?.activeCountry,
              site: widget.snapshot.accident.site,
              input: AccidentVendorInput(
                workshopName: _vName.text,
                city: _vCity.text,
                contactName: _vContact.text,
                contactPhone: _vPhone.text,
                contactEmail: _vEmail.text,
                registrationNo: _vReg.text,
                inspectorName: _vInspector.text,
              ),
            );
        _editingVendor = false;
      });

  Future<void> _contactWorkshop() async {
    final AccidentVendorDetails? v = _bundle?.vendor;
    final String phone = v?.contactPhone?.trim() ?? '';
    final String email = v?.contactEmail?.trim() ?? '';
    final Uri uri = phone.isNotEmpty
        ? Uri(scheme: 'tel', path: phone)
        : Uri(scheme: 'mailto', path: email);
    final bool ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      setState(
        () => _actionError = WsKitCopy(context).t(
          'The workshop contact could not be opened on this device.',
          'تعذر فتح جهة اتصال الورشة على هذا الجهاز.',
          'اس ڈیوائس پر ورکشاپ رابطہ نہیں کھل سکا۔',
        ),
      );
    }
  }

  void _startDispatch() {
    _dDestination.text = _bundle?.vendor?.displayName ??
        widget.snapshot.accident.workshopName ??
        '';
    _dOrigin.text = widget.snapshot.accident.site;
    _dSignedBy.text = _workspace?.fullName ?? '';
    setState(() => _recordingDispatch = true);
  }

  Future<void> _saveDispatch() => _run(() async {
        final DateTime? departure = _dDeparture;
        if (departure == null) {
          throw ArgumentError(
            WsKitCopy(context).t(
              'Record the departure time first.',
              'سجل وقت المغادرة أولاً.',
              'پہلے روانگی کا وقت درج کریں۔',
            ),
          );
        }
        await ref.read(accidentDispatchRepositoryProvider).recordDispatch(
              accidentId: widget.snapshot.accident.id,
              repairOrderId: _bundle?.vendor?.repairOrderId,
              country: _workspace?.activeCountry,
              site: widget.snapshot.accident.site,
              sentByName: _workspace?.fullName,
              input: AccidentDispatchInput(
                departureAt: departure,
                destination: _dDestination.text,
                carrier: _dCarrier.text,
                driverName: _dDriver.text,
                recoveryVehicle: _dRecovery.text,
                origin: _dOrigin.text,
                etaAt: _dEta,
                outOdometerKm: num.tryParse(_dOdo.text.trim()),
                outEngineHours: num.tryParse(_dHours.text.trim()),
                outFuelPct: num.tryParse(_dFuel.text.trim()),
                keysCount: int.tryParse(_dKeys.text.trim()),
                documentsSent: _split(_dDocs.text),
                accessories: _split(_dAccessories.text),
                outgoingPhotoPaths: List<String>.of(_dPhotos),
                outgoingSignedBy: _dSignedBy.text,
                outgoingSignatureDataUrl: _dSignature,
              ),
            );
        _recordingDispatch = false;
        _dPhotos.clear();
        _dSignature = null;
        _dDeparture = null;
        _dEta = null;
      });

  Future<void> _acceptVehicle() => _run(() async {
        final AccidentDispatch? dispatch = _bundle?.dispatch;
        if (dispatch == null) return;
        final HandoverReceiptDraft draft = _receipt.copyWith(
          receivedByName: _rName.text,
          receivedByDesignation: _rDesignation.text,
          inOdometerKm: num.tryParse(_rOdo.text.trim()),
          inEngineHours: num.tryParse(_rHours.text.trim()),
          inFuelPct: num.tryParse(_rFuel.text.trim()),
          additionalDamageRemarks: _rRemarks.text,
        );
        await ref.read(accidentDispatchRepositoryProvider).acceptCustody(
              dispatch: dispatch,
              receipt: draft,
              country: _workspace?.activeCountry,
              site: widget.snapshot.accident.site,
            );
        _receipt = const HandoverReceiptDraft();
      });

  Future<String?> _capture(String key, AccidentPhotoSource source) async {
    try {
      return await ref.read(accidentPhotoCaptureProvider).capture(
            sessionKey: 'dispatch-${widget.snapshot.accident.id}-$key',
            source: source,
          );
    } on Object catch (error) {
      if (mounted) setState(() => _actionError = _errorText(error));
      return null;
    }
  }

  Future<DateTime?> _pickDateTime(DateTime? initial) async {
    final DateTime base = initial ?? _clock();
    final DateTime? date = await showDatePicker(
      context: context,
      initialDate: base,
      firstDate: base.subtract(const Duration(days: 365)),
      lastDate: base.add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return null;
    final TimeOfDay? time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(base),
    );
    if (time == null) return null;
    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }

  static List<String> _split(String raw) => raw
      .split(RegExp(r'[,\n;]'))
      .map((String s) => s.trim())
      .where((String s) => s.isNotEmpty)
      .toList(growable: false);

  // ── build ─────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final WsKitCopy c = WsKitCopy(context);
    final AccidentRecord record = widget.snapshot.accident;
    final AccidentDispatchBundle? bundle = _bundle;
    final AccidentDispatch? d = bundle?.dispatch;
    final AccidentVendorDetails? v = bundle?.vendor;
    final Duration? transit = transitElapsed(d, _now);
    final VendorSlaChip sla = vendorSlaChip(d, bundle?.vendorSla, _now);
    final String route = _routeLabel(c, v?.repairRoute ?? record.repairType);
    final String dispatchStatus =
        d == null ? c.notSet : dispatchLiveStateLabel(d.liveStatus);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AccidentWorkstreamHeader(
          snapshot: widget.snapshot,
          workstreamKey: 'handover',
          now: widget.clock?.call(),
        ),
        const SizedBox(height: TpSpace.md),
        AccidentMockTitle(
          c.t(
            'Dispatch & Handover',
            'الإرسال والتسليم',
            'روانگی اور حوالگی',
          ),
        ),
        const SizedBox(height: TpSpace.sm),
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            AccidentMockChip(
              label: c.t('Repair route', 'مسار الإصلاح', 'مرمت کا راستہ'),
              value: route,
              tone: TpStatus.info,
            ),
            AccidentMockChip(
              label: c.t('Dispatch status', 'حالة الإرسال', 'روانگی کی حالت'),
              value: dispatchStatus,
              tone: d == null
                  ? TpStatus.neutral
                  : d.custodyAccepted
                      ? TpStatus.ok
                      : d.isInTransit
                          ? TpStatus.warning
                          : TpStatus.info,
            ),
            AccidentMockChip(
              key: const Key('accident.dispatch.transit'),
              label: c.t('Transit elapsed', 'مدة النقل', 'سفر کا گزرا وقت'),
              value: transit == null ? c.notSet : formatElapsed(transit),
              tone:
                  transitTimerRunning(d) ? TpStatus.warning : TpStatus.neutral,
            ),
            AccidentMockChip(
              key: const Key('accident.dispatch.vendorSla'),
              label: c.t(
                'Vendor repair SLA',
                'مهلة إصلاح المورد',
                'وینڈر مرمت کی مدت',
              ),
              value: bundle?.slaReadFailed == true && d?.custodyAccepted == true
                  ? c.t(
                      'SLA unavailable',
                      'المهلة غير متاحة',
                      'مدت دستیاب نہیں',
                    )
                  : _slaLabel(c, sla),
              tone: switch (sla.tone) {
                VendorSlaTone.ok => TpStatus.ok,
                VendorSlaTone.warning => TpStatus.warning,
                VendorSlaTone.critical => TpStatus.critical,
                VendorSlaTone.running => TpStatus.info,
                VendorSlaTone.neutral => TpStatus.neutral,
              },
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        AccidentMockNotice(
          title: c.t(
            'Vendor SLA starts only after signed vehicle acceptance.',
            'تبدأ مهلة المورد فقط بعد الاستلام الموقع للمركبة.',
            'وینڈر کی مدت صرف دستخط شدہ وصولی کے بعد شروع ہوتی ہے۔',
          ),
          text: c.t(
            'The SLA clock starts when the workshop signs vehicle acceptance.',
            'يبدأ عداد المهلة عندما توقع الورشة على استلام المركبة.',
            'مدت کا وقت تب شروع ہوتا ہے جب ورکشاپ گاڑی کی وصولی پر '
                'دستخط کرے۔',
          ),
        ),
        if (_loading) ...<Widget>[
          const SizedBox(height: TpSpace.md),
          const TpLoadingState(),
        ] else if (_error != null) ...<Widget>[
          const SizedBox(height: TpSpace.md),
          AccidentMockNotice(
            tone: TpStatus.critical,
            text: _errorText(_error!),
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.secondary(
            label: c.t('Retry', 'إعادة المحاولة', 'دوبارہ کوشش کریں'),
            onPressed: _load,
          ),
        ] else ...<Widget>[
          if (bundle != null && !bundle.dispatchesProvisioned) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            AccidentMockNotice(
              tone: TpStatus.info,
              text: c.t(
                'Dispatch legs are not provisioned on this database yet. '
                    'Dispatch details, handover condition and the workshop '
                    'receipt cannot be recorded until the migration is applied.',
                'سجلات الإرسال غير مفعلة في قاعدة البيانات بعد. لا يمكن '
                    'تسجيل التفاصيل حتى يتم تطبيق الترحيل.',
                'روانگی کے ریکارڈ اس ڈیٹا بیس میں ابھی فراہم نہیں کیے '
                    'گئے۔ مائیگریشن لاگو ہونے تک تفصیلات درج نہیں ہو سکتیں۔',
              ),
            ),
          ],
          if (bundle != null && !bundle.vendorFieldsProvisioned) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            AccidentMockNotice(
              tone: TpStatus.info,
              text: c.t(
                'Vendor contact fields are not provisioned yet; only the '
                    'workshop name is stored.',
                'حقول اتصال المورد غير مفعلة بعد؛ يتم حفظ اسم الورشة فقط.',
                'وینڈر رابطہ فیلڈز ابھی فراہم نہیں؛ صرف ورکشاپ کا نام '
                    'محفوظ ہوتا ہے۔',
              ),
            ),
          ],
          if (_actionError != null) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            AccidentMockNotice(tone: TpStatus.critical, text: _actionError!),
          ],
          const SizedBox(height: TpSpace.md),
          _vendorSection(c, v, bundle),
          const SizedBox(height: TpSpace.md),
          _dispatchSection(c, d, v, bundle),
          const SizedBox(height: TpSpace.md),
          _conditionSection(c, d),
          const SizedBox(height: TpSpace.md),
          _receiptSection(c, d, bundle),
          const SizedBox(height: TpSpace.md),
          _stepper(c, d),
          const SizedBox(height: TpSpace.md),
          AccidentMockNotice(
            tone: TpStatus.info,
            text: c.t(
              'After acceptance, vendor can add inspection details, '
                  'quotation, parts, schedule and progress in its own workspace. '
                  'PO is created only after quotation review and approval.',
              'بعد الاستلام يمكن للمورد إضافة تفاصيل الفحص وعرض السعر '
                  'والقطع والجدول والتقدم في مساحته الخاصة. يُنشأ أمر '
                  'الشراء فقط بعد مراجعة عرض السعر واعتماده.',
              'قبولیت کے بعد وینڈر اپنے ورک اسپیس میں معائنہ، کوٹیشن، '
                  'پرزے، شیڈول اور پیش رفت شامل کر سکتا ہے۔ PO صرف کوٹیشن '
                  'کے جائزے اور منظوری کے بعد بنتا ہے۔',
            ),
          ),
          const SizedBox(height: TpSpace.sm),
          AccidentMockActions(
            actions: <(String, IconData, VoidCallback?)>[
              (
                c.t(
                  'Open case timeline',
                  'فتح سجل القضية',
                  'کیس ٹائم لائن کھولیں',
                ),
                Icons.timeline_outlined,
                () => widget.onNavigate('timeline')
              ),
              (
                c.t(
                  'Open workshop assessment',
                  'فتح تقييم الورشة',
                  'ورکشاپ تشخیص کھولیں',
                ),
                Icons.handyman_outlined,
                () => widget.onNavigate('assessment')
              ),
            ],
          ),
        ],
      ],
    );
  }

  String _routeLabel(WsKitCopy c, String? raw) {
    final String token = (raw ?? '').trim().toLowerCase().replaceAll(' ', '_');
    if (token.isEmpty) return c.notSet;
    for (final VocabItem tile in repairRouteTiles) {
      if (token.contains(tile.key)) return tile.label;
    }
    return humaniseAccidentToken(token);
  }

  String _slaLabel(WsKitCopy c, VendorSlaChip chip) => switch (chip.label) {
        'Not started' => c.t('Not started', 'لم تبدأ', 'شروع نہیں ہوئی'),
        'Met' => c.t('Met', 'تم الالتزام', 'پوری ہوئی'),
        'Breached' => c.t('Breached', 'تم تجاوزها', 'خلاف ورزی'),
        'Paused' => c.t('Paused', 'متوقفة', 'موقوف'),
        'Running' => c.t('Running', 'جارية', 'جاری'),
        'Cancelled' => c.t('Cancelled', 'ملغاة', 'منسوخ'),
        'Started, no SLA target' => c.t(
            'Started, no SLA target',
            'بدأت، بلا هدف مهلة',
            'شروع، کوئی ہدف نہیں',
          ),
        _ => chip.label,
      };

  // ── 1 Destination and vendor ──────────────────────────────────────────

  Widget _vendorSection(
    WsKitCopy c,
    AccidentVendorDetails? v,
    AccidentDispatchBundle? bundle,
  ) {
    final String? name =
        v?.displayName ?? widget.snapshot.accident.workshopName;
    final bool canContact = (v?.contactPhone?.trim().isNotEmpty ?? false) ||
        (v?.contactEmail?.trim().isNotEmpty ?? false);
    return AccidentMockSection(
      number: 1,
      title: c.t('Destination and vendor', 'الوجهة والمورد', 'منزل اور وینڈر'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (_editingVendor)
            _vendorForm(c)
          else ...<Widget>[
            AccidentMockFacts(
              items: <(String, String?)>[
                (c.t('Workshop name', 'اسم الورشة', 'ورکشاپ کا نام'), name),
                (c.t('City', 'المدينة', 'شہر'), v?.vendorCity),
                (
                  c.t('Vendor contact name', 'اسم جهة الاتصال', 'رابطہ کا نام'),
                  v?.contactName
                ),
                (c.t('Phone', 'الهاتف', 'فون'), v?.contactPhone),
                (c.t('Email', 'البريد الإلكتروني', 'ای میل'), v?.contactEmail),
                (
                  c.t(
                    'Workshop registration / tax no.',
                    'رقم تسجيل الورشة / الضريبة',
                    'ورکشاپ رجسٹریشن / ٹیکس نمبر',
                  ),
                  v?.registrationNo
                ),
                (
                  c.t(
                    'Assigned vendor inspector',
                    'مفتش المورد المعين',
                    'مقررہ وینڈر معائنہ کار',
                  ),
                  v?.inspectorName?.trim().isNotEmpty == true
                      ? v!.inspectorName
                      : c.t('Unassigned', 'غير معين', 'غیر مقرر')
                ),
              ],
            ),
            const SizedBox(height: TpSpace.sm),
            AccidentMockActions(
              actions: <(String, IconData, VoidCallback?)>[
                (
                  c.t(
                    'Edit vendor details',
                    'تعديل بيانات المورد',
                    'وینڈر کی تفصیلات بدلیں',
                  ),
                  Icons.edit_outlined,
                  _busy ? null : _startVendorEdit
                ),
                (
                  c.t('Contact workshop', 'الاتصال بالورشة', 'ورکشاپ سے رابطہ'),
                  Icons.call_outlined,
                  canContact && !_busy ? _contactWorkshop : null
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _vendorForm(WsKitCopy c) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          TpInput(
            label: c.t('Workshop name', 'اسم الورشة', 'ورکشاپ کا نام'),
            controller: _vName,
            isRequired: true,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t('City', 'المدينة', 'شہر'),
            controller: _vCity,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t(
              'Vendor contact name',
              'اسم جهة الاتصال',
              'رابطہ کا نام',
            ),
            controller: _vContact,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t('Phone', 'الهاتف', 'فون'),
            controller: _vPhone,
            keyboardType: TextInputType.phone,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t('Email', 'البريد الإلكتروني', 'ای میل'),
            controller: _vEmail,
            keyboardType: TextInputType.emailAddress,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t(
              'Workshop registration / tax no.',
              'رقم تسجيل الورشة / الضريبة',
              'ورکشاپ رجسٹریشن / ٹیکس نمبر',
            ),
            controller: _vReg,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t(
              'Assigned vendor inspector',
              'مفتش المورد المعين',
              'مقررہ وینڈر معائنہ کار',
            ),
            controller: _vInspector,
          ),
          const SizedBox(height: TpSpace.md),
          Row(
            children: <Widget>[
              Expanded(
                child: TpButton.secondary(
                  label: c.t('Cancel', 'إلغاء', 'منسوخ'),
                  onPressed: _busy
                      ? null
                      : () => setState(() => _editingVendor = false),
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: TpButton.primary(
                  label: c.t('Save vendor', 'حفظ المورد', 'وینڈر محفوظ کریں'),
                  isBusy: _busy,
                  onPressed: _busy ? null : _saveVendor,
                ),
              ),
            ],
          ),
        ],
      );

  // ── 2 Dispatch details ────────────────────────────────────────────────

  Widget _dispatchSection(
    WsKitCopy c,
    AccidentDispatch? d,
    AccidentVendorDetails? v,
    AccidentDispatchBundle? bundle,
  ) {
    final bool canRecord =
        d == null && (bundle?.dispatchesProvisioned ?? false) && !_busy;
    return AccidentMockSection(
      number: 2,
      title: c.t('Dispatch details', 'تفاصيل الإرسال', 'روانگی کی تفصیلات'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (_recordingDispatch)
            _dispatchForm(c)
          else ...<Widget>[
            AccidentMockFacts(
              items: <(String, String?)>[
                (
                  c.t('Sent by', 'أرسل بواسطة', 'روانہ کرنے والا'),
                  d?.sentByName
                ),
                (
                  c.t('Departure', 'المغادرة', 'روانگی'),
                  d?.departureAt == null
                      ? null
                      : accidentMockDateTime(context, d!.departureAt!)
                ),
                (c.t('Carrier', 'الناقل', 'ٹرانسپورٹر'), d?.carrier),
                (c.t('Driver', 'السائق', 'ڈرائیور'), d?.driverName),
                (
                  c.t('Recovery vehicle', 'مركبة النقل', 'ریکوری گاڑی'),
                  d?.recoveryVehicle
                ),
                (c.t('Origin', 'نقطة الانطلاق', 'روانگی کی جگہ'), d?.origin),
                (
                  c.t('Destination', 'الوجهة', 'منزل'),
                  d?.destination ?? v?.displayName
                ),
                (
                  c.t('Estimated arrival', 'الوصول المتوقع', 'متوقع آمد'),
                  d?.etaAt == null
                      ? null
                      : accidentMockDateTime(context, d!.etaAt!)
                ),
              ],
            ),
            const SizedBox(height: TpSpace.sm),
            Row(
              children: <Widget>[
                Text(
                  c.t('Live status', 'الحالة الحية', 'موجودہ حالت'),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(width: TpSpace.sm),
                Flexible(
                  child: TpStatusChip(
                    status: d == null
                        ? TpStatus.unknown
                        : d.custodyAccepted
                            ? TpStatus.ok
                            : d.isInTransit
                                ? TpStatus.warning
                                : TpStatus.info,
                    label: d == null
                        ? c.notSet
                        : dispatchLiveStateLabel(d.liveStatus),
                    isCompact: true,
                  ),
                ),
              ],
            ),
            if (d == null) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              AccidentMockActions(
                actions: <(String, IconData, VoidCallback?)>[
                  (
                    c.t('Record dispatch', 'تسجيل الإرسال', 'روانگی درج کریں'),
                    Icons.local_shipping_outlined,
                    canRecord ? _startDispatch : null
                  ),
                ],
              ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _dispatchForm(WsKitCopy c) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          _timeRow(
            c,
            label: c.t('Departure', 'المغادرة', 'روانگی'),
            value: _dDeparture,
            onPick: () async {
              final DateTime? picked = await _pickDateTime(_dDeparture);
              if (picked != null) setState(() => _dDeparture = picked);
            },
            onNow: () => setState(() => _dDeparture = _clock()),
          ),
          TpInput(
            label: c.t('Destination', 'الوجهة', 'منزل'),
            controller: _dDestination,
            isRequired: true,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t('Carrier', 'الناقل', 'ٹرانسپورٹر'),
            controller: _dCarrier,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t('Driver', 'السائق', 'ڈرائیور'),
            controller: _dDriver,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t('Recovery vehicle', 'مركبة النقل', 'ریکوری گاڑی'),
            controller: _dRecovery,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t('Origin', 'نقطة الانطلاق', 'روانگی کی جگہ'),
            controller: _dOrigin,
          ),
          const SizedBox(height: TpSpace.sm),
          _timeRow(
            c,
            label: c.t('Estimated arrival', 'الوصول المتوقع', 'متوقع آمد'),
            value: _dEta,
            onPick: () async {
              final DateTime? picked = await _pickDateTime(_dEta);
              if (picked != null) setState(() => _dEta = picked);
            },
          ),
          TpInput(
            label: c.t(
              'Odometer (km)',
              'عداد المسافة (كم)',
              'اوڈومیٹر (کلومیٹر)',
            ),
            controller: _dOdo,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t('Engine hours', 'ساعات المحرك', 'انجن کے گھنٹے'),
            controller: _dHours,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t('Fuel %', 'الوقود %', 'ایندھن %'),
            controller: _dFuel,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t('Keys', 'المفاتيح', 'چابیاں'),
            controller: _dKeys,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t(
              'Documents sent (one per line)',
              'المستندات المرسلة (كل مستند في سطر)',
              'ارسال کردہ دستاویزات (ہر سطر میں ایک)',
            ),
            controller: _dDocs,
            maxLines: 3,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t(
              'Accessories / checklist (one per line)',
              'الملحقات / قائمة التحقق (كل عنصر في سطر)',
              'لوازمات / چیک لسٹ (ہر سطر میں ایک)',
            ),
            controller: _dAccessories,
            maxLines: 3,
          ),
          const SizedBox(height: TpSpace.sm),
          _photoRow(
            c,
            label: c.t(
              'Outgoing damage photos',
              'صور الأضرار عند التسليم',
              'روانگی کے نقصان کی تصاویر',
            ),
            count: _dPhotos.length,
            onAdd: (AccidentPhotoSource source) async {
              final String? path = await _capture('out', source);
              if (path != null) setState(() => _dPhotos.add(path));
            },
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t(
              'Outgoing condition signed by',
              'موقع حالة التسليم',
              'روانگی کی حالت پر دستخط کنندہ',
            ),
            controller: _dSignedBy,
          ),
          const SizedBox(height: TpSpace.sm),
          Text(
            c.t('Outgoing signature', 'توقيع التسليم', 'روانگی کے دستخط'),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: TpSpace.xs),
          InspectionSignaturePad(
            height: 140,
            onChanged: (InspectionSignatureCapture? capture) =>
                setState(() => _dSignature = capture?.dataUrl),
          ),
          const SizedBox(height: TpSpace.md),
          Row(
            children: <Widget>[
              Expanded(
                child: TpButton.secondary(
                  label: c.t('Cancel', 'إلغاء', 'منسوخ'),
                  onPressed: _busy
                      ? null
                      : () => setState(() => _recordingDispatch = false),
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: TpButton.primary(
                  label: c.t(
                    'Save dispatch',
                    'حفظ الإرسال',
                    'روانگی محفوظ کریں',
                  ),
                  isBusy: _busy,
                  onPressed: _busy ? null : _saveDispatch,
                ),
              ),
            ],
          ),
        ],
      );

  // ── 3 Vehicle handover condition ──────────────────────────────────────

  Widget _conditionSection(WsKitCopy c, AccidentDispatch? d) =>
      AccidentMockSection(
        number: 3,
        title: c.t(
          'Vehicle handover condition',
          'حالة تسليم المركبة',
          'حوالگی کے وقت گاڑی کی حالت',
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            AccidentMockFacts(
              items: <(String, String?)>[
                (
                  c.t('Odometer', 'عداد المسافة', 'اوڈومیٹر'),
                  d?.outOdometerKm == null ? null : '${d!.outOdometerKm} km'
                ),
                (
                  c.t('Engine hours', 'ساعات المحرك', 'انجن کے گھنٹے'),
                  d?.outEngineHours?.toString()
                ),
                (
                  c.t('Fuel', 'الوقود', 'ایندھن'),
                  d?.outFuelPct == null ? null : '${d!.outFuelPct}%'
                ),
                (c.t('Keys', 'المفاتيح', 'چابیاں'), d?.keysCount?.toString()),
              ],
            ),
            AccidentMockCountedList(
              label: c.t(
                'Documents sent',
                'المستندات المرسلة',
                'ارسال کردہ دستاویزات',
              ),
              items: d?.documentsSent ?? const <String>[],
              unit: c.t('documents', 'مستندات', 'دستاویزات'),
            ),
            AccidentMockCountedList(
              label: c.t(
                'Accessories / checklist',
                'الملحقات / قائمة التحقق',
                'لوازمات / چیک لسٹ',
              ),
              items: d?.accessories ?? const <String>[],
              unit: c.t('items', 'عناصر', 'اشیاء'),
            ),
            AccidentMockFacts(
              items: <(String, String?)>[
                (
                  c.t(
                    'Outgoing damage photos',
                    'صور الأضرار عند التسليم',
                    'روانگی کے نقصان کی تصاویر',
                  ),
                  d == null || d.outgoingPhotos.isEmpty
                      ? null
                      : '${d.outgoingPhotos.length} '
                          '${c.t('photos', 'صور', 'تصاویر')}'
                ),
                (
                  c.t(
                    'Outgoing condition signed by',
                    'موقع حالة التسليم',
                    'روانگی کی حالت پر دستخط کنندہ',
                  ),
                  d?.outgoingSignedBy == null
                      ? null
                      : <String>[
                          d!.outgoingSignedBy!,
                          if (d.outgoingSignedAt != null)
                            accidentMockDateTime(context, d.outgoingSignedAt!),
                        ].join(' · ')
                ),
              ],
            ),
            if (d?.outgoingSignature != null) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              _StoredImage(reference: d!.outgoingSignature!, height: 120),
            ],
          ],
        ),
      );

  // ── 4 Workshop receipt ────────────────────────────────────────────────

  Widget _receiptSection(
    WsKitCopy c,
    AccidentDispatch? d,
    AccidentDispatchBundle? bundle,
  ) {
    if (d != null && d.custodyAccepted) {
      return AccidentMockSection(
        number: 4,
        title: c.t('Workshop receipt', 'استلام الورشة', 'ورکشاپ کی وصولی'),
        subtitle: c.t(
          'Completed by vendor',
          'أكملها المورد',
          'وینڈر نے مکمل کیا',
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            AccidentMockFacts(
              items: <(String, String?)>[
                (
                  c.t('Arrived', 'الوصول', 'آمد'),
                  d.arrivedAt == null
                      ? null
                      : accidentMockDateTime(context, d.arrivedAt!)
                ),
                (
                  c.t('Received by', 'المستلم', 'وصول کنندہ'),
                  <String?>[d.receivedByName, d.receivedByDesignation]
                      .whereType<String>()
                      .join(' · ')
                ),
                (
                  c.t(
                    'Incoming odometer',
                    'عداد المسافة عند الوصول',
                    'آمد کا اوڈومیٹر',
                  ),
                  d.inOdometerKm == null ? null : '${d.inOdometerKm} km'
                ),
                (
                  c.t(
                    'Incoming engine hours',
                    'ساعات المحرك عند الوصول',
                    'آمد کے انجن گھنٹے',
                  ),
                  d.inEngineHours?.toString()
                ),
                (
                  c.t('Incoming fuel', 'الوقود عند الوصول', 'آمد کا ایندھن'),
                  d.inFuelPct == null ? null : '${d.inFuelPct}%'
                ),
                (
                  c.t(
                    'Condition matches dispatch',
                    'الحالة تطابق التسليم',
                    'حالت روانگی سے مطابقت رکھتی ہے',
                  ),
                  d.conditionMatches == null
                      ? null
                      : d.conditionMatches!
                          ? c.t('Yes', 'نعم', 'ہاں')
                          : c.t('No', 'لا', 'نہیں')
                ),
                (
                  c.t(
                    'Additional damage / remarks',
                    'أضرار إضافية / ملاحظات',
                    'اضافی نقصان / تبصرے',
                  ),
                  d.additionalDamageRemarks
                ),
                (
                  c.t('Receiving photos', 'صور الاستلام', 'وصولی کی تصاویر'),
                  d.receivingPhotos.isEmpty
                      ? null
                      : '${d.receivingPhotos.length} '
                          '${c.t('photos', 'صور', 'تصاویر')}'
                ),
                (
                  c.t('Custody accepted', 'تم قبول العهدة', 'تحویل قبول'),
                  d.acceptedAt == null
                      ? c.t('Yes', 'نعم', 'ہاں')
                      : accidentMockDateTime(context, d.acceptedAt!)
                ),
              ],
            ),
            if (d.receiverSignature != null) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              Text(
                c.t(
                  'Vendor receiver signature',
                  'توقيع مستلم المورد',
                  'وینڈر وصول کنندہ کے دستخط',
                ),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              _StoredImage(reference: d.receiverSignature!, height: 120),
            ],
            if (d.senderSignature != null) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              Text(
                c.t(
                  'Sender / driver signature',
                  'توقيع المرسل / السائق',
                  'بھیجنے والے / ڈرائیور کے دستخط',
                ),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              _StoredImage(reference: d.senderSignature!, height: 120),
            ],
          ],
        ),
      );
    }

    final HandoverReceiptDraft draft = _receipt.copyWith(
      receivedByName: _rName.text,
      receivedByDesignation: _rDesignation.text,
    );
    final List<String> missing = receiptMissing(draft.toFieldMap());
    final bool enabled = canSignAndAccept(draft, dispatch: d) && !_busy;
    return AccidentMockSection(
      number: 4,
      title: c.t('Workshop receipt', 'استلام الورشة', 'ورکشاپ کی وصولی'),
      subtitle: c.t(
        'Completed by vendor',
        'يكملها المورد',
        'وینڈر مکمل کرے گا',
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (d == null)
            AccidentMockNotice(
              tone: TpStatus.info,
              text: c.t(
                'No dispatch leg is recorded yet. Record the dispatch first; '
                    'the receipt is signed against it.',
                'لم يُسجل إرسال بعد. سجّل الإرسال أولاً؛ يُوقع الاستلام '
                    'عليه.',
                'ابھی کوئی روانگی درج نہیں۔ پہلے روانگی درج کریں؛ وصولی اسی '
                    'پر دستخط ہوتی ہے۔',
              ),
            ),
          _timeRow(
            c,
            label: c.t(
              'Arrived date / time *',
              'تاريخ / وقت الوصول *',
              'آمد کی تاریخ / وقت *',
            ),
            value: _receipt.arrivedAt,
            onPick: () async {
              final DateTime? picked = await _pickDateTime(_receipt.arrivedAt);
              if (picked != null) {
                setState(
                  () => _receipt = _receipt.copyWith(arrivedAt: picked),
                );
              }
            },
            onNow: () => setState(
              () => _receipt = _receipt.copyWith(arrivedAt: _clock()),
            ),
          ),
          TpInput(
            label: c.t(
              'Received by (name) *',
              'المستلم (الاسم) *',
              'وصول کنندہ (نام) *',
            ),
            controller: _rName,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t('Designation *', 'الوظيفة *', 'عہدہ *'),
            controller: _rDesignation,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t(
              'Incoming odometer (km)',
              'عداد المسافة عند الوصول',
              'آمد کا اوڈومیٹر',
            ),
            controller: _rOdo,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t(
              'Incoming engine hours',
              'ساعات المحرك عند الوصول',
              'آمد کے انجن گھنٹے',
            ),
            controller: _rHours,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t(
              'Incoming fuel %',
              'الوقود عند الوصول %',
              'آمد کا ایندھن %',
            ),
            controller: _rFuel,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: TpSpace.md),
          Text(
            c.t(
              'Condition matches dispatch',
              'الحالة تطابق التسليم',
              'حالت روانگی سے مطابقت رکھتی ہے',
            ),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: TpSpace.xs),
          TpSegmented<int>(
            value: switch (_receipt.conditionMatches) {
              true => 1,
              false => 0,
              null => -1,
            },
            options: <TpSegmentedOption<int>>[
              TpSegmentedOption<int>(
                value: 1,
                label: c.t('Yes', 'نعم', 'ہاں'),
              ),
              TpSegmentedOption<int>(
                value: 0,
                label: c.t('No', 'لا', 'نہیں'),
              ),
            ],
            onChanged: (int value) => setState(
              () => _receipt = _receipt.copyWith(conditionMatches: value == 1),
            ),
          ),
          const SizedBox(height: TpSpace.sm),
          TpInput(
            label: c.t(
              'Additional damage / remarks',
              'أضرار إضافية / ملاحظات',
              'اضافی نقصان / تبصرے',
            ),
            controller: _rRemarks,
            maxLines: 3,
          ),
          const SizedBox(height: TpSpace.sm),
          _photoRow(
            c,
            label: c.t(
              'Upload receiving photos *',
              'رفع صور الاستلام *',
              'وصولی کی تصاویر اپ لوڈ کریں *',
            ),
            count: _receipt.receivingPhotos.length,
            onAdd: (AccidentPhotoSource source) async {
              final String? path = await _capture('receipt', source);
              if (path != null) {
                setState(
                  () => _receipt = _receipt.copyWith(
                    receivingPhotos: <String>[
                      ..._receipt.receivingPhotos,
                      path,
                    ],
                  ),
                );
              }
            },
          ),
          const SizedBox(height: TpSpace.sm),
          _photoRow(
            c,
            label: c.t(
              'Upload signed handover paper *',
              'رفع ورقة التسليم الموقعة *',
              'دستخط شدہ حوالگی کاغذ اپ لوڈ کریں *',
            ),
            count: _receipt.handoverPaperRef == null ? 0 : 1,
            onAdd: (AccidentPhotoSource source) async {
              final String? path = await _capture('paper', source);
              if (path != null) {
                setState(
                  () => _receipt = _receipt.copyWith(handoverPaperRef: path),
                );
              }
            },
          ),
          const SizedBox(height: TpSpace.md),
          Text(
            c.t(
              'Vendor receiver signature *',
              'توقيع مستلم المورد *',
              'وینڈر وصول کنندہ کے دستخط *',
            ),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: TpSpace.xs),
          InspectionSignaturePad(
            key: const Key('accident.receipt.receiverSignature'),
            height: 140,
            onChanged: (InspectionSignatureCapture? capture) => setState(
              () => _receipt = capture == null
                  ? _receipt.copyWith(clearReceiverSignature: true)
                  : _receipt.copyWith(receiverSignature: capture.dataUrl),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          Text(
            c.t(
              'Sender / driver signature (captured)',
              'توقيع المرسل / السائق (مسجل)',
              'بھیجنے والے / ڈرائیور کے دستخط (ریکارڈ شدہ)',
            ),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: TpSpace.xs),
          InspectionSignaturePad(
            key: const Key('accident.receipt.senderSignature'),
            height: 140,
            onChanged: (InspectionSignatureCapture? capture) => setState(
              () => _receipt = capture == null
                  ? _receipt.copyWith(clearSenderSignature: true)
                  : _receipt.copyWith(senderSignature: capture.dataUrl),
            ),
          ),
          CheckboxListTile(
            key: const Key('accident.receipt.custody'),
            contentPadding: EdgeInsets.zero,
            value: _receipt.custodyAccepted,
            onChanged: d == null || _busy
                ? null
                : (bool? value) => setState(
                      () => _receipt =
                          _receipt.copyWith(custodyAccepted: value ?? false),
                    ),
            title: Text(
              c.t(
                'I accept custody of this vehicle',
                'أقبل عهدة هذه المركبة',
                'میں اس گاڑی کی تحویل قبول کرتا ہوں',
              ),
            ),
          ),
          FilledButton.icon(
            key: const Key('accident.receipt.accept'),
            onPressed: enabled ? _acceptVehicle : null,
            icon: const Icon(Icons.lock_outline),
            label: Text(
              c.t(
                'Sign and accept vehicle',
                'التوقيع واستلام المركبة',
                'دستخط کرکے گاڑی قبول کریں',
              ),
            ),
          ),
          if (!enabled) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(
              c.t(
                'Complete all required fields to enable',
                'أكمل جميع الحقول المطلوبة للتفعيل',
                'فعال کرنے کے لیے تمام مطلوبہ فیلڈز مکمل کریں',
              ),
              key: const Key('accident.receipt.gateHint'),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: TpPalette.of(context).textMuted,
                  ),
            ),
            if (missing.isNotEmpty)
              Text(
                '${c.t('Missing', 'الناقص', 'باقی')}: '
                '${missing.map((String k) => _fieldLabel(c, k)).join(', ')}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
          ],
        ],
      ),
    );
  }

  String _fieldLabel(WsKitCopy c, String key) => switch (key) {
        'arrived_at' => c.t('Arrived date / time', 'وقت الوصول', 'آمد کا وقت'),
        'received_by_name' => c.t('Received by', 'المستلم', 'وصول کنندہ'),
        'received_by_designation' => c.t('Designation', 'الوظيفة', 'عہدہ'),
        'receiving_photos' =>
          c.t('Receiving photos', 'صور الاستلام', 'وصولی کی تصاویر'),
        'handover_paper_ref' =>
          c.t('Signed handover paper', 'ورقة التسليم', 'حوالگی کاغذ'),
        'receiver_signature' =>
          c.t('Vendor receiver signature', 'توقيع المستلم', 'وصول کنندہ دستخط'),
        'custody_accepted' =>
          c.t('Custody checkbox', 'مربع قبول العهدة', 'تحویل کا خانہ'),
        _ => key,
      };

  // ── stepper ───────────────────────────────────────────────────────────

  Widget _stepper(WsKitCopy c, AccidentDispatch? d) {
    final TpPalette palette = TpPalette.of(context);
    return AccidentMockPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (final NumberedStep step in dispatchStepper)
            Builder(
              builder: (BuildContext context) {
                final DispatchStepState state = dispatchStepState(step.key, d);
                final DateTime? at = dispatchStepTime(step.key, d);
                final TpStatus tone = switch (state) {
                  DispatchStepState.complete => TpStatus.ok,
                  DispatchStepState.next => TpStatus.info,
                  DispatchStepState.pending => TpStatus.neutral,
                };
                final String label = switch (state) {
                  DispatchStepState.complete =>
                    c.t('Complete', 'مكتمل', 'مکمل'),
                  DispatchStepState.next => c.t('Next', 'التالي', 'اگلا'),
                  DispatchStepState.pending =>
                    c.t('Pending', 'قيد الانتظار', 'زیر التوا'),
                };
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      CircleAvatar(
                        radius: 12,
                        backgroundColor: palette.forStatus(tone).base,
                        child: Text(
                          '${step.n}',
                          style: TextStyle(
                            color: palette.forStatus(tone).onBase,
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      const SizedBox(width: TpSpace.sm),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              _stepLabel(c, step.key),
                              style:
                                  const TextStyle(fontWeight: FontWeight.w700),
                            ),
                            Text(
                              at == null
                                  ? c.notSet
                                  : accidentMockDateTime(context, at),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                      TpStatusChip(status: tone, label: label, isCompact: true),
                    ],
                  ),
                );
              },
            ),
        ],
      ),
    );
  }

  String _stepLabel(WsKitCopy c, String key) => switch (key) {
        'dispatched' => c.t('Dispatched', 'تم الإرسال', 'روانہ'),
        'arrived' => c.t('Arrived', 'وصلت', 'پہنچ گئی'),
        'signed_acceptance' =>
          c.t('Signed acceptance', 'الاستلام الموقع', 'دستخط شدہ قبولیت'),
        _ => c.t(
            'Vendor assessment / quotation starts',
            'يبدأ تقييم المورد / عرض السعر',
            'وینڈر تشخیص / کوٹیشن شروع',
          ),
      };

  // ── small form rows ───────────────────────────────────────────────────

  Widget _timeRow(
    WsKitCopy c, {
    required String label,
    required DateTime? value,
    required Future<void> Function() onPick,
    VoidCallback? onNow,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: TpSpace.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(label, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: TpSpace.xs),
            Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.xs,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                Text(
                  value == null
                      ? c.notSet
                      : accidentMockDateTime(context, value),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => unawaited(onPick()),
                  icon: const Icon(Icons.event_outlined),
                  label: Text(c.t('Pick', 'اختيار', 'منتخب کریں')),
                ),
                if (onNow != null)
                  OutlinedButton.icon(
                    onPressed: _busy ? null : onNow,
                    icon: const Icon(Icons.schedule_outlined),
                    label: Text(c.t('Use now', 'الآن', 'ابھی')),
                  ),
              ],
            ),
          ],
        ),
      );

  Widget _photoRow(
    WsKitCopy c, {
    required String label,
    required int count,
    required Future<void> Function(AccidentPhotoSource source) onAdd,
  }) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: TpSpace.xs),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              Text(
                count == 0
                    ? c.notSet
                    : '$count ${c.t('attached', 'مرفقة', 'منسلک')}',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              OutlinedButton.icon(
                onPressed: _busy
                    ? null
                    : () => unawaited(onAdd(AccidentPhotoSource.camera)),
                icon: const Icon(Icons.photo_camera_outlined),
                label: Text(c.t('Camera', 'الكاميرا', 'کیمرہ')),
              ),
              OutlinedButton.icon(
                onPressed: _busy
                    ? null
                    : () => unawaited(onAdd(AccidentPhotoSource.gallery)),
                icon: const Icon(Icons.photo_library_outlined),
                label: Text(c.t('Gallery', 'المعرض', 'گیلری')),
              ),
            ],
          ),
        ],
      );
}

/// Renders a stored signature or photo: a `data:` URL from memory, a
/// `tp-storage://` reference through the authenticated resolver.
class _StoredImage extends ConsumerWidget {
  const _StoredImage({required this.reference, required this.height});
  final String reference;
  final double height;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpPalette palette = TpPalette.of(context);
    final BoxDecoration frame = BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(TpRadius.md),
      border: Border.all(color: palette.border),
    );
    if (reference.startsWith('data:image/')) {
      final int comma = reference.indexOf(',');
      return Container(
        height: height,
        decoration: frame,
        child: Image.memory(
          base64Decode(comma < 0 ? reference : reference.substring(comma + 1)),
          fit: BoxFit.contain,
          errorBuilder: (_, __, ___) => const SizedBox.shrink(),
        ),
      );
    }
    if (!reference.startsWith('tp-storage://')) {
      return TpIdentifierText(reference, maxLines: 1);
    }
    final AsyncValue<String> url =
        ref.watch(accidentEvidenceUrlProvider(reference));
    return Container(
      height: height,
      decoration: frame,
      child: url.when(
        data: (String value) => Image.network(
          value,
          fit: BoxFit.contain,
          errorBuilder: (_, __, ___) => const Center(
            child: Icon(Icons.broken_image_outlined),
          ),
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => const Center(child: Icon(Icons.lock_outline)),
      ),
    );
  }
}
