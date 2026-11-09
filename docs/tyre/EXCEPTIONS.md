# Tyre exceptions - reconciliation register (Phase 4b, 2026-11-10)

Where: `/data-reconciliation`, Integrity tab, **Tyre exceptions** (`src/components/reconciliation/TyreExceptionsSection.jsx`).
Source: `public.get_tyre_exceptions_v2(country, kind, status, limit, offset)` over `public._tyre_exception_rows(country, kind)`
(migration `supabase/migrations/20261110113000_tyre_exceptions_v2_reviews.sql`). Shaping: `src/lib/tyreExceptionsV2.js`.

Every exception carries: the record ids behind it, the reason, a **proposed** correction (text only, never applied),
the expected impact (km and/or cost in the row's own currency, never blended) and a review status
(open / accepted / rejected / deferred, with note, who and when). Reviews are written by
`set_tyre_exception_review` into `tyre_exception_reviews` + the append-only `tyre_exception_review_events`.
**No exception, review or button on this page changes `tyre_records`, `parts_consumption` or any other business table.**
The correction itself is made by a person in the normal screens, under the normal undo rules (T16).

The older `get_tyre_exceptions(country)` (20261109150000) is unchanged; v2 is a new, versioned function.

## Kinds, rules and live counts

Counts read from the live database on 2026-11-10 inside an aborted transaction (nothing persisted), as the super admin.
A KSA-only Manager sees only the KSA column (6,695 rows); asking for UAE returns nothing.

| Kind | Rule (what makes it an exception) | KSA | UAE | Egypt | Proposed correction policy |
|---|---|---|---|---|---|
| `invalid_serial` | Active fitment with a blank serial, a value that fails T6 (`tyre_serial_is_strong`), or a real serial with a remark typed in the same cell | 80 | 39 | 5 | Read the serial from the sidewall; move remarks to notes |
| `duplicate_active` | One real serial active on more than one row: on two vehicles, or two wheels of one vehicle on the same day (T3/T5) | 3 | 1 | 2 | Close the fitment the tyre is no longer on |
| `uncertain_previous_tyre` | Same serial recorded as both the tyre removed and the tyre fitted at one change (old.removal_date = new.fit_date and old.km_at_removal = new.km_at_fitment), not handled by the 2026-11-09 fix | 57 (6 protected) | 14 (14 protected) | 0 | Read the old serial from the job card; keep the price on the tyre that was bought |
| `rotation_not_closed` | Output of `tyre_close_rotations(true, country)` - **dry run only**, hard-coded in the function. Shown only to roles that may run the closer | 6 | 4 | 0 | A person runs the rotation closer (owner decision); its undo is `tyre_replacement_undo(batch)` |
| `overlapping_fitment` | `v_tyre_lifetime_fitments.is_overlap` (T18): a fitment starts before an earlier fitment of the same tyre ended. Its km is already excluded from lifetime CPK | 313 | 175 | 72 | Close the earlier fitment, or remove the duplicate row when the meters are identical |
| `missing_readings` | No total km and no odometer/hour reading at fitment, or removed with no reading at removal | 272 | 226 | 20 | Take the reading from that day's job card |
| `invalid_reading` | Fitment odometer placeholder `1` (T7), life above the class cap (mixer 80k / pump 56k / loader 15k / other 100k), removal reading below fitment (km or hours), or an odometer reset (fitment reading more than 1,000 km below an earlier fitment on the same vehicle) | 1,143 | 403 | 76 | Enter the real reading; confirm meter replacement before correcting a reset |
| `conflicting_dates` | Removal before fitment, a future date, or removal after the next tyre was fitted on the same wheel. Live: 0 reversed, 0 future; all 2,249 are the wheel-sequence conflict | 1,988 | 198 | 63 | Set the removal date to the next fitment date when the job card agrees |
| `missing_site` | Fitment with no site; the vehicle's current registered site is shown as a hint | 2,242 | 1,448 | 116 | Use the vehicle's site on the fitment date (proposal only; the current site may differ from the historical one) |
| `price_missing` | Physical tyre (`v_tyre_lifetime`, real serial) with purchase cost status MISSING (T17) | 487 | 1,522 | 97 | Find the purchase on the expense grid by job card; never estimate without labelling it ESTIMATED |
| `price_incorrect` | Price more than 3 times above or below the median for the same size and country (sizes with at least 5 priced rows) | 85 | 0 | 0 | Check the invoice; a line total typed as a unit price is the usual cause |
| `price_assigned_twice` | One real serial priced on more than one fitment (T1). K507B403860 is protected | 1 (protected) | 0 | 0 | T2: latest uploaded row keeps the price unless the job cards show two purchases |
| `unlinked_repair_retread` | Tyre-bucket expense line whose description says repair / retread / vulcanise, carrying no serial | 18 | 0 | 33 | Link to the tyre named on the job card when it names one; otherwise stays unlinked |
| `duplicate_expense` | Tyre expense lines identical in content with at most one source line number (T11) | 0 | 0 | 0 | Keep one, archive the copies in Duplicate Control |
| **Total** | | **6,695** | **4,030** | **484** | 11,209 |

`rotation_not_closed` uses the rotation closer's own rules (same vehicle, later wheel dated later, no same-day ambiguity),
so it is narrower than `get_tyre_exceptions`' `rotation_not_closed` count (11).

## Stable exception keys

Built from record ids or the (country, serial) a group is about, never from a position in a list, so a review stays
attached across reruns: `kind|<tyre_records.id>`, `invalid_reading|reset|<id>`, `kind|<COUNTRY>|<SERIAL>` (duplicate_active,
price_assigned_twice, price_missing), `uncertain_previous_tyre|<old id>|<new id>`,
`rotation_not_closed|<COUNTRY>|<ASSET>|<SERIAL>|<FROM POSITION>`, `duplicate_expense|<first id>|<copies>`.
MIRROR: `exceptionKey()` in `src/lib/tyreExceptionsV2.js` (tested). A key whose record set changes (for example a
duplicate expense gaining a third copy) is a new exception on purpose.

## Protected (stay open; no review accepted)

`tyre_exception_refs` holds a snapshot taken by the migration from the fix backups:
- the **20 unclear tyre changes** (6 KSA + 14 UAE): signature pairs not in `_bak.ksa_old_tyre_fix_20261109` /
  `_bak.ue_old_tyre_fix_20261109` whose rows sit in more than one pair (chained or ambiguous). Measured 6 + 14 = 20, matching
  the 20261109120000/130000 headers;
- **K507B403860** (both priced fitments).
They are listed (status open, "Owner decision needed"); `set_tyre_exception_review` refuses them with
"This exception is protected and stays open until the owner authorises a change". 90 pairs (UAE 89, Egypt 1) that touch a
backup row are marked `fix_handled` and not listed.

## Security
- `_tyre_exception_rows` and `get_tyre_exceptions_v2` are SECURITY INVOKER: the caller's RLS on `tyre_records`,
  `parts_consumption`, `v_tyre_lifetime*` and the new tables decides what is listed. `get_tyre_exceptions_v2` is STABLE,
  so even the rotation closer call inside it cannot write.
- `set_tyre_exception_review` is DEFINER (it must write the review tables, which have no client write grant): it requires
  a signed-in super admin or an elevated role in an organisation, re-checks country scope, validates kind/status/key/note
  length, refuses protected exceptions, and writes only the two review tables.
- New tables: RLS on, RESTRICTIVE org isolation, country isolation, no anon grants, SELECT only for authenticated.

## Dry-run proof (2026-11-10, one aborted transaction)
- Seed: protected KSA 7 (6 pairs + K507B403860), protected UAE 14, fix_handled UAE 89 / Egypt 1.
- Super admin: 11,209 exceptions, 4.8 s for the full count; one kind about 0.5 s. KSA Manager: 6,695, KSA only, 4.6 s.
- Review as super admin (deferred) recorded with one history event; filter by status returns it.
- Refused: K507B403860 and a protected pair (protected), KSA Manager on UAE (country), Tyre Man (role).
- `tyre_records` fingerprint, `parts_consumption` count and sum, and `tyre_replacement_log` count identical before and after.
- anon: no execute on the three functions, no select on the new tables.

## Rollback
See the migration header (drop the 3 functions and 3 tables). No business data is touched, so nothing else to restore.
