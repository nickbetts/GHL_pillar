import assert from 'node:assert/strict';
import { createSessionToken, verifySessionToken, createImpersonationSessionToken } from './api/session.js';
import { verifyWebhookSecret } from './api/webhook-security.js';
import { londonDateKey, londonDayRange } from './api/business-time.js';
import { listAllContacts } from './lib/ghlClient.js';
import { claimQualification, recordCall } from './api/apollo-sales-queue.js';
import i3crmHandler from './api/i3crm.js';
import reportsHandler from './api/reports.js';
import webhookHandler from './api/webhooks.js';
import ghlOpportunityWebhookHandler from './api/webhook-ghl-opportunity.js';
import threeCxWebhookHandler from './api/3cx-webhook.js';
import {
  SUBSECTORS,
  VARIANTS,
  composeResolvedTemplate,
  composeTemplate,
  inferSubsector,
  normalizeSubsector,
} from './email-template-data.js';

function normalizePhone9(value) {
  return String(value || '').replace(/\D+/g, '').slice(-9);
}

function websiteHost(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return String(new URL(raw).hostname || '').toLowerCase().replace(/^www\./, '').trim();
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
  }
}

function normalizedCompanyName(value) {
  return String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function companyKey(lead) {
  const p = normalizePhone9(lead.phone || '');
  if (p) return `phone:${p}`;
  const d = websiteHost(lead.companyWebsite || '');
  if (d) return `domain:${d}`;
  const n = normalizedCompanyName(lead.companyName || '');
  if (n) return `name:${n}`;
  return `lead:${lead.id}`;
}

function isCovered(lead) {
  const d = String(lead.disposition || '').toLowerCase();
  return d.includes('covered by colleague') || d.includes('already worked this company');
}

function rankPriority(priority) {
  const order = { hot: 0, warm: 1, cold: 2 };
  return Number.isFinite(order[priority]) ? order[priority] : 9;
}

function callSort(a, b) {
  const p = rankPriority(a.priority) - rankPriority(b.priority);
  if (p) return p;
  return String(a.id).localeCompare(String(b.id));
}

function buildTargetMap(leads) {
  const groups = new Map();
  for (const lead of leads) {
    const key = companyKey(lead);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lead);
  }

  const out = new Map();
  for (const [key, members] of groups.entries()) {
    const explicit = members.find((m) => !!m.companyTarget);
    if (explicit) {
      out.set(key, String(explicit.id));
      continue;
    }
    const ranked = members.filter((m) => !isCovered(m)).sort(callSort);
    out.set(key, String((ranked[0] || members[0]).id));
  }
  return out;
}

function mergeKey(lead) {
  const number = normalizePhone9(lead.phone || lead.directPhone || '');
  return number ? `${companyKey(lead)}|${number}` : `lead:${lead.id}`;
}

function uniqueByMerge(leads) {
  const seen = new Set();
  return leads.filter((lead) => {
    const key = mergeKey(lead);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isActiveTarget(lead, targets) {
  return String(targets.get(companyKey(lead)) || '') === String(lead.id);
}

function futureScheduledCount(leads, now = new Date('2026-07-30T10:00:00Z')) {
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  const targets = buildTargetMap(leads);
  const future = leads
    .filter((l) => l.callbackAt)
    .filter((l) => new Date(l.callbackAt).getTime() > end.getTime())
    .filter((l) => isActiveTarget(l, targets));
  return uniqueByMerge(future).length;
}

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

async function assertAnonymousDenied(handler, req, expectedStatus) {
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, expectedStatus);
}

async function testPagination() {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const second = String(url).includes('startAfterId=2');
    return {
      ok: true,
      json: async () => second
        ? { contacts: [{ id: '2' }], meta: {} }
        : { contacts: [{ id: '1' }], meta: { nextPageUrl: 'https://services.leadconnectorhq.com/contacts?startAfterId=2' } },
    };
  };
  try {
    const result = await listAllContacts();
    assert.deepEqual(result.data.map((row) => row.id), ['1', '2']);
    assert.equal(result.pages, 2);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testQualificationClaims() {
  const claimedSql = async (strings) => strings.join('').includes('RETURNING *')
    ? [{ id: 7, status: 'to_contact' }]
    : [];
  const claimed = await claimQualification(claimedSql, 7);
  assert.equal(claimed.lead.id, 7);
  assert.equal(claimed.completed, false);
  assert.ok(claimed.token);

  const conflictSql = async (strings) => strings.join('').includes('RETURNING *')
    ? []
    : [{ id: 8, status: 'to_contact', qualification_state: 'processing' }];
  assert.equal((await claimQualification(conflictSql, 8)).conflict, true);

  const completedSql = async (strings) => strings.join('').includes('RETURNING *')
    ? []
    : [{ id: 9, status: 'qualified', qualification_state: 'completed' }];
  assert.equal((await claimQualification(completedSql, 9)).completed, true);
}

function testImpersonationSession() {
  const admin = { id: 11, email: 'admin@example.com', name: 'Admin User', role: 'admin', ghlOwnerId: 'owner-admin' };
  const rep = { id: 22, email: 'rep@example.com', name: 'Rep User', role: 'rep', ghlOwnerId: 'owner-rep' };

  const token = createImpersonationSessionToken(rep, admin);
  const payload = verifySessionToken(token);

  assert.equal(payload.email, 'rep@example.com');
  assert.equal(payload.role, 'rep');
  assert.equal(payload.original.email, 'admin@example.com');
  assert.equal(payload.original.role, 'admin');
  assert.equal(payload.impersonating, true);
}

async function testRecordCallActionMetadata() {
  const queries = [];
  const sql = async (strings, ...values) => {
    queries.push({ text: strings.join(''), values });
    return [];
  };

  const result = await recordCall(sql, {
    lead: { id: 101, owner_id: 'rep-1', owner: 'Rep One' },
    direction: 'outbound',
    fromNumber: '+44 7700 111111',
    toNumber: '+44 7700 222222',
    agent: 'Rep One',
    durationSec: 74,
    outcome: 'Answered - interested',
    actionKey: 'answered_interested',
    actionLabel: 'Interested, book callback',
    recordingUrl: 'https://example.test/recording.mp3',
    callId: 'call-123',
    provider: 'manual',
    startedAt: '2026-07-31T09:00:00Z',
  });

  assert.equal(result.success, true);
  const insert = queries.find((entry) => entry.text.includes('INSERT INTO queue_events'));
  assert.ok(insert, 'expected a queue_events insert');
  const meta = JSON.parse(insert.values[6]);
  assert.equal(meta.actionKey, 'answered_interested');
  assert.equal(meta.actionLabel, 'Interested, book callback');
  assert.equal(meta.outcome, 'Answered - interested');
  assert.equal(meta.rawOutcome, 'Answered - interested');
}

function testEmailTemplates() {
  assert.equal(SUBSECTORS.length, 18);
  assert.equal(VARIANTS.length, 6);
  assert.equal(normalizeSubsector('Homeware'), 'Home Wear');
  assert.equal(normalizeSubsector('Unknown niche'), '');
  assert.equal(inferSubsector('private dentist practice'), 'Private Dentists');
  assert.equal(inferSubsector('luxury jewellery brand'), 'Luxury Accessories / Goods');

  const values = {
    FIRST_NAME: '<Alex>',
    COMPANY_NAME: 'Acme & Co',
    SENDER_NAME: 'Nick',
    SENDER_TITLE: 'Director',
    SENDER_EMAIL: 'nick@bettsandburton.com',
    BOOKING_URL: 'https://example.test/book',
  };
  for (const subsector of SUBSECTORS) {
    assert.ok(subsector.observation, `${subsector.label} needs an audience insight`);
    assert.ok(subsector.opportunity, `${subsector.label} needs a conversion opportunity`);
    assert.ok(subsector.caution, `${subsector.label} needs a copy caution`);
    for (const variant of VARIANTS) {
      const template = composeTemplate(subsector.label, variant.key);
      assert.ok(template?.subject && template?.body, `${subsector.label} / ${variant.key} is incomplete`);
      const resolved = composeResolvedTemplate(subsector.label, variant.key, values);
      assert.deepEqual(resolved.unresolved, [], `${subsector.label} / ${variant.key} has unresolved variables`);
      assert.match(resolved.body, /<Alex>/, 'personalization should remain plain editable text');
      assert.doesNotMatch(resolved.body, /guaranteed|risk-free|FCA approved/i, 'email copy must avoid prohibited claims');
    }
  }
}

async function run() {
  testImpersonationSession();
  const sample = [
    {
      id: '1',
      phone: '+44 7700 123456',
      companyName: 'Acme Ltd',
      callbackAt: '2026-08-02T10:00:00Z',
      priority: 'hot',
      companyTarget: false,
      disposition: '',
    },
    {
      id: '2',
      phone: '07700123456',
      companyName: 'Acme Ltd',
      callbackAt: '2026-08-02T11:00:00Z',
      priority: 'warm',
      companyTarget: false,
      disposition: '',
    },
    {
      id: '3',
      phone: '+44 7700 777888',
      companyName: 'Beta CIC',
      callbackAt: '2026-08-03T10:00:00Z',
      priority: 'cold',
      companyTarget: true,
      disposition: '',
    },
    {
      id: '4',
      phone: '+44 7700 777999',
      companyName: 'Beta CIC',
      callbackAt: '2026-08-03T09:00:00Z',
      priority: 'hot',
      companyTarget: false,
      disposition: '',
    },
    {
      id: '5',
      phone: '+44 7700 888000',
      companyName: 'Gamma Org',
      callbackAt: '2026-07-30T09:00:00Z',
      priority: 'hot',
      companyTarget: false,
      disposition: '',
    },
    {
      id: '6',
      phone: '+44 7700 999000',
      companyName: 'Delta Org',
      callbackAt: '2026-08-04T10:00:00Z',
      priority: 'hot',
      companyTarget: false,
      disposition: 'Covered by colleague',
    },
  ];

  assert.equal(futureScheduledCount(sample), 4, 'future callbacks should dedupe by merge key and honor active company targets');

  process.env.SESSION_SECRET = 'test-session-secret-with-sufficient-entropy';
  const token = createSessionToken({ id: 1, email: 'manager@example.test', name: 'Manager', role: 'manager' });
  assert.equal(verifySessionToken(token)?.role, 'manager');
  assert.equal(verifySessionToken(`${token}x`), null);

  process.env.TEST_WEBHOOK_SECRET = 'webhook-test-secret';
  assert.equal(verifyWebhookSecret({ headers: { 'x-test-secret': 'webhook-test-secret' } }, {
    envName: 'TEST_WEBHOOK_SECRET', headers: ['x-test-secret'],
  }).ok, true);
  assert.equal(verifyWebhookSecret({ headers: { 'x-test-secret': 'wrong' } }, {
    envName: 'TEST_WEBHOOK_SECRET', headers: ['x-test-secret'],
  }).status, 401);

  await assertAnonymousDenied(i3crmHandler, { method: 'GET', headers: {}, query: {} }, 401);
  await assertAnonymousDenied(reportsHandler, { method: 'POST', headers: {}, query: {} }, 401);
  await assertAnonymousDenied(webhookHandler, { method: 'POST', headers: {}, body: {} }, 410);
  await assertAnonymousDenied(ghlOpportunityWebhookHandler, { method: 'POST', headers: {}, body: {} }, 410);
  await assertAnonymousDenied(threeCxWebhookHandler, { method: 'POST', headers: {}, body: {} }, 410);

  process.env.ENABLE_GHL_INBOUND_WEBHOOKS = 'true';
  delete process.env.GHL_WEBHOOK_SECRET;
  await assertAnonymousDenied(webhookHandler, { method: 'POST', headers: {}, body: {} }, 503);
  await assertAnonymousDenied(ghlOpportunityWebhookHandler, { method: 'POST', headers: {}, body: {} }, 503);
  delete process.env.ENABLE_GHL_INBOUND_WEBHOOKS;

  process.env.ENABLE_3CX_CALL_WEBHOOKS = 'true';
  delete process.env.THREECX_WEBHOOK_SECRET;
  await assertAnonymousDenied(threeCxWebhookHandler, { method: 'POST', headers: {}, body: {} }, 503);
  delete process.env.ENABLE_3CX_CALL_WEBHOOKS;

  for (const [day, hours] of [['2026-03-29', 23], ['2026-10-25', 25]]) {
    const range = londonDayRange(day);
    assert.equal(londonDateKey(range.start), day);
    assert.equal((range.endExclusive - range.start) / 3_600_000, hours);
  }

  await testPagination();
  await testQualificationClaims();
  testEmailTemplates();
  await testRecordCallActionMetadata();
  console.log('All tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
