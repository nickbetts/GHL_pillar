/**
 * Add (or refresh) the "Pillar | Lite" proposal template, linked to the Standard Terms contract.
 * Additive only: never touches other templates or any proposals.
 *
 * Usage: node scripts/seed-pillar-lite.mjs
 */

import fs from 'fs';
import { neon } from '@neondatabase/serverless';

let DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  const envFile = ['.env.local', '.env'].find((f) => fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('DATABASE_URL'));
  if (envFile) {
    DATABASE_URL = fs.readFileSync(envFile, 'utf8').split('\n').find((l) => l.trim().startsWith('DATABASE_URL')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  }
}
if (!DATABASE_URL) { console.error('DATABASE_URL not set.'); process.exit(1); }
const sql = neon(DATABASE_URL);

const { sanitizeBlocks } = await import('../lib/proposalBlocks.js');
const { PILLAR_LITE_TEMPLATE_NAME, PILLAR_LITE_BLOCKS } = await import('../lib/proposalPillarLite.js');

const blocks = sanitizeBlocks(PILLAR_LITE_BLOCKS);
console.log(`Template has ${blocks.length} blocks (${PILLAR_LITE_BLOCKS.length} authored).`);
if (blocks.length !== PILLAR_LITE_BLOCKS.length) { console.error('Some blocks were dropped by sanitizeBlocks; aborting.'); process.exit(1); }

const contract = (await sql`SELECT id FROM contracts WHERE name = 'Standard Terms' LIMIT 1`)[0];
const contractId = contract ? Number(contract.id) : null;

const existing = await sql`SELECT id FROM proposal_templates WHERE name = ${PILLAR_LITE_TEMPLATE_NAME} LIMIT 1`;
if (existing.length) {
  await sql`UPDATE proposal_templates SET blocks = ${JSON.stringify(blocks)}::jsonb, updated_at = now() WHERE id = ${existing[0].id}`;
  console.log(`Updated template #${existing[0].id}.`);
} else {
  const rows = await sql`
    INSERT INTO proposal_templates (name, blocks, is_default, created_by, contract_id)
    VALUES (${PILLAR_LITE_TEMPLATE_NAME}, ${JSON.stringify(blocks)}::jsonb, FALSE, 'system', ${contractId})
    RETURNING id
  `;
  console.log(`Created template #${rows[0].id}${contractId ? ` linked to contract #${contractId}` : ''}.`);
}
