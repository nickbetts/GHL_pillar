/**
 * One-off, additive migration into the contract library:
 *  - the shared contract terms become the "Standard Terms" contract, linked to every template without its own terms
 *  - the AI Website + Retainer terms become "Website + Hosting Retainer Terms", with services-driven clauses
 *  - unaccepted proposals are frozen to the version their template points at
 * Safe to re-run: existing contracts (matched by name) are left alone.
 *
 * Usage: node scripts/migrate-contracts.mjs
 */

import fs from 'fs';
import { neon } from '@neondatabase/serverless';

let DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  const envFile = ['.env.local', '.env'].find((f) => fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('DATABASE_URL'));
  if (envFile) DATABASE_URL = fs.readFileSync(envFile, 'utf8').split('\n').find((l) => l.trim().startsWith('DATABASE_URL')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}
if (!DATABASE_URL) { console.error('DATABASE_URL not set.'); process.exit(1); }
process.env.DATABASE_URL = DATABASE_URL;

const { getSql, ensureProposalTables } = await import('../api/db.js');
const { docFromBlocks, sanitizeDoc, validateDoc, renderContractDoc, newId } = await import('../lib/contractEngine.js');
const { WEBSITE_RETAINER_TERMS, WEBSITE_RETAINER_VARIABLES, WEBSITE_RETAINER_TEMPLATE_NAME } = await import('../lib/proposalWebsiteRetainer.js');

const sql = getSql();
await ensureProposalTables(sql);

const find = (doc, pred) => {
  let hit = null;
  const walk = (nodes, section) => nodes.forEach((n) => { if (!hit && pred(n, section)) hit = n; if (!hit && n.children) walk(n.children, section); });
  doc.sections.forEach((s) => walk(s.nodes, s));
  if (!hit) throw new Error('Could not find a clause to attach a rule to');
  return hit;
};
const byText = (start) => (n) => String(n.text || '').startsWith(start);

// Services-driven rules and plain-English lines for the website + retainer contract.
function enhanceRetainer(doc) {
  const rule = (start, when, plain) => { const n = find(doc, byText(start)); if (when) n.when = when; if (plain) n.plain = plain; };
  const either = { service: ['hosting', 'support'] };
  rule('The Contract shall be for the initial term', null, 'After the initial term the retainer rolls on a 30-day basis.');
  rule('Throughout the Initial Term and any Rolling Term', either);
  rule('up to {{support_hours}} hours each month', { service: 'support' }, 'The retainer includes {{support_hours}} hours a month for content updates and support. Unused hours do not roll over.');
  rule('hosting of the Site on secure servers', { service: 'hosting' }, 'We host, maintain and secure your site as part of the monthly retainer.');
  rule('maintenance of the Site, including weekly updates', { service: 'hosting' });
  rule('security of the Site, including', { service: 'hosting' });
  rule('The monthly hours included in the Retainer do not roll over', { service: 'support' });
  rule('At the end of the Initial Term the Supplier shall check', either, 'After the initial term we will check how much of the retainer has been used, then have a call about reducing it, including the hosting cost.');
  rule('The Services include helping the Customer to point the DNS', { service: 'dns_help' }, 'We help point your DNS to the new site once you are happy with it. Your domain stays with {{domain_registrar}}, in your control.');
  rule('The Supplier shall host the Site on secure servers and use reasonable endeavours', { service: 'hosting' });
  rule('The Supplier may suspend the Site without notice', { service: 'hosting' });
  rule('provide photographs of its completed works', { service: 'website_build' });
  rule('The Retainer shall be charged at the monthly amount', either);
  rule('If the Customer ends the Contract before the Site goes live', { service: 'website_build' });
  rule('If the Contract ends for any reason, or the Customer chooses to leave', null, 'If you ever end the retainer, we will bundle up your full site and send it to you. We cannot set up new hosting or get it live elsewhere.');
  const data = doc.sections.find((s) => s.title === 'Data protection');
  data.when = { service: 'enquiry_forms' };
  doc.sections.find((s) => s.title === 'Ownership of the Site and the Domain').plain = 'You own your domain and your website. We do not, and we never take control of your domain.';
  // The hand-written plain-English box becomes an automatic summary of the clauses that apply.
  const intro = doc.sections[0];
  const i = intro.nodes.findIndex((n) => n.kind === 'callout' && /^In plain English/.test(n.title));
  if (i < 0) throw new Error('Plain English callout not found');
  intro.nodes[i] = { id: newId(), kind: 'summary', title: 'In plain English', text: 'The full terms are below. If anything here conflicts with the plain English summary, the full terms apply.' };
  return doc;
}

async function publishNew(name, description, doc, variables, note) {
  const existing = await sql`SELECT id FROM contracts WHERE name = ${name}`;
  if (existing.length) { console.log(`Contract "${name}" already exists (#${existing[0].id}); leaving it.`); return Number(existing[0].id); }
  const clean = sanitizeDoc(doc);
  const issues = validateDoc(clean, { serviceKeys: (await sql`SELECT key FROM contract_services`).map((r) => r.key), variableKeys: variables.map((v) => v.key) });
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) throw new Error(`"${name}" has errors: ${JSON.stringify(errors)}`);
  const rows = await sql`INSERT INTO contracts (name, description, draft, variables, created_by, draft_updated_by) VALUES (${name}, ${description}, ${JSON.stringify(clean)}::jsonb, ${JSON.stringify(variables)}::jsonb, 'system', 'system') RETURNING id`;
  const id = Number(rows[0].id);
  await sql`INSERT INTO contract_versions (contract_id, version, doc, variables, change_note, published_by) VALUES (${id}, 1, ${JSON.stringify(clean)}::jsonb, ${JSON.stringify(variables)}::jsonb, ${note}, 'system')`;
  console.log(`Created and published "${name}" (#${id}) with ${issues.length} warning(s).`);
  return id;
}

// 1. Standard terms from the shared set.
const shared = await sql`SELECT blocks FROM proposal_contract_terms WHERE id = 1`;
const standardId = await publishNew('Standard Terms', 'The general terms used by templates without their own contract.', docFromBlocks(shared[0]?.blocks || []), [], 'Migrated from the shared contract terms');

// 2. Website + retainer terms.
const retainerTpl = await sql`SELECT id, contract_terms FROM proposal_templates WHERE name = ${WEBSITE_RETAINER_TEMPLATE_NAME}`;
const sourceTerms = Array.isArray(retainerTpl[0]?.contract_terms) && retainerTpl[0].contract_terms.length ? retainerTpl[0].contract_terms : WEBSITE_RETAINER_TERMS;
const retainerId = await publishNew('Website + Hosting Retainer Terms', 'Fixed-price website build with a monthly hosting and support retainer.', enhanceRetainer(docFromBlocks(sourceTerms)), WEBSITE_RETAINER_VARIABLES, 'Migrated from the AI Website + Retainer terms, with services-driven clauses');

// 3. Link templates.
if (retainerTpl.length) {
  await sql`UPDATE proposal_templates SET contract_id = ${retainerId}, contract_pin = NULL, services = ${JSON.stringify(['website_build', 'hosting', 'support', 'dns_help', 'enquiry_forms'])}::jsonb, contract_terms = NULL WHERE id = ${retainerTpl[0].id}`;
}
await sql`UPDATE proposal_templates SET contract_id = ${standardId}, services = COALESCE(services, '[]'::jsonb) WHERE contract_id IS NULL`;

// 4. Freeze unaccepted proposals to the version their template points at.
const frozen = await sql`
  UPDATE proposals p SET contract_version_id = v.id, selected_services = COALESCE(p.selected_services, t.services, '[]'::jsonb)
  FROM proposal_templates t, contract_versions v
  WHERE t.id = p.template_id AND v.contract_id = t.contract_id AND p.contract_version_id IS NULL AND p.stage = 'proposal' AND p.accepted_at IS NULL
    AND v.version = (SELECT MAX(version) FROM contract_versions x WHERE x.contract_id = t.contract_id)
  RETURNING p.id
`;
console.log(`Froze ${frozen.length} unaccepted proposal(s) to their contract version.`);

// 5. Sanity check: the migrated retainer contract renders the same as before for the full service set.
const v = (await sql`SELECT doc FROM contract_versions WHERE contract_id = ${retainerId} AND version = 1`)[0];
const out = renderContractDoc(v.doc, { services: ['website_build', 'hosting', 'support', 'dns_help', 'enquiry_forms'], variables: { support_hours: '5', domain_registrar: 'GoDaddy' } });
console.log(`Retainer contract renders ${out.blocks.length} blocks with all services; unresolved refs: ${out.unresolvedRefs.length}.`);
