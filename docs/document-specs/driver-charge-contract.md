# Driver charge contract (web and Flutter)

Migration: `supabase/migrations/20261126170000_driver_charge_cases.sql` (authored, NOT applied).
PDF spec: `docs/document-specs/driver-charge-notice.json` (both clients render this one spec).
Signed statements: `docs/document-specs/driver-charge-statements.json` (English, Arabic, Urdu; the single
source of the words, checked against the SQL, the web locales and the Flutter ARB files by
`src/test/driverChargeStatementsParity.test.js`).
Web renderer: `src/lib/driverChargePdf.js`. Web service: `src/lib/api/driverCharges.js`.

A driver charge is any amount the company intends to recover from a driver: traffic fine, accident
damage, tyre damage, missing item, handover damage, other. It extends the traffic-fine engine: the
same `driver_workspace_command` RPC, the same idempotency ledger, the same `driver_workspace_events`
audit (now with a `charge_id` column) and the same access resolver `private.driver_workspace_access`.

## Tables (all `SELECT` only for `authenticated`; every write goes through the RPCs)

| Table | Purpose | Mutability |
|---|---|---|
| `driver_charges` | One charge case | Core fields frozen once `notified_at` is set; never deleted; terminal states never reopen |
| `driver_charge_evidence` | Evidence refs (`kind`, `ref`, `label`) | Append-only; added only while status is `issued` |
| `driver_charge_signatures` | Driver consent, driver dispute receipt, refusal witness | Append-only; stores exact statement text and a charge snapshot |
| `driver_charge_decisions` | Supervisor, finance, appeal, waiver, reversal, schedule, deduction | Append-only; separation of duties enforced by trigger |
| `driver_charge_appeals` | One appeal per charge | Filed once, decided once |
| `driver_charge_instalments` | Deduction schedule | Only `scheduled` rows may change, and only to `deducted` or `cancelled` |
| `accident_liability_approvals` | Audit of each liability approval | Append-only |

Read RLS: same organisation and `driver_workspace_access(driver_id) <> 'none'`. A driver sees only
charges of the driver record linked to his own login.

`driver_charges` key columns: `id, organisation_id, charge_no (DC-YYYY-NNNNN), driver_id, vehicle_id,
country, site, category, source_type, source_id, source_summary, incident_at, basis, amount (numeric 14,2),
currency (ISO 4217, never blended), status, driver_response, response_explanation, acknowledged_at,
notified_at, notified_by, deducted_amount, schedule_monthly_wage, schedule_cap_pct, schedule_cap_amount,
scheduled_by, scheduled_at, reversal_code, close_reason, supersedes_charge_id, superseded_by_charge_id,
version, issued_by, created_at, updated_at`.

Duplicate guard: at most one live (not `cancelled_wrongly_issued`) charge per
`(organisation_id, source_type, source_id, driver_id)`. A second issue raises `23505`.

## Status tokens

```
issued -> notified -> accepted | disputed | refused
accepted | disputed | refused -> supervisor_approved   (supervisor review: approve)
accepted | disputed | refused -> notified              (supervisor review: return, driver responds again)
supervisor_approved -> finance_approved                 (finance review: approve)
supervisor_approved -> accepted | disputed | refused    (finance review: return to supervisor)
supervisor_approved | finance_approved | scheduled -> under_appeal  (driver appeal, once)
under_appeal -> previous status (upheld) | waived (allowed)
finance_approved -> scheduled -> deducted
any non-terminal -> waived
any non-terminal with no deduction recorded -> cancelled_wrongly_issued (optional reissue)
```

Terminal: `deducted`, `waived`, `cancelled_wrongly_issued`.

`driver_response`: `accepted | disputed | refused | null`.

## RPCs

All return `jsonb`. Errors: `42501` not permitted, `22023` invalid input, `23505` duplicate,
`PT409` record changed or wrong state (refresh and retry; never `40001`).

### `driver_workspace_command(p_action text, p_payload jsonb, p_request_id uuid)`

`p_request_id` is a client UUID; replaying the same id with the same payload returns the first
result. Every payload carries `driver_id`. Every action except `charge_issue` carries `charge_id`
and `version` (the version the user was looking at). Returns
`{ driver_id, id, charge_no, action, replacement_charge_id? }`.

| Action | Who | Payload (besides driver_id, charge_id, version) |
|---|---|---|
| `charge_issue` | manager or assigned supervisor, never the driver | `category, source_type, source_id?, vehicle_id?, incident_at?, basis (10..4000), amount (finite, > 0, <= 1,000,000), currency, evidence: [{kind, ref, label}]`. `currency` must equal `country_currency` for the driver's country. `traffic_fine` must link `driver_fine`; the fine must be approved (`response_status approved`, `review_stage complete`), open and unpaid, the charge in the fine currency and not above the fine amount; the fine is then linked (`driver_fines.recovery_charge_id`) and its own payment step is locked until the charge closes. A linked record must be in the driver's country, inside the caller's country/site scope and, where it names a driver (id or name), name this driver. When the linked record names no driver (inspections, checklists, or an accident or tyre record with no driver), the payload must carry `link_unverified: true`; it is stored as `source_link_unverified` and the notice states "Link to source not confirmed by record". Needs a source or at least one evidence item. |
| `charge_correct` | manager, or the issuing supervisor, while `issued` | `amount?, basis?, vehicle_id?, incident_at?, reason` |
| `charge_attach_evidence` | as above, while `issued` | `kind, ref, label`. A `photo` must be a private storage reference `tp-storage://(tyre-photos\|accident-photos\|inspection-photos)/<path>`; anything else (a public URL, a bare path) is refused. |
| `charge_notify` | manager or supervisor | none. Stamps `notified_at` and `notified_by`; freezes the charge. A physical damage charge (`accident_damage`, `tyre_damage`, `handover_damage`) needs at least one `photo` evidence row first (`22023`). |
| `charge_respond` | linked driver only, status `notified` | `response: accept or dispute, statement_version (deduction-consent-v2 for accept, receipt-dispute-v2 for dispute), statement_language: en, ar or ur, acknowledged: true, signature, explanation (required for dispute)`. The server stores the statement text of the chosen language and the language with the signature. |
| `charge_record_refusal` | manager or supervisor, status `notified` | `witness_user_id, reason`. Step 1 of 2: names an active account in the tenant that has access to this driver's workspace and is not the recorder, the issuer, the person who served the notice or the driver. The charge stays `notified` until the witness confirms; until then the refusal can be recorded again (for example with another witness), which replaces the pending one. A supervisor or finance return clears a pending refusal. |
| `charge_witness_confirm` | the named witness only, signed in as themselves | `statement_version: refusal-witness-v2, statement_language: en, ar or ur, acknowledged: true, signature`. Step 2: records the witness signature and moves the charge to `refused`. |
| `charge_supervisor_review` | manager or supervisor who did NOT issue it, serve it, record the refusal or witness it | `decision: approve or return, reason` |
| `charge_finance_review` | finance reviewer, not the issuer, notifier, witness or supervisor approver | `decision: approve or return, reason` |
| `charge_schedule` | finance reviewer, status `finance_approved` | `monthly_wage (finite, > 0, <= 1,000,000), wage_currency (must equal the charge currency), instalments: [{due_month: YYYY-MM-01, amount}], reason?`. The limits depend on the charge country (see "Country deduction rules" below). Outside KSA: each instalment at most `round(monthly_wage * cap_pct / 100, 2)`, and the SUM of all non-cancelled instalments of this driver in each month, across ALL his charges, must stay within the limit computed from the LOWEST wage stated for him in that month. In KSA: the statutory limits below, per month across all charges, from the lowest wage stated that month. A month holding another currency is refused. The wage is not copied into decisions or events; total equals the outstanding amount; months ascending from the current month. Stores `schedule_rule` (`ksa_labour_law` or `company_setting`), `schedule_cap_pct` and `schedule_cap_amount` (the per-instalment limit of this charge). Without the driver's acceptance: see the country rules. |
| `charge_record_deduction` | finance reviewer, status `scheduled` | `instalment_id, payroll_reference`. Month must be due. |
| `charge_waive` | manager or finance | `reason` |
| `charge_reverse` | manager, no deduction recorded | `reversal_code (wrong_driver, duplicate, wrong_amount, wrong_vehicle, misused, other), reason (10+), reissue?: {driver_id?, amount?, basis?, vehicle_id?}`. Duplicate and misused cannot reissue. Wrong driver must reissue to a different driver. |
| `charge_appeal` | linked driver, once, status `supervisor_approved`, `finance_approved` or `scheduled`, and only while nothing has been deducted (there is no refund step; after the first deduction a manager or finance can waive the remainder) | `reason (10+)` |
| `charge_decide_appeal` | staff or finance who is not the issuer, notifier, refusal witness, any approver or the driver | `outcome: upheld or allowed, reason (10+)` |

Every choice field (`response`, `decision`, `outcome`, `reversal_code`) is required: a missing value is refused, never treated as a pass.

### `driver_charges_list(p_filters jsonb, p_offset integer)`

Filters: `driver_id, status, category, search`. Returns
`{ rows: [...up to 101], can_finance, cap_pct, appeal_window_days }`. Row fields: `id, charge_no,
driver_id, driver_name, employee_id, category, source_type, source_id, source_label, asset_no, site,
country, amount, currency, deducted_amount, outstanding, status, driver_response, version, notified_at,
created_at, updated_at, supersedes_charge_id, superseded_by_charge_id`. 101 rows means there is
another page.

### `driver_charge_detail(p_charge_id uuid)`

Returns `{ access, actions[], charge, driver, evidence[], signatures[], decisions[], appeal, instalments[],
events[], statements{version: text}, settings{cap_pct, appeal_window_days} }`. `actions` lists the
command names the caller may use now; the server still enforces every rule. Signature images are
omitted for the `viewer` access level.

### `driver_charge_sources(p_source_type text, p_driver_id uuid, p_search text, p_offset integer)`

Staff picker for linked records. Returns `[{ id, summary: { type, id, label, country, site, amount, currency } }]`.
Only records the charge could actually link (same rules as `charge_issue`) are listed; `summary.driver_recorded` says whether the record names a driver. Tyre records, inspections and checklists need a search of at least 3 characters (shorter returns `[]`). Cheap filters run before the 101-row limit, so a page can hold fewer than 101 rows. The search
matches named human-readable columns only (for example reference, asset, plate, driver name), never
the whole row.

Signatures are not readable from `driver_charge_signatures` directly; use `driver_charge_detail`.
`driver_charges.schedule_monthly_wage` and `schedule_cap_amount` are not readable directly either
(column grant), and `driver_charge_detail` omits them for the `viewer` access level. A signature must
be a PNG data URL of at least about 1 KB or an SVG with at least 10 points.
Approval and reopen history (`accident_liability_approvals`, `accident_liability_reopens`) is readable
only where the caller can read the parent assessment (its org, country and site policies).

### `approve_accident_liability(p_assessment_id uuid, p_reason text, p_charge jsonb)`

Elevated or `accidents.approve_liability`. Stamps `approved_by = auth.uid()` and `approved_at = now()`,
locks the row, writes `accident_liability_approvals`. When the assessment payer is `driver_recovery`,
`p_charge = { driver_id, currency, amount?, basis?, evidence? }` is required and opens an
`accident_damage` charge linked to the accident (amount defaults to `accidents.repair_cost`). The
client can no longer set approval columns directly; an approved row cannot be edited or deleted.

### `review_driver_expense(p_id uuid, p_status text, p_reason text)`

Elevated only, never your own claim. `pending -> approved | rejected`, `approved -> reimbursed`.
Stamps `reviewed_by`, `reviewed_at`, `review_reason`. Owners may edit or delete only their own pending claims.

## Country deduction rules

Server: `private.driver_charge_country_rule(country)`, `private.driver_charge_bucket(category)`,
`private.driver_charge_working_deadline(from, days)`, `private.driver_charge_objection_deadline(charge)`.
Display mirrors (never the authority): `chargeCountryRule`, `chargeBucket`, `scheduleCapFor`,
`workingDeadline` in `src/lib/driverCharges.js`; `driverChargeCountryRule`, `driverChargeBucket`,
`chargeWorkingDeadline` in `tyre_pulse_flutter/lib/features/driver_workspace/domain/driver_charge.dart`.

Buckets: `damage` = accident_damage, tyre_damage, missing_item, handover_damage; `fine` = traffic_fine;
`consent` = other.

### KSA (country KSA, SA, SAU or Saudi Arabia): Saudi Labour Law, Royal Decree M/51

A day's wage is the monthly wage stated on the schedule divided by 30.

| Article | Rule enforced on the server |
|---|---|
| 91 | Damage or loss caused by the worker's fault (`damage` bucket) may be deducted without the worker's written consent, but at most 5 days' wage per month across all his damage charges. The worker may object within 15 working days. |
| 70, 71 | A fine for one violation at most 5 days' wage (a `traffic_fine` charge above that is refused at scheduling); fines deducted in one month at most 5 days' wage across all his fine charges. |
| 92 | Any other deduction (`consent` bucket) needs the worker's written consent (`accepted`). |
| 93 | All deductions together in one month at most half (50%) of the wage due. |

Without consent (driver `disputed` or `refused`, witnessed): a KSA charge can be scheduled ONLY when it is in
the `damage` bucket, has supervisor and then finance approval (status `finance_approved`), has no open
objection (an appeal with no outcome), and the objection window has ended. A disputed or refused fine or
other charge is refused (`22023`, Article 92). The objection window is 15 working days (Sunday to Thursday,
Friday and Saturday off, Asia/Riyadh) counted from the finance approval; it closes at the end of the 15th
working day. Saudi public holidays are not excluded (not modelled).

The company setting `driver_charge_instalment_cap_pct` is not used in KSA: the statute sets the limits.

### UAE, Egypt and every other country: NEEDS LEGAL CONFIRMATION

The configurable behaviour is unchanged: instalment cap `driver_charge_instalment_cap_pct` of the lowest
wage, per driver per month across all charges, and a deduction without consent only after
`driver_charge_appeal_window_days` calendar days from finance approval or after an upheld appeal. The UAE
and Egypt labour law rules have NOT been checked; `country_rule` returns `needs_legal_confirmation: true` and
both clients say so on screen.

### Legal note

This is an implementation of the owner's reading of the Saudi Labour Law articles cited above. It is not
legal advice. Have a qualified Saudi labour lawyer confirm the rules (in particular: treating a traffic
fine recovered from the driver as an Article 70/71 fine, the 15 working day window counted from the finance
approval, and the day rate of wage / 30) before relying on it in a dispute, and confirm the UAE and Egypt
rules before using charges there.

## Evidence photos

The issuer uploads photos to the PRIVATE `tyre-photos` bucket under
`modules/driver-charge/<first 8 of uid>/<time>_<n>_<rand>.<ext>` (web `uploadDriverChargePhoto`, same checks
as handover photos: JPEG, PNG, WebP or HEIC, 20 MB). The charge stores the `tp-storage://` reference as a
`photo` evidence row. The driver sees the photos (short-lived signed URLs) before accepting, disputing or
appealing, on the web and in the Flutter app, and the notice PDF prints them in section 4a. Note: the
`tyre_photos_read` storage policy lets any active member of the organisation read objects under
`modules/`; it is not per charge.

## Settings (`system_config`)

| Key | Default | Meaning |
|---|---|---|
| `driver_charge_instalment_cap_pct` | `20` | Highest percent of the monthly wage one instalment may take (not used in KSA) |
| `driver_charge_appeal_window_days` | `7` | Calendar days to object to a charge the driver did not accept, before scheduling (not used in KSA: 15 working days) |

`driver_charge_detail.settings` also returns `country_rule`, `bucket`, `needs_photo`, `objection_deadline`
(instant the window closes, null before finance approval) and `objection_last_day` (`YYYY-MM-DD`, Riyadh).

## Statements (stored verbatim with each signature)

Returned by `driver_charge_detail.statements` as `{ version: { en, ar, ur } }`. Versions:
`deduction-consent-v2` (accept), `receipt-dispute-v2` (dispute, receipt only), `refusal-witness-v2`
(witness). Plain words for drivers who read little; every screen also says to ask the supervisor to read it
aloud. v2 replaced the unreleased v1 wording because v1 said a dispute signature "does not authorise any
deduction", which is not true for a KSA damage charge after the objection window. The Arabic and Urdu text is a
draft: it needs owner and legal approval before production use. The web has no Urdu interface language, so
the web shows Urdu statements from the server text only (`src/locales/{en,ar}/driverCharges.json` carry the
English and Arabic copies).

The notice PDF prints a short box in the driver's language (his latest signature's language, else the app
language, else English) and each signed statement in the language it was signed in; spec labels stay English.
The web draws Arabic and Urdu as a shaped image (browser canvas), the Flutter app with the Noto Naskh Arabic
fallback font.


### `reopen_accident_liability(p_assessment_id uuid, p_reason text)`

Super admin or organisation Admin only. Reason 10..2000. Unlocks the approved assessment (the same
row; `accident_id` is unique), writes `accident_liability_reopens`, and reverses (status
`cancelled_wrongly_issued`, reason recorded) the driver charge the latest approval opened, if it has
no deduction. Refused when deductions exist: waive the remainder on the charge first. Returns
`{ assessment_id, reopen_id, reversed_charge_id }`. The approver must not be the person who recorded
the assessment. An approved assessment still accepts `field_audit` updates. An accident with an
approval on record cannot be deleted (the case is closed instead); an accident whose assessment was
never approved, or was approved before this migration (no approval row), deletes normally with its
assessment. Such an approved assessment cannot be deleted on its own.

### `review_driver_expense(p_id uuid, p_status text, p_reason text, p_expected_updated_at timestamptz)`

Elevated, not the claim owner, in country and site scope (site from the claim or its vehicle).
`p_expected_updated_at` is the `updated_at` the reviewer saw; a changed claim returns `PT409`. A
reviewed claim cannot be deleted except by a super admin. The pending and review rules apply to
signed-in client writes only; service role and definer import functions (Data Intake) keep the
status they write.
