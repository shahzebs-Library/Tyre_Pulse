/// Widget regression coverage for the enriched checklist runner.
///
/// The production controller is replaced by a notifier that starts with a
/// fully-decoded template/draft state.  This keeps the tests at the real
/// presentation boundary (the screen, field tiles, fixed dock and callbacks)
/// without fabricating a repository or bypassing the controller seam.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_submit_gate.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';
import 'package:tyre_pulse/features/checklists/presentation/checklist_fill_screen.dart';
import 'package:tyre_pulse/features/checklists/presentation/controllers/checklist_fill_controller.dart';
import 'package:tyre_pulse/features/checklists/presentation/state/checklist_fill_state.dart';
import 'package:tyre_pulse/features/checklists/presentation/widgets/checklist_field_answer_tile.dart';
import 'package:tyre_pulse/features/checklists/presentation/widgets/checklist_signature_pad.dart';

const ChecklistField _mode = ChecklistField(
  id: 'mode',
  type: 'select',
  label: 'Inspection mode',
  options: <String>['hide', 'show'],
);
const ChecklistField _preStart = ChecklistField(
  id: 'pre_start',
  type: 'section',
  label: 'PRE-START',
  labels: <String, String>{
    'ar': 'قبل البدء',
    'hi': 'शुरू करने से पहले',
    'ur': 'شروع کرنے سے پہلے',
  },
);
const ChecklistField _engine = ChecklistField(
  id: 'engine',
  type: 'text',
  label: 'Engine condition',
  labels: <String, String>{
    'ar': 'حالة المحرك',
    'hi': 'इंजन की स्थिति',
    'ur': 'انجن کی حالت',
  },
  required: true,
);
const ChecklistField _hidden = ChecklistField(
  id: 'hidden_required',
  type: 'text',
  label: 'Hidden follow-up',
  required: true,
  visibleWhen: <ChecklistVisibleCondition>[
    ChecklistVisibleCondition(field: 'mode', op: '=', value: 'show'),
  ],
);
const ChecklistField _safety = ChecklistField(
  id: 'safety_section',
  type: 'section',
  label: 'SAFETY & EVIDENCE',
  labels: <String, String>{
    'ar': 'السلامة والأدلة',
    'hi': 'सुरक्षा और प्रमाण',
    'ur': 'حفاظت اور ثبوت',
  },
);
const ChecklistField _brakes = ChecklistField(
  id: 'brakes',
  type: 'boolean',
  label: 'Brakes operational',
  required: true,
);
const ChecklistField _photo = ChecklistField(
  id: 'evidence',
  type: 'photo',
  label: 'Photo evidence',
  required: true,
  allowGallery: true,
);
const ChecklistField _signature = ChecklistField(
  id: 'operator_signature',
  type: 'signature',
  label: 'Operator signature',
  required: true,
);

const ChecklistTemplateRecord _record = ChecklistTemplateRecord(
  template: ChecklistTemplate(
    id: 'daily-pmv',
    name: 'Daily PMV Inspection',
    fields: <ChecklistField>[
      _mode,
      _preStart,
      _engine,
      _hidden,
      _safety,
      _brakes,
      _photo,
      _signature,
    ],
  ),
  requireSignature: true,
);

// One valid 1x1 PNG. The capture widget's persistence contract is a data URL;
// using real decodable bytes also exercises its completed-preview branch.
const String _signatureDataUrl = 'data:image/png;base64,'
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk'
    'YAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

ChecklistSubmitGate _gate({
  required Map<String, Object?> answers,
  Map<String, String> signatures = const <String, String>{},
  String? primarySignature,
  Map<String, int> photoCounts = const <String, int>{},
}) {
  return evaluateChecklistSubmitGate(
    template: _record.template,
    answers: answers,
    notes: const <String, Object?>{},
    signatures: signatures,
    photoCounts: photoCounts,
    templateRequiresSignature: _record.requireSignature,
    primarySignature: primarySignature,
  );
}

ChecklistFillState _state({
  bool complete = false,
  String readLang = 'en',
}) {
  final Map<String, Object?> answers = <String, Object?>{
    'mode': 'hide',
    'engine': 'Good',
    if (complete) 'brakes': true,
  };
  final Map<String, String> signatures = <String, String>{
    if (complete) 'operator_signature': _signatureDataUrl,
  };
  final String? primarySignature = complete ? _signatureDataUrl : null;
  return ChecklistFillState(
    phase: ChecklistFillPhase.ready,
    templateRecord: _record,
    draftKey: 'draft-1',
    answers: answers,
    signaturesByField: signatures,
    primarySignature: primarySignature,
    photosByField: <String, List<ChecklistDraftPhoto>>{
      if (complete)
        'evidence': <ChecklistDraftPhoto>[
          ChecklistDraftPhoto(
            id: 'photo-1',
            fieldKey: 'evidence',
            localPath: 'missing-test-photo.jpg',
            capturedAt: DateTime(2026, 8, 28),
          ),
        ],
    },
    printedName: 'Operator One',
    siteOptions: const <String>['North Yard', 'South Yard'],
    site: 'North Yard',
    assetNo: 'TM-514',
    readLang: readLang,
    submitGate: _gate(
      answers: answers,
      signatures: signatures,
      primarySignature: primarySignature,
      photoCounts:
          complete ? const <String, int>{'evidence': 1} : const <String, int>{},
    ),
  );
}

final class _TestChecklistFillController extends ChecklistFillController {
  _TestChecklistFillController(this.initialState);

  final ChecklistFillState initialState;
  final List<MapEntry<String, Object?>> answerUpdates =
      <MapEntry<String, Object?>>[];
  final List<String> printedNameUpdates = <String>[];
  final List<String?> siteUpdates = <String?>[];
  final List<String> languageUpdates = <String>[];
  int submitCalls = 0;

  @override
  ChecklistFillState build() => initialState;

  @override
  Future<void> initialiseFromRoute(ChecklistFillRoute route) async {}

  @override
  void updateAnswer(String fieldId, Object? value) {
    answerUpdates.add(MapEntry<String, Object?>(fieldId, value));
    state = state.copyWith(
      answers: <String, Object?>{...state.answers, fieldId: value},
    );
  }

  @override
  void setPrintedName(String value) {
    printedNameUpdates.add(value);
    state = state.copyWith(printedName: value);
  }

  @override
  void setSite(String? site) {
    siteUpdates.add(site);
    state = state.copyWith(site: site);
  }

  @override
  void setReadLang(String lang) {
    languageUpdates.add(lang);
    state = state.copyWith(readLang: lang);
  }

  @override
  Future<bool> submit() async {
    submitCalls += 1;
    return true;
  }
}

Future<_TestChecklistFillController> _pump(
  WidgetTester tester, {
  required ChecklistFillState state,
  Locale appLocale = const Locale('en'),
  Size size = const Size(800, 3000),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final _TestChecklistFillController controller =
      _TestChecklistFillController(state);
  final List<Override> overrides = <Override>[
    checklistFillControllerProvider.overrideWith(() => controller),
  ];
  await tester.pumpWidget(
    ProviderScope(
      key: UniqueKey(),
      overrides: overrides,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: appLocale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const ChecklistFillScreen(
          route: ChecklistFillRoute(templateId: TemplateId('daily-pmv')),
        ),
      ),
    ),
  );
  await tester.pump();
  return controller;
}

void main() {
  testWidgets(
    'compact 360x640 keeps the lively hierarchy and fixed submit dock '
    'without an overflow',
    (WidgetTester tester) async {
      await _pump(
        tester,
        state: _state(),
        size: const Size(360, 640),
      );

      expect(tester.takeException(), isNull);
      expect(find.text('Daily PMV Inspection'), findsOneWidget);
      expect(find.text('TM-514'), findsOneWidget);
      expect(find.text('2 of 5 answered'), findsNWidgets(2));
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      // Asset selection and verified identity occupy the first viewport.
      // Scroll to build the section rail before checking its labels.
      await tester.drag(find.byType(ListView), const Offset(0, -400));
      await tester.pump();
      expect(find.text('PRE-START'), findsOneWidget);
      expect(find.text('SAFETY & EVIDENCE'), findsOneWidget);

      final Scaffold scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
      expect(scaffold.bottomNavigationBar, isNotNull);
      final Finder submit = find.widgetWithText(TpButton, 'Submit checklist');
      expect(submit, findsOneWidget);
      expect(tester.getBottomRight(submit).dy, lessThanOrEqualTo(640));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'progress and numbering include visible photo/signature fields but '
    'exclude a conditionally hidden required field',
    (WidgetTester tester) async {
      final ChecklistFillState completed = _state(complete: true);
      expect(completed.submitGate!.blockingReasons, isEmpty);
      await _pump(tester, state: completed);

      expect(
        find.byKey(const ValueKey<String>('hidden_required')),
        findsNothing,
      );
      expect(find.text('Hidden follow-up'), findsNothing);
      expect(find.text('5 of 5 answered'), findsNWidgets(2));
      expect(find.text('100%'), findsOneWidget);

      final List<ChecklistFieldAnswerTile> tiles = tester
          .widgetList<ChecklistFieldAnswerTile>(
            find.byType(ChecklistFieldAnswerTile),
          )
          .toList(growable: false);
      expect(
        tiles.map((ChecklistFieldAnswerTile tile) => tile.field.id),
        <String>['mode', 'engine', 'brakes', 'evidence', 'operator_signature'],
      );
      expect(
        tiles.singleWhere((tile) => tile.field.id == 'evidence').photos,
        hasLength(1),
      );
      expect(
        tiles.singleWhere((tile) => tile.field.id == 'evidence').onCapturePhoto,
        isNotNull,
      );
      expect(
        tiles
            .singleWhere((tile) => tile.field.id == 'operator_signature')
            .signatureBuilder,
        isNotNull,
      );
      expect(find.byType(ChecklistSignaturePad), findsNWidgets(2));
    },
  );

  testWidgets(
    'template-supported EN AR HI UR reading languages are offered and RTL '
    'content does not change the English app-shell direction',
    (WidgetTester tester) async {
      final _TestChecklistFillController controller = await _pump(
        tester,
        state: _state(readLang: 'ar'),
        appLocale: const Locale('en'),
      );

      final DropdownButton<String> languagePicker = tester
          .widgetList<DropdownButton<String>>(
            find.byType(DropdownButton<String>),
          )
          .singleWhere((DropdownButton<String> item) => item.value == 'ar');
      expect(
        languagePicker.items!
            .map((DropdownMenuItem<String> item) => item.value),
        <String?>['en', 'ar', 'hi', 'ur'],
      );

      final BuildContext fieldContext =
          tester.element(find.byKey(const ValueKey<String>('engine')));
      expect(Directionality.of(fieldContext), TextDirection.rtl);
      final BuildContext appBarContext = tester.element(find.byType(AppBar));
      expect(Directionality.of(appBarContext), TextDirection.ltr);
      expect(find.text('حالة المحرك'), findsOneWidget);

      languagePicker.onChanged!('ur');
      await tester.pump();
      expect(controller.languageUpdates, <String>['ur']);
    },
  );

  testWidgets(
    'disabled and enabled submit gates are truthful and the fixed action '
    'still reaches the controller',
    (WidgetTester tester) async {
      final _TestChecklistFillController blocked =
          await _pump(tester, state: _state());
      TpButton button = tester.widget<TpButton>(
        find.widgetWithText(TpButton, 'Submit checklist'),
      );
      expect(button.onPressed, isNull);
      // The gate summary is intentionally the final item in the lazy list.
      // Drag the real form rather than relying on a finder for an item that
      // has not been built yet.
      await tester.drag(find.byType(ListView), const Offset(0, -1800));
      await tester.pump();
      expect(find.textContaining('2 field(s) need attention'), findsOneWidget);
      expect(
        find.textContaining('1 signature(s) are required'),
        findsOneWidget,
      );
      expect(
        find.textContaining('A signature is required to submit this sheet'),
        findsOneWidget,
      );
      expect(blocked.submitCalls, 0);

      final _TestChecklistFillController ready =
          await _pump(tester, state: _state(complete: true));
      button = tester.widget<TpButton>(
        find.widgetWithText(TpButton, 'Submit checklist'),
      );
      expect(button.onPressed, isNotNull);
      await tester.tap(find.widgetWithText(TpButton, 'Submit checklist'));
      await tester.pump();
      expect(ready.submitCalls, 1);
    },
  );

  testWidgets(
    'field and language stay editable while verified identity and linked '
    'asset context stay locked',
    (WidgetTester tester) async {
      final _TestChecklistFillController controller =
          await _pump(tester, state: _state());

      final Finder engineInput = find.descendant(
        of: find.byKey(const ValueKey<String>('engine')),
        matching: find.byType(TextField),
      );
      await tester.enterText(engineInput.first, 'Needs service');
      await tester.pump();
      expect(controller.answerUpdates.last.key, 'engine');
      expect(controller.answerUpdates.last.value, 'Needs service');

      final Iterable<TextField> fields = tester.widgetList<TextField>(
        find.byType(TextField),
      );
      final TextField printedName = fields.singleWhere(
        (TextField field) => field.controller?.text == 'Operator One',
      );
      expect(printedName.enabled, isFalse);
      expect(controller.printedNameUpdates, isEmpty);
      expect(controller.siteUpdates, isEmpty);
      expect(find.text('North Yard'), findsOneWidget);
      expect(find.text('Select asset'), findsOneWidget);
      expect(find.text('Scan QR'), findsOneWidget);
    },
  );

  testWidgets('design QA capture: compact English', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      state: _state(),
      size: const Size(390, 844),
    );

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/checklist_runner_compact_en.png'),
    );
  });

  testWidgets('design QA capture: wide Urdu RTL', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      state: _state(readLang: 'ur'),
      appLocale: const Locale('ur'),
      size: const Size(1024, 768),
    );

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/checklist_runner_wide_ur.png'),
    );
  });
}
