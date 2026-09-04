/**
 * Reseed queue_leads.sort_seed on every ACTIVE (non-archived) lead so the call
 * card list shuffles within each rep bucket. Owners, statuses, priorities are
 * NOT touched — only the tiebreaker used by callSort() in sales-queue.html.
 *
 * Because callSort() sorts by status → priority → sort_seed, HS/PD, Google
 * Maps and Apollo leads with the same status+priority now interleave.
 *
 * Usage:
 *   DATABASE_URL="..." node scripts/shuffle-call-queue.mjs             # DRY RUN
 *   DATABASE_URL="..." node scripts/shuffle-call-queue.mjs --apply     # writes
 */

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set.');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(DATABASE_URL);

await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS sort_seed INTEGER`;

const before = await sql`
  SELECT owner, COUNT(*)::int AS n
  FROM queue_leads
  WHERE archived_at IS NULL AND owner_id IS NOT NULL
  GROUP BY owner
  ORDER BY owner
`;
console.log('Active leads per owner (pre-shuffle):');
for (const r of before) console.log(`  ${String(r.owner).padEnd(28)} ${r.n}`);
const total = before.reduce((s, r) => s + r.n, 0);
console.log(`  TOTAL active: ${total}`);
console.log(`Mode: ${apply ? '⚠️  APPLY (writing sort_seed)' : 'DRY RUN'}\n`);

if (!apply) {
  console.log('── Dry run only. Re-run with --apply to reseed. ──');
  process.exit(0);
}

// Postgres random() gives a fresh value per row; multiply into a wide INT space.
const res = await sql`
  UPDATE queue_leads
     SET sort_seed = floor(random() * 2000000000)::int
   WHERE archived_at IS NULL
`;
console.log(`✓ Reseeded ${res.length ?? total} active leads.`);

const sample = await sql`
  SELECT owner, source, name, company_name, sort_seed
  FROM queue_leads
  WHERE archived_at IS NULL AND owner = 'Amir Ward' AND status = 'to_contact'
  ORDER BY sort_seed
  LIMIT 10
`;
console.log('\nSample new order for Amir Ward (first 10 to_contact):');
for (const r of sample) {
  console.log(`  seed=${String(r.sort_seed).padStart(10)}  ${(r.source || '').padEnd(11)}  ${r.name || r.company_name || '(no name)'}`);
}
