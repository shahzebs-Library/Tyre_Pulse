# AI Tyre Inspection Intelligence: implementation and production gate

## Purpose

Add one new module after Inspections under Inspections & Compliance.
The module must preserve the current enterprise UI, never obscure original
inspector evidence, and treat physical tread measurements as a separate
verified data stream from AI observations.

## Repository review completed

- Existing `src/pages/InspectionIntelligence.jsx` is a separate analytics page.
- Existing `src/components/inspection/InspectionPhotos.jsx` resolves photo refs.
- Existing `src/lib/api/inspections.js` provides the secured inspection row boundary.
- Existing `src/components/ui/EnterpriseTable.jsx` is the required table component.
- Existing inspection PDF implementations must remain the default until the
  centralized server renderer has been verified and rolled out.
- Existing Flutter inspection submission queues must remain intact.

## Navigation

- Parent: Inspections & Compliance
- Existing item: Inspections
- New item: AI Tyre Inspection
- Route: `/ai-tyre-inspection`
- Existing Inspection Intelligence remains separate and unchanged.
- Feature uses the `inspections` module entitlement.

## Immutable evidence principles

1. Never overwrite what the inspector actually selected.
2. Never remove original uploaded photographs.
3. Do not invent tread millimetres from uncalibrated photographs.
4. Do not create a safety pass outcome based on image inference alone.
5. Do not mutate an approved inspection to insert AI results.
6. Store AI analysis as an independently versioned object.
7. Record human acceptance, correction and rejection separately.
8. Preserve photo provenance and original inspection association.
9. Maintain audit history for every authorization-sensitive change.
10. Keep all tenant and organization scope checks server-side.

## Photo eligibility

- A condition marked Good is not automatically submitted to damage inference.
- Worn, Cut, Damaged, Punctured, Cracked and similar abnormal states are eligible.
- Each tyre position may have zero, one or many attached pictures.
- Multiple pictures from the same position should be grouped in an analysis.
- Identical references within the same position must be deduplicated.
- Multiple distinct references must not be discarded.
- General inspection photographs require deliberate association with a tyre.
- Missing photos are recorded as missing evidence, not interpreted as good tyres.
- Blurry or obstructed photos should return an unassessable status.

## Physical measurements

Capture original depth and minimum permitted depth from a verified source.
Store actual gauge results for inner, center and outer tread grooves.
Use the lowest valid measured depth as a conservative wear metric.
Capture tyre position, serial, vehicle, inspector, timestamp and distance reading.
Require one known measurement source: manual gauge, digital gauge or calibrated device.
Keep historical readings immutable for quality checks.
Reject missing, negative and physically inconsistent readings.
Do not use temperature, tyre pressure or photos as substitutes for gauge depth.

## Remaining usable tread

Let original be manufacturer or physically verified new depth.
Let minimum be the applicable tyre/application removal threshold.
Let measured be the lowest verified measured groove.

remaining_mm = max(0, measured - minimum)
usable_new_mm = original - minimum
remaining_percent = remaining_mm / usable_new_mm * 100

If any authoritative component is missing, return measurement required.
If the measured depth is at or below the removal threshold, flag for immediate review.
The percent is NOT a percentage of safety or tyre structural integrity.

## Remaining distance estimate

A forecast is only available when at least two reliable readings are available
for the same tyre serial, with a reasonable positive distance span and net wear.
Never silently combine readings across replacements.
Increased depth compared with a previous reading must trigger data review.
Predictions must carry uncertainty and require supervisor interpretation.
A structural defect can require tyre removal regardless of tread depth.

## Model service requirements

- Run inference server-side only.
- Read bytes from authorized private storage objects.
- Never pass an arbitrary client-provided URL to a server fetcher.
- Limit file bytes, supported MIME types, batch size and model output tokens.
- Validate JSON model output against an allowlisted schema.
- Store model version, prompt version and media hash.
- Restrict all jobs to organization scope.
- Use an idempotency key based on inspection, position and image hash.
- Set retries, execution timeout, backoff, dead-letter and global spend limits.
- Refuse to treat model-generated numeric millimetres as authoritative.
- Do not include secrets in logs or database results.
- Limit personal data included in model requests.

## Background queue

Pending jobs become processing only through an atomic claim operation.
A lease prevents multiple workers from processing the same job concurrently.
Stale leases may be reclaimed after timeout.
A failed request retries only while below configured max attempts.
Permanent errors remain visible to authorized managers.
A photo upload must be complete before the analysis job is created.
No changes to the Flutter offline queue are required to process analysis later.

## API requirements

The web application must never use the service role key.
Read and review APIs must derive user organization from verified JWT session.
Supabase RLS must be complete before authenticated clients read the new tables.
Explicit field lists are preferred over wildcard selects.
Review writes should go through an authorization-aware RPC or backend endpoint.
Supervisor roles require separate permissions from ordinary inspectors.

## PDF and Flutter

A single server-generated inspection PDF becomes the authoritative output.
The AI appendix remains omitted or explicitly pending until analysis finishes.
Each numeric figure identifies its physical measurement source and date.
Photographs are embedded from authorized storage, never third-party hotlinks.
Flutter reads the same PDF and summary data as the web application.
The app must not create a competing AI model inference path.

## User experience

Maintain existing typography, dark and light theme tokens, EnterpriseTable,
PageHeader, Card, filter patterns, accessibility and loading/error conventions.
The summary shows pending, processed, failed and reviewed separately.
Each tyre position shows its own photographs, findings and physical readings.
A supervisor can see inspector declarations alongside model suggestions.
Review history must remain readable after approval.
Unknown is never displayed as Good.

## Security prerequisites blocking deployment

- Confirm the exact production `inspections.organisation_id` type and constraints.
- Confirm membership and role tables and existing tenant-isolation helpers.
- Confirm inspection storage bucket permissions and signed URL policy.
- Add RLS for authenticated users only with correct role/tenant checks.
- Add privileged backend claim/review workflow.
- Verify cross-tenant isolation with two test organizations.
- Prove unauthorized clients cannot read or write raw AI payloads.
- Provide a secure secret manager for model provider credentials.

## Migration notes

The initial migration is intentionally locked down.
Its tables are not intended for direct browser reads until full policies exist.
Do not apply incomplete access policies to production.
Inspect the deployed migration history and rehearse additive changes first.
Never alter existing inspection rows to backfill synthetic AI outcomes.

## Validation matrix

1. One photo, one abnormal tyre.
2. Multiple photos, one abnormal tyre.
3. Several tyre positions with different conditions.
4. A Good tyre with a photograph.
5. Abnormal condition without photograph.
6. Unreadable and invalid photo references.
7. Offline submit followed by delayed photo upload.
8. Duplicate submission and concurrent job claims.
9. Deleted or replaced image.
10. Unavailable model service.
11. Malformed AI response.
12. AI detecting a defect when inspector marked Good.
13. Inspector defect not visible to AI.
14. Valid gauge reading at all three grooves.
15. One valid groove and two missing grooves.
16. Measured depth at or below minimum.
17. Measured depth greater than original.
18. Missing original measurement.
19. Mixed tyre serials in historic readings.
20. Negative or zero distance change.
21. Unauthorized ordinary inspector attempting approval.
22. Cross-tenant result fetch and job update.
23. Model quota exceeded.
24. PDF with completed, pending and absent AI.
25. Flutter displaying the same finalized report.

## Completion evidence

A production-ready declaration requires:
- Passing lint, unit tests and production build.
- Passing all authorization, data quality and UI integration tests.
- Migration applied and verified in production with existing RLS policies.
- Background worker deployed and monitored with secure credentials.
- Real labelled tyre image benchmark with error analysis.
- Real tread-depth measurement validation.
- Centralized PDF endpoint serving the same file to web and Flutter.
- Audit trail for supervisor review.
- Budget limits and model usage monitoring.
- End-to-end execution with a real inspection in a safe environment.

## Status

This document is a quality gate. It does not claim those prerequisites are done.
The draft pull request should remain unmerged until all blockers are addressed.
