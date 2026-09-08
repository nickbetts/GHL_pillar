import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../call-list-zen.html', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../call-list-zen-live.js', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).filter((text) => text.trim());
const inline = scripts.at(-1);

function createState(fetch = async () => { throw new Error('Unexpected request'); }) {
  const context = vm.createContext({ fetch });
  context.window = context;
  vm.runInContext(adapter, context);
  context.STATE.toast = () => {};
  return context;
}

function createActions() {
  const context = vm.createContext({
    window: { addEventListener() {} }, STATE: { toast() {} },
    renderContact() {}, contactOpenId: 'a', transitioning: false,
  });
  vm.runInContext(inline.slice(inline.indexOf('  const noteDrafts ='), inline.indexOf('  const CHECK_ITEMS')), context);
  return context;
}

test('Zen scripts parse', () => {
  scripts.forEach((script) => new vm.Script(script));
  new vm.Script(adapter);
});

test('callback drafts remain associated with their contact after a rejected write', async () => {
  const context = createActions();
  context.window.updateCallbackDraft('a', '2026-12-15');
  context.window.updateCallbackDraft('b', '2026-12-16');
  context.operation = async () => { throw new Error('Rejected'); };
  await vm.runInContext('runContactAction(operation)', context);
  assert.equal(vm.runInContext("callbackDrafts.get('a')", context), '2026-12-15');
  assert.equal(vm.runInContext("callbackDrafts.get('b')", context), '2026-12-16');
  assert.match(inline, /callbackDrafts.get\(String\(l.id\)\)/);
});

test('initial-load retry initializes calling exactly once and restores rep identity', async () => {
  let initializations = 0;
  const elements = Object.fromEntries(['zenAvatar', 'zenRepName'].map((id) => [id, { style: {} }]));
  const context = vm.createContext({
    window: {}, STATE: { refresh: async () => {}, toast() {} },
    SalesCall: { init: async () => { initializations++; } },
    MOCK: { rep: { initials: 'PA', avatarColor: '#123456', name: 'Preview Admin' } },
    document: { getElementById: (id) => elements[id] },
    renderStack() {}, renderCallbacksHero() {}, renderOpportunities() {}, renderTopKpis() {},
  });
  vm.runInContext(inline.slice(inline.indexOf('  async function refreshZen()'), inline.indexOf('  SQ.init(')), context);
  await context.window.refreshZen();
  await context.window.refreshZen();
  assert.equal(initializations, 1);
  assert.equal(elements.zenRepName.textContent, 'Preview Admin');
});

test('opportunity links have a matching detail-route handler', () => {
  const opportunities = readFileSync(new URL('../opportunities.html', import.meta.url), 'utf8');
  assert.match(inline, /openOpportunityModal/);
  assert.match(opportunities, /\['meeting', 'detail'\]\.includes\(deepOpen\)/);
  for (const match of opportunities.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
});

test('Zen mutation methods keep existing API action contracts', async () => {
  const requests = [];
  const { STATE: state, MOCK: mock } = createState(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { json: async () => ({ success: true }) };
  });
  mock.rep.id = 'owner';
  mock.leads = [{ id: 'lead-1', ownerId: 'owner' }];
  state.refresh = async () => {};
  await state.qualify('lead-1', { services: ['SEO'] }, 'qualifying note');
  await state.saveFollowup('lead-1', 'Gatekeeper', 'to_call_back', 'Gatekeeper', '2026-12-15T10:00:00.000Z', 'call note');
  await state.updateLead('lead-1', { name: 'New Name', title: 'Director', sector: 'Health', subSector: 'Dental', priority: 'hot', status: 'to_contact' });
  await state.reassign('lead-1', 'rep-2');
  await state.updateDisposition('lead-1', 'Callback booked', '2026-12-16T10:00:00.000Z');
  assert.deepEqual(requests.map((request) => request.action), ['qualify', 'log-call', 'set-lead-name', 'set-sector', 'priority', 'status', 'reassign', 'disposition']);
  assert.deepEqual(requests[0].answers, { services: ['SEO'] });
  assert.equal(requests[1].setStatus, 'to_call_back');
  assert.equal(requests[3].subSector, 'Dental');
  assert.equal(requests[7].callbackAt, '2026-12-16T10:00:00.000Z');
});

test('pending writes are deduplicated and cannot clear newer drafts or navigate another contact', async () => {
  const context = createActions();
  let resolveWrite;
  let writes = 0;
  let navigations = 0;
  context.operation = async () => { writes++; await new Promise((resolve) => { resolveWrite = resolve; }); };
  context.onSaved = () => { navigations++; };
  context.window.updateNoteDraft('a', 'Original');
  const pending = vm.runInContext('runContactAction(operation, {clearDraft:true, onSaved})', context);
  await vm.runInContext('runContactAction(operation, {clearDraft:true, onSaved})', context);
  assert.equal(writes, 1);
  context.window.updateNoteDraft('a', 'Newer draft');
  context.contactOpenId = 'b';
  resolveWrite();
  await pending;
  assert.equal(navigations, 0);
  assert.equal(vm.runInContext("noteDrafts.get('a')", context), 'Newer draft');
  assert.equal(vm.runInContext('pendingContacts.size', context), 0);
});

test('successful notes clear only submitted drafts and failures preserve drafts', async () => {
  const context = createActions();
  context.operation = async () => {};
  context.window.updateNoteDraft('a', 'Saved');
  await vm.runInContext('runContactAction(operation, {clearDraft:true})', context);
  assert.equal(vm.runInContext("noteDrafts.has('a')", context), false);
  context.window.updateNoteDraft('a', 'Unsaved');
  context.operation = async () => { throw new Error('Rejected'); };
  await vm.runInContext('runContactAction(operation, {clearDraft:true})', context);
  assert.equal(vm.runInContext("noteDrafts.get('a')", context), 'Unsaved');
});

test('queue eligibility respects retries, status and callback precedence', () => {
  const { STATE: state, MOCK: mock } = createState();
  const today = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  mock.leads = [
    { id: 'retry-today', status: 'no_answer', lastTouchAt: today },
    { id: 'retry-old', status: 'no_answer', lastTouchAt: yesterday },
    { id: 'callback', status: 'to_contact', callbackAt: today },
    { id: 'future', status: 'to_call_back', callbackAt: tomorrow },
    { id: 'qualified', status: 'qualified', callbackAt: yesterday },
    { id: 'dead', status: 'not_interested', callbackAt: yesterday },
    { id: 'ready', status: 'to_contact' },
    { id: 'locked', status: 'to_contact', companyLocked: true },
    { id: 'covered', status: 'to_contact', disposition: 'Covered by colleague' },
    { id: 'email', status: 'contacted', disposition: 'Send email' },
  ].map((lead) => ({ ...lead, phone: '01234567890' }));
  mock.leads.push({ id: 'no-phone', status: 'to_contact' });
  assert.deepEqual(Array.from(state.activeLeads(), (lead) => lead.id).sort(), ['ready', 'retry-old']);
  assert.deepEqual(Array.from(state.dueCallbacks(), (lead) => lead.id), ['callback']);
  assert.equal(state.londonDay('2026-09-08T23:30:00Z'), '2026-09-09');
  assert.equal(state.londonDay('2026-12-08T23:30:00Z'), '2026-12-08');
});

test('missing ownership never requests an unscoped queue', async () => {
  const { STATE: state } = createState();
  await assert.rejects(state.refresh(), /no rep mapping/);
});

test('a failed report retains known figures and marks them unavailable', async () => {
  const { STATE: state, MOCK: mock } = createState(async (url) => ({
    ok: !url.includes('opportunities'),
    json: async () => ({ success: true, contacts: [{ id: 'a', ownerId: 'owner' }, { id: 'b', ownerId: 'other' }] }),
  }));
  mock.rep.id = 'owner';
  mock.opportunities = [{ id: 'known' }];
  state.counters.dialed = 7;
  await state.refresh();
  assert.match(state.reportError, /unavailable/);
  assert.equal(state.counters.dialed, 7);
  assert.equal(mock.opportunities[0].id, 'known');
  assert.equal(mock.leads.length, 1);
});

test('successful write followed by failed refresh stays successful', async () => {
  const { STATE: state } = createState();
  state.refresh = async () => { throw new Error('Offline'); };
  const notices = [];
  state.toast = (message) => notices.push(message);
  await state.refreshAfterSave('a');
  assert.equal(state.worked.has('a'), true);
  assert.match(notices[0], /Changes saved/);
});

test('note save increments the badge even if timeline reload fails', async () => {
  const { STATE: state, MOCK: mock } = createState(async (_url, options) => ({
    json: async () => ({ success: JSON.parse(options.body).action === 'add-lead-note' }),
  }));
  mock.leads = [{ id: 1, noteCount: 2 }];
  await state.addNote(1, 'New note');
  assert.equal(mock.leads[0].noteCount, 3);
});