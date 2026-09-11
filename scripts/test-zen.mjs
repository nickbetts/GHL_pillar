import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../call-list-zen.html', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../call-list-zen-live.js', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../api/sq-auth.js', import.meta.url), 'utf8');
const profileApi = readFileSync(new URL('../api/rep-profile.js', import.meta.url), 'utf8');
const queueApi = readFileSync(new URL('../api/apollo-sales-queue.js', import.meta.url), 'utf8');
const db = readFileSync(new URL('../api/db.js', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
const salesApp = readFileSync(new URL('../sales-app.js', import.meta.url), 'utf8');
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
  assert.match(html, /class="sq is-loading"/);
  assert.match(html, /class="bread-loader"/);
  assert.match(html, /class="basket"/);
  assert.match(html, /animation:breadDrop 5s/);
  assert.doesNotMatch(html, /blaster/);
  assert.doesNotMatch(html, /ZEN_MIN_LOADING_MS/);
  assert.match(inline, /finishLoading/);
  assert.match(inline, /renderZenLoadFailure/);
});

test('Zen workspace backgrounds are stored in rep profiles', () => {
  assert.match(db, /ADD COLUMN IF NOT EXISTS zen_background/);
  assert.match(auth, /workspaceBackground/);
  assert.match(profileApi, /action === 'update-background'/);
  assert.match(inline, /action:'update-background'/);
  assert.match(adapter, /workspaceBackground: user\?\.workspaceBackground/);
  assert.doesNotMatch(inline, /localStorage/);
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
    SQ: { avatarInner: () => 'PA' },
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

test('Zen opportunity drawer uses local actions and meeting booking contract', () => {
  assert.match(html, /class="opp-row" onclick="openOpportunityModal/);
  assert.match(html, /Notes timeline/);
  assert.match(html, /Edit name/);
  assert.match(html, /callOpportunity/);
  assert.match(html, /mailto:\$\{esc\(contact\.email\)\}/);
  assert.match(html, /target="_blank" rel="noopener noreferrer">\$\{esc\(website\)\}/);
  assert.match(html, /Book next meeting/);
  assert.match(adapter, /action: 'book-opportunity-meeting'/);
  assert.match(html, /role="region" aria-labelledby="zenOpportunityTitle"/);
  assert.match(html, /id="contact"><div class="zen-modal" id="zenOpportunityModal"/);
  assert.match(html, /Closing checklist/);
  assert.match(html, /opportunity-open/);
  assert.match(inline, /pickChecklistQualification/);
  assert.match(html, /onclick="beginQualification\(\)">Qualify → Opportunity/);
  assert.match(html, /Back to qualification checklist/);
  assert.match(html, /Opportunity context notes/);
  assert.doesNotMatch(html, /function renderQualificationPanel/);
  assert.match(inline, /document\.body\.classList\.add\('contact-open'\)/);
  assert.match(inline, /document\.body\.classList\.remove\('contact-open'\)/);
  assert.match(html, /class="contact-grid"><div class="cell"><div class="k">Email/);
  assert.match(html, /class="contact-grid"><div class="cell"><div class="k">Email[\s\S]*Opportunity stage/);
  assert.match(adapter, /title: opportunity\.title/);
  assert.match(adapter, /companyWebsite: opportunity\.companyWebsite/);
  assert.match(html, /data-field="name"/);
  assert.match(html, /beginInlineEdit\('title'\)/);
  assert.match(html, /title="Lead controls" aria-label="Lead controls"/);
  assert.match(adapter, /source=taxonomy/);
  assert.match(html, /id="editLeadSector" onchange="updateSectorOptions\(\)"/);
  assert.match(html, /id="editLeadSubSector"/);
  assert.doesNotMatch(html, /id="editLeadPriority"/);
});

test('opportunity container is restored after the contact renderer clears it', () => {
  let mounted = null;
  const host = { replaceChildren(element) { mounted = element; } };
  const context = vm.createContext({
    document: {
      getElementById(id) { return id === 'contact' ? host : mounted; },
      createElement() { return { setAttribute(key, value) { this[key] = value; } }; },
    },
  });
  vm.runInContext(inline.slice(inline.indexOf('  function ensureOpportunityModal()'), inline.indexOf('  window.openOpportunityModal =')), context);
  const modal = context.ensureOpportunityModal();
  assert.equal(modal, mounted);
  assert.equal(modal.id, 'zenOpportunityModal');
  assert.equal(modal.role, 'region');
  assert.equal(modal['aria-labelledby'], 'zenOpportunityTitle');
  assert.equal(context.ensureOpportunityModal(), modal);
  mounted = null;
  assert.notEqual(context.ensureOpportunityModal(), modal);
});

test('opportunity stage fields follow real stages without hiding existing data', () => {
  const labels = ['proposal won', 'lost', 'meeting_attended'].map((stages) => ({
    dataset: { stages }, hidden: false, input: { value: '' },
    querySelector() { return this.input; },
  }));
  const stage = { value: 'qualified' };
  const details = { dataset: {}, hidden: false, querySelectorAll() { return labels; } };
  const context = vm.createContext({
    window: {}, document: {
      getElementById(id) { return id === 'zenOppStage' ? stage : null; },
      querySelectorAll(selector) { return selector.includes('fieldset') ? [details] : labels; },
    },
  });
  vm.runInContext(inline.slice(inline.indexOf('  window.updateOpportunityStageFields ='), inline.indexOf('  window.openOpportunityContact =')), context);
  context.window.updateOpportunityStageFields();
  assert.equal(details.hidden, true);
  stage.value = 'lost';
  context.window.updateOpportunityStageFields();
  assert.deepEqual(labels.map((label) => label.hidden), [true, false, true]);
  labels[1].input.value = 'Existing loss reason';
  stage.value = 'qualified';
  context.window.updateOpportunityStageFields();
  assert.equal(labels[1].hidden, false);
  assert.equal(details.hidden, false);
  assert.match(inline, /data-stages="lost"/);
  assert.doesNotMatch(inline, /data-stages="[^"]*closed_lost/);
});

test('meeting form opens and cancels without rebuilding or clearing either draft', () => {
  const form = { hidden: true };
  const button = { hidden: false, focus() {} };
  const date = { value: '2026-12-15T10:00', focus() {} };
  const context = vm.createContext({
    window: {}, opportunityMeetingOpen: false,
    document: {
      querySelector() { return form; },
      getElementById(id) { return id === 'zenBookMeeting' ? button : date; },
    },
    openOpportunityModal() { throw new Error('Must not rebuild the drawer'); },
  });
  vm.runInContext(inline.slice(inline.indexOf('  window.openOpportunityMeetingForm ='), inline.indexOf('  window.callOpportunity =')), context);
  context.window.openOpportunityMeetingForm();
  assert.equal(form.hidden, false);
  assert.equal(button.hidden, true);
  context.window.closeOpportunityMeetingForm();
  assert.equal(form.hidden, true);
  assert.equal(button.hidden, false);
  assert.equal(date.value, '2026-12-15T10:00');
});

test('contact shortcuts wait for note hydration and ignore navigation away', async () => {
  let resolveNotes;
  const events = [];
  const context = vm.createContext({
    window: {}, transitioning: false, contactOpenId: null, contactContext: 'queue',
    document: { body: { classList: { add() {} } } },
    STATE: { get() { return {}; }, hydrateNotes() { return new Promise((resolve) => { resolveNotes = resolve; }); }, toast() {} },
    renderStack() {}, renderChecklist() {}, renderContact() { events.push('render'); },
  });
  vm.runInContext(inline.slice(inline.indexOf('  function openContact('), inline.indexOf('  function finishClose(')), context);
  context.window.openContact('a', { onReady() { events.push('edit'); } });
  assert.deepEqual(events, ['render']);
  resolveNotes();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['render', 'render', 'edit']);
  events.length = 0;
  context.window.openContact('a', { onReady() { events.push('edit'); } });
  context.contactOpenId = 'b';
  resolveNotes();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['render']);
  assert.match(inline, /openContact\(id, \{ onReady:/);
});

test('drawer hierarchy and qualification selection semantics stay consistent', () => {
  assert.match(inline, /<\/div>\s*\$\{controlsPanel\}\s*<div class="dial-section-inline">/);
  assert.match(inline, /class="checklist \$\{isOpportunity \? '' : 'qualifying'\}/);
  assert.match(inline, /aria-pressed="\$\{selected\}"/);
  assert.match(inline, /data-multiple="\$\{question.type === 'multi'\}"/);
  assert.doesNotMatch(inline, /qualifyServicesDropdown|qualify-dropdown-panel/);
  assert.match(inline, /window.nextQualificationStep/);
  assert.match(inline, /selectOpportunityStage/);
  assert.match(inline, /data-stage=/);
  assert.match(inline, /zenOppMeetingScheduledAt/);
  assert.match(inline, /meetingScheduledAt: asIso\('#zenOppMeetingScheduledAt'\)/);
  assert.match(inline, /Add the meeting date before saving Meeting booked/);
  assert.match(inline, /setOpportunityLossReason/);
  assert.match(inline, /Qualification from call/);
  assert.match(inline, /Context notes/);
  assert.match(inline, /class="dial-section-inline"/);
  assert.ok(inline.indexOf('id="zenBookMeeting"') < inline.indexOf('${renderOpportunityControls(row)}'));
  assert.match(inline, /callOpportunity\('\$\{esc\(String\(row\.id\)\)\}', 'office'\)/);
  assert.match(inline, /SalesCall\.dialDirect/);
  assert.match(inline, /copyZenPhone/);
  assert.match(inline, /voidCurrentContact/);
  assert.match(inline, /Step \$\{qualificationStep \+ 1\} of \$\{total\}/);
  assert.match(inline, /\[activeQuestion\]\.map\(\(question\)/);
  assert.match(inline, /type === 'single' && state\[key\]/);
  assert.match(inline, /if \(!answered\) return;/);
  assert.match(inline, /Ready to qualify/);
  assert.match(inline, /qualification-handoff/);
  assert.match(inline, /meeting-fields/);
  assert.doesNotMatch(inline, /You're ready to close|specific times go in the note/);
  const footer = inline.slice(inline.indexOf('<div class="zen-modal-foot">'), inline.indexOf('    modal.hidden = false;'));
  assert.doesNotMatch(footer, /Notes timeline|Edit name|Open contact|Book next meeting|>Close</);
  assert.doesNotMatch(footer, /callOpportunity/);
});

test('Zen qualification answers are accepted by the queue API schema', () => {
  assert.match(queueApi, /decisionMaker: \['Decision-maker Status'\]/);
  assert.match(queueApi, /agencyExperience: \['Previous Agency Experience'\]/);
  assert.match(queueApi, /'AIO \/ Search Innovation'/);
  assert.match(queueApi, /'budget', 'timeline', 'painPoint', 'decisionMaker'/);
  assert.match(queueApi, /const agencyExperience/);
  assert.match(queueApi, /source: 'qualification'/);
});

test('Zen is the default call-list route and backward stages are role-gated', () => {
  assert.match(vercel, /"source": "\/call-list",\s*"destination": "\/call-list-zen"/);
  assert.match(salesApp, /label: 'Call List 2\.0', href: '\/call-list-zen'/);
  assert.match(inline, /Only admins can move an opportunity backwards/);
  assert.match(inline, /window\.SQ\?\.caps\?\.isAdmin/);
});

test('completed contact outcomes advance within the active queue context', () => {
  assert.match(inline, /const nextLead = navigationPool\(\)\[0\] \|\| null/);
  assert.match(inline, /if \(nextLead\) \{\s*switchContact\(nextLead\.id\)/);
});

test('scheduled meetings take precedence over stored opportunity next steps', () => {
  assert.match(inline, /function opportunityNextStep\(id, opportunity, contact = null\)/);
  assert.match(inline, /filter\(\(meeting\) => \(meeting\.status \|\| 'scheduled'\) === 'scheduled'\)/);
  assert.match(inline, /return `Meeting booked\$\{when \? ` · \$\{fmtDateTime\(when\)\}` : ''\}`/);
  assert.match(inline, /<span>Previous<\/span>/);
  assert.match(inline, /<span>Next<\/span>/);
});

test('queue and callback overview lists use bounded pagination', () => {
  assert.match(inline, /const QUEUE_PAGE_SIZE = 5/);
  assert.match(inline, /const CALLBACK_PAGE_SIZE = 5/);
  assert.match(html, /id="queuePager"/);
  assert.match(inline, /setQueuePage\(\$\{queuePage - 1\}\)/);
  assert.match(inline, /setCallbackPage\(\$\{callbackPage - 1\}\)/);
  assert.doesNotMatch(html, /stackSub/);
  assert.doesNotMatch(inline.slice(inline.indexOf('function renderStack()'), inline.indexOf('const OPPORTUNITY_VISIBLE_STAGES')), /class="pos"/);
  assert.match(html, /<\/aside>\s*<section class="oppcard" id="oppcard">/);
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
  await state.setOpportunityStage('lead-1', 'scoping', { dealType: 'Recurring', mrrValue: 2500, nextStepSummary: 'Send scope' });
  await state.updateOpportunityFollowup('lead-1', 'Book discovery', '2026-12-17T10:00:00.000Z');
  await state.logMeetingOutcome('lead-1', 'attended', 7, '2026-12-18T10:00:00.000Z');
  assert.deepEqual(requests.map((request) => request.action), ['qualify', 'log-call', 'set-lead-name', 'set-sector', 'priority', 'status', 'reassign', 'disposition', 'set-opportunity-stage', 'set-opportunity-followup', 'log-meeting-outcome']);
  assert.deepEqual(requests[0].answers, { services: ['SEO'] });
  assert.equal(requests[1].setStatus, 'to_call_back');
  assert.equal(requests[3].subSector, 'Dental');
  assert.equal(requests[7].callbackAt, '2026-12-16T10:00:00.000Z');
  assert.equal(requests[8].stage, 'scoping');
  assert.equal(requests[9].nextStepSummary, 'Book discovery');
  assert.equal(requests[10].meetingId, 7);
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