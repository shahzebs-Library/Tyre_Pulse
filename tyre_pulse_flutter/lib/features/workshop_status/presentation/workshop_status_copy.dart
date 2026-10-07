/// Localised copy for Workshop Status, in the same single-catalog convention
/// as `PmCopy` / `WorkshopCopy`: one ARB key holding `key=value~key=value`.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/workshop_status/domain/workshop_status_vocab.dart';

Map<String, String> _parseCatalog(String catalog) => <String, String>{
      for (final String entry in catalog.split('~'))
        if (entry.indexOf('=') > 0)
          entry.substring(0, entry.indexOf('=')):
              entry.substring(entry.indexOf('=') + 1),
    };

final class WorkshopStatusCopy {
  factory WorkshopStatusCopy.of(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return WorkshopStatusCopy._(
      _parseCatalog(l10n.workshopStatusCopyCatalog),
      _parseCatalog(l10n.workshopStatusVocabCatalog),
    );
  }

  WorkshopStatusCopy._(this.values, this.vocab);

  final Map<String, String> values;

  /// Display labels for the controlled vocabularies, keyed by
  /// [workshopVocabKey]. Display only: the English value is what is saved.
  final Map<String, String> vocab;

  String call(String key) => values[key] ?? key;

  /// The label for a stored stage / delay reason / parts status. Falls back to
  /// the stored English value, never to a blank or a raw key.
  String vocabLabel(String value) {
    if (value == kWorkshopReleasedStage) return call('released');
    return vocab[workshopVocabKey(value)] ?? value;
  }
}
