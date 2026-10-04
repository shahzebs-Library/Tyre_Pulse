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

const String _chromeOnWindows =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const QrLoginRequestInfo _info = QrLoginRequestInfo(
  userAgent: _chromeOnWindows,
  ip: '203.0.113.7',
  ageSeconds: 12,
  options: <String>['37', '82', '15'],
);

final class _FakeRepo implements QrLoginRepository {
  _FakeRepo(
    this.outcome, {
    this.peekResult = const QrLoginPeekReady(_info),
  });

  final QrLoginOutcome Function(bool approve) outcome;
  final QrLoginPeekResult peekResult;
  int peeks = 0;
  final List<({String id, String secret, bool approve, String? match})> calls =
      <({String id, String secret, bool approve, String? match})>[];

  @override
  Future<QrLoginPeekResult> peek({
    required String id,
    required String secret,
  }) async {
    peeks++;
    return peekResult;
  }

  @override
  Future<QrLoginOutcome> decide({
    required String id,
    required String secret,
    required bool approve,
    String? match,
  }) async {
    calls.add((id: id, secret: secret, approve: approve, match: match));
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

  testWidgets(
      'a valid code peeks first and shows the browser, address, age, '
      'warning and the three numbers', (tester) async {
    _tallSurface(tester);
    final _FakeRepo repo = _FakeRepo((bool a) => QrLoginDecided(approved: a));
    await tester.pumpWidget(_app(repo, payload: _payload));
    await tester.pumpAndSettle();
    expect(repo.peeks, 1);
    expect(find.byKey(QrLoginKeys.confirmSheet), findsOneWidget);
    expect(find.textContaining('Ahmed Ali'), findsOneWidget);
    expect(find.textContaining('Chrome'), findsOneWidget);
    expect(find.textContaining('Windows'), findsOneWidget);
    expect(find.textContaining('203.0.113.7'), findsOneWidget);
    expect(find.text('Requested 12 seconds ago'), findsOneWidget);
    expect(
      find.text(
        'Only approve if you are signing in on this computer yourself '
        'right now.',
      ),
      findsOneWidget,
    );
    expect(find.text('Tap the number shown on the computer'), findsOneWidget);
    for (final String n in _info.options) {
      expect(find.byKey(QrLoginKeys.option(n)), findsOneWidget);
      expect(
        tester.getSize(find.byKey(QrLoginKeys.option(n))).height,
        greaterThanOrEqualTo(48),
      );
    }
    // Nothing is decided until the person answers.
    expect(repo.calls, isEmpty);
  });

  testWidgets('an unknown browser says so instead of guessing', (
    tester,
  ) async {
    _tallSurface(tester);
    final _FakeRepo repo = _FakeRepo(
      (bool a) => QrLoginDecided(approved: a),
      peekResult: const QrLoginPeekReady(
        QrLoginRequestInfo(options: <String>['37', '82', '15']),
      ),
    );
    await tester.pumpWidget(_app(repo, payload: _payload));
    await tester.pumpAndSettle();
    expect(find.text('Unknown browser'), findsOneWidget);
    expect(find.textContaining('IP address'), findsNothing);
  });

  testWidgets('tapping a number approves with that p_match', (tester) async {
    _tallSurface(tester);
    final _FakeRepo repo = _FakeRepo((bool a) => QrLoginDecided(approved: a));
    await tester.pumpWidget(_app(repo, payload: _payload));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(QrLoginKeys.option('82')));
    await tester.pumpAndSettle();
    expect(repo.calls.single.approve, isTrue);
    expect(repo.calls.single.match, '82');
    expect(repo.calls.single.id, _id);
    expect(repo.calls.single.secret, _secret);
    expect(find.text('Computer signed in'), findsOneWidget);
  });

  testWidgets('Decline declines the code on the server', (tester) async {
    _tallSurface(tester);
    final _FakeRepo repo = _FakeRepo((bool a) => QrLoginDecided(approved: a));
    await tester.pumpWidget(_app(repo, payload: _payload));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(QrLoginKeys.decline));
    await tester.pumpAndSettle();
    expect(repo.calls.single.approve, isFalse);
    expect(repo.calls.single.match, isNull);
    expect(find.text('Sign-in declined'), findsOneWidget);
  });

  testWidgets('a wrong number says the code is cancelled', (tester) async {
    _tallSurface(tester);
    final _FakeRepo repo =
        _FakeRepo((_) => const QrLoginRefused(QrLoginFailure.mismatch));
    await tester.pumpWidget(_app(repo, payload: _payload));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(QrLoginKeys.option('15')));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'That number did not match. The code is cancelled; make a new one '
        'on the computer.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('an administrator is told to use the password', (tester) async {
    _tallSurface(tester);
    final _FakeRepo repo =
        _FakeRepo((_) => const QrLoginRefused(QrLoginFailure.admin));
    await tester.pumpWidget(_app(repo, payload: _payload));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(QrLoginKeys.option('37')));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('not available for administrator accounts'),
      findsOneWidget,
    );
  });

  testWidgets('a code that is already expired at peek sends nothing', (
    tester,
  ) async {
    _tallSurface(tester);
    final _FakeRepo repo = _FakeRepo(
      (bool a) => QrLoginDecided(approved: a),
      peekResult: const QrLoginPeekRefused(QrLoginFailure.expired),
    );
    await tester.pumpWidget(_app(repo, payload: _payload));
    await tester.pumpAndSettle();
    expect(find.byKey(QrLoginKeys.confirmSheet), findsNothing);
    expect(repo.calls, isEmpty);
    expect(find.textContaining('This code has expired'), findsOneWidget);
  });

  testWidgets('an expired code says so in plain English', (tester) async {
    _tallSurface(tester);
    final _FakeRepo repo =
        _FakeRepo((_) => const QrLoginRefused(QrLoginFailure.expired));
    await tester.pumpWidget(_app(repo, payload: _payload));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(QrLoginKeys.option('37')));
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
    await tester.tap(find.byKey(QrLoginKeys.option('37')));
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
