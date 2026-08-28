/// Confirms every user-facing string in the English reference ARB exists,
/// and is non-empty, in the Arabic and Urdu translations too.
///
/// Spec section 51: the product ships English, Arabic and Urdu with every
/// string sourced from an ARB file. A key present in English but missing
/// from a translated file silently degrades at runtime; an EMPTY
/// translation is worse still, because it renders nothing at all with no
/// signal that anything is wrong. This file reads the three committed ARB
/// sources directly and checks them against each other, so a translation
/// gap is caught here rather than noticed later as a blank label on a
/// phone screen.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Locates an ARB file the same defensive way
/// `module_registry_drift_test.dart` locates its cross-package reference
/// file: `flutter test` runs with the package root as the working
/// directory (see `.github/workflows/flutter-ci.yml`), so the file is
/// normally under `lib/l10n/` directly. The second candidate covers a
/// repository-root working directory instead.
File _locateArbFile(String fileName) {
  for (final String relative in <String>[
    'lib${Platform.pathSeparator}l10n${Platform.pathSeparator}$fileName',
    'tyre_pulse_flutter${Platform.pathSeparator}lib'
        '${Platform.pathSeparator}l10n${Platform.pathSeparator}$fileName',
  ]) {
    final File file = File(relative);
    if (file.existsSync()) {
      return file;
    }
  }
  fail(
    'Could not find lib/l10n/$fileName from the working directory '
    '${Directory.current.path}.',
  );
}

Map<String, dynamic> _readArb(String fileName) {
  return jsonDecode(_locateArbFile(fileName).readAsStringSync())
      as Map<String, dynamic>;
}

/// The translatable keys in an ARB map: everything except the `@key`
/// metadata entries, which describe a sibling key rather than naming a
/// string of their own.
Set<String> _translatableKeys(Map<String, dynamic> arb) {
  return arb.keys.where((String key) => !key.startsWith('@')).toSet();
}

void main() {
  late final Map<String, dynamic> en;
  late final Map<String, dynamic> ar;
  late final Map<String, dynamic> ur;

  setUpAll(() {
    en = _readArb('app_en.arb');
    ar = _readArb('app_ar.arb');
    ur = _readArb('app_ur.arb');
  });

  group('the loader is not vacuously trusting an empty read', () {
    test('every ARB actually decoded content, not an empty map', () {
      // Guards the guard: if _readArb ever silently returned {} (a wrong
      // path, a parse that decoded something unexpected), every test
      // below would pass vacuously instead of catching a real gap.
      expect(en, isNotEmpty);
      expect(ar, isNotEmpty);
      expect(ur, isNotEmpty);
      expect(_translatableKeys(en), isNotEmpty);
      expect(_translatableKeys(ar), isNotEmpty);
      expect(_translatableKeys(ur), isNotEmpty);
    });
  });

  group('english is the reference locale', () {
    test(
      'english carries at least as many translatable keys as the others',
      () {
        // Measured directly against the committed files, not assumed: today
        // en/ar/ur are exactly equal at 66 keys each, so English trivially
        // qualifies as the reference. If a future edit ever makes a
        // translated file the larger one, that is the signal this file's
        // "english is the reference" premise needs re-pointing at whichever
        // file is actually the superset - do not just raise the pinned
        // count below without checking which file changed.
        final int enCount = _translatableKeys(en).length;
        expect(enCount, greaterThanOrEqualTo(_translatableKeys(ar).length));
        expect(enCount, greaterThanOrEqualTo(_translatableKeys(ur).length));
      },
    );
  });

  group('key counts, pinned against the real committed files', () {
    // Was 66/66/66. Four features landed keys concurrently, each accounted
    // for here rather than folded into one unexplained jump - the parallel
    // migration phase 3 run had one agent per feature package, and all four
    // reached this shared file:
    // - `features/assets` (the vehicles list and detail screens) added 25
    //   keys, vehiclesTitle through vehiclesTruncatedNotice.
    // - a serial-search feature added 28 keys, serialSearchTitle through
    //   serialSearchUndoConfirmMessage.
    // - `features/records` added 24 keys, recordsTitle through the rest of
    //   that prefix.
    // - `features/scanning` added 15 keys, scannerTitle through the rest of
    //   that prefix.
    // 66 + 25 + 28 + 24 + 15 = 158.
    // - `features/tyre_diagram` (Phase 4, the vehicle tyre diagram widget)
    //   added 13 keys: tyreDiagramFrontLabel through tyreDiagramTyreCount
    //   (the diagram's own chrome - front label, tap hint, tyre count,
    //   pending lead-in, tyreless/empty messages, the pressure detail
    //   suffix) plus tyreConditionGood through tyreConditionMissing (the
    //   six-value condition legend/accessibility-label vocabulary).
    // 158 + 13 = 171.
    // - `features/inspections` (Phase 5, the inspection capture wizard,
    //   detail screen and the scoped "My Inspections" history surface)
    //   added 71 keys: inspectionNavTitle through
    //   inspectionHistorySubmittedSection - the wizard's step track and
    //   header (vehicle/site/odometer/hour-meter picking, resuming a
    //   draft), the tyre-position editor sheet (condition/pressure/tread/
    //   serial/photo/notes), the signature pad's saved-preview/redraw
    //   pair, the review and submit-outcome screens, the read-only detail
    //   screen (including its own queued-vs-synced banner), and the
    //   history list's empty/section states.
    // 171 + 71 = 242.
    // - `features/checklists` (Phase 6, the checklist templates/assignments
    //   home, the dynamic per-template fill screen over the 14-field-type
    //   engine, and the scoped "my checklist history" surface merging
    //   completed submissions with the offline queue) added 49 keys:
    //   checklistAddPhotoTitle through checklistGatePrimarySignature - the
    //   photo-source picker, the boolean yes/no choice, the signature pad's
    //   saved-preview/redraw pair (its own copy, mirroring but not sharing
    //   the inspection pad's keys), the checklists home list (unfinished
    //   work/assignments due/available checklists sections), the resumable-
    //   draft progress line, the history list's search/filter/section/
    //   status vocabulary for both the queued and the confirmed halves, and
    //   the fill screen's own chrome (site/printed-name header, the
    //   template-level signature label, the submit action, the "not due
    //   yet" advisory, and the submit-gate's four structured reason lines -
    //   deliberately NOT the domain layer's own English
    //   `ChecklistSubmitGate.blockingReasons`, which that class's own doc
    //   comment states is never for display).
    // 242 + 49 = 291.
    // - `features/approvals` (inspection approvals: the supervisor's queue
    //   over `inspections.approval_status = 'pending_approval'` and the
    //   single-stage review/decide screen that goes through the
    //   `decide_inspection_approval` RPC) added 38 keys:
    //   inspectionApprovalsTitle through inspectionApprovalSignatureRedraw -
    //   the queue's title/count/empty/error/badge vocabulary, the review
    //   screen's fallback title, its tyre-conditions section heading and
    //   empty message, the decided-vs-still-pending sections (decision
    //   title, approved/returned labels, "approved/returned by" and
    //   "signing as" sentences - each carrying a `{name}` placeholder so a
    //   Latin-script email or display name can be LTR-isolated before being
    //   substituted in, per `TpDirection.isolateLtr`'s own rule for an
    //   identifier concatenated into translated prose), the note field's
    //   label/hint, the Approve/Return buttons, the two validation dialogs
    //   (signature required / reason required), the two decision-outcome
    //   dialogs (approved/returned, each with its own full sentence rather
    //   than one templated string with an English word substituted in - a
    //   deliberately different choice from the mobile source's own inline
    //   ternary, made because splicing an untranslated fragment mid-sentence
    //   does not survive translation into a language with different word
    //   order), the Stay-here/Back-to-list actions, the save-failed dialog,
    //   and its own copy of the signature pad's saved-preview/redraw pair -
    //   mirroring but not sharing `inspectionSignatureSavedLabel`/
    //   `inspectionSignatureRedraw`, exactly as the checklist feature's own
    //   copy of that same pair does not share them either (see this test's
    //   own comment on the 242+49 checklist batch, above). Nine further
    //   strings this feature needed were genuine REUSES of existing keys,
    //   not new ones: `valueUnavailable`, `inspectionInspectorUnknown`,
    //   `inspectionObservationsLabel`, `inspectionInspectorSignatureLabel`,
    //   `inspectionSignatureMissing`, `inspectionNotFoundTitle`,
    //   `tyreDiagramPressureDetail`, `actionClear` and `actionClose` - each
    //   already states the exact same fact this feature needed to state
    //   over the same `inspections` table or the same shared tyre-diagram
    //   engine, so duplicating them would only have drifted.
    // 291 + 38 = 329.
    // - `features/approvals` (checklist approvals: the two-rung
    //   supervisor/area-manager queue and review screen over
    //   `checklist_submissions.approval_status`, decided via a queued raw
    //   `.update()` rather than an RPC - checklist approvals mirror
    //   `mobile/lib/checklists.ts`'s own `decideApproval`, which writes the
    //   row directly, unlike the single-stage inspection approval flow
    //   above which does go through `decide_inspection_approval`) added 65
    //   keys: checklistApprovalsTitle through
    //   checklistApprovalSignatureRedraw - the queue's title/awaiting-count/
    //   empty (both the "nothing at all" and the "nothing needs you"
    //   variants)/error/filter-chip/your-turn/fallback-title vocabulary,
    //   its blocked-decisions panel (a THIRD queue state distinct from the
    //   inspection queue's plain queued/failed pair, because a checklist
    //   approval that failed for a reason other than connectivity - a stale
    //   stage, a server-side optimistic-concurrency conflict - must never
    //   be silently retried, only surfaced for a person to look at again),
    //   its six-value status-chip vocabulary (closed/sent back/waiting on
    //   each rung/waiting approval/no approval needed - deliberately
    //   distinct strings rather than reusing the inspection approval
    //   feature's own status vocabulary, because the two features' status
    //   spaces do not line up one-to-one), the review screen's load-error/
    //   not-found pair, its sign-offs and responses section headings (the
    //   latter feeding a read-only render of every template field through
    //   the checklists feature's own `ChecklistFieldAnswerTile`, not a
    //   second answer-rendering widget), the per-rung labels (filled-by/
    //   supervisor/area-manager/approval, plus "not signed yet"), the
    //   decision form's own field labels (name/note, each rung's own
    //   signature-pad label), the Return/Sign-off/Approve-and-close button
    //   labels, the four validation messages a decision can be blocked on
    //   (mirroring `decisionRequirementError`'s own branches without
    //   displaying that pure function's pinned English text directly), the
    //   "not your rung to decide" and "nothing left to decide" advisories
    //   (the former carrying a `{status}` placeholder), the save-failed
    //   dialog, the three decision-outcome dialogs (sent back/signed off/
    //   approved, each a full sentence for the same word-order reason the
    //   inspection approval feature's own outcome dialogs are full
    //   sentences) with their shared Stay-here/Back-to-list actions, an
    //   offline "queued, will send later" dialog with no counterpart in the
    //   single-stage inspection flow (which is decided synchronously
    //   against the server rather than through an offline-safe queue), the
    //   score line and its passed/failed words, and its own copy of the
    //   signature pad's saved-preview/redraw pair - mirroring but not
    //   sharing either `inspectionSignatureSavedLabel`/
    //   `inspectionSignatureRedraw` or `checklistSignatureSavedLabel`/
    //   `checklistSignatureRedraw`, for the same reason this test's own
    //   242+49 and 291+38 comments give for why each feature keeps its own
    //   copy of that pair rather than sharing one.
    // 329 + 65 = 394.
    // - `features/meter_logs` (Phase 7, the daily odometer/engine-hour
    //   capture screen ported from `mobile/lib/meterLogs.ts` and
    //   `mobile/app/(app)/meter-logs.tsx`) added 51 keys: meterLogNavTitle
    //   through meterLogRecentKmValue - the workspace-loading guard, the
    //   asset/site fields and the site auto-fill helper text, the "last
    //   reading" panel's three states (checking/unknown/known, the latter
    //   carrying `{km}`/`{date}` placeholders), the odometer and engine
    //   -hours fields with their conditional help text, notes, its own copy
    //   of the signature pad's saved-preview/redraw pair (mirroring but not
    //   sharing `inspectionSignatureSavedLabel`/`inspectionSignatureRedraw`,
    //   `checklistSignatureSavedLabel`/`checklistSignatureRedraw` or
    //   `checklistApprovalSignatureSavedLabel`/
    //   `checklistApprovalSignatureRedraw`, for the same reason this test's
    //   own earlier batches give for why each feature keeps its own copy of
    //   that pair), the Review & Save action, the four validation dialogs
    //   (asset/reading required, invalid reading, below-last-reading and
    //   big-jump confirmations - the latter two each carrying a `{km}`
    //   placeholder), the review step's photograph/required-photo/save
    //   -reading vocabulary, the flagged-for-review note, the two save
    //   -outcome messages (plain and flagged), a generic try-again fallback,
    //   and the recent-readings sheet's own title/empty/error/row-value
    //   strings.
    // 394 + 51 = 445.
    // - `features/washing` (Phase 7, the vehicle-wash capture screen ported
    //   from `mobile/lib/wash.ts`, `mobile/lib/washSchedule.ts` and
    //   `mobile/app/(app)/washing.tsx`) added 50 keys: washNavTitle through
    //   washRecentLoadErrorMessage - its own copy of the workspace-loading
    //   guard message (the identical fact as meter logs', kept as a
    //   separate key for the same top-level-feature-independence reason),
    //   the "Due for wash" panel's title/none/today/overdue (the latter
    //   carrying an `{days}` placeholder)/load-error vocabulary, the asset
    //   field and its master-info fleet-number fragment (`{fleetNo}`), the
    //   site field and its auto-fill help text, the locked-to-today date
    //   line (`{date}`), the seven-value wash-type vocabulary and the two
    //   -value status vocabulary (both DB-CHECK tokens, translated only for
    //   display - see `wash_record.dart`'s own `kWashTypes`/
    //   `kWashStatusChoices`), the photo gallery's add/camera/gallery
    //   labels, the operator/bay/odometer/notes detail fields, the two
    //   validation dialogs (asset/wash-type required), the Save Wash action
    //   and its saved/failed/try-again outcomes, and the recent-washes
    //   sheet's own title/empty/error strings.
    // 445 + 50 = 495.
    // - `features/work_orders` and `features/home` (Phase 8a - the real
    //   `work_orders` maintenance job-card list and detail screens, plus
    //   the minimal Home branch-root screen built alongside them purely to
    //   make Work Orders genuinely reachable - see `features/home/
    //   presentation/home_screen.dart`'s own library comment) together
    //   added 52 keys: homeNavTitle through workOrderFieldDescription.
    //   `features/home` contributed 6 (homeNavTitle, homeGreeting,
    //   homeQuickActionsHeading, homeWorkOrdersTile,
    //   homeWorkOrdersTileSubtitle, homeNoQuickActionsMessage) - a
    //   deliberately small vocabulary for a deliberately minimal stopgap
    //   screen, not a Home hub's full copy. `features/work_orders`
    //   contributed the remaining 46: the list screen's nav title/active
    //   -count (carrying a `{count}` placeholder)/Active-All filter chips/
    //   empty and load-error states/the two raw-value display fallbacks
    //   (a blank status shows a translated "Open", a blank work type shows
    //   a translated "General work" - `work_order_badges.dart`'s own
    //   library comment on why a STORED value is otherwise always shown
    //   verbatim, never translated); the create sheet's field labels/
    //   hints/validation and save-outcome messages; the six work-type and
    //   four priority CREATE-FORM option labels (translated for the
    //   picker only - a saved row still reads back its raw English word);
    //   the two status-advance button labels (each simply naming the
    //   state it moves a job to) and their shared "queued, will sync"
    //   outcome message, used by both the list row's inline action and the
    //   detail screen's own; and the detail screen's own not-found/
    //   load-error pair, title fallback, and seven field labels (work
    //   order number, work type, site, country, opened/started/completed,
    //   description).
    // - `features/home` again (the real Home hub, replacing the Phase 8a
    //   stopgap by REPLACEMENT rather than extension - see
    //   `features/home/presentation/home_screen.dart`'s own library comment
    //   on why). Net +6: 3 stopgap-only keys retired
    //   (homeQuickActionsHeading, homeWorkOrdersTile,
    //   homeWorkOrdersTileSubtitle - the tile grid now carries per-section
    //   headings and reuses each destination's own existing nav-title key
    //   for its tile label, e.g. `workOrdersNavTitle`, rather than a
    //   Home-local duplicate) against 9 new ones added: three section
    //   headings (homeFieldSectionHeading, homeFleetSectionHeading,
    //   homeMaintenanceSectionHeading) and six small-stat-card strings
    //   (homeSyncStatLabel, homeSiteStatLabel, homeSiteStatUnavailable,
    //   homeFleetSizeStatLabel, homeStatLoadingCaption,
    //   homeStatUnavailableCaption) for the pending-sync/site/fleet-size
    //   row. homeNavTitle, homeGreeting and homeNoQuickActionsMessage carry
    //   over unchanged from the stopgap - the greeting and the honest
    //   zero-access fallback are both still correct as written.
    // 547 - 3 + 9 = 553.
    // - `features/tyre_exchange` (Tyre Replacement, ported from
    //   `mobile/app/(app)/tyre-change.tsx`). Purely additive, 40 new keys,
    //   nothing retired: the field labels/hints for asset, master-fleet
    //   readout, site (+ its auto-fill help text), position (+ its typed
    //   fallback), brand, size, serial, cost, odometer, tread depth and
    //   removal reason; the photo-picker's add/camera/gallery labels; the
    //   save action; the asset- and position-required validation pair; the
    //   saved/add-another/done outcome trio; and the save-failed title with
    //   its generic try-again fallback.
    // 553 + 40 = 593.
    // - `features/search` (global cross-entity search, spec section 34).
    //   Purely additive, 16 new keys: the search field's title/subtitle/
    //   placeholder/help text, the searching/idle/empty state trio, the
    //   recent-searches section heading, the results-count summary, one
    //   section label per result kind (assets/tyres/work orders/
    //   inspections), and a notice shown when one identifier-type lookup
    //   fails while at least one other still succeeds. Accident-reference
    //   matching is deliberately NOT represented here - no Flutter
    //   accidents feature exists yet, so that identifier type is omitted
    //   rather than half-built (see `features/search/data/
    //   global_search_repository.dart`'s own library comment).
    // 593 + 16 = 609.
    // - `features/auth` (the sign-in screen - the acute blocker this app had
    //   no entry point without) added 12 keys: loginAppSubtitle through
    //   loginErrorLocked - the subtitle under the app name, the footer
    //   tagline, the card's title/subtitle, the identifier and password
    //   field labels and placeholders, the show/hide-password tooltip pair,
    //   the client-side required-fields message, and the server-enforced
    //   lockout message (carrying an `{minutes}` plural placeholder - see
    //   `SignInLocked.lockoutMinutes`'s own doc comment for why it is never
    //   less than one). The submit button label deliberately REUSES the
    //   existing `actionSignIn` key rather than adding a new one - it
    //   already says exactly the right thing. The three language-toggle
    //   chip labels ('EN' / 'ع' / 'اردو') are deliberately NOT ARB keys at
    //   all - see `login_screen.dart`'s own `_LanguageOption` doc comment
    //   for why a language's own name must not be routed through whichever
    //   language happens to be active.
    // 609 + 12 = 621.
    // - `features/profile` (the Profile branch root - previously
    //   unreachable, and the only place `AuthController.signOut` was ever
    //   wired to a control) added 5 keys: profileNavTitle,
    //   profileRoleLabel, profileSuperAdminBadge,
    //   profileSignOutConfirmTitle and profileSignOutConfirmMessage. Three
    //   further strings this screen needed were genuine REUSES, not new
    //   keys: `valueUnavailable` (an absent full name), and
    //   `homeSiteStatLabel`/`homeSiteStatUnavailable` (the profile's site
    //   row states the identical fact the Home screen's own site stat card
    //   already does, over the same `WorkspaceProfile.legacySite` field) -
    //   duplicating either would only have drifted the two screens apart.
    // 621 + 5 = 626.
    // - `features/tyre_diagram` again (the redesigned "Tyre Map / Vehicle
    //   Layout" board - a real Layout/List toggle, a Total/OK/Monitor/
    //   Critical stat row, and the flat list alternative to the diagram -
    //   plus the two new screens it opens into: Tyre Detail for one wheel
    //   and Take Action for what can be done about it) added 61 keys,
    //   nothing retired: tyreDiagramModeLayout through
    //   tyreDiagramListEmptyMessage (12 - the two view-mode toggle labels,
    //   the four stat-row labels, the "{count} not yet recorded" caption,
    //   the list row's tread/pressure value templates and its own "Not
    //   recorded" fallback, and the list's empty title/message pair);
    //   tyreDetailTitle through tyreDetailNoEvidenceMessage (16 - the
    //   three stat labels, the shared "not recorded" fallback and its
    //   fuller caption form, the Overview and Additional info section
    //   headings, the four Additional-info field labels for data this
    //   domain does not track at all - brand/pattern, size, installed
    //   distance, running distance - deliberately rendering the honest
    //   fallback rather than a fabricated value per AGENTS.md rule 1, the
    //   asset/site field labels, the Take action button, and the "nobody
    //   has recorded anything yet" message); takeActionTitle through
    //   takeActionComingSoonCaption (13 - the seven action-row titles,
    //   Replace tyre's and Report defect's own subtitles as the two rows a
    //   real write path backs, Adjust reading's two subtitles for its
    //   conditionally-live state, and the single "not available in this
    //   build yet" caption shared by the four rows nothing in this
    //   codebase's command registry backs - repository rule 7, never a
    //   live-looking control that does nothing); reportDefectTitle through
    //   reportDefectSaveFailedTitle (14 - the sheet's own title, the
    //   title/description field labels and hints, the damage-reason and
    //   priority dropdown labels, the submit action, the title-required
    //   validation pair, and the saved/save-failed outcome messages, the
    //   last of which deliberately reuses the tyre-exchange feature's own
    //   `tyreReplaceTryAgainFallback` rather than adding a duplicate
    //   generic-retry string); and damageReasonPuncture through
    //   damageReasonOther (6 - the damage-reason dropdown's own option
    //   vocabulary, distinct from any tyre-condition vocabulary because a
    //   defect report's cause is not the same axis as a recorded
    //   condition).
    // tyreDetailAddDetailsButton through tyreDetailRemainingKmUnavailable
    // add 5 more tyre-detail strings for the submitted-reading workflow.
    // - `features/auth` (country-aware sign-in) added 11 keys for one shared
    //   login flow across Saudi Arabia, the United Arab Emirates and Egypt:
    //   the generic PMV operations heading, welcome title/subtitle, country
    //   selector title/subtitle, change-country action, three country labels,
    //   and the selector's label/value accessibility copy. None of these
    //   strings claims that the product itself belongs to one country.
    // - The richer login scope strip adds 3 missing COMBINED labels:
    //   Fleet & assets, Inspections & checklists, and Maintenance & workshop.
    //   It reuses `globalSearchSectionTyres` and `tabAccidents` for the two
    //   single-module labels instead of duplicating their existing strings.
    // 626 + 66 + 11 + 3 + 3 + 2 = 711. The final five keys are the localized
    // Accident, My Work and Alerts feature catalogs added with their
    // registered screens.
    // - `features/inspections` then added 7 truthful workflow keys for the
    //   Not started / In progress / Ready for review hierarchy, its resume
    //   summary, and the untouched/in-progress/complete helper copy. The
    //   existing
    //   `inspectionResumeProgress` key was corrected from "recorded" to
    //   "checked" without changing the key count.
    // 736 + 29 = 765.
    // Bumping this pin is the expected maintenance action
    // for a real key addition; this comment exists so the next person to
    // touch it can tell that apart from a mistake. Per this file's own
    // earlier note: if a future edit ever makes a translated file the
    // larger one, re-derive which file is the reference before touching
    // this number - do not just raise it blind.
    // Notifications, RCA, PM, stock, calendar and management add their
    // locale-owned catalogs without introducing per-locale drift.
    test('en, ar and ur each carry exactly 772 translatable keys today', () {
      expect(_translatableKeys(en).length, 772);
      expect(_translatableKeys(ar).length, 772);
      expect(_translatableKeys(ur).length, 772);
    });
  });

  group('every english key exists in the translated files', () {
    test('nothing is missing from app_ar.arb', () {
      final List<String> missing = _translatableKeys(
        en,
      ).difference(_translatableKeys(ar)).toList()
        ..sort();
      expect(missing, isEmpty, reason: 'app_ar.arb is missing: $missing');
    });

    test('nothing is missing from app_ur.arb', () {
      final List<String> missing = _translatableKeys(
        en,
      ).difference(_translatableKeys(ur)).toList()
        ..sort();
      expect(missing, isEmpty, reason: 'app_ur.arb is missing: $missing');
    });
  });

  group('neither translated file carries a key english does not have', () {
    // A stray key in ar/ur is never read by AppLocalizations - it is only
    // ever generated from the template file's own keys - and its
    // presence is a sign the template and a translation have drifted
    // apart in the other direction.
    test('app_ar.arb has no extra keys', () {
      final List<String> extra = _translatableKeys(
        ar,
      ).difference(_translatableKeys(en)).toList()
        ..sort();
      expect(
        extra,
        isEmpty,
        reason: 'app_ar.arb has keys not in app_en.arb: $extra',
      );
    });

    test('app_ur.arb has no extra keys', () {
      final List<String> extra = _translatableKeys(
        ur,
      ).difference(_translatableKeys(en)).toList()
        ..sort();
      expect(
        extra,
        isEmpty,
        reason: 'app_ur.arb has keys not in app_en.arb: $extra',
      );
    });
  });

  group('no translation is an empty string', () {
    // An empty translation is worse than a missing key: a missing key at
    // least surfaces during generation or falls back to a placeholder; an
    // empty one silently renders nothing on screen with no signal
    // anything is wrong.
    void expectNoEmptyValues(String label, Map<String, dynamic> arb) {
      final List<String> empties = <String>[];
      for (final MapEntry<String, dynamic> entry in arb.entries) {
        if (entry.key.startsWith('@')) {
          continue;
        }
        final dynamic value = entry.value;
        if (value is String && value.trim().isEmpty) {
          empties.add(entry.key);
        }
      }
      expect(
        empties,
        isEmpty,
        reason: '$label has empty translations for: $empties',
      );
    }

    test('app_en.arb', () {
      expectNoEmptyValues('app_en.arb', en);
    });

    test('app_ar.arb', () {
      expectNoEmptyValues('app_ar.arb', ar);
    });

    test('app_ur.arb', () {
      expectNoEmptyValues('app_ur.arb', ur);
    });
  });
}
