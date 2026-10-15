/**
 * One-off patch for the "Website + Hosting Retainer Terms" contract: removes cross-references that would
 * dangle when a service is switched off (found by the preview matrix), then publishes the next version.
 *
 * Usage: node scripts/patch-retainer-contract.mjs
 */

import fs from 'fs';

const envFile = ['.env.local', '.env'].find((f) => fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('DATABASE_URL'));
process.env.DATABASE_URL ||= fs.readFileSync(envFile, 'utf8').split('\n').find((l) => l.trim().startsWith('DATABASE_URL')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');

const { getSql, ensureProposalTables } = await import('../api/db.js');
const { previewMatrix, validateDoc } = await import('../lib/contractEngine.js');
const sql = getSql();
await ensureProposalTables(sql);

const [contract] = await sql`SELECT id, draft, variables FROM contracts WHERE name = 'Website + Hosting Retainer Terms'`;
if (!contract) { console.error('Contract not found; run migrate-contracts.mjs first.'); process.exit(1); }
const doc = contract.draft;

const nodes = [];
const walk = (ns, sec) => ns.forEach((n) => { nodes.push({ n, sec }); walk(n.children || [], sec); });
doc.sections.forEach((s) => walk(s.nodes, s));
const get = (start) => { const hit = nodes.find(({ n }) => String(n.text || '').startsWith(start)); if (!hit) throw new Error(`No clause starts with: ${start}`); return hit.n; };
const idOf = (start) => get(start).id;
let changed = 0;
const set = (start, text) => { const n = get(start); if (n.text !== text) { n.text = text; changed += 1; } };

const t136 = idOf('The Customer may not end the Contract for convenience');
const t132 = idOf('Without prejudice to any other rights or remedies to which the parties may be entitled');
const sec = (title) => doc.sections.find((s) => s.title === title).id;

set('the monthly services described in', 'the monthly services described in the Proposal.');
set('The Customer may not end the Contract for convenience', `The Customer may not end the Contract for convenience during the Initial Term. After the Initial Term the Customer may end the Contract by giving the Supplier not less than 30 days\' written notice, and the Retainer shall stop at the end of that notice period.`);
set('If the Customer ends the Contract before the Site goes live', `Despite clause {{ref:${t136}}}, if the Customer ends the Contract before the Site goes live (other than under clause {{ref:${t132}}}), the Supplier shall keep 50% of the fixed price for the design and build of the Site, and the Customer shall pay that amount to the extent it has not already been paid. The Supplier shall refund any amount the Customer has paid above that figure. No further charges are payable for the design and build of the Site or for the rest of the Initial Term, other than Retainer charges for months already started. For this clause, the Site goes live when it is first made publicly available on the Domain.`);
const notices = nodes.find(({ n, sec: s }) => s.title === 'Notices' && String(n.text || '').startsWith('Despite clause')).n;
notices.text = `Despite clause {{ref:${idOf('A reference to writing or written')}}} and this clause {{ref:${sec('Notices')}}}, notices and confirmations under this Contract may be given by email to the address most recently notified in writing by the receiving party, and are deemed received at 9.00 am on the next Business Day after sending.`;
changed += 1;
const seven = get('Clause {{ref:');
seven.text = seven.text.replace(/, and clause \{\{ref:[A-Za-z0-9_-]+\}\} shall apply to the Retainer/, '');
const sec3 = get('keep in place appropriate technical and organisational measures');
sec3.text = sec3.text.replace(/, including the measures described in clause \{\{ref:[A-Za-z0-9_-]+\}\}/, '');

const keys = ['website_build', 'hosting', 'support', 'dns_help', 'enquiry_forms'];
const problems = previewMatrix(doc, { serviceKeys: keys }).filter((r) => r.problems.length);
console.log(`Edited ${changed}+ clauses. Matrix problems remaining: ${problems.length} of ${2 ** keys.length}.`);
if (problems.length) { console.error(JSON.stringify(problems.slice(0, 3))); process.exit(1); }
const errors = validateDoc(doc, { serviceKeys: keys, variableKeys: (contract.variables || []).map((v) => v.key) }).filter((i) => i.level === 'error');
if (errors.length) { console.error(errors); process.exit(1); }

const next = Number((await sql`SELECT COALESCE(MAX(version), 0) + 1 AS n FROM contract_versions WHERE contract_id = ${contract.id}`)[0].n);
const same = (await sql`SELECT 1 FROM contract_versions WHERE contract_id = ${contract.id} AND doc = ${JSON.stringify(doc)}::jsonb`).length;
if (same) { console.log('Already patched; nothing to publish.'); process.exit(0); }
await sql`UPDATE contracts SET draft = ${JSON.stringify(doc)}::jsonb, draft_updated_by = 'system', draft_updated_at = now() WHERE id = ${contract.id}`;
await sql`INSERT INTO contract_versions (contract_id, version, doc, variables, change_note, published_by) VALUES (${contract.id}, ${next}, ${JSON.stringify(doc)}::jsonb, ${JSON.stringify(contract.variables || [])}::jsonb, 'Removed cross-references that could dangle when a service is switched off', 'system')`;
const frozen = await sql`
  UPDATE proposals p SET contract_version_id = v.id
  FROM proposal_templates t, contract_versions v
  WHERE t.id = p.template_id AND t.contract_id = ${contract.id} AND v.contract_id = ${contract.id} AND v.version = ${next}
    AND p.stage = 'proposal' AND p.accepted_at IS NULL
  RETURNING p.id
`;
console.log(`Published version ${next}; moved ${frozen.length} unaccepted proposal(s) to it.`);
