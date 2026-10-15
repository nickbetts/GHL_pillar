/**
 * Seeds the clause library with the boilerplate sections of the website + retainer contract and links
 * those sections back to the library, then publishes the next version of that contract.
 * Sections that point at clauses outside themselves are skipped (they would dangle in other contracts).
 * Safe to re-run: sections already linked are left alone.
 *
 * Usage: node scripts/seed-clause-library.mjs
 */

import fs from 'fs';

const envFile = ['.env.local', '.env'].find((f) => fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('DATABASE_URL'));
process.env.DATABASE_URL ||= fs.readFileSync(envFile, 'utf8').split('\n').find((l) => l.trim().startsWith('DATABASE_URL')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');

const { getSql, ensureProposalTables } = await import('../api/db.js');
const sql = getSql();
await ensureProposalTables(sql);

const PLAN = {
  Core: ['Waiver', 'Rights and remedies', 'Severance', 'Entire agreement', 'Assignment', 'No partnership or agency', 'Third party rights', 'Governing law', 'Jurisdiction', 'Force majeure', 'Notices'],
  Confidentiality: ['Confidentiality and Supplier\'s property'],
  Liability: ['Indemnity', 'Limitation of liability'],
  Data: ['Data protection'],
  Website: ['Ownership of the Site and the Domain'],
};
const category = (title) => Object.keys(PLAN).find((c) => PLAN[c].includes(title));

const [contract] = await sql`SELECT id, draft, variables FROM contracts WHERE name = 'Website + Hosting Retainer Terms'`;
if (!contract) { console.error('Contract not found; run migrate-contracts.mjs first.'); process.exit(1); }
const doc = contract.draft;

const ids = (nodes, acc = new Set()) => { nodes.forEach((n) => { acc.add(n.id); ids(n.children || [], acc); }); return acc; };
const refsOf = (nodes, acc = []) => { nodes.forEach((n) => { String(n.text || '').replace(/\{\{ref:([A-Za-z0-9_-]+)\}\}/g, (m, id) => { acc.push(id); return m; }); refsOf(n.children || [], acc); }); return acc; };

let added = 0;
for (const section of doc.sections) {
  const cat = category(section.title);
  if (!cat || section.source) continue;
  const own = ids(section.nodes); own.add(section.id);
  const outside = refsOf(section.nodes).filter((id) => !own.has(id));
  if (outside.length) { console.log(`Skipped "${section.title}": it refers to clauses outside itself.`); continue; }
  const copy = JSON.parse(JSON.stringify(section));
  delete copy.source;
  const rows = await sql`INSERT INTO contract_clauses (title, category, section, updated_by) VALUES (${section.title}, ${cat}, ${JSON.stringify(copy)}::jsonb, 'system') RETURNING id, version`;
  section.source = { clauseId: Number(rows[0].id), version: Number(rows[0].version) };
  added += 1;
}
console.log(`Added ${added} clause(s) to the library.`);
if (!added) process.exit(0);

const next = Number((await sql`SELECT COALESCE(MAX(version), 0) + 1 AS n FROM contract_versions WHERE contract_id = ${contract.id}`)[0].n);
await sql`UPDATE contracts SET draft = ${JSON.stringify(doc)}::jsonb, draft_updated_by = 'system', draft_updated_at = now() WHERE id = ${contract.id}`;
await sql`INSERT INTO contract_versions (contract_id, version, doc, variables, change_note, published_by) VALUES (${contract.id}, ${next}, ${JSON.stringify(doc)}::jsonb, ${JSON.stringify(contract.variables || [])}::jsonb, 'Linked boilerplate sections to the clause library (wording unchanged)', 'system')`;
console.log(`Published version ${next} of the retainer contract.`);
