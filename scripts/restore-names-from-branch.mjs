/**
 * Restore real lead names from a Neon point-in-time branch back into production.
 *
 * Context: a wave release overwrote real names with Apollo-masked values on
 * email collision. The real names still exist in Neon history. Create a branch
 * from just before the overwrite (~2026-08-05 08:30 UTC) and pass its
 * connection string as SOURCE_DB. Production is TARGET_DB.
 *
 * This only writes name / first_name / last_name, and ONLY for leads that are
 * currently masked in production, matched by id. It never touches status,
 * disposition, callbacks, notes, owner, or any other column.
 *
 * Usage:
 *   SOURCE_DB="postgres://...<restore-branch>..." \
 *   TARGET_DB="postgres://...<production>..." \
 *   node scripts/restore-names-from-branch.mjs
 *
 * Flags:
 *   DRY_RUN=1   preview changes, write nothing
 */

import { neon } from '@neondatabase/serverless';

const SOURCE_DB = process.env.SOURCE_DB;
const TARGET_DB = process.env.TARGET_DB || (process.env.DATABASE_URL || '').trim();
const DRY_RUN = process.env.DRY_RUN === '1';

if (!SOURCE_DB) { console.error('SOURCE_DB (restore branch) missing'); process.exit(1); }
if (!TARGET_DB) { console.error('TARGET_DB (production) missing'); process.exit(1); }

const source = neon(SOURCE_DB);
const target = neon(TARGET_DB);

const isMasked = (v) => typeof v === 'string' && v.includes('*');

async function run() {
  const masked = await target`
    SELECT id, email, name
    FROM queue_leads
    WHERE archived_at IS NULL AND (name LIKE '%*%' OR last_name LIKE '%*%')
  `;
  console.log(`Currently masked in production: ${masked.length}`);
  if (!masked.length) return;

  const ids = masked.map((r) => Number(r.id)).filter(Number.isFinite);

  // Pull the pre-overwrite identity for those same ids from the restore branch.
  const originals = await source`
    SELECT id, name, first_name, last_name
    FROM queue_leads
    WHERE id = ANY(${ids})
  `;
  const origById = new Map(originals.map((r) => [String(r.id), r]));

  let restorable = 0;
  let updated = 0;
  let skippedStillMasked = 0;

  for (const lead of masked) {
    const orig = origById.get(String(lead.id));
    if (!orig) continue;
    const realName = orig.name;
    if (!realName || isMasked(realName) || isMasked(orig.last_name)) {
      skippedStillMasked += 1;
      continue;
    }
    restorable += 1;

    if (DRY_RUN) {
      console.log(`[dry] ${lead.id} ${lead.name} -> ${realName}`);
      continue;
    }

    await target`
      UPDATE queue_leads
      SET name = ${orig.name},
          first_name = ${orig.first_name},
          last_name = ${orig.last_name},
          updated_at = now()
      WHERE id = ${lead.id}
        AND (name LIKE '%*%' OR last_name LIKE '%*%')
    `;
    updated += 1;
  }

  console.log(JSON.stringify({
    maskedInProduction: masked.length,
    foundInBranch: originals.length,
    restorable,
    updated,
    skippedStillMaskedInBranch: skippedStillMasked,
    dryRun: DRY_RUN,
  }, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
