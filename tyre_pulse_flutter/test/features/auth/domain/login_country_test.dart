import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/auth/domain/login_country.dart';

void main() {
  test('each country has a unique stable storage value', () {
    expect(
      LoginCountry.values.map((LoginCountry value) => value.storageValue),
      <String>{
        'saudi_arabia',
        'united_arab_emirates',
        'egypt',
      },
    );
  });

  test('all stable values round-trip', () {
    for (final LoginCountry country in LoginCountry.values) {
      expect(
        LoginCountry.fromStorageValue(country.storageValue),
        same(country),
      );
    }
  });

  test('absent and unknown values never guess a country', () {
    expect(LoginCountry.fromStorageValue(null), isNull);
    expect(LoginCountry.fromStorageValue(''), isNull);
    expect(LoginCountry.fromStorageValue('future_country'), isNull);
  });
}
