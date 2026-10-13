/**
 * Pin three industries to the top of every rep's call queue via sort_seed,
 * then randomise everything else. callSort() orders status -> priority ->
 * sort_seed, so negative seeds win within each status+priority tier:
 *
 *   -1000  GOOGLE_Industrial_and_Contracting_CAMBS
 *   -2000  Construction / Construction company / Construction Company
 *   -3000  Manufacturing
 *   >= 0   everything else (random)
 *
 * Statuses, priorities, owners are untouched. Reverse by running
 * scripts/shuffle-call-queue.mjs --apply.
 *
 * Usage: node scripts/stack-queue-industries.mjs          # dry run
 *        node scripts/stack-queue-industries.mjs --apply  # writes
 */

import { neon } from '@neondatabase/serverless';
import fs from 'fs';

let DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  const envFile = ['.env.local', '.env'].find((f) => fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('DATABASE_URL'));
  if (envFile) {
    DATABASE_URL = fs.readFileSync(envFile, 'utf8').split('\n').find((l) => l.trim().startsWith('DATABASE_URL')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  }
}
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set.');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(DATABASE_URL);

const TOP = [
  { seed: -1000, match: ['GOOGLE_Industrial_and_Contracting_CAMBS'] },
  { seed: -2000, match: ['Construction', 'Construction company', 'Construction Company'] },
  { seed: -3000, match: ['Manufacturing'] },
];

const counts = [];
for (const group of TOP) {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM queue_leads
    WHERE archived_at IS NULL AND TRIM(sector) = ANY(${group.match})
  `;
  counts.push(`${group.match[0]}: ${rows[0].n}`);
}
const others = await sql`
  SELECT COUNT(*)::int AS n FROM queue_leads
  WHERE archived_at IS NULL AND NOT (TRIM(sector) = ANY(${TOP.flatMap((g) => g.match)}))
`;
console.log('Top stacking:', counts.join(' · '), `· randomised rest: ${others[0].n}`);
console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN (re-run with --apply to write)'}`);

if (!apply) process.exit(0);

for (const group of TOP) {
  await sql`
    UPDATE queue_leads
    SET sort_seed = ${group.seed}, updated_at = now()
    WHERE archived_at IS NULL AND TRIM(sector) = ANY(${group.match})
  `;
}
await sql`
  UPDATE queue_leads
  SET sort_seed = floor(random() * 2000000000)::int, updated_at = now()
  WHERE archived_at IS NULL AND NOT (TRIM(sector) = ANY(${TOP.flatMap((g) => g.match)}))
`;
console.log('Done.');
