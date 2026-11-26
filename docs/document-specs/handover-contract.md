# Vehicle Handover Authorization: data contract

For the Flutter app (and any other client) that captures a vehicle handover and
prints the same paper as the web. Source of truth:
`supabase/migrations/20261126171000_handover_authorization_paper.sql` on top of
V181, `20261112130000`, `20261112143000` and `20261112155000`.
PDF layout: `docs/document-specs/handover-authorization.json` (the web renderer
`src/lib/vehicleHandoverPdf.js` reads that file; build the mobile PDF from the
same file, section by section, in the same order).

Status: the migration is AUTHORED, NOT APPLIED to production. Until it is, the
new columns and `sign_handover` do not exist; clients must fall back to the
legacy single `signature_url` (the web does: it retries a select without the new
columns when PostgREST answers 42703 / PGRST204).

## Flow

1. Insert a `handover_reports` row with `approval_status = 'draft'` and the
   field data (no signatures, no location, no document number).
2. The server mints `document_no` = `HO-<ASSET>-<YEAR>-<NNNN>` at insert
   (per organisation, asset and UTC year of `handover_at`).
3. Call `sign_handover(..., p_party => 'handing', ...)` with the handing party's
   signature.
4. Call `sign_handover(..., p_party => 'receiving', ...)` with the receiving
   party's signature. This sets `approval_status = 'pending_supervisor'`.
5. The record is now frozen. Fleet Supervisor, then Fleet Incharge, decide with
   `decide_handover_approval`. The handover appears in the Approvals queue.
6. If a supervisor sends it back, both driver signatures (and any supervisor
   signature), the location and the freeze are cleared and the record returns
   to `draft` with the reason in `review_note`. Correct it, then repeat steps 3
   and 4.

Who holds the pen for each signature:

- The account linked to that party's driver (`driver_account_links`) signs with
  `p_on_behalf = false`.
- Anyone else must send `p_on_behalf = true`, and the server accepts it only
  from a supervisor-level account (Admin, Manager, Director, Fleet Supervisor,
  Fleet Incharge, super admin). The screen must ask "I am signing on behalf of
  <name>" before sending the flag. A party with no driver id (typed name, yard)
  can only be signed on behalf.
- An account linked to EITHER driver on the handover can never sign for the
  other party. The app should leave that signature for later.
- One account may collect both signatures only when both are on behalf.

On a check-out the driver picked in the form RECEIVES the vehicle (to_*); the
other party (yard, previous driver) HANDS it over (from_*). On a check-in the
picked driver HANDS it back (from_*).

## Table `public.handover_reports`

Existing columns (unchanged): `id, organisation_id, country, report_no,
asset_no, handover_type ('checkout'|'checkin'), from_driver, to_driver (text,
kept for names not in the register), handover_at, odometer_km, fuel_level_pct
(0..100), condition_rating ('excellent'|'good'|'fair'|'poor'), damages (jsonb,
numbered markers, see src/lib/vehicleHandoverMarks.js), damage_count,
cleanliness ('clean'|'acceptable'|'dirty'), signature_url (legacy single
signature), photo_url, photos (jsonb array of tp-storage:// refs), notes,
created_by, created_at, updated_at, document_no, approval_status, review_note,
supervisor_name, supervisor_signature, supervisor_at, supervisor_by,
incharge_name, incharge_signature, incharge_at, incharge_by`.

New columns:

| column | type | written by | notes |
|---|---|---|---|
| from_driver_id | uuid, drivers(id) | client on insert | handing driver, when in the register |
| to_driver_id | uuid, drivers(id) | client on insert | receiving driver, when in the register |
| hour_meter | numeric, >= 0 | client on insert | engine hours at handover |
| site | text (upper case) | client on insert | site isolation applies |
| from_signature | text (SVG markup or data URL, max 200000 chars) | sign_handover only | |
| from_signed_name | text | sign_handover only | driver register name, else the typed name |
| from_signed_at | timestamptz | sign_handover only | server now() |
| from_signed_by | uuid, profiles(id) | sign_handover only | account that collected the signature |
| to_signature, to_signed_name, to_signed_at, to_signed_by | as above | sign_handover only | receiving party |
| latitude | double precision, -90..90 | sign_handover only | device GPS |
| longitude | double precision, -180..180 | sign_handover only | both or neither |
| location_accuracy_m | numeric, >= 0 | sign_handover only | |
| location_status | 'captured' / 'denied' / 'unavailable' | sign_handover only | honest when GPS is refused |
| location_captured_at | timestamptz | sign_handover only | server now() |
| frozen_at | timestamptz | sign_handover only | time of the first signature; cleared on send back |
| from_on_behalf, to_on_behalf | boolean | sign_handover only | true when a supervisor signed for that party |

Rules enforced by the database (a client cannot bypass them):

- INSERT carrying any signature, location, on-behalf or `frozen_at` column:
  refused 42501.
- `from_driver_id` / `to_driver_id` must be drivers of the same organisation
  (and the same country when both are set), and must differ: refused 22023.
- UPDATE of any signature or location column outside `sign_handover`: refused
  42501, for every role including super admin.
- After the FIRST signature every column except `approval_status`,
  `supervisor_*`, `incharge_*`, `review_note`, `updated_at` is frozen: refused
  42501 ("This handover has been signed and can no longer be changed.").
- The only way signatures are removed is the send back in
  `decide_handover_approval`; a plain UPDATE that clears them is refused 42501.
- DELETE after the receiving signature: refused 42501 unless super admin.
- A client supplied `document_no` is ignored; the server number is used.
- RLS: RESTRICTIVE org isolation, country isolation, and site isolation (null or
  blank site is visible to all).

## RPC `sign_handover`

```
sign_handover(
  p_id               uuid,
  p_party            text,                 -- 'handing' | 'receiving'
  p_signature        text,                 -- see "Signature format" below
  p_signer_name      text   default null,  -- used only when no driver id is set
  p_latitude         double precision default null,
  p_longitude        double precision default null,
  p_accuracy_m       numeric default null,
  p_location_status  text   default null,  -- 'denied' | 'unavailable' when no fix
  p_on_behalf        boolean default false -- true when not the driver's own account
) returns jsonb
```

Returns `{ ok: true, party, signed_name, signed_at, signed_by, on_behalf,
frozen: true, status }`, where `status` is the approval status after the call
(`pending_supervisor` after the receiving signature).

Signature format (`handover_valid_signature`, the same rule as the driver charge
module): either `data:image/png;base64,<base64>`, or exactly the static SVG the
web pad emits:
`<svg xmlns="http://www.w3.org/2000/svg" width="N" height="N" viewBox="0 0 N N">`
followed by one or more
`<path d="M.. L.." fill="none" stroke="#RRGGBB" stroke-width="N" stroke-linecap="round" stroke-linejoin="round"/>`
and `</svg>`, nothing else (width/height integers, path data only M, L, digits,
spaces, dots and minus). Anything else is refused 22023. The Flutter pad must
emit this shape (or a PNG data URL).

Grant: `authenticated` only. Requires an active (approved, not locked) account in
the row's organisation, country and site scope. The time is always server time;
there is no argument for it.

Errors (the message is a plain sentence; show it as is):

| code | when |
|---|---|
| 42501 | not signed in, or account not active; not the driver's account and `p_on_behalf` not set; on behalf from a non-supervisor; on behalf by an account linked to a driver on this handover; same account for both without both on behalf |
| 22023 | unknown party; missing, oversized or badly formed signature; invalid location; row not visible; already in sign-off; party already signed; receiving before handing; no signer name |

The handing party signs first. Each party signs once. The receiving moment's
location replaces the handing one.

## RPC `decide_handover_approval` (existing, extended)

```
decide_handover_approval(p_id uuid, p_approved boolean,
  p_signature text default null, p_note text default null) returns jsonb
```

Returns `{ ok, decision: 'approved'|'rejected', status, both_steps }`; a send
back also returns `signatures_cleared: true` and `status: 'draft'`.

Ladder: `draft -> pending_supervisor -> pending_incharge -> approved`. Sending
back (`p_approved = false`, needs `p_note`) from either pending rung returns the
record to `draft`, clears both driver signatures, the supervisor signature, the
location and `frozen_at`, and keeps the reason in `review_note`. Rows sent back
before this change carry `approval_status = 'rejected'`; treat both as "sent
back". A Fleet Incharge, Admin or super admin deciding at `pending_supervisor`
closes both rungs with one signature.

New refusals from 20261126171000:

| code | when |
|---|---|
| 42501 | the caller is linked (driver_account_links) to from_driver_id or to_driver_id: "A signing driver cannot sign off their own handover." |
| 42501 | the caller collected either signature (`from_signed_by` / `to_signed_by`) or created the record (`created_by`) |
| 22023 | approving before both drivers signed |

Who may sign: supervisor rung = Admin, Manager, Director, Fleet Supervisor,
Fleet Incharge, super admin; incharge rung = Admin, Fleet Incharge, super admin
(mirrored in `src/lib/handoverApproval.js`).

## Audit trail `public.handover_report_events`

Append-only: no client insert, update or delete, and a trigger refuses changes.
Readable within the same organisation AND the same country and site scope as
the handover itself (the event row carries the record's country and site).

Columns: `id, handover_id, organisation_id, country, site, action, actor,
actor_name, changes (jsonb), at`.

Actions: `created`, `edited`, `signed_handing`, `signed_receiving`,
`decision_pending_supervisor`, `decision_pending_incharge`, `decision_approved`,
`decision_rejected`, `decision_draft`, `sent_back` (every cleared value plus the
reason in `review_note`), `deleted`. On-behalf signing shows as
`from_on_behalf` / `to_on_behalf` in the `changes` of the signing event. `changes` holds
`{ column: { old, new } }`; signature images are recorded only as `"signed"`.

## Approvals queue

The web Approvals page lists `handover_reports` where `approval_status in
('pending_supervisor','pending_incharge')` as source `handover`; the drawer
decides through `decide_handover_approval`. Handovers are not bulk decidable.
`/handovers?view=<id>` opens one handover (used by the PDF QR code and the queue).

## Link to driver charges

A handover damage can later open a driver charge case: use
`source_type = 'handover_report'` and `source_id = handover_reports.id` (see
`docs/document-specs/driver-charge-contract.md` on its own branch). Nothing in
this migration creates charges.

## Known gaps

- When a person is typed rather than picked from the driver register there is
  no driver id, so only a supervisor can sign for them (on behalf), and the
  "approver is not the signing driver" rule cannot be keyed on a driver link.
- An on-behalf signature proves which supervisor account collected it, not that
  the named person held the pen; the flag makes that visible on the paper.
- Location is device measured and can be absent (`denied` or `unavailable`).
