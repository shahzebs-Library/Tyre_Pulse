# 09. Migration matrix

Artifact 9 of the nine required by section 75 of the Flutter migration spec.

## What this file is, and what it is not

Section 75 asks for a per-feature matrix of SOURCE LOGIC / CORRECTIONS /
BACKEND / FLUTTER TARGET / OFFLINE STRATEGY / TESTS.

**Artifact 01 already carries exactly those columns for all 72 features.**
Repeating them here would create a second copy that drifts from the first, which
is the failure mode AGENTS.md rule 1 and the spec's own anti-duplication stance
exist to prevent. So this file does the part artifact 01 does not:

- it SEQUENCES the 72 features into the spec's 12 phases
- it states what must be TRUE before each phase starts and before it is called done
- it lists the decisions that BLOCK a phase, and who has to make them
- it carries the risk register

Read artifact 01 for "what is this feature". Read this for "when do we build it
and what stops us".

## Confidence key

| Mark | Meaning |
|---|---|
| VERIFIED | Read directly from source in this repo |
| RECORDED | A measured figure quoted from another artifact or PROJECT_MEMORY |
| UNVERIFIED | Needs a live database check. The Supabase connector was not authenticated when this was written |

---

## 1. The scale being sequenced

RECORDED from artifacts 01, 03, 04, 05 and 06:

| Measure | Count |
|---|---|
| User-facing features | 72 |
| Addressable routes | 49 |
| Access modules | 31 (11 admin-only) |
| Distinct tables | 33 (32 exist live, 1 does not) |
| Offline write paths | 17 |
| Local Drift tables designed | 17 |
| Existing behaviour-pinning tests to port | 37 |
| Feature areas with NO test today | 2 of 13 |

The last row is the one that shapes the plan. Accidents, and assets/scanning,
have no behavioural tests at all - and the accident report form alone is 1,235
lines. Those areas cannot be migrated by test parity because there is no parity
to measure. They need characterisation tests written against the CURRENT app
before the Flutter version is trusted. That is why accidents sits late, at
phase 9, rather than early where its business importance might suggest.

---

## 2. Phase map

Phases are the spec's, from section 67. The feature-area numbers refer to
artifact 01 sections 2.1 to 2.13.

| Phase | Scope | Feature areas | Depends on | Status |
|---|---|---|---|---|
| 0 | Freeze source apps as reference | none | - | DONE. `mobile/` and `tyre_pulse_app/` are read-only by AGENTS.md, not deleted |
| 1 | Foundation: structure, config, Supabase, logging, Sentry, secure storage, Drift, Riverpod, GoRouter, localisation, theme, permissions, workspace | 2.13 cross-cutting | - | IN PROGRESS |
| 2 | Auth and shell: bootstrap, session restore, login, profile, access gate, version gate, workspace, navigation, Home, offline banner | 2.1, 2.2 | 1 | Not started |
| 3 | Fleet foundation: asset list and detail, search, tyre list/detail/history, serial search, scanner | 2.5, 2.6 | 2 | Not started |
| 4 | Tyre diagram engine, to TEST PARITY before phase 5 continues | part of 2.3 | 3 | Not started |
| 5 | Inspection: draft, tyre editor, conditions, photos, completeness, signature, offline submit, history | 2.3 | 4 | Not started |
| 6 | Generic checklist engine, then approvals | 2.4 | 5 | Not started |
| 7 | Tyre replacement, meter logs, washing | 2.7, part of 2.5 | 4, 6 | Not started |
| 8 | Workshop, work orders, maintenance | 2.9 | 2 | Not started |
| 9 | Accidents, evidence, claims, RCA, PDFs | 2.8 | 2, plus characterisation tests | Not started |
| 10 | Stock, notifications, reports, team, admin, AI | 2.10, 2.11, 2.12 | 2 | Not started |
| 11 | iOS completion: APNs, permissions, background modes, deep links, signing, TestFlight | all | 2 onward | Continuous, closed here |
| 12 | Parallel production validation against the Expo app | all | 11 | Not started |

### Why this order and not another

**Phase 4 is a hard gate before phase 5.** The spec states it and artifact 07
supplies the fixture. The tyre diagram decides which positions exist, and the
inspection writes answers keyed to those positions. Build the inspection on a
wrong position vocabulary and every row written is mis-keyed - and AGENTS.md
rule 10 forbids changing position IDs later to fix it.

**Phase 6 depends on phase 5, not the reverse.** They look independent - a
checklist is not an inspection - but they share draft persistence, the photo
pipeline and signature capture. Building checklists first means building all
three twice.

**Phase 7 waits for phase 6** only for washing and meters, which are simple.
Tyre replacement waits for phase 4 because it writes to positions.

**Phases 8, 9 and 10 depend only on phase 2** and can run in parallel with each
other once the shell is real. They are listed in sequence for a single team, not
because a dependency forces it.

---

## 3. Per-phase entry and exit

Exit criteria are the spec's Definition of Done (section 72) applied to the
phase. "Done" is never "the screen looks finished".

### Phase 1 - Foundation

**Entry:** nothing.

**Exit:**
- CI green on all three jobs: analyze/test, Android build, iOS build
- Drift schema opens, and a version-1-to-current migration test PROVES rows survive
- The permission resolver passes its precedence table under both admin-vs-revoke behaviours
- Config validation refuses a service-role key and explains a missing URL
- The seven distinguishable states of spec section 58 exist as widgets, and a refusal cannot be rendered as a spinner
- No business feature exists yet. This is deliberate: the spec forbids feature migration until the foundation passes tests.

### Phase 2 - Auth and shell

**Entry:** phase 1 exit met. **Decisions D1, D6 and D9 answered.**

**Exit:**
- Session restores across process death
- A transient network failure does NOT sign a user out. Artifact 01 section 5.8 is explicit: only a definitive server answer may end a session, and the production app got this wrong once
- The forced-update gate blocks a build below the configured minimum and FAILS OPEN on every error path
- Back returns to the actual previous destination, proven by a test, never a jump to Home
- A denied route renders a reason
- Offline banner shows a real pending count from the Drift queue

### Phase 3 - Fleet foundation

**Entry:** phase 2 exit met. **Decision D8 answered** (is global search in scope).

**Exit:**
- Lists page rather than loading a fleet. Artifact 01 section 5.19 records that `.limit(N)` above 1000 is not a bound in PostgREST - a paged read is the only bound
- A failed read renders as failed, never as empty. Section 5.6
- Scanner routes a scanned code to the right destination and degrades to manual entry

### Phase 4 - Tyre diagram

**Entry:** phase 3 exit met.

**Exit:** artifact 07's full parity suite passes. Position identifiers are
byte-identical to production storage keys. This phase is not done at partial
parity - a diagram that is right for eight vehicle types and wrong for the ninth
silently corrupts that ninth type's inspections.

### Phase 5 - Inspection

**Entry:** phase 4 at full parity.

**Exit:**
- Completeness matches artifact 07's rules, including the `checked` marker and the mobile `requireEvidence` override, which must be ported AS A PAIR. Artifact 01 section 5.12 records the consequence of splitting them: one inspection in four becomes unsubmittable
- A pressure of 0 is a real reading and survives. Section 5.22
- **A draft survives process death.** See risk R2 - this is a NEW capability, not a port
- Photos queue without blocking the next tyre, and a local file is never deleted before the server confirms

### Phase 6 - Checklists and approvals

**Entry:** phase 5 exit met. **Decisions D2 and D3 answered - both block this phase.**

**Exit:**
- Artifact 08's parity suite passes
- The stored answer is the English canonical value, never the translated label. Section 5.24
- A signature is per field on the fill screen and per rung on the approval screen. Section 5.13
- Approvals go through the RPC and are NOT blindly queued

### Phase 7 - Replacement, meters, washing

**Entry:** phases 4 and 6 exit met.

**Exit:** replacement is transactional and idempotent - close old fitment,
update removed tyre, create new fitment, update replacement tyre, record meter,
write history. Prefer a server RPC so the mutations succeed or fail together.
The Kotlin replacement screen wrote nothing at all (spec section 36); a Flutter
version that writes four of six rows is worse than one that writes none.

### Phase 8 - Workshop

**Entry:** phase 2 exit met. **Decision D4 answered - blocks this phase.**

**Exit:** every metric shown is backed by a real column. Anything the backend
cannot supply renders unavailable, never a plausible number.

### Phase 9 - Accidents

**Entry:** phase 2 exit met, AND characterisation tests written against the
current Expo accident flow. This phase cannot start on test parity because there
is no test to have parity with.

**Exit:** the workstream status logic matches production, evidence is linked by
stable IDs, and no invented field appears.

### Phase 10 - Operational modules

**Entry:** phase 2 exit met. **Decision D7 answered** (where do the seven
unhomed features live).

**Exit:** an empty table renders "no records", never sample data. Spec section
45 records that the Kotlin app displayed invented tyre stock at a real site.

### Phase 11 - iOS completion

iOS compiles from phase 1 onward because CI builds it on every commit. This
phase closes APNs, background modes, signing and TestFlight - not "start iOS".

### Phase 12 - Parallel validation

Run both apps with selected users and compare submission counts, tyre positions,
photos, signatures, sync, approvals, crash rate and load time. Promote only on
proven parity. Do not replace the Expo app on a schedule.

---

## 4. Decisions that block phases

These are product-owner calls, not engineering ones. Each names the phase it
blocks so none is discovered late.

| ID | Decision | Blocks | Source |
|---|---|---|---|
| D1 | Can a per-user REVOKE deny an admin? Mobile says yes; the web resolver and the server RPC say no. Three resolvers, three answers | 2 | Artifact 04 |
| D2 | Which of the three checklist-approval gates is authoritative? The supervisory roles V600 named as signers are refused at the screen TODAY | 6 | Artifact 01 section 5.15b |
| D3 | Do approvals route through the RPC and stop being queued? | 6 | Artifact 06 section 4 |
| D4 | `workorders/index.tsx` is labelled Work Orders and reads `corrective_actions`; `work-orders.tsx` reads the real table and is orphaned. Which is live, and does the label or the table change? | 8 | Artifact 01 questions 1-3 |
| D5 | Is the repair-request/RFR flow in scope, and will V608 be applied? The table does not exist, so every submit fails today | 7 or 10 | Artifact 01 question 6 |
| D6 | Does `routeAccess.ts` become the source of truth in Flutter, or be deleted? It has zero consumers today and has already drifted from the guards | 2 | Artifact 03 |
| D7 | Seven live features have no Flutter package in spec section 3: alerts, calendar, analytics, overview, report-an-issue, repair-request, serial search | 10 | Artifact 01 question 7 |
| D8 | Global search is specified (spec 34) but does not exist on the phone. Build it or drop it? | 3 | Artifact 01 question 8 |
| D9 | Confirm the field-capture lockdown stands. The registry prose contradicts its own data and the data is right | 2 | Artifact 01 question 9 |
| D10 | `engine_hours_logs` is written by mobile and never read. Add hours history, or accept write-only? | 7 | Artifact 01 question 8 |

**D1, D6 and D9 block phase 2, which is the next phase.** They should be
answered first.

---

## 5. Risk register

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Nothing is verifiable locally.** No Flutter SDK, no JDK, no Android SDK, and a Windows host so no Xcode | High | CI is the verification boundary and builds Android AND iOS on every commit. No claim of working code without a green run. See `tyre_pulse_flutter/docs/TOOLCHAIN.md` |
| R2 | **The inspection capture screen has no draft in production.** Asset, meter and up to 13 tyre positions with photos live only in React state until submit. Backgrounding plus an Android process reclaim loses it silently | High | Flutter must NOT port this. Drafts are in the phase 5 exit criteria as a new capability. Artifact 05 designs the tables |
| R3 | **Two feature areas have no tests**, one of them a 1,235-line accident form | High | Phase 9 entry requires characterisation tests written first |
| R4 | **`view` is not a data boundary.** No RLS policy gates on it - VERIFIED by grepping every migration. Module-off hides the tile, it does not stop a read | High | Encoded in the permission layer: capabilities are typed server-enforced vs UI-only, and a repository may not treat module access as authorisation to fetch |
| R5 | Position ID vocabulary confusion between storage keys and render slot IDs | High | Artifact 07 resolves it. AGENTS.md rule 10 forbids renaming. Parity gate at phase 4 |
| R6 | A queued approval replayed hours later contradicts a decision somebody already made | High | Spec section 14. Approvals are online-only or use optimistic concurrency. D3 |
| R7 | Seven parameter-name inconsistencies carried into Flutter routes | Medium | Artifact 03 lists them. One canonical name per concept, chosen at phase 2 and recorded |
| R8 | Riverpod 3.x and go_router 18.x differ from the majors most examples target | Medium | Recorded in `BOOTSTRAP.md`. Reviewers must check the major before accepting a snippet |
| R9 | Generated `.g.dart` cannot be produced locally | Medium | Committed to the repo and regenerated in CI, which fails if the committed copy is stale |
| R10 | A publishing accident creates a second unrelated Play listing | Medium | Spec section 69. Confirm package id, signing key and version code before any release. Nothing is published in phases 1-11 |
| R11 | Unsynced Expo work is lost at upgrade | Medium | Spec section 68: require the legacy app to drain its queue first, verify pending is zero, warn before upgrade. The server is the migration authority - do NOT read AsyncStorage from Flutter |
| R12 | A compromised signing key is in repository history | Recorded | Spec section 70. Treat as compromised, never copy into the Flutter repo, rotate. `.gitignore` blocks all signing material |

---

## 6. Explicitly out of scope

Stated so nobody rebuilds them by accident:

- **The web application.** It stays React and Next.js. Spec section 2.
- **A custom REST backend.** It does not exist. Spec section 2 and AGENTS.md rule 3.
- **Heavy analytics.** They remain on the web. Spec section 48 limits mobile reporting to field outputs.
- **Platform configuration.** Stays in the web console. Spec section 50.
- **Deleting the Expo or Kotlin app.** Phase 0 freezes them as reference. Spec section 67 says no destructive deletion, and phase 12 requires the Expo app running in parallel.

---

## 7. Live checks still outstanding

The Supabase connector was not authenticated for any artifact in this set. These
must be run before Flutter code depends on them. Artifact 01 section 10 carries
the SQL; the highest-priority four are:

1. Does `repair_requests` exist? Decides D5.
2. Which tables carry `client_uuid` AND a unique index? This is what makes queue
   idempotency real rather than assumed, and artifact 05 flags that the
   migrations disagree with each other on partial versus plain indexes.
3. Which `mobile:` module keys exist in `module_permissions`? Settles whether
   two roles have screens the registry says they do not.
4. Which roles actually exist in `profiles`? Settles whether `normaliseRole`
   silently collapses a real role.
