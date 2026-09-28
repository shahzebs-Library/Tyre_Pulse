/// The content model for the shareable "Accident case summary" PDF.
///
/// Mirrors the web `src/lib/accidentCasePdf.js` discipline: this file owns no
/// rendering and invents nothing. Every value comes straight off the
/// `accidents` row or its `accident_case_workstreams` rows; a blank value is
/// kept as `null` so the renderer prints "Not recorded", never a fabricated
/// zero or a guessed word.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

/// The kind of value a summary line carries, so the renderer can format it
/// for the reader's locale without the model knowing about locales.
enum AccidentSummaryValueKind { text, token, date, money, yesNo, count }

@immutable
final class AccidentSummaryLine {
  const AccidentSummaryLine({
    required this.labelKey,
    required this.kind,
    this.text,
    this.number,
    this.flag,
  });

  /// An `AccidentCopy` key (the feature's existing trilingual catalog).
  final String labelKey;
  final AccidentSummaryValueKind kind;
  final String? text;
  final num? number;
  final bool? flag;

  /// True when nothing was recorded for this line.
  bool get isBlank => switch (kind) {
        AccidentSummaryValueKind.money ||
        AccidentSummaryValueKind.count =>
          number == null,
        AccidentSummaryValueKind.yesNo => flag == null,
        _ => (text?.trim() ?? '').isEmpty,
      };
}

@immutable
final class AccidentSummarySection {
  const AccidentSummarySection({required this.titleKey, required this.lines});

  final String titleKey;
  final List<AccidentSummaryLine> lines;
}

@immutable
final class AccidentSummaryWorkstream {
  const AccidentSummaryWorkstream({
    required this.key,
    required this.chip,
    this.team,
    this.progressPct,
    this.naReason,
  });

  final String key;
  final AccidentWorkstreamChip chip;
  final String? team;

  /// The server's own progress figure. Null means none was recorded; the
  /// renderer never turns that into 0%.
  final num? progressPct;
  final String? naReason;
}

@immutable
final class AccidentCaseSummary {
  const AccidentCaseSummary({
    required this.reference,
    required this.sections,
    required this.workstreams,
    required this.workstreamsProvisioned,
    this.completionOverall,
    this.photoCount = 0,
  });

  /// Builds the summary from a loaded case. Workstreams are listed in the
  /// canonical case order, and only the ones the server actually routed.
  factory AccidentCaseSummary.fromSnapshot(AccidentCaseSnapshot snapshot) {
    final AccidentRecord r = snapshot.accident;
    AccidentSummaryLine text(String key, String? value) => AccidentSummaryLine(
          labelKey: key,
          kind: AccidentSummaryValueKind.text,
          text: value,
        );
    AccidentSummaryLine token(String key, String? value) => AccidentSummaryLine(
          labelKey: key,
          kind: AccidentSummaryValueKind.token,
          text: value,
        );
    AccidentSummaryLine date(String key, String? value) => AccidentSummaryLine(
          labelKey: key,
          kind: AccidentSummaryValueKind.date,
          text: value,
        );
    AccidentSummaryLine money(String key, num? value) => AccidentSummaryLine(
          labelKey: key,
          kind: AccidentSummaryValueKind.money,
          number: value,
        );
    AccidentSummaryLine yesNo(String key, bool? value) => AccidentSummaryLine(
          labelKey: key,
          kind: AccidentSummaryValueKind.yesNo,
          flag: value,
        );

    final List<AccidentWorkstream> ordered = <AccidentWorkstream>[
      ...snapshot.workstreams,
    ]..sort((AccidentWorkstream a, AccidentWorkstream b) {
        int rank(String key) {
          final int index = accidentWorkstreamOrder.indexOf(key);
          return index < 0 ? accidentWorkstreamOrder.length : index;
        }

        final int byRank = rank(a.key).compareTo(rank(b.key));
        return byRank != 0 ? byRank : a.key.compareTo(b.key);
      });

    return AccidentCaseSummary(
      reference: r.reference,
      completionOverall: r.completionOverall,
      photoCount: r.photos.length,
      workstreamsProvisioned: snapshot.provisioned,
      sections: <AccidentSummarySection>[
        AccidentSummarySection(
          titleKey: 'incidentFacts',
          lines: <AccidentSummaryLine>[
            text('caseId', r.reference),
            date('incidentDateLabel', r.incidentDate),
            text('assetNo', r.assetNo),
            text('plate', r.plateNumber),
            token('vehicleType', r.vehicleType),
            text('site', r.site),
            text('exactLocation', r.location),
            token('type', r.accidentType),
            token('severity', r.severity),
            text('driver', r.driverName),
            yesNo('injuries', r.injuries),
            yesNo('thirdParty', r.thirdPartyInvolved),
            text('description', r.description),
          ],
        ),
        AccidentSummarySection(
          titleKey: 'liability',
          lines: <AccidentSummaryLine>[
            token('fault', r.faultStatus),
            token('responsible', r.responsibleParty),
            token('liable', r.liableParty),
            token('payer', r.payer),
          ],
        ),
        AccidentSummarySection(
          titleKey: 'insurance',
          lines: <AccidentSummaryLine>[
            text('insurer', r.insurer),
            text('policy', r.policyNo),
            text('claimNo', r.insuranceClaimNo),
            token('claimStatus', r.claimStatus),
            money('claimed', r.claimAmount),
            money('approved', r.claimApprovedAmount),
            token('recoveryStatus', r.recoveryStatus),
            money('recovered', r.recoveredAmount),
          ],
        ),
        AccidentSummarySection(
          titleKey: 'workshopRelease',
          lines: <AccidentSummaryLine>[
            token('repairType', r.repairType),
            text('workshop', r.workshopName),
            money('repairCost', r.repairCost),
            date('expectedRelease', r.expectedReleaseDate),
            date('actualRelease', r.releaseDate),
          ],
        ),
        AccidentSummarySection(
          titleKey: 'closure',
          lines: <AccidentSummaryLine>[
            token('caseStatus', r.caseStatus ?? r.status),
            token('workflowStage', r.workflowStage),
            token('closureLevel', r.closureLevel),
          ],
        ),
      ],
      workstreams: <AccidentSummaryWorkstream>[
        for (final AccidentWorkstream ws in ordered)
          AccidentSummaryWorkstream(
            key: ws.key,
            chip: ws.chip,
            team: ws.team,
            progressPct: ws.progressPct,
            naReason: ws.naReason,
          ),
      ],
    );
  }

  final String reference;
  final List<AccidentSummarySection> sections;
  final List<AccidentSummaryWorkstream> workstreams;

  /// False when the case workstream model is not provisioned for this case;
  /// the renderer then says so instead of printing an empty table.
  final bool workstreamsProvisioned;

  /// The server's recorded overall completion. Null is printed as
  /// "Not recorded", never as 0%.
  final num? completionOverall;
  final int photoCount;

  /// A filesystem-safe file name derived from the case reference.
  String get fileName {
    final String safe = reference
        .replaceAll(RegExp('[^A-Za-z0-9]+'), ' ')
        .trim()
        .replaceAll(RegExp(r'\s+'), ' ');
    return safe.isEmpty
        ? 'Accident case summary.pdf'
        : 'Accident case summary $safe.pdf';
  }
}
