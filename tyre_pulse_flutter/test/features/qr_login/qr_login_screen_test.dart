import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/qr_login/data/qr_login_repository.dart';
import 'package:tyre_pulse/features/qr_login/domain/qr_login.dart';
import 'package:tyre_pulse/features/qr_login/presentation/qr_login_screen.dart';
import 'package:tyre_pulse/features/qr_login/qr_login_providers.dart';
import 'package:tyre_pulse/features/scanning/presentation/camera_access.dart';

const String _id = '3f2a9c1e-7b4d-4e8a-9f10-2b3c4d5e6f70';
final String _secret = 'ab' * 24;
final String _payload = 'tyrepulse://qr-login?id=$_id&s=$_secret';

final class _FakeRepo implements QrLoginRepository {
  _FakeRepo(this.outcome);

  final QrLoginOutcome Function(bool approve) outcome;
  final List<({String id, String secret, bool approve})> calls =
      <({String id, String secret, bool approve})>[];

  @override
  Future<QrLoginOutcome> decide({
    required String id,
    required String secret,
    required bool approve,
  }) async {
    calls.add((id: id, secret: secret, approve: approve));
    return outcome(approve);
  }
}

Widget _app(
  _FakeRepo repo, {
  String? payload,
  String? name = 'Ahmed Ali',
  Locale locale = const Locale('en'),
}) {
  return ProviderScope(
    overrides: [
      qrLoginRepositoryProvider.overrideWithValue(repo),
      qrLoginPersonNameProvider.overrideWithValue(name),
      // No platform camera channel in a widget test.
      cameraAccessProvider.overrideWithValue(
        const CameraUnavailableInThisBuild(),
      ),
    ],
    child: MaterialApp(
      theme: TpTheme.light,
      locale: locale,
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: QrLoginScreen(initialPayload: payload),
    ),
  );
}

void _tallSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(420, 1200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets(
      'without a payload it explains the steps and shows the camera '
      'state, never a spinner', (tester) async {
    _tallSurface(tester);
    await tester.pumpWidget(_app(_FakeRepo((_) => throw StateError('no'))));
    await tester.pumpAndSettle();
    expect(find.textContaining('TyrePulse sign-in page'), findsOneWidget);
    expect(find.byKey(QrLoginKeys.confirmSheet), findsNothing);
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });

  testWidgets('a valid code asks first, naming the person', (tester) async {
    _tallSurface(tester);
    final _FakeRepo repo = _FakeRepo((bool a) => QrLoginDecided(approved: a));
    await tester.pumpWidget(_app(repo, payload: _payload));
    await tester.pumpAndSettle();
    expect(find.byKey(QrLoginKeys.confirmSheet), findsOneWidget);
    expect(find.textContaining('Ahmed Ali'), findsOneWidget);
    expect(
      find.textContaining('Only approve a code you just opened yourself'),
      findsOneWidget,
    );
    // Nothing is sent until the person answers.
    expect(repo.calls, isEmpty);
  });

  testWidgets('Approve sends approve=true and shows the success state', (
    tester,
  ) async {
    _tallSurface(tester);
    final _FakeRepo repo = _FakeRepo((bool a) => QrLoginDecided(approved: a));
    await tester.pumpWidget(_app(repo, payload: _payload));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(QrLoginKeys.approve));
    await tester.pumpAndSettle();
    expect(repo.calls.single.approve, isTrue);
    expect(repo.calls.single.id, _id);
    expect(repo.calls.single.secret, _secret);
    expect(find.text('Computer signed in'), findsOneWidget);
  });

  testWidgets('Cancel declines the code on the server', (tester) async {
    _tallSurface(tester);
    final _FakeRepo repo = _FakeRepo((bool a) => QrLoginDecided(approved: a));
    await tester.pumpWidget(_app(repo, payload: _payload));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(QrLoginKeys.cancel));
    await tester.pumpAndSettle();
    expect(repo.calls.single.approve, isFalse);
    expect(find.text('Sign-in declined'), findsOneWidget);
  });

  testWidgets('an expired code says so in plain English', (tester) async {
    _tallSurface(tester);
    final _FakeRepo repo =
        _FakeRepo((_) => const QrLoginRefused(QrLoginFailure.expired));
    await tester.pumpWidget(_app(repo, payload: _payload));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(QrLoginKeys.approve));
    await tester.pumpAndSettle();
    expect(find.text('Computer not signed in'), findsOneWidget);
    expect(find.textContaining('This code has expired'), findsOneWidget);
    expect(find.text('Scan another code'), findsOneWidget);
  });

  testWidgets('a refused account and no signal each get their own sentence', (
    tester,
  ) async {
    _tallSurface(tester);
    await tester.pumpWidget(
      _app(
        _FakeRepo((_) => const QrLoginRefused(QrLoginFailure.notAllowed)),
        payload: _payload,
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(QrLoginKeys.approve));
    await tester.pumpAndSettle();
    expect(find.textContaining('not approved or is locked'), findsOneWidget);
  });

  testWidgets('a broken sign-in code is not sent and says why', (
    tester,
  ) async {
    _tallSurface(tester);
    final _FakeRepo repo = _FakeRepo((bool a) => QrLoginDecided(approved: a));
    await tester.pumpWidget(
      _app(repo, payload: 'tyrepulse://qr-login?id=nope&s=12'),
    );
    await tester.pumpAndSettle();
    expect(repo.calls, isEmpty);
    expect(find.text('Not a sign-in code'), findsOneWidget);
  });

  testWidgets('with no name on the profile it says "your account"', (
    tester,
  ) async {
    _tallSurface(tester);
    await tester.pumpWidget(
      _app(
        _FakeRepo((bool a) => QrLoginDecided(approved: a)),
        payload: _payload,
        name: null,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('your account'), findsOneWidget);
  });

  testWidgets('the confirm sheet renders in Arabic and Urdu', (tester) async {
    _tallSurface(tester);
    for (final Locale locale in const <Locale>[Locale('ar'), Locale('ur')]) {
      await tester.pumpWidget(
        _app(
          _FakeRepo((bool a) => QrLoginDecided(approved: a)),
          payload: _payload,
          locale: locale,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(QrLoginKeys.confirmSheet), findsOneWidget);
      expect(find.textContaining('Ahmed Ali'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    }
  });
}
