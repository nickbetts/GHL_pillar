/**
 * Add (or refresh) the "Website Build + Retainer" template with its own contract terms,
 * and create the J Button Construction proposal from it, owned by Zain.
 * Additive only: never touches other templates, proposals or CRM leads.
 *
 * Usage: node scripts/seed-website-retainer.mjs
 */

import crypto from 'crypto';
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

const { hashPassword } = await import('../api/session.js');
const { sanitizeBlocks, tokenContext, cleanVariables } = await import('../lib/proposalBlocks.js');
const { WEBSITE_RETAINER_TEMPLATE_NAME, WEBSITE_RETAINER_LEGACY_NAME, WEBSITE_RETAINER_VARIABLES, WEBSITE_RETAINER_BLOCKS, WEBSITE_RETAINER_TERMS } = await import('../lib/proposalWebsiteRetainer.js');

const LEAD_ID = 39410; // J Button Construction (Emily Saggs), owned by Zain
const PROPOSAL_TITLE = 'J Button Construction: Website Build + Retainer';
const CLIENT_STORY = 'J Button Construction is an experienced builder just outside Newmarket, working for domestic and commercial customers across Cambridgeshire and Suffolk on new builds, renovations, extensions, loft and garage conversions, groundworks, carpentry and insurance work. You work alongside architects to finish projects on time and within budget, without cutting corners, and your website should show that quality from the first click.';

// Template (blocks keep their merge tokens) plus its own contract terms.
await sql`ALTER TABLE proposal_templates ADD COLUMN IF NOT EXISTS contract_terms JSONB`;
await sql`ALTER TABLE proposal_templates ADD COLUMN IF NOT EXISTS skip_onboarding BOOLEAN NOT NULL DEFAULT FALSE`;
await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS skip_onboarding BOOLEAN NOT NULL DEFAULT FALSE`;
await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS variables JSONB`;
await sql`ALTER TABLE proposal_templates ADD COLUMN IF NOT EXISTS variables JSONB`;
const templateBlocks = sanitizeBlocks(WEBSITE_RETAINER_BLOCKS);
const terms = sanitizeBlocks(WEBSITE_RETAINER_TERMS);
if (templateBlocks.length !== WEBSITE_RETAINER_BLOCKS.length || terms.length !== WEBSITE_RETAINER_TERMS.length) {
  console.error('Some blocks were dropped by sanitizeBlocks; aborting.'); process.exit(1);
}
console.log(`Template: ${templateBlocks.length} blocks, ${terms.length} contract term blocks.`);

let templateId;
const existing = await sql`SELECT id FROM proposal_templates WHERE name IN (${WEBSITE_RETAINER_TEMPLATE_NAME}, ${WEBSITE_RETAINER_LEGACY_NAME}) ORDER BY id LIMIT 1`;
if (existing.length) {
  templateId = Number(existing[0].id);
  await sql`UPDATE proposal_templates SET name = ${WEBSITE_RETAINER_TEMPLATE_NAME}, blocks = ${JSON.stringify(templateBlocks)}::jsonb, skip_onboarding = TRUE, variables = ${JSON.stringify(WEBSITE_RETAINER_VARIABLES)}::jsonb, updated_at = now() WHERE id = ${templateId}`;
  console.log(`Updated template #${templateId}.`);
} else {
  const rows = await sql`
    INSERT INTO proposal_templates (name, blocks, is_default, created_by, skip_onboarding, variables)
    VALUES (${WEBSITE_RETAINER_TEMPLATE_NAME}, ${JSON.stringify(templateBlocks)}::jsonb, FALSE, 'system', TRUE, ${JSON.stringify(WEBSITE_RETAINER_VARIABLES)}::jsonb)
    RETURNING id
  `;
  templateId = Number(rows[0].id);
  console.log(`Created template #${templateId}.`);
}

// Proposal for J Button, owned by Zain.
const already = await sql`SELECT id FROM proposals WHERE lead_id = ${LEAD_ID} AND title = ${PROPOSAL_TITLE} LIMIT 1`;
if (already.length) { console.log(`Proposal #${already[0].id} already exists; leaving it untouched.`); process.exit(0); }

const lead = (await sql`SELECT id, name, company_name, email FROM queue_leads WHERE id = ${LEAD_ID} AND archived_at IS NULL`)[0];
const zain = (await sql`SELECT name, email, ghl_owner_id FROM app_users WHERE email = 'zain@i3media.net' AND active = TRUE`)[0];
if (!lead || !zain?.ghl_owner_id) { console.error('Lead or Zain not found.'); process.exit(1); }

const draft = {
  client_name: lead.name,
  client_company: 'J Button Construction Ltd',
  client_email: lead.email,
  owner_name: 'Zain Safir-Sheikh',
  deal_type: 'Hybrid',
  mrr_value: 250,
  one_off_value: 6000,
  expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  client_story: CLIENT_STORY,
  variables: cleanVariables(WEBSITE_RETAINER_VARIABLES, {}),
};
const blocks = sanitizeBlocks(WEBSITE_RETAINER_BLOCKS, tokenContext(draft));
const password = `stream-${crypto.randomBytes(3).toString('hex')}`;
const { hash, salt } = hashPassword(password);

const inserted = await sql`
  INSERT INTO proposals (
    token, lead_id, template_id, title, client_name, client_company, client_email,
    access_password_hash, access_password_salt, blocks, deal_type, mrr_value, one_off_value,
    status, owner_id, owner_name, expires_at, created_by_email, handover_token, skip_onboarding, variables
  ) VALUES (
    ${crypto.randomBytes(9).toString('base64url')}, ${LEAD_ID}, ${templateId}, ${PROPOSAL_TITLE}, ${draft.client_name}, ${draft.client_company}, ${draft.client_email},
    ${hash}, ${salt}, ${JSON.stringify(blocks)}::jsonb, ${draft.deal_type}, ${draft.mrr_value}, ${draft.one_off_value},
    'active', ${zain.ghl_owner_id}, ${draft.owner_name}, ${draft.expires_at}::timestamptz, ${zain.email}, ${crypto.randomBytes(9).toString('base64url')}, TRUE, ${JSON.stringify(draft.variables)}::jsonb
  )
  RETURNING id, token
`;
await sql`INSERT INTO proposal_events (proposal_id, event_type, actor_name, meta) VALUES (${inserted[0].id}, 'created', ${draft.owner_name}, ${JSON.stringify({ leadId: LEAD_ID, templateId })}::jsonb)`;
console.log(`Created proposal #${inserted[0].id}. Owner: ${draft.owner_name}. Client: ${draft.client_name} <${draft.client_email}>.`);
console.log(`Link: /proposal?p=${inserted[0].token}`);
console.log(`Gate password: ${password}`);
