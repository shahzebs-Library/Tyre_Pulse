import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/auth/data/login_artwork_repository.dart';
import 'package:tyre_pulse/features/auth/domain/login_artwork.dart';
import 'package:tyre_pulse/features/auth/domain/login_country.dart';
import 'package:tyre_pulse/features/auth/presentation/login_artwork_provider.dart';

final class _FakeRepo implements LoginArtworkRepository {
  _FakeRepo({this.cached, this.remote});

  LoginArtworkChoice? cached;
  LoginArtworkChoice? remote;
  LoginArtworkChoice? saved;

  @override
  Future<LoginArtworkChoice?> fetchRemote() async => remote;

  @override
  Future<LoginArtworkChoice?> readCached() async => cached;

  @override
  Future<void> saveCached(LoginArtworkChoice choice) async => saved = choice;
}

void main() {
  group('LoginArtworkChoice.parse', () {
    test('absent or junk falls back to each country landmark', () {
      for (final Object? raw in <Object?>[null, '', 'nope', '[1]', 42]) {
        final LoginArtworkChoice c = LoginArtworkChoice.parse(raw);
        expect(c, LoginArtworkChoice.defaults);
        expect(
          c.forCountry(LoginCountry.saudiArabia),
          LoginArtwork.saudiLandmark,
        );
      }
    });

    test('reads a map, a JSON string and a double-quoted JSON string', () {
      const Map<String, String> m = <String, String>{
        'saudi_arabia': 'fleet_machines',
      };
      for (final Object raw in <Object>[
        m,
        jsonEncode(m),
        jsonEncode(jsonEncode(m)),
      ]) {
        expect(
          LoginArtworkChoice.parse(raw).forCountry(LoginCountry.saudiArabia),
          LoginArtwork.fleetMachines,
        );
      }
    });

    test('an unknown picture resets only that country', () {
      final LoginArtworkChoice c = LoginArtworkChoice.parse(<String, String>{
        'saudi_arabia': 'missing',
        'egypt': 'uae_landmark',
      });
      expect(
        c.forCountry(LoginCountry.saudiArabia),
        LoginArtwork.saudiLandmark,
      );
      expect(c.forCountry(LoginCountry.egypt), LoginArtwork.uaeLandmark);
    });

    test('round-trips through the cache JSON', () {
      final LoginArtworkChoice c = LoginArtworkChoice.parse(<String, String>{
        'united_arab_emirates': 'fleet_machines',
      });
      expect(LoginArtworkChoice.parse(c.toJson()), c);
    });
  });

  group('loginArtworkProvider', () {
    Future<ProviderContainer> settle(_FakeRepo repo) async {
      final ProviderContainer c = ProviderContainer(
        overrides: [
          loginArtworkRepositoryProvider.overrideWithValue(repo),
        ],
      );
      addTearDown(c.dispose);
      c.listen(loginArtworkProvider, (_, __) {});
      for (int i = 0; i < 5; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      return c;
    }

    test('starts on defaults, then applies the server value and caches it',
        () async {
      final LoginArtworkChoice remote = LoginArtworkChoice.parse(
        <String, String>{'saudi_arabia': 'fleet_machines'},
      );
      final _FakeRepo repo = _FakeRepo(remote: remote);
      final ProviderContainer c = await settle(repo);
      expect(c.read(loginArtworkProvider), remote);
      expect(repo.saved, remote);
    });

    test('offline keeps the cached choice', () async {
      final LoginArtworkChoice cached = LoginArtworkChoice.parse(
        <String, String>{'egypt': 'fleet_machines'},
      );
      final ProviderContainer c = await settle(_FakeRepo(cached: cached));
      expect(c.read(loginArtworkProvider), cached);
    });

    test('nothing anywhere keeps the country landmarks', () async {
      final ProviderContainer c = await settle(_FakeRepo());
      expect(c.read(loginArtworkProvider), LoginArtworkChoice.defaults);
    });
  });
}
