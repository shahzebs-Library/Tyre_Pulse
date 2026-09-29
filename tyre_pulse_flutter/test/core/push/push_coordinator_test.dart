import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/push/push_coordinator.dart';
import 'package:tyre_pulse/core/push/push_message.dart';
import 'package:tyre_pulse/core/push/push_messaging_client.dart';

import 'push_fakes.dart';

void main() {
  late FakePushMessagingClient client;
  late FakePushDeviceRepository devices;
  late RecordingTelemetry telemetry;
  late PushCoordinator coordinator;
  late List<PushMessage> opened;
  late List<PushMessage> shown;

  PushCoordinator build() {
    final PushCoordinator c = PushCoordinator(
      client: client,
      devices: devices,
      telemetry: telemetry,
      appVersion: '0.1.1',
    );
    c.attach(onOpen: opened.add, onForeground: shown.add);
    return c;
  }

  setUp(() {
    client = FakePushMessagingClient();
    devices = FakePushDeviceRepository();
    telemetry = RecordingTelemetry();
    opened = <PushMessage>[];
    shown = <PushMessage>[];
    coordinator = build();
  });

  tearDown(() async {
    await coordinator.dispose();
    await client.close();
  });

  group('token lifecycle', () {
    test('registers the token with the build version after sign-in', () async {
      await coordinator.onSignedIn('u1');
      expect(devices.registered, <String>['fcm-token-1']);
      expect(devices.versions, <String?>['0.1.1']);
      expect(client.permissionRequests, 1);
    });

    test('does not register again for the same user and token', () async {
      await coordinator.onSignedIn('u1');
      await coordinator.onSignedIn('u1');
      expect(devices.registered, hasLength(1));
      expect(client.initializeCalls, 1);
    });

    test('a refreshed token is registered', () async {
      await coordinator.onSignedIn('u1');
      client.refresh.add('fcm-token-2');
      await pumpEventQueue();
      expect(devices.registered, <String>['fcm-token-1', 'fcm-token-2']);
    });

    test('a refresh while signed out registers nothing', () async {
      await coordinator.onSignedIn('u1');
      coordinator.onSignedOut();
      client.refresh.add('fcm-token-2');
      await pumpEventQueue();
      expect(devices.registered, <String>['fcm-token-1']);
    });

    test('denied permission registers nothing (matches the Expo app)',
        () async {
      client.permission = PushPermissionStatus.denied;
      await coordinator.onSignedIn('u1');
      expect(devices.registered, isEmpty);
    });

    test('sign-out revokes the registered token', () async {
      await coordinator.onSignedIn('u1');
      await coordinator.onSigningOut();
      expect(devices.revoked, <String>['fcm-token-1']);
      expect(coordinator.registeredToken, isNull);
    });

    test('sign-out with nothing registered calls nothing', () async {
      await coordinator.onSigningOut();
      expect(devices.revoked, isEmpty);
    });

    test('a failed revoke is reported, never thrown', () async {
      await coordinator.onSignedIn('u1');
      devices.revokeError = const AppError.network();
      await coordinator.onSigningOut();
      expect(telemetry.errors, hasLength(1));
    });

    test(
      'a hung revoke is abandoned after the timeout',
      () async {
        await coordinator.onSignedIn('u1');
        devices.revokeGate = Completer<void>();
        final Stopwatch watch = Stopwatch()..start();
        await coordinator.onSigningOut();
        expect(watch.elapsed, lessThan(const Duration(seconds: 6)));
        expect(telemetry.errors, hasLength(1));
      },
      timeout: const Timeout(Duration(seconds: 10)),
    );

    test('a failed registration is reported and retried next time', () async {
      devices.registerError = const AppError.network();
      await coordinator.onSignedIn('u1');
      expect(telemetry.errors, hasLength(1));
      devices.registerError = null;
      client.refresh.add('fcm-token-1');
      await pumpEventQueue();
      expect(devices.registered, <String>['fcm-token-1']);
    });
  });

  group('initialisation failure is never fatal', () {
    test('a Firebase init error is reported and nothing else runs', () async {
      client
        ..initializes = false
        ..initError = StateError('no google-services');
      await coordinator.onSignedIn('u1');
      expect(telemetry.errors, hasLength(1));
      expect(telemetry.errors.single.technical, contains('StateError'));
      expect(client.permissionRequests, 0);
      expect(devices.registered, isEmpty);
    });

    test('an unsupported platform reports nothing', () async {
      client.initializes = false;
      await coordinator.onSignedIn('u1');
      expect(telemetry.errors, isEmpty);
      expect(devices.registered, isEmpty);
    });
  });

  group('messages', () {
    const PushMessage message = PushMessage(
      title: 'Approval required',
      data: <String, String>{'entity_type': 'inspection'},
    );

    test('a cold-start notification opens after sign-in, once', () async {
      client.initial = message;
      await coordinator.onSignedIn('u1');
      expect(opened, <PushMessage>[message]);
      await coordinator.onSignedIn('u2');
      expect(opened, hasLength(1));
    });

    test('a background tap opens straight away when signed in', () async {
      await coordinator.onSignedIn('u1');
      client.opened.add(message);
      await pumpEventQueue();
      expect(opened, <PushMessage>[message]);
    });

    test('a tap held while signed out is dropped on sign-out', () async {
      await coordinator.onSignedIn('u1');
      coordinator.onSignedOut();
      client.opened.add(message);
      await pumpEventQueue();
      await coordinator.onSigningOut();
      expect(opened, isEmpty);
    });

    test('a tap before the UI attaches is delivered on attach', () async {
      coordinator.attach();
      await coordinator.onSignedIn('u1');
      client.opened.add(message);
      await pumpEventQueue();
      expect(opened, isEmpty);
      coordinator.attach(onOpen: opened.add);
      expect(opened, <PushMessage>[message]);
    });

    test('foreground messages reach the banner only when signed in', () async {
      await coordinator.onSignedIn('u1');
      client.foreground.add(message);
      await pumpEventQueue();
      coordinator.onSignedOut();
      client.foreground.add(message);
      await pumpEventQueue();
      expect(shown, hasLength(1));
    });
  });
}
