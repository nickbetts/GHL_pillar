/**
 * Repair masked (obfuscated) lead names in place.
 *
 * Background: some leads were enqueued with Apollo-obfuscated last names
 * (e.g. "Mike Bu***d") because they already had an email and were skipped by
 * the wave enrichment pass. Apollo people/bulk_match by id returns the real
 * identity for 1 lead credit each.
 *
 * This script is deliberately surgical: it updates ONLY name / first_name /
 * last_name (and phone when currently missing), matched by the lead's own id.
 * It never touches status, disposition, callback_at, call_notes, owner,
 * qualified_at, opportunity_stage, or any other column — so worked leads keep
 * their status.
 *
 * Usage:
 *   DATABASE_URL=... APOLLO_API_KEY=... node scripts/repair-masked-names.mjs
 *
 * Env flags:
 *   DRY_RUN=1     preview matches, write nothing
 *   LIMIT=<n>     only process the first N masked leads (0 = all)
 */

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const DRY_RUN = process.env.DRY_RUN === '1';
const LIMIT = Number.parseInt(process.env.LIMIT || '0', 10);
const BATCH = 10; // Apollo bulk_match cap per request
const BATCH_PAUSE_MS = 600;

if (!DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }
if (!APOLLO_API_KEY) { console.error('APOLLO_API_KEY missing'); process.exit(1); }

const sql = neon(DATABASE_URL);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function officePhone(p) {
  return p?.organization?.phone || p?.organization?.primary_phone?.number || null;
}

async function bulkMatch(ids) {
  const res = await fetch('https://api.apollo.io/api/v1/people/bulk_match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
    body: JSON.stringify({ details: ids.map((id) => ({ id })), reveal_personal_emails: false }),
  });
  if (res.status === 429) throw new Error('RATE_LIMIT');
  if (!res.ok) throw new Error(`Apollo HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.matches) ? data.matches : [];
}

async function run() {
  const masked = LIMIT > 0
    ? await sql`
        SELECT id, apollo_id, name, phone
        FROM queue_leads
        WHERE archived_at IS NULL
          AND apollo_id IS NOT NULL
          AND (name LIKE '%*%' OR last_name LIKE '%*%')
        ORDER BY id
        LIMIT ${LIMIT}
      `
    : await sql`
        SELECT id, apollo_id, name, phone
        FROM queue_leads
        WHERE archived_at IS NULL
          AND apollo_id IS NOT NULL
          AND (name LIKE '%*%' OR last_name LIKE '%*%')
        ORDER BY id
      `;

  console.log(`Masked leads to repair: ${masked.length}${DRY_RUN ? ' (DRY_RUN)' : ''}`);
  if (!masked.length) return;

  const byApolloId = new Map(masked.map((r) => [String(r.apollo_id), r]));
  let matched = 0;
  let updated = 0;
  let stillMasked = 0;
  let noMatch = 0;

  const ids = masked.map((r) => String(r.apollo_id));
  const totalBatches = Math.ceil(ids.length / BATCH);

  for (let b = 0; b < totalBatches; b++) {
    const slice = ids.slice(b * BATCH, (b + 1) * BATCH);
    let people = [];
    try {
      people = await bulkMatch(slice);
    } catch (err) {
      if (err.message === 'RATE_LIMIT') {
        process.stderr.write('Rate limited — pausing 10s\n');
        await sleep(10000);
        try { people = await bulkMatch(slice); } catch { people = []; }
      } else {
        process.stderr.write(`Batch ${b + 1} match failed: ${err.message}\n`);
      }
    }

    for (const p of people) {
      if (!p?.id) { noMatch += 1; continue; }
      const lead = byApolloId.get(String(p.id));
      if (!lead) continue;
      matched += 1;

      const first = p.first_name || null;
      const last = p.last_name || null;
      const fullName = p.name || [first, last].filter(Boolean).join(' ') || null;

      if (!fullName || fullName.includes('*') || (last && last.includes('*'))) {
        stillMasked += 1;
        continue;
      }

      const phone = officePhone(p);

      if (DRY_RUN) {
        console.log(`[dry] ${lead.id} ${lead.name} -> ${fullName}`);
        updated += 1;
        continue;
      }

      // Only identity columns. Phone filled only when currently empty.
      await sql`
        UPDATE queue_leads
        SET name = ${fullName},
            first_name = ${first},
            last_name = ${last},
            phone = CASE WHEN (phone IS NULL OR phone = '') THEN ${phone} ELSE phone END,
            updated_at = now()
        WHERE id = ${lead.id}
      `;
      updated += 1;
    }

    process.stderr.write(`Batch ${b + 1}/${totalBatches}: matched so far ${matched}, updated ${updated}\n`);
    if (b < totalBatches - 1) await sleep(BATCH_PAUSE_MS);
  }

  console.log(JSON.stringify({ requested: masked.length, matched, updated, stillMasked, noMatch, dryRun: DRY_RUN }, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
