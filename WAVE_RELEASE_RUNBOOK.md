# Wave Release Runbook

This runbook is the standard operating procedure for every future contact enrich and release wave.

Goal: no live surprises, no split ownership, no uncallable records, and no reporting drift.

## Scope

Applies to all outbound wave operations:

- candidate pull
- wave release
- enrichment
- queue maintenance before reps work the list

## Roles

- Release Owner: runs commands, signs off each gate
- Data QA: checks sample records and company grouping
- Sales Ops: confirms board and reporting parity

One person can wear multiple roles, but all gates must be explicitly checked.

## Release Policy

1. No feature changes during an active wave window.
2. Every wave must pass preflight before release.
3. Start with canary size, then full wave.
4. If a blocking gate fails, stop and fix before continuing.

## Required Environment

- `QUEUE_AUTH` with admin access for maintenance actions
- API_BASE set to the deployment target (defaults to production)
- Production deployment has `SESSION_SECRET`, `GHL_WEBHOOK_SECRET`, and `THREECX_WEBHOOK_SECRET`

## Gate 1: Preflight (blocking)

Run:

```bash
QUEUE_AUTH=... API_BASE=https://ghl-pillar.vercel.app npm run wave:preflight
```

What it checks:

- Outbound queue API availability
- No-number contacts count
- Split company ownership count
- GHL-linked/qualified leakage in outbound queue
- Required maintenance action availability (merge-company-owners and purge-no-phone)
- Candidate lifecycle and queue-lead reconciliation
- Tier balance and sector release-rate distribution

Default blocking thresholds:

- no-number contacts must be 0
- split companies must be 0
- GHL-linked/qualified leakage must be 0
- candidate reconciliation failures must be 0
- Tier 1/Tier 2 imbalance per wave must be at most 1
- sector release-rate deviation must be at most 0.10 for sectors with 50+ candidates

Threshold overrides use `MAX_NO_NUMBER`, `MAX_SPLIT_COMPANIES`, `MAX_GHL_LINKED`, `MAX_TIER_IMBALANCE`, and `MAX_SECTOR_RELEASE_DEVIATION`. Record the reason for any override in the release evidence.

## Gate 2: Deploy Verification (blocking)

After each deploy, re-run preflight to confirm endpoint behavior matches expected action list.

If action is unknown after deploy:

- stop automation
- trigger redeploy
- re-run preflight until action availability is confirmed

## Gate 3: Canary Wave

1. Release a small canary wave.
2. Enrich only canary records.
3. Validate for 10-15 minutes:
   - callback due/future buckets behave as expected
   - no split ownership appears for canary companies
   - send-email routing and callable filtering look correct

If canary passes, continue.

Wave numbers are immutable and cannot be reused. Concurrent releases skip candidates already locked by another release.

## Gate 4: Full Wave

1. Release full wave.
2. Run enrichment.
3. Re-run preflight and compare deltas.

## Gate 5: Post-Wave Audit

Immediately after full wave:

- Confirm no-number count remains 0.
- Confirm split-company count remains 0.
- Spot check at least 10 companies:
  - owner consistency
  - decision-maker grouping
  - callback scheduling behavior

If any mismatch appears, pause next wave until resolved.

## Standard Commands

Preflight:

```bash
QUEUE_AUTH=... API_BASE=https://ghl-pillar.vercel.app npm run wave:preflight
```

Dry-run merge split companies:

```bash
curl -sS -X POST "$API_BASE/api/apollo-sales-queue" \
  -H "Content-Type: application/json" \
  -H "x-queue-auth: $QUEUE_AUTH" \
  --data '{"action":"merge-company-owners","dryRun":true}'
```

Run merge split companies:

```bash
curl -sS -X POST "$API_BASE/api/apollo-sales-queue" \
  -H "Content-Type: application/json" \
  -H "x-queue-auth: $QUEUE_AUTH" \
  --data '{"action":"merge-company-owners"}'
```

Dry-run purge no-phone:

```bash
curl -sS -X POST "$API_BASE/api/apollo-sales-queue" \
  -H "Content-Type: application/json" \
  -H "x-queue-auth: $QUEUE_AUTH" \
  --data '{"action":"purge-no-phone","dryRun":true}'
```

Run purge no-phone:

```bash
curl -sS -X POST "$API_BASE/api/apollo-sales-queue" \
  -H "Content-Type: application/json" \
  -H "x-queue-auth: $QUEUE_AUTH" \
  --data '{"action":"purge-no-phone"}'
```

## Blocker Matrix

Stop release if any of these are true:

- no-number contacts > threshold
- split companies > threshold
- GHL-linked/qualified leakage > threshold
- required maintenance action unavailable
- candidate lifecycle reconciliation fails
- wave tier or sector distribution exceeds its threshold
- canary behavior does not match queue rules

## Recovery Flow

1. Stop further release/enrich operations.
2. Fix the highest impact blocker first: ownership, no-phone data, deployment availability, candidate lifecycle, tier balance, or sector distribution.
3. Re-run preflight.
4. Resume only when preflight passes.

## Evidence Capture

For each wave, store:

- preflight output (before canary)
- preflight output (after full wave)
- any maintenance action outputs used to remediate

This gives an auditable trail for every wave and prevents repeated mistakes.
