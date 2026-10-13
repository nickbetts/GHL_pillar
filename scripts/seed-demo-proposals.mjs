/**
 * Seed five demo proposals, one per stage of the deal flow, so the team can see
 * exactly what a client experiences at each step:
 *
 *   1 proposal live (unsigned)      4 onboarding form out (contract signed)
 *   2 proposal signed               5 complete (handover ready)
 *   3 contract sent (unsigned)
 *
 * Demo gate for all five: alex.morgan@northwind-example.co.uk + i3demo2026
 *
 * Usage: node scripts/seed-demo-proposals.mjs           # insert/refresh demos
 *        node scripts/seed-demo-proposals.mjs --remove  # delete all demos
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
const { sanitizeBlocks, tokenContext } = await import('../lib/proposalBlocks.js');
const { WEBSITE_TEMPLATE_BLOCKS, CONTRACT_TERMS_BLOCKS, DEFAULT_QUESTIONNAIRE } = await import('../lib/proposalDefaults.js');

const DEMO_PREFIX = 'DEMO · ';
const DEMO_EMAIL = 'alex.morgan@northwind-example.co.uk';
const DEMO_PASSWORD = 'i3demo2026';

if (process.argv.includes('--remove')) {
  const gone = await sql`DELETE FROM proposals WHERE title LIKE ${DEMO_PREFIX + '%'} RETURNING id`;
  console.log(`Removed ${gone.length} demo proposals.`);
  process.exit(0);
}

// Start clean so re-runs never duplicate.
await sql`DELETE FROM proposals WHERE title LIKE ${DEMO_PREFIX + '%'}`;

const sample = {
  client_name: 'Alex Morgan',
  client_company: 'Northwind Engineering Ltd',
  client_email: DEMO_EMAIL,
  owner_name: 'Nick Betts',
  deal_type: 'Hybrid',
  mrr_value: null,
  one_off_value: null,
  expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
};

const blocks = sanitizeBlocks(WEBSITE_TEMPLATE_BLOCKS, tokenContext(sample));

// Real indices of the selectable blocks, so selections match the template.
const optionIdx = [];
let addonIdx = -1;
blocks.forEach((b, i) => {
  if (b.type === 'options' && b.selectable) optionIdx.push(i);
  if (b.type === 'addons' && addonIdx < 0) addonIdx = i;
});
const selection = {
  options: Object.fromEntries(optionIdx.map((i) => [String(i), 'b'])),
  addons: addonIdx >= 0 ? { [String(addonIdx)]: [0] } : {},
  summary: 'Brand Uplift (£12,000) + Support retainer: 5 hours / month (£550 / mo)',
};

const terms = (await sql`SELECT blocks FROM proposal_contract_terms WHERE id = 1`)[0]?.blocks || CONTRACT_TERMS_BLOCKS;
const { hash, salt } = hashPassword(DEMO_PASSWORD);

const contractBlocksFor = (id, title) => [
  { type: 'heading', text: `Contract: ${title}` },
  { type: 'text', text: `Between i3MEDIA Ltd and ${sample.client_company}.\n\nProposal: ${title} (PROP-${id})\nSelected work: ${selection.summary}\n\nThe small print below applies to this engagement.` },
  ...sanitizeBlocks(Array.isArray(terms) ? terms : [], {
    ...tokenContext(sample),
    proposal_title: title,
    proposal_ref: `PROP-${id}`,
    selection_summary: selection.summary,
  }),
];

const demoAnswers = DEFAULT_QUESTIONNAIRE.map((q, i) => ({
  q: q.q,
  a: q.type === 'yesno'
    ? 'Yes'
    : [
        'Precision CNC machining and fabrication for motorsport and industrial clients.',
        'Procurement managers at mid-size engineering firms who need reliable repeat supply.',
        'Rank for our core services, prove our track record with case studies, and make requesting a quote effortless.',
        'Full logo suite and brand guidelines, plus project photography from the last two years.',
        'Alex Morgan runs the project day to day; our MD signs off major decisions.',
        'Some copy can be reused from the current site, but most service pages need a rewrite.',
        'ieg.ac.uk for structure and roadphone.co.uk for how the enquiry paths work.',
        'End of Q1 if possible.',
        'We will need the enquiry forms to feed into our CRM.',
      ][i] || '—',
}));

const STAGES = [
  { n: 1, label: 'proposal live (unsigned)', stage: 'proposal', status: 'active' },
  { n: 2, label: 'proposal signed', stage: 'proposal', status: 'signed' },
  { n: 3, label: 'contract sent (unsigned)', stage: 'contract', status: 'signed' },
  { n: 4, label: 'onboarding form out (contract signed)', stage: 'questionnaire', status: 'signed' },
  { n: 5, label: 'complete (handover ready)', stage: 'complete', status: 'signed' },
];

const created = [];
for (const s of STAGES) {
  const token = crypto.randomBytes(9).toString('base64url');
  const handoverToken = crypto.randomBytes(9).toString('base64url');
  const title = `${DEMO_PREFIX}Stage ${s.n}: ${s.label}`;
  const signed = s.n >= 2;
  const contractSigned = s.n >= 4;
  const complete = s.n >= 5;
  const rows = await sql`
    INSERT INTO proposals (
      token, lead_id, template_id, title, client_name, client_company, client_email,
      access_password_hash, access_password_salt, blocks, deal_type, mrr_value, one_off_value,
      status, stage, owner_id, owner_name, expires_at, created_by_email, handover_token,
      selection, signed_at, signed_by_name,
      contract_blocks, contract_sent_at, contract_signed_at, contract_signed_by_name,
      questionnaire_answers, questionnaire_completed_at, created_at
    ) VALUES (
      ${token}, NULL, NULL, ${title}, ${sample.client_name}, ${sample.client_company}, ${sample.client_email},
      ${hash}, ${salt}, ${JSON.stringify(blocks)}::jsonb, ${sample.deal_type}, ${sample.mrr_value}, ${sample.one_off_value},
      ${s.status}, ${s.stage}, '', ${sample.owner_name}, ${sample.expires_at}::timestamptz, 'demo', ${handoverToken},
      ${signed ? JSON.stringify(selection) : null}::jsonb,
      ${signed ? new Date(Date.now() - 86400000).toISOString() : null}::timestamptz, ${signed ? 'Alex Morgan' : null},
      ${s.n >= 3 ? JSON.stringify(contractBlocksFor(0, title)) : null}::jsonb,
      ${s.n >= 3 ? new Date(Date.now() - 43200000).toISOString() : null}::timestamptz,
      ${contractSigned ? new Date(Date.now() - 21600000).toISOString() : null}::timestamptz, ${contractSigned ? 'Alex Morgan' : null},
      ${complete ? JSON.stringify(demoAnswers) : null}::jsonb,
      ${complete ? new Date(Date.now() - 3600000).toISOString() : null}::timestamptz,
      ${new Date(Date.now() - s.n * 3600000).toISOString()}::timestamptz
    )
    RETURNING id
  `;
  const id = Number(rows[0].id);
  // Fix the contract intro reference now we know the real id.
  if (s.n >= 3) {
    await sql`UPDATE proposals SET contract_blocks = ${JSON.stringify(contractBlocksFor(id, title))}::jsonb WHERE id = ${id}`;
  }
  const events = ['created'];
  if (signed) events.push('viewed', 'accepted', 'signed');
  if (s.n >= 3) events.push('contract_sent');
  if (contractSigned) events.push('contract_viewed', 'contract_signed');
  if (complete) events.push('questionnaire_completed');
  for (const type of events) {
    await sql`INSERT INTO proposal_events (proposal_id, event_type, actor_name) VALUES (${id}, ${type}, ${type === 'created' || type === 'contract_sent' ? sample.owner_name : sample.client_name})`;
  }
  if (s.n === 1) {
    await sql`INSERT INTO proposal_comments (proposal_id, block_index, author_name, author_email, body) VALUES (${id}, 6, ${sample.client_name}, ${sample.client_email}, 'Can we talk through the support retainer options on our next call?')`;
    await sql`INSERT INTO proposal_events (proposal_id, event_type, actor_name, meta) VALUES (${id}, 'commented', ${sample.client_name}, ${JSON.stringify({ blockIndex: 6, body: 'Can we talk through the support retainer options on our next call?' })}::jsonb)`;
  }
  created.push({ n: s.n, label: s.label, id, token, handoverToken });
}

console.log('\nDemo gate for all five: ' + DEMO_EMAIL + ' + ' + DEMO_PASSWORD + '\n');
for (const d of created) {
  console.log(`Stage ${d.n} · ${d.label}`);
  console.log(`  client: /proposal?p=${d.token}`);
  if (d.n >= 3) console.log(`  handover: /handover?h=${d.handoverToken}`);
}
