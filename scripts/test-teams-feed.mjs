import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildCard, dealValueText, gbp, feed, teamsConfigured } from '../lib/teams.js';
import { frenzyCard } from '../lib/teams-feed.js';
import { lossCategory, firstYearValue, STAGE_WEIGHTS } from '../lib/insights.js';

test('deal values read naturally', () => {
  assert.equal(dealValueText(12000, 800), '£12,000 one-off + £800/mo');
  assert.equal(dealValueText(0, 550), '£550/mo');
  assert.equal(dealValueText(null, null), '');
  assert.equal(gbp(1234.5), '£1,234.50');
});

test('buildCard makes a Workflows-compatible adaptive card and drops empty facts', () => {
  const card = buildCard({ title: 'Meeting booked: Northwind', facts: [['Rep', 'Zain'], ['Value', ''], ['When', null]], url: 'https://x.test/a', urlLabel: 'Open' });
  assert.equal(card.type, 'message');
  const att = card.attachments[0];
  assert.equal(att.contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(att.content.type, 'AdaptiveCard');
  assert.deepEqual(att.content.body.find((b) => b.type === 'FactSet').facts, [{ title: 'Rep', value: 'Zain' }]);
  assert.equal(att.content.actions[0].url, 'https://x.test/a');
});

test('frenzy card names the rep, company and end time', () => {
  const c = frenzyCard({ repName: 'Zain', companyName: 'Northwind', value: '£12,000 one-off', endsAt: Date.UTC(2026, 9, 18, 9, 30), winNumber: 3 }).attachments[0].content;
  assert.match(c.body[0].text, /Zain closed Northwind/);
  assert.match(c.body[1].text, /2×/);
  assert.ok(c.body.find((b) => b.type === 'FactSet').facts.some((f) => f.value === '#3'));
});

test('the feed is a safe no-op without a webhook and never touches the database', async () => {
  const saved = process.env.TEAMS_WEBHOOK_URL;
  delete process.env.TEAMS_WEBHOOK_URL;
  assert.equal(teamsConfigured(), false);
  const boom = () => { throw new Error('db must not be used'); };
  assert.equal(await feed(boom, buildCard({ title: 'x' }), 'k'), false);
  if (saved) process.env.TEAMS_WEBHOOK_URL = saved;
});

test('loss reasons map onto fixed categories', () => {
  assert.equal(lossCategory('No budget'), 'Price / budget');
  assert.equal(lossCategory('Went with competitor'), 'Went with a competitor');
  assert.equal(lossCategory('Timing not right'), 'Timing');
  assert.equal(lossCategory('No response / stalled'), 'No response');
  assert.equal(lossCategory('Not a fit'), 'Not a fit');
  assert.equal(lossCategory('Internal hold'), 'Internal hold');
  assert.equal(lossCategory(''), 'No reason recorded');
  assert.equal(lossCategory('Something unusual'), 'Other');
});

test('first-year value is one-off plus twelve months of recurring; stage weights rise towards proposal', () => {
  assert.equal(firstYearValue(12000, 800), 21600);
  assert.ok(STAGE_WEIGHTS.proposal > STAGE_WEIGHTS.scoping && STAGE_WEIGHTS.scoping > STAGE_WEIGHTS.meeting_booked);
});

test('Insights page renders the forecast, funnel, win/loss and admin panels from API data', async () => {
  const html = {};
  const el = (id) => ({ set innerHTML(v) { html[id] = v; }, get innerHTML() { return html[id] || ''; }, addEventListener() {}, value: '30' });
  const els = {};
  const sample = {
    success: true, days: 30, groupBy: 'source', staleCount: 2, teamsConfigured: false, isAdmin: true,
    users: [{ name: 'Zain', email: 'zain@i3media.net' }], reportRecipients: ['zain@i3media.net'],
    forecast: { openCount: 3, totalValue: 90000, weightedValue: 30000, likelyWithin30Days: 12000, wonThisMonth: { deals: 1, value: 28100, mrr: 1675 }, note: 'n',
      stages: [{ stage: 'proposal', label: 'Proposal', weight: 0.55, count: 2, value: 60000, weighted: 33000 }], byOwner: [{ owner: 'Zain', count: 2, value: 60000, weighted: 33000 }], monthly: [{ month: '2026-10', deals: 1, value: 28100, mrr: 1675 }] },
    funnel: { days: 30, groupBy: 'source', rows: [{ group: 'apollo', calls: 100, connected: 25, connectRate: 25, qualified: 3, meetings: 2, proposals: 1, won: 1, wonValue: 28100, callsPerWin: 100 }], totals: { calls: 100, connected: 25, qualified: 3, meetings: 2, proposals: 1, won: 1, wonValue: 28100, connectRate: 25 } },
    winLoss: { days: 30, won: 1, lost: 2, winRate: 33.3, wonValue: 28100, lostValue: 5000, avgCycleDays: 21, reasons: [{ category: 'Price / budget', count: 2, share: 100, value: 5000 }], owners: [{ owner: 'Zain', won: 1, lost: 2, winRate: 33.3, wonValue: 28100, lostValue: 5000 }], recentLost: [{ id: 1, name: 'A', company: 'Acme', owner: 'Zain', reason: 'No budget', category: 'Price / budget', value: 2500 }] },
  };
  const ctx = {
    document: { getElementById: (id) => (els[id] ||= el(id)), querySelectorAll: () => [] },
    fetch: async () => ({ status: 200, json: async () => sample }),
    SQ: { init: (cb) => cb() },
    location: { href: '' },
  };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../insights.js', import.meta.url), 'utf8'), ctx);
  await new Promise((r) => setTimeout(r, 20));
  const out = html.inBody;
  for (const needle of ['Pipeline forecast', '£90,000', 'Funnel conversion', 'apollo', 'Wins and losses', 'Price / budget', 'Monday morning report', 'zain@i3media.net', '2 open opportunities have had no next step']) {
    assert.ok(out.includes(needle), `missing ${needle}`);
  }
  assert.ok(!/undefined|NaN/.test(out), 'no undefined or NaN in the rendered page');
});
