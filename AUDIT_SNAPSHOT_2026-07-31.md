# Production Confidence Audit — 2026-07-31

Audit target: `https://ghl-pillar.vercel.app`

Repository state at audit: `main` at `55b74ab`, matching `origin/main` with a clean working tree.

## Executive verdict

The outbound queue is operational and its release blockers are clear: the production preflight passed with no uncallable contacts, split company ownership, or GHL-linked leakage. The queue and manager report endpoints correctly reject anonymous requests.

The platform is not yet ready to be treated as fully hardened. Two legacy integration surfaces bypass the newer session model: `api/i3crm` permits anonymous CRM reads and mutations, and `api/webhooks` accepts unsigned events that can mutate GHL data. These should be fixed before further feature work.

## Evidence captured

Captured at approximately `2026-07-31T07:32Z`.

### Automated checks

| Check | Result |
| --- | --- |
| `npm test` | Pass (`All tests passed`) |
| `npm audit --omit=dev` | Pass, zero known vulnerabilities |
| Queue module ESM import | Pass |
| Production wave preflight | Pass, zero blockers |
| Working tree | Clean; `main` equals `origin/main` |

The current test suite contains one synthetic callback-target/deduplication assertion. A pass is useful as a smoke check, but it is not broad regression coverage.

### Production endpoint health and access

| Endpoint | Anonymous result | Audit interpretation |
| --- | ---: | --- |
| `GET /api/apollo-sales-queue?source=outbound` | `401` | Correctly protected |
| `GET /api/sales-queue-report` | `401` | Correctly protected |
| `GET /api/i3crm` | `200` | Critical exposure: CRM data is readable without authentication |
| `POST /api/reports?type=daily` | `200` | High exposure: CRM summary is readable without authentication |
| `GET /api/reports?type=daily` | `405` | Expected method rejection, not an auth control |

The audit did not invoke anonymous mutation actions. Code inspection confirms `api/i3crm` also accepts unauthenticated `POST` and `PATCH` requests.

### Live outbound invariants

| Invariant | Live count | Required maximum |
| --- | ---: | ---: |
| Active outbound contacts | 1,116 | Informational |
| Contacts with no callable number | 0 | 0 |
| Companies split across owners | 0 | 0 |
| GHL-linked or qualified leads in outbound queue | 0 | 0 |

Maintenance dry-runs were available. `merge-company-owners` found zero split companies and `purge-no-phone` found zero rows.

### Live manager report

The authenticated default 30-day outbound report returned:

| Metric | Live count |
| --- | ---: |
| Calls | 51 |
| Answered | 18 |
| Qualified events | 0 |
| Answered, not interested | 9 |
| Wants more information | 6 |
| No answer | 6 |
| Left voicemail | 2 |
| Gatekeeper | 15 |
| Wrong number | 10 |
| Active future callbacks | 1 |

The callback workload contained one callback due today and none overdue. The achievement endpoint returned only 23 all-time call events because it excludes events without an `owner_id`; the 30-day manager report includes 51. At least 28 recent call events are therefore missing from rep achievement totals.

### Candidate bank

| Metric | Live count |
| --- | ---: |
| Total candidates | 15,058 |
| Role-fit | 13,345 |
| Role-excluded | 1,536 |
| Unvetted | 177 |
| Released | 1,111 |
| Enqueued | 1,223 |

Released tier mix is 555 Tier 1 and 556 Tier 2. This is an intentional 50/50 release in the current `release-wave` implementation, even though the full bank is 3,181 Tier 1 and 11,877 Tier 2. Sector release is approximately proportional to the eligible bank.

The `enqueued` count exceeding `released` is possible because candidate enqueue state and wave release state are separate. It should nevertheless be exposed as a reconciled operational metric so managers can distinguish pre-wave/manual enqueues from released-wave enqueues.

## Metric definitions

### Queue workload

- Active workload comes from non-archived `queue_leads` rows.
- Outbound means `source IS DISTINCT FROM 'inbound'`; legacy null-source rows therefore count as outbound.
- Callback workload uses one active company target and then deduplicates by company plus callable number.
- Callback buckets are current-state workload, not historical activity.

### Activity and qualification reporting

- Calls and answered calls come from `queue_events` in the selected date range.
- Qualification counts are `status_change` events whose destination is `qualified`.
- Qualification is therefore an activity count, not a distinct-lead count. Requalifying the same lead can increment it again.
- Archived leads remain represented in event history by design; active callback workload excludes them.

### Legacy GHL reports

- `api/reports` reads at most 100 contacts and 100 opportunities.
- Labels such as total contacts, total opportunities, and weekly demo attendance describe only that capped response, not the complete GHL account.
- Daily demo count uses opportunity update date plus the literal stage name `Demo Scheduled`; it is not a booking-event count.

## Severity-ranked findings

### Critical

1. **Unauthenticated CRM API.** `api/i3crm.js` performs reads, contact/opportunity creation, dummy-data seeding, stage updates, and note updates without calling the queue identity/role checks. Require a signed session for reads and admin authorization for mutations.
2. **Unsigned mutating webhook.** `api/webhooks.js` contains a signature-verification placeholder and processes any POST body. Forged requests can add tags and update contacts. Verify the provider signature before parsing or acting on the event.
3. **Shared password is shipped to browsers.** Six tracked legacy HTML pages contain the shared password as a JavaScript literal. Anyone who can load those pages can read it; it must not be treated as access control. Remove the client-side gates, move the pages behind server sessions, and rotate the exposed credential.

### High

1. **Unauthenticated legacy reports.** `api/reports.js` exposes CRM summary data through anonymous POST. Protect it with manager-level authentication or retire it in favor of `api/sales-queue-report`.
2. **Legacy reports silently cap data at 100.** Pagination is not followed, so totals and rates become wrong as the account grows. Implement cursor pagination and report the fetched/available counts.
3. **Qualification events can double-count leads.** Report queries count transitions rather than distinct leads or first qualification. Return both `qualificationEvents` and `distinctQualifiedLeads`, with unambiguous UI labels.
4. **Qualification has no durable idempotency boundary.** GHL calls occur before the queue row records the resulting IDs. Concurrent clicks, retries, or a timeout after the GHL write can create duplicate external work. Add an idempotency key and a database-backed `qualification_pending/completed` state.
5. **Regression coverage is too narrow.** There are no executable tests for authorization, wave selection, qualification retries, event counting, callback timezone boundaries, or legacy pagination.
6. **Session signing has a predictable fallback.** `api/session.js` derives a signing secret from other configuration when `SESSION_SECRET` is absent. Require an explicit high-entropy production secret and fail closed if it is missing.
7. **Ownerless calls disappear from achievements.** Achievement queries require `owner_id IS NOT NULL`, while manager reports fall back to the lead's current owner for grouping. Backfill event ownership where evidence is reliable and show an explicit `Unassigned` row instead of omitting activity.

### Medium

1. **Callback day boundaries are implicit.** Browser workload calculations use the browser timezone while server report buckets use the server timezone. Declare one business timezone, currently expected to be `Europe/London`, and calculate boundaries explicitly with it.
2. **Achievement callbacks can count one user action twice.** A `Callback booked` call event and its separate callback disposition event both satisfy the achievement query. Deduplicate by call/idempotency key or count scheduled callback state separately.
3. **Wave tier policy is not documented in the runbook.** Production release currently forces a 50/50 Tier 1/Tier 2 mix, while bank composition is roughly 21/79. State the policy and add a preflight assertion for expected tier and sector distributions.
4. **Environment file is not shell-safe.** Sourcing local `.env` failed on an unquoted ampersand. Use a dotenv parser for scripts and keep shell metacharacters quoted if the file is also intended to be sourced.
5. **Candidate reconciliation is opaque.** Released, enriched, promoted, and enqueued are independent flags/counts. Add a reconciliation endpoint with mutually exclusive lifecycle buckets and failure reasons.
6. **Request payloads lack explicit size/schema controls.** Webhook and bulk contact bodies are accepted as general objects/arrays. Enforce content type, payload limits, required fields, and bounded batch sizes.

## Recommended delivery order

1. Gate `api/i3crm`, `api/reports`, and all mutating webhooks; rotate any shared credentials that have appeared in shell history or logs.
2. Require `SESSION_SECRET` in production and add login throttling/audit alerts.
3. Add pagination to GHL reads and replace ambiguous legacy report labels.
4. Make qualification idempotent and add a concurrency/retry integration test.
5. Extract shared metric functions and test callback, achievement, qualification, and wave invariants against fixtures.
6. Add explicit `Europe/London` date boundaries and lifecycle reconciliation to the manager report.

## Release confidence

- **Outbound wave release:** Green under the existing preflight policy.
- **Queue/report availability:** Green for authenticated queue surfaces.
- **Metric confidence:** Amber because qualification/callback event counts can overcount and legacy GHL totals are capped.
- **Security posture:** Red until anonymous CRM mutation and unsigned webhook processing are removed.
