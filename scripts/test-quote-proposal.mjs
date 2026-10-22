import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { computeQuote, quoteToBlocks, quoteSummary, Q_PKG } from '../lib/quoteModel.js';
import { proposalCosts } from '../lib/proposalCosts.js';
import { sanitizeBlocks } from '../lib/proposalBlocks.js';
import { OFFERINGS_BRIEF, BRIEF_PRICES } from '../lib/offerings-brief.js';
import { templateBrief, leadFacts } from '../lib/callPrep.js';

const offeringsSource = fs.readFileSync(new URL('../offerings.js', import.meta.url), 'utf8');
const forecastModelSource = fs.readFileSync(new URL('../forecast-model.js', import.meta.url), 'utf8');

test('server quote prices match the Offerings page', () => {
  for (const p of Object.values(Q_PKG).filter((x) => x.monthly)) {
    assert.ok(offeringsSource.includes(`monthly: ${p.monthly}`), `${p.name} price drifted from offerings.js`);
    assert.ok(offeringsSource.includes(p.name), `${p.name} missing from offerings.js`);
  }
  for (const price of BRIEF_PRICES) assert.ok(offeringsSource.includes(price) || price === '£349', `${price} not on the Offerings page`);
  assert.ok(offeringsSource.includes('min: 99, max: 300') && offeringsSource.includes('min: 349'), 'care plan limits drifted');
  for (const price of BRIEF_PRICES) assert.ok(OFFERINGS_BRIEF.includes(price), `${price} missing from the AI brief`);
});

test('computeQuote applies billing discounts and clamps add-on prices', () => {
  const q = computeQuote({ pkg: 'gl', bill: 'quarterly', add: { static: { on: true, build: 200, care: 9999 }, lp: { n: 2 }, integ: { on: true } } });
  assert.equal(q.pkgNet, 1662.5);
  const site = q.rows.find((r) => r.id === 'static');
  assert.equal(site.one, 1000);
  assert.equal(site.mo, 300);
  assert.equal(q.oneOff, 1000 + 350);
  assert.equal(q.addMonthly, 300 + 40);
  assert.deepEqual(q.quoted, ['Tool integrations']);
  assert.equal(computeQuote({}).monthlyTotal, 0);
});

test('a quote becomes a proposal whose costs add back up to the quote', () => {
  const q = computeQuote({ pkg: 'gl', bill: 'monthly', add: { static: { on: true, build: 1500, care: 150 } } });
  const blocks = sanitizeBlocks(quoteToBlocks(q, { company: 'Northwind' }), { rep_name: 'Zain', expiry_date: '30 October' });
  assert.ok(blocks.some((b) => b.type === 'investment'));
  const costs = proposalCosts({ blocks, selection: { options: {}, addons: {}, summary: quoteSummary(q) } });
  assert.equal(costs.oneOff, 1500);
  assert.equal(costs.monthly, 1750 + 150);
  assert.match(quoteSummary(q), /Get Leads at £1,750 a month, Static website/);
});

test('call prep: the standard brief is safe with masked names, and facts are trimmed', () => {
  const facts = leadFacts({ name: 'Simon Ma***e', title: 'Director', company_name: 'Acme', sector: 'Security', sub_sector: 'CCTV' }, { notes: ['a', 'b'], calls: ['No answer'] });
  const brief = templateBrief(facts);
  assert.equal(brief.headline, 'Director at Acme');
  assert.equal(templateBrief(leadFacts({ name: '***' }, {})).headline, 'No company details recorded');
  assert.equal(brief.questions.length, 3);
  assert.equal(brief.fit.package, 'Get Leads');
});

test('call prep: one playbook per sector, each lead gets its own opener and watch-outs', async () => {
  const { sectorKey, composeBrief } = await import('../lib/callPrep.js');
  const a = leadFacts({ name: 'Priya Shah', title: 'Owner', company_name: 'Smile Dental', sector: 'Healthcare ', sub_sector: 'Private Dentists', company_employees: 8, disposition: 'No answer' }, { calls: ['No answer', 'Left voicemail'] });
  const b = leadFacts({ name: 'Tom Lee', title: 'Director', company_name: 'Bright Teeth', sector: 'healthcare', sub_sector: 'private dentists' }, {});
  assert.equal(sectorKey(a), 'healthcare / private dentists');
  assert.equal(sectorKey(a), sectorKey(b));
  assert.equal(sectorKey(leadFacts({}, {})), 'general');
  const playbook = { painPoints: ['Hard to find online'], whyWeHelp: 'We build visibility.', fit: { package: 'Get Leads', why: 'x' }, questions: ['q1', 'q2', 'q3'], objections: [], nextStep: 'Book a meeting.' };
  const one = composeBrief(playbook, a);
  const two = composeBrief(playbook, b);
  assert.equal(one.headline, 'Owner at Smile Dental, 8 staff');
  assert.deepEqual(one.questions, two.questions);
  assert.equal(one.watchOuts.length, 2);
  assert.equal(two.watchOuts.length, 0);
  assert.equal(one.painPoints.length, 1);
  assert.equal(one.whyWeHelp, 'We build visibility.');
});

test('Offerings page still renders and the proposal form shows in the quote popout', () => {
  const html = {};
  const nodes = new Proxy({}, { get: (t, id) => (t[id] ||= { set innerHTML(v) { html[id] = v; }, get innerHTML() { return html[id] || ''; }, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, hidden: true, classList: { toggle() {}, add() {}, remove() {} } }) });
  const ctx = {
    document: { getElementById: (id) => nodes[id], addEventListener() {}, querySelector: () => null, body: { classList: { add() {}, remove() {} } } },
    window: {}, navigator: {}, location: { origin: 'https://x.test' }, addEventListener() {}, fetch: async () => ({ json: async () => ({ success: true, opportunities: [] }) }),
    SQ: { init: (cb) => cb() },
  };
  ctx.window = ctx;
  ctx.addEventListener = (type, cb) => { if (type === 'DOMContentLoaded') cb(); };
  vm.runInNewContext(forecastModelSource, ctx); // the forecast model is shared with the Targets page and loaded first by offerings.html
  vm.runInNewContext(offeringsSource, ctx);
  assert.ok(/Get Leads/.test(html.offBody || ''), 'page rendered');
  assert.ok(/Quote this package/.test(html.offBody));
});

test('portal updates are cleaned and payments split 50/50', async () => {
  const { cleanPortalUpdates, portalPayments } = await import('../lib/portal.js');
  const clean = cleanPortalUpdates([{ title: '  Design   started ', status: 'active', date: '2026-10-20T09:00', note: 'x'.repeat(900) }, { title: '', status: 'done' }, { title: 'Bad status', status: 'nope', date: 'tomorrow' }]);
  assert.equal(clean.length, 2);
  assert.deepEqual([clean[0].title, clean[0].status, clean[0].date, clean[0].note.length], ['Design started', 'active', '2026-10-20', 600]);
  assert.deepEqual([clean[1].status, clean[1].date], ['upcoming', null]);
  const pay = portalPayments({ blocks: [{ type: 'investment', text: 'Website build | £12,000 | one-off' }, { type: 'investment', text: 'Care | £250 / month | monthly' }] });
  assert.equal(pay.oneOff, 12000);
  assert.equal(pay.upfront, 6000);
  assert.equal(pay.final, 6000);
  assert.equal(pay.monthly, 250);
  assert.equal(portalPayments({ blocks: [] }), null);
});

test('client and hub pages still parse with the new portal and prep code', () => {
  for (const file of ['../proposal.html', '../proposal-hub.html', '../call-list-zen.html', '../opportunities.html']) {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const m of src.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(m[1]), file);
  }
});
