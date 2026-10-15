/**
 * Add (or refresh) the "Charity | Marketing Only" proposal template.
 * Additive only: inserts a new template, or updates the blocks of the one with the
 * same name. Never touches other templates or any proposals.
 *
 * Usage: node scripts/seed-charity-template.mjs
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
const { CHARITY_MARKETING_TEMPLATE_NAME, CHARITY_MARKETING_BLOCKS } = await import('../lib/proposalCharityTemplate.js');

// Keep merge tokens ({{client_company}} etc.) intact: they resolve when a proposal is created.
const blocks = sanitizeBlocks(CHARITY_MARKETING_BLOCKS);
console.log(`Template has ${blocks.length} blocks (${CHARITY_MARKETING_BLOCKS.length} authored).`);
if (blocks.length !== CHARITY_MARKETING_BLOCKS.length) { console.error('Some blocks were dropped by sanitizeBlocks; aborting.'); process.exit(1); }

const existing = await sql`SELECT id FROM proposal_templates WHERE name = ${CHARITY_MARKETING_TEMPLATE_NAME} LIMIT 1`;
if (existing.length) {
  await sql`UPDATE proposal_templates SET blocks = ${JSON.stringify(blocks)}::jsonb WHERE id = ${existing[0].id}`;
  console.log(`Updated template #${existing[0].id}.`);
} else {
  const rows = await sql`
    INSERT INTO proposal_templates (name, blocks, is_default, created_by)
    VALUES (${CHARITY_MARKETING_TEMPLATE_NAME}, ${JSON.stringify(blocks)}::jsonb, FALSE, 'system')
    RETURNING id
  `;
  console.log(`Created template #${rows[0].id}.`);
}
