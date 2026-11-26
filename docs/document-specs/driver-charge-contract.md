# Driver charge contract (web and Flutter)

Migration: `supabase/migrations/20261126170000_driver_charge_cases.sql` (authored, NOT applied).
PDF spec: `docs/document-specs/driver-charge-notice.json` (both clients render this one spec).
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
| `charge_issue` | manager or assigned supervisor, never the driver | `category, source_type, source_id?, vehicle_id?, incident_at?, basis (10..4000), amount (finite, > 0, <= 1,000,000), currency, evidence: [{kind, ref, label}]`. `currency` must equal `country_currency` for the driver's country. `traffic_fine` must link `driver_fine`; the fine must be approved (`response_status approved`, `review_stage complete`), open and unpaid, the charge in the fine currency and not above the fine amount; the fine is then linked (`driver_fines.recovery_charge_id`) and its own payment step is locked until the charge closes. A linked record must be in the driver's country, inside the caller's country/site scope and, where it names a driver (id or name), name this driver. Needs a source or at least one evidence item. |
| `charge_correct` | manager, or the issuing supervisor, while `issued` | `amount?, basis?, vehicle_id?, incident_at?, reason` |
| `charge_attach_evidence` | as above, while `issued` | `kind, ref, label` |
| `charge_notify` | manager or supervisor | none. Stamps `notified_at` and `notified_by`; freezes the charge. |
| `charge_respond` | linked driver only, status `notified` | `response: accept or dispute, statement_version (deduction-consent-v1 for accept, receipt-dispute-v1 for dispute), statement_language: en, acknowledged: true, signature, explanation (required for dispute)` |
| `charge_record_refusal` | manager or supervisor, status `notified` | `witness_user_id, reason`. Step 1 of 2: names an active account in the tenant that is not the recorder, the issuer, the person who served the notice or the driver. The charge stays `notified` until the witness confirms. |
| `charge_witness_confirm` | the named witness only, signed in as themselves | `statement_version: refusal-witness-v1, acknowledged: true, signature`. Step 2: records the witness signature and moves the charge to `refused`. |
| `charge_supervisor_review` | manager or supervisor who did NOT issue it, serve it or witness the refusal | `decision: approve or return, reason` |
| `charge_finance_review` | finance reviewer, not the issuer, notifier, witness or supervisor approver | `decision: approve or return, reason` |
| `charge_schedule` | finance reviewer, status `finance_approved` | `monthly_wage (finite, > 0, <= 1,000,000), wage_currency (must equal the charge currency), instalments: [{due_month: YYYY-MM-01, amount}], reason?`. Each instalment at most `round(monthly_wage * cap_pct / 100, 2)`, and the SUM of all non-cancelled instalments of this driver in each month, across ALL his charges, must stay within that limit (a month holding another currency is refused); total equals the outstanding amount; months ascending from the current month. If the driver did not accept: only after the appeal window since finance approval, or after an upheld appeal. |
| `charge_record_deduction` | finance reviewer, status `scheduled` | `instalment_id, payroll_reference`. Month must be due. |
| `charge_waive` | manager or finance | `reason` |
| `charge_reverse` | manager, no deduction recorded | `reversal_code (wrong_driver, duplicate, wrong_amount, wrong_vehicle, misused, other), reason (10+), reissue?: {driver_id?, amount?, basis?, vehicle_id?}`. Duplicate and misused cannot reissue. Wrong driver must reissue to a different driver. |
| `charge_appeal` | linked driver, once, status `supervisor_approved`, `finance_approved` or `scheduled` | `reason (10+)` |
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
Only records the charge could actually link (same rules as `charge_issue`) are listed. The search
matches named human-readable columns only (for example reference, asset, plate, driver name), never
the whole row.

Signatures are not readable from `driver_charge_signatures` directly; use `driver_charge_detail`.

### `approve_accident_liability(p_assessment_id uuid, p_reason text, p_charge jsonb)`

Elevated or `accidents.approve_liability`. Stamps `approved_by = auth.uid()` and `approved_at = now()`,
locks the row, writes `accident_liability_approvals`. When the assessment payer is `driver_recovery`,
`p_charge = { driver_id, currency, amount?, basis?, evidence? }` is required and opens an
`accident_damage` charge linked to the accident (amount defaults to `accidents.repair_cost`). The
client can no longer set approval columns directly; an approved row cannot be edited or deleted.

### `review_driver_expense(p_id uuid, p_status text, p_reason text)`

Elevated only, never your own claim. `pending -> approved | rejected`, `approved -> reimbursed`.
Stamps `reviewed_by`, `reviewed_at`, `review_reason`. Owners may edit or delete only their own pending claims.

## Settings (`system_config`)

| Key | Default | Meaning |
|---|---|---|
| `driver_charge_instalment_cap_pct` | `20` | Highest percent of the monthly wage one instalment may take |
| `driver_charge_appeal_window_days` | `7` | Days to appeal a charge the driver did not accept, before scheduling |

## Statements (stored verbatim with each signature)

Returned by `driver_charge_detail.statements`. Versions: `deduction-consent-v1`, `receipt-dispute-v1`,
`refusal-witness-v1`. English only today; Arabic and Urdu need owner-approved legal wording before a
new version is added on the server.


### `reopen_accident_liability(p_assessment_id uuid, p_reason text)`

Super admin or organisation Admin only. Reason 10..2000. Unlocks the approved assessment (the same
row; `accident_id` is unique), writes `accident_liability_reopens`, and reverses (status
`cancelled_wrongly_issued`, reason recorded) the driver charge the latest approval opened, if it has
no deduction. Refused when deductions exist: waive the remainder on the charge first. Returns
`{ assessment_id, reopen_id, reversed_charge_id }`. The approver must not be the person who recorded
the assessment. An approved assessment still accepts `field_audit` updates. An accident with an
approval on record cannot be deleted (the case is closed instead); an accident whose assessment was
never approved deletes normally.

### `review_driver_expense(p_id uuid, p_status text, p_reason text, p_expected_updated_at timestamptz)`

Elevated, not the claim owner, in country and site scope (site from the claim or its vehicle).
`p_expected_updated_at` is the `updated_at` the reviewer saw; a changed claim returns `PT409`. A
reviewed claim cannot be deleted except by a super admin.
