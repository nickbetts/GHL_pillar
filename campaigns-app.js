import { GENERAL_VARIANTS, VARIANTS, SUBSECTORS, composeTemplate } from '/email-template-data.js';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

const KNOWN_VARS = ['FIRST_NAME', 'COMPANY_NAME', 'SENDER_NAME', 'SENDER_TITLE', 'SENDER_EMAIL', 'BOOKING_URL', 'SIGNATURE', 'SIGNATURE_HTML'];
const INSERTABLE_VARS = [
  ['FIRST_NAME', 'First name'], ['COMPANY_NAME', 'Company name'], ['BOOKING_URL', 'Booking link'],
  ['SENDER_NAME', 'Sender name'], ['SENDER_TITLE', 'Sender title'], ['SENDER_EMAIL', 'Sender email'], ['SIGNATURE', 'Signature'],
];
const SPAM_WORDS = ['free', 'guarantee', 'guaranteed', 'act now', 'limited time', 'click here', 'buy now', 'risk-free', 'risk free', '100%', 'winner', 'urgent', 'no obligation', 'cash', 'cheap', 'special promotion', 'double your', 'earn money'];
const DEFAULT_BOOKING_URL = 'https://click.i3media.net/growth';
const BUSINESS_START = 9;
const BUSINESS_END = 17;
const ICON = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
};
const TABS = [['sequence', 'Sequence'], ['audience', 'Audience'], ['contacts', 'Contacts'], ['analytics', 'Analytics'], ['settings', 'Settings']];
const RULE_VALUES = {
  queue_status: [['to_contact', 'New / To contact'], ['to_call_back', 'Callback scheduled'], ['wants_more_info', 'Wants more info'], ['no_answer', 'No answer'], ['qualified', 'Qualified'], ['not_interested', 'Not interested']],
  sector: [['General', 'General'], ['Professional Services', 'Professional Services'], ['E-Commerce', 'E-Commerce'], ['Security', 'Security'], ['Transport & Logistics', 'Transport & Logistics'], ['Healthcare', 'Healthcare']],
  sub_sector: [['All sectors', 'All sectors'], ...SUBSECTORS.filter((item) => item.label !== 'All sectors').map((item) => [item.label, item.label])],
  disposition: ['No answer', 'Left voicemail', 'Callback booked', 'Gatekeeper', 'Wrong number', 'Interested', 'Not interested', 'Covered by colleague', 'Already worked this company', 'Company target'].map((value) => [value, value]),
};
const TRIGGER_FIELDS = [['queue_status', 'Lead status'], ['sector', 'Sector'], ['sub_sector', 'Sub-sector']];
const STOP_FIELDS = [['disposition', 'Disposition']];
const ENROLLMENT_STATUSES = ['active', 'paused', 'completed', 'stopped'];

const state = {
  campaigns: [], filter: 'all', query: '',
  campaign: null, draft: null, rules: null, report: null, enrollments: null,
  tab: 'sequence', openStep: 0, dirty: false, dirtyParts: new Set(),
  senders: [], sample: { firstName: 'Alex', companyName: 'Acme Ltd', senderEmail: '' },
  device: 'desktop', lastTestTo: '',
  contactFilter: 'all', contactQuery: '', activityQuery: '',
};

// ── Helpers ─────────────────────────────────────────────────────────────
async function api(body) {
  const response = await fetch('/api/campaigns', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'same-origin', body:JSON.stringify(body) });
  const data = await response.json().catch(() => ({ success:false, error:'Request failed' }));
  if (response.status === 401) { location.href = '/login?next=/campaigns'; throw new Error('Not signed in'); }
  if (!response.ok || !data.success) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(text, tone = 'ok') {
  const node = document.createElement('div');
  node.className = `toast ${tone}`;
  node.textContent = text;
  $('toastHost').appendChild(node);
  setTimeout(() => node.remove(), 3200);
}
function relTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '—';
  const future = diff < 0;
  const mins = Math.round(Math.abs(diff) / 60000);
  const text = mins < 1 ? 'just now' : mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  if (text === 'just now') return text;
  return future ? `in ${text}` : `${text} ago`;
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : '—');
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
function stepTime(step) { return `${String(step.sendHour ?? 9).padStart(2, '0')}:${String(step.sendMinute ?? 0).padStart(2, '0')}`; }
function stepDays(steps) {
  let day = 0;
  return steps.map((step, index) => { if (index > 0) day += Number(step.waitDays) || 0; return day; });
}
function newStep(overrides = {}) {
  return { stepName: 'New email', subjectTemplate: '', bodyTemplate: 'Hi {{FIRST_NAME}},\n\n\n\n{{SIGNATURE}}', waitDays: 3, sendHour: 9, sendMinute: 0, sendTimezone: 'Europe/London', active: true, ...overrides };
}
function templateStep(subsector, variant, index = 0) {
  const template = composeTemplate(subsector, variant.key);
  return newStep({ stepName: variant.label, subjectTemplate: template?.subject || '', bodyTemplate: template?.body || '', waitDays: index === 0 ? 0 : index === 1 ? 2 : 3 });
}
function starterSequence() { return GENERAL_VARIANTS.map((variant, index) => templateStep('All sectors', variant, index)); }
const stepsLocked = () => !state.campaign || ['active', 'archived'].includes(state.campaign.status) || Boolean(state.report?.activity?.length);
const archived = () => state.campaign?.status === 'archived';

// ── Rendering email like the server does (cron-send-campaign-steps messageHtml) ──
function sampleValues() {
  const sender = state.senders.find((item) => item.email === state.sample.senderEmail) || state.senders[0] || {};
  const senderName = sender.displayName || sender.name || 'Your name';
  const signature = sender.signature || ['Best,', senderName, sender.title || '', sender.email || ''].filter(Boolean).join('\n');
  let booking = state.draft?.bookingUrl || DEFAULT_BOOKING_URL;
  try {
    const url = new URL(booking);
    if (state.sample.firstName) url.searchParams.set('firstName', state.sample.firstName);
    if (state.sample.companyName) url.searchParams.set('companyName', state.sample.companyName);
    booking = url.toString();
  } catch { /* keep raw */ }
  return {
    FIRST_NAME: state.sample.firstName, COMPANY_NAME: state.sample.companyName,
    SENDER_NAME: senderName, SENDER_TITLE: sender.title || '', SENDER_EMAIL: sender.email || 'you@i3media.net',
    BOOKING_URL: booking, SIGNATURE: signature, SIGNATURE_HTML: esc(signature).replace(/\n/g, '<br>'),
  };
}
function resolveVars(text, values) { return String(text || '').replace(/\{\{([A-Z_]+)\}\}/g, (_m, key) => (values[key] == null ? '' : String(values[key]))); }
function renderEmailHtml(step) {
  const values = sampleValues();
  const body = resolveVars(step.bodyTemplate, values).trim();
  const withoutSig = body.endsWith(values.SIGNATURE) ? body.slice(0, -values.SIGNATURE.length).trimEnd() : body;
  const html = esc(withoutSig)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  return { subject: resolveVars(step.subjectTemplate, values), html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827">${html.replace(/\n/g, '<br>')}<br><div style="margin-top:14px">${values.SIGNATURE_HTML}</div></div>`, values };
}

// ── Content health (Lemlist/Lavender-style pre-send checks) ─────────────
function stepChecks(step) {
  const checks = [];
  const subject = String(step.subjectTemplate || '');
  const body = String(step.bodyTemplate || '');
  const all = `${subject}\n${body}`;
  const tokens = [...all.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((match) => match[1]);
  const unknown = [...new Set(tokens.filter((token) => !KNOWN_VARS.includes(token)))];
  if (!subject.trim()) checks.push(['bad', 'Subject line is empty.']);
  if (!body.trim()) checks.push(['bad', 'Email body is empty.']);
  if (!String(step.stepName || '').trim()) checks.push(['bad', 'Give this step a name.']);
  unknown.forEach((token) => checks.push(['bad', /^[A-Z_]+$/.test(token) ? `{{${token}}} isn't a known variable — it will send as blank.` : `{{${token}}} won't be replaced — variables must be UPPERCASE, e.g. {{FIRST_NAME}}.`]));
  if (body.includes('{{SIGNATURE_HTML}}')) checks.push(['warn', 'Use {{SIGNATURE}} in the body — {{SIGNATURE_HTML}} would show raw HTML tags.']);
  if (subject.length > 60) checks.push(['warn', `Subject is ${subject.length} characters — under 60 avoids truncation on mobile.`]);
  const words = body.replace(/\{\{[^}]*\}\}/g, 'x').split(/\s+/).filter(Boolean).length;
  if (words > 200) checks.push(['warn', `${words} words — cold emails under 125 words get more replies.`]);
  const lower = all.toLowerCase();
  const spam = SPAM_WORDS.filter((word) => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(lower));
  if (spam.length) checks.push(['warn', `Spam-trigger words: ${spam.slice(0, 4).map((word) => `“${word}”`).join(', ')}.`]);
  if (/!{2,}/.test(all)) checks.push(['warn', 'Multiple exclamation marks can trip spam filters.']);
  const caps = (all.replace(/\{\{[^}]*\}\}/g, '').match(/\b[A-Z]{4,}\b/g) || []).length;
  if (caps >= 3) checks.push(['warn', 'Several ALL-CAPS words — reads as shouting and hurts deliverability.']);
  const links = (body.match(/https?:\/\/|\{\{BOOKING_URL\}\}/g) || []).length;
  if (links > 3) checks.push(['warn', `${links} links — keep to 1–2 to protect deliverability.`]);
  if (!all.includes('{{FIRST_NAME}}') && !all.includes('{{COMPANY_NAME}}')) checks.push(['info', 'No personalisation — add {{FIRST_NAME}} or {{COMPANY_NAME}}.']);
  if (!body.includes('{{BOOKING_URL}}') && !/https?:\/\//.test(body)) checks.push(['info', 'No call-to-action link — consider adding {{BOOKING_URL}}.']);
  if (body.includes('{{SIGNATURE}}') && !body.trim().endsWith('{{SIGNATURE}}')) checks.push(['warn', 'The signature is added automatically at the end — {{SIGNATURE}} mid-email will appear twice.']);
  if ((Number(step.sendHour) || 0) < BUSINESS_START || (Number(step.sendHour) || 0) >= BUSINESS_END) checks.push(['warn', 'Sends are limited to 09:00–17:00 UK — this time will be moved into business hours.']);
  const score = checks.reduce((sum, [tone]) => sum + (tone === 'bad' ? 40 : tone === 'warn' ? 12 : 4), 0);
  const grade = checks.some(([tone]) => tone === 'bad') ? 'bad' : score >= 24 ? 'ok' : 'good';
  return { checks, words, grade, label: grade === 'bad' ? 'Needs fixes' : grade === 'ok' ? 'Could improve' : 'Looks good' };
}

// ── Campaign list ───────────────────────────────────────────────────────
function renderList() {
  const counts = { all: state.campaigns.length, active: 0, draft: 0, paused: 0 };
  state.campaigns.forEach((campaign) => { if (counts[campaign.status] !== undefined) counts[campaign.status] += 1; });
  $('campaignFilters').innerHTML = [['all', 'All'], ['active', 'Active'], ['draft', 'Draft'], ['paused', 'Paused']]
    .map(([key, label]) => `<button type="button" role="tab" aria-selected="${state.filter === key}" class="${state.filter === key ? 'on' : ''}" data-filter="${key}">${label} <span class="n">${counts[key]}</span></button>`).join('');
  const query = state.query.trim().toLowerCase();
  const items = state.campaigns.filter((campaign) => (state.filter === 'all' || campaign.status === state.filter) && (!query || campaign.name.toLowerCase().includes(query)));
  $('campaignList').innerHTML = items.length ? items.map((campaign) => `
    <button type="button" class="cmp-item ${state.campaign?.id === campaign.id ? 'on' : ''}" data-id="${esc(campaign.id)}">
      <span class="dot ${esc(campaign.status)}" title="${esc(campaign.status)}"></span>
      <span><span class="nm">${esc(campaign.name)}</span><span class="mt">${plural(campaign.stepCount || 0, 'email')} · ${esc(campaign.activeCount ?? 0)} active of ${esc(campaign.enrollmentCount || 0)} · ${esc(relTime(campaign.updatedAt))}</span></span>
    </button>`).join('') : `<div class="cmp-empty">${state.campaigns.length ? 'No campaigns match.' : 'No campaigns yet.'}</div>`;
}
async function loadCampaigns() {
  const data = await api({ action:'list' });
  state.campaigns = data.campaigns || [];
  renderList();
}

// ── Workspace ───────────────────────────────────────────────────────────
function confirmDiscard() { return !state.dirty || confirm('You have unsaved changes. Discard them?'); }
function markDirty(part) { state.dirtyParts.add(part); setDirty(true); }
function clearDirty() { state.dirtyParts.clear(); setDirty(false); }
function setDirty(value = true) {
  state.dirty = value;
  const save = $('saveBtn');
  if (save) { save.disabled = !value || archived(); save.classList.toggle('ghost', !value); }
  const flag = $('dirtyFlag');
  if (flag) flag.hidden = !value;
}
async function selectCampaign(id, { tab } = {}) {
  if (String(state.campaign?.id) !== String(id) && !confirmDiscard()) return;
  const data = await api({ action:'get', id });
  state.campaign = data.campaign;
  state.draft = { name: data.campaign.name, description: data.campaign.description || '', bookingUrl: data.campaign.bookingUrl || '', steps: data.campaign.steps.map((step) => ({ ...step })) };
  state.rules = null; state.report = null; state.enrollments = null;
  state.openStep = 0; state.tab = tab || state.tab || 'sequence';
  state.dirty = false; state.dirtyParts.clear();
  history.replaceState(null, '', `/campaigns?id=${encodeURIComponent(id)}${state.tab !== 'sequence' ? `&tab=${state.tab}` : ''}`);
  renderList();
  renderWorkspace();
  Promise.allSettled([loadRules(), loadReport(), loadEnrollments()]).then(() => { if (String(state.campaign?.id) === String(id)) { renderHeaderMeta(); renderTabs(); if (state.tab !== 'sequence' || stepsLocked()) renderTab(); } });
}
function renderWorkspace() {
  const campaign = state.campaign;
  if (!campaign) {
    $('workspace').innerHTML = `<div class="ws-empty"><div class="ws-empty-card"><span class="ic">${ICON.mail}</span><h2>Build an email sequence</h2><p>Create multi-step campaigns with automatic waits, audience rules and stop conditions. Pick a campaign on the left or start a new one.</p><button type="button" data-act="new">${ICON.plus}New campaign</button></div></div>`;
    return;
  }
  const status = campaign.status;
  const primary = status === 'active'
    ? `<button type="button" class="ghost" data-act="pause">Pause</button>`
    : `<button type="button" class="go" data-act="activate" ${archived() ? 'disabled' : ''}>${ICON.send}${status === 'paused' ? 'Resume' : 'Activate'}</button>`;
  $('workspace').innerHTML = `
    <div class="ws-head">
      <div class="ws-title">
        <input class="ws-name" id="campaignName" value="${esc(state.draft.name)}" aria-label="Campaign name" maxlength="160" ${archived() ? 'disabled' : ''} />
        <div class="ws-meta" id="wsMeta"></div>
      </div>
      <div class="ws-actions">
        <button type="button" class="ghost" id="saveBtn" data-act="save" disabled title="Save (⌘S)">Save</button>
        ${primary}
        <details class="menu"><summary aria-label="More actions">${ICON.more}</summary><div class="menu-list">
          <button type="button" data-act="clone">${ICON.copy}Duplicate campaign</button>
          <button type="button" data-act="tab" data-tab="analytics">View analytics</button>
          <button type="button" class="danger" data-act="archive" ${archived() ? 'disabled' : ''}>${ICON.trash}Archive campaign</button>
        </div></details>
      </div>
    </div>
    <nav class="ws-tabs" role="tablist" id="wsTabs"></nav>
    <div class="ws-body" id="tabBody"></div>`;
  renderHeaderMeta();
  renderTabs();
  renderTab();
}
function renderHeaderMeta() {
  const host = $('wsMeta');
  if (!host || !state.campaign) return;
  const steps = state.draft.steps;
  const days = stepDays(steps);
  const enrolled = (state.report?.enrollmentStatuses || []).reduce((sum, row) => sum + row.count, 0);
  host.innerHTML = `<span class="status-pill ${esc(state.campaign.status)}">${esc(state.campaign.status)}</span>
    <span>${plural(steps.length, 'email')}${steps.length ? ` over ${plural(days[days.length - 1] || 0, 'day')}` : ''}</span>
    <span>${plural(enrolled, 'contact')} enrolled</span>
    <span>Updated ${esc(relTime(state.campaign.updatedAt))}</span>
    <span class="dirty" id="dirtyFlag" ${state.dirty ? '' : 'hidden'}>Unsaved changes</span>`;
  setDirty(state.dirty);
}
function renderTabs() {
  const host = $('wsTabs');
  if (!host) return;
  const contactCount = state.enrollments ? state.enrollments.length : null;
  host.innerHTML = TABS.map(([key, label]) => `<button type="button" role="tab" aria-selected="${state.tab === key}" class="${state.tab === key ? 'on' : ''}" data-tab="${key}">${label}${key === 'contacts' && contactCount !== null ? ` <span class="n">${contactCount}</span>` : ''}</button>`).join('');
}
function setTab(tab) {
  state.tab = tab;
  history.replaceState(null, '', `/campaigns?id=${encodeURIComponent(state.campaign.id)}${tab !== 'sequence' ? `&tab=${tab}` : ''}`);
  renderTabs();
  renderTab();
}
function renderTab() {
  const host = $('tabBody');
  if (!host) return;
  if (state.tab === 'sequence') host.innerHTML = sequenceHtml();
  else if (state.tab === 'audience') host.innerHTML = audienceHtml();
  else if (state.tab === 'contacts') host.innerHTML = contactsHtml();
  else if (state.tab === 'analytics') host.innerHTML = analyticsHtml();
  else host.innerHTML = settingsHtml();
  if (state.tab === 'sequence') renderPreview();
  if (state.tab === 'audience') mountRules();
}

// ── Sequence tab ────────────────────────────────────────────────────────
function sequenceHtml() {
  const steps = state.draft.steps;
  const locked = stepsLocked();
  const days = stepDays(steps);
  const banner = archived()
    ? `<div class="banner">${ICON.info}<span>This campaign is archived and can no longer be edited. Duplicate it to reuse the sequence.</span></div>`
    : state.campaign.status === 'active'
      ? `<div class="banner warn">${ICON.info}<span>This campaign is live, so its emails are read-only. Pause it to make changes.</span></div>`
      : state.report?.activity?.length
        ? `<div class="banner warn">${ICON.info}<span>Emails in this sequence have already been sent, so steps are locked to keep reporting accurate. Duplicate the campaign to change the copy.</span></div>`
        : '';
  if (!steps.length) {
    return `${banner}<div class="seq-empty"><h3>No emails yet</h3><p>Start from the proven Growth sequence, pick a template, or write your own.</p><div class="seq-add"><button type="button" data-act="starter" ${locked ? 'disabled' : ''}>Use Growth sequence (6 emails)</button><button type="button" class="ghost" data-act="add-template" ${locked ? 'disabled' : ''}>Pick a template</button><button type="button" class="ghost" data-act="add-blank" ${locked ? 'disabled' : ''}>${ICON.plus}Blank email</button></div></div>`;
  }
  const totalWarnings = steps.reduce((sum, step) => sum + stepChecks(step).checks.filter(([tone]) => tone !== 'info').length, 0);
  return `${banner}
    <div class="seq-layout">
      <div>
        <div class="seq-summary"><span><strong>${plural(steps.length, 'email')}</strong> over ${plural(days[days.length - 1] || 0, 'day')}</span><span>Sends Mon–Fri, 09:00–17:00 UK time</span><span>${totalWarnings ? `${plural(totalWarnings, 'suggestion')} to review` : 'All emails pass content checks'}</span></div>
        <div id="steps">${steps.map((step, index) => `${index ? waitHtml(step, index, days[index], locked) : ''}${stepHtml(step, index, days[index], locked)}`).join('')}</div>
        ${locked ? '' : `<div class="seq-add"><button type="button" class="ghost" data-act="add-blank">${ICON.plus}Add email</button><button type="button" class="ghost" data-act="add-template">Add from template</button></div>`}
      </div>
      <aside class="seq-preview" id="preview"></aside>
    </div>`;
}
function waitHtml(step, index, day, locked) {
  return `<div class="seq-wait">${ICON.clock}Wait <input type="number" min="0" max="365" value="${esc(step.waitDays)}" data-wait="${index}" aria-label="Days to wait before email ${index + 1}" ${locked ? 'disabled' : ''}/> days, then send <span class="day">· Day ${day}</span></div>`;
}
function stepHtml(step, index, day, locked) {
  const health = stepChecks(step);
  const open = state.openStep === index;
  const count = state.draft.steps.length;
  return `<article class="seq-step ${open ? 'open' : ''}" data-index="${index}">
    <header class="seq-step-head" data-toggle="${index}">
      <span class="seq-num">${index + 1}</span>
      <span class="seq-step-title"><strong>${esc(step.stepName || 'Untitled email')}</strong><span>Day ${day} · ${esc(stepTime(step))} · ${esc(step.subjectTemplate || 'No subject')}</span></span>
      <span class="health ${health.grade}">${health.label}</span>
      <span class="seq-tools">${locked ? '' : `
        <button type="button" class="ghost" data-move="${index}" data-dir="-1" title="Move up" aria-label="Move email ${index + 1} up" ${index === 0 ? 'disabled' : ''}>${ICON.up}</button>
        <button type="button" class="ghost" data-move="${index}" data-dir="1" title="Move down" aria-label="Move email ${index + 1} down" ${index === count - 1 ? 'disabled' : ''}>${ICON.down}</button>
        <button type="button" class="ghost" data-dup="${index}" title="Duplicate" aria-label="Duplicate email ${index + 1}">${ICON.copy}</button>
        <button type="button" class="ghost del" data-del="${index}" title="Delete" aria-label="Delete email ${index + 1}">${ICON.trash}</button>`}</span>
      <span class="chev">${ICON.down}</span>
    </header>
    <div class="seq-step-body">
      <div class="field-row">
        <label class="field">Step name<input data-f="stepName" data-i="${index}" value="${esc(step.stepName)}" maxlength="160" ${locked ? 'disabled' : ''}/></label>
        <label class="field">Send time (UK)<input type="time" min="09:00" max="16:59" data-f="sendTime" data-i="${index}" value="${esc(stepTime(step))}" ${locked ? 'disabled' : ''}/></label>
      </div>
      <label class="field">Subject line
        <span class="subject-wrap"><input data-f="subjectTemplate" data-i="${index}" value="${esc(step.subjectTemplate)}" maxlength="500" placeholder="e.g. A few ideas for {{COMPANY_NAME}}" ${locked ? 'disabled' : ''}/>${locked ? '' : `<select data-insert="subjectTemplate" data-i="${index}" aria-label="Insert variable into subject"><option value="">+ Variable</option>${INSERTABLE_VARS.slice(0, 2).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select>`}</span>
      </label>
      <div class="field">Email body
        <div class="editor-box">
          ${locked ? '' : `<div class="editor-bar"><button type="button" class="ghost" data-fmt="bold" data-i="${index}" title="Bold (**text**)"><b>B</b></button><button type="button" class="ghost" data-fmt="link" data-i="${index}" title="Insert link">Link</button><button type="button" class="ghost" data-fmt="cta" data-i="${index}" title="Insert booking link">Booking link</button><select data-insert="bodyTemplate" data-i="${index}" aria-label="Insert variable into body"><option value="">+ Variable</option>${INSERTABLE_VARS.map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select><span class="count" data-count="${index}">${health.words} words · ~${Math.max(1, Math.round(health.words / 3.5))}s read</span></div>`}
          <textarea data-f="bodyTemplate" data-i="${index}" maxlength="50000" ${locked ? 'disabled' : ''}>${esc(step.bodyTemplate)}</textarea>
        </div>
      </div>
      <ul class="checks" data-checks="${index}">${checksHtml(health)}</ul>
      <div class="step-foot"><button type="button" class="ghost" data-act="test" data-i="${index}">${ICON.send}Send test</button><span class="spacer"></span></div>
    </div>
  </article>`;
}
function checksHtml(health) {
  return health.checks.length ? health.checks.map(([tone, text]) => `<li class="${tone}">${esc(text)}</li>`).join('') : '<li>Looks good — personalised, concise and deliverability-friendly.</li>';
}
function renderPreview() {
  const host = $('preview');
  if (!host) return;
  const step = state.draft.steps[state.openStep] || state.draft.steps[0];
  if (!step) { host.innerHTML = ''; return; }
  const email = renderEmailHtml(step);
  const senderOptions = state.senders.length
    ? state.senders.map((sender) => `<option value="${esc(sender.email)}" ${sender.email === state.sample.senderEmail ? 'selected' : ''}>${esc(sender.displayName)}</option>`).join('')
    : '<option value="">Sample sender</option>';
  host.innerHTML = `
    <div class="pv-head"><strong>Preview · Email ${state.draft.steps.indexOf(step) + 1}</strong><div class="seg" role="group" aria-label="Preview size"><button type="button" class="${state.device === 'desktop' ? 'on' : ''}" data-device="desktop">Desktop</button><button type="button" class="${state.device === 'mobile' ? 'on' : ''}" data-device="mobile">Mobile</button></div></div>
    <div class="pv-sample">
      <input data-sample="firstName" value="${esc(state.sample.firstName)}" aria-label="Sample first name" placeholder="First name" />
      <input data-sample="companyName" value="${esc(state.sample.companyName)}" aria-label="Sample company" placeholder="Company" />
      <select class="full" data-sample="senderEmail" aria-label="Preview sender">${senderOptions}</select>
    </div>
    <div class="pv-frame ${state.device === 'mobile' ? 'mobile' : ''}">
      <div class="pv-mail-head"><span><b>From</b> ${esc(email.values.SENDER_NAME)} &lt;${esc(email.values.SENDER_EMAIL)}&gt;</span><span><b>To</b> ${esc(state.sample.firstName || 'Contact')} · ${esc(state.sample.companyName || 'Company')}</span><span class="subj">${esc(email.subject) || '<span style="color:var(--faint)">(no subject)</span>'}</span></div>
      <div class="pv-body">${email.html}</div>
    </div>
    <button type="button" class="ghost" data-act="test" data-i="${state.draft.steps.indexOf(step)}">${ICON.send}Send this as a test</button>`;
}
function refreshStepChrome(index) {
  const step = state.draft.steps[index];
  const card = document.querySelector(`.seq-step[data-index="${index}"]`);
  if (!step || !card) return;
  const health = stepChecks(step);
  const days = stepDays(state.draft.steps);
  card.querySelector('.seq-step-title strong').textContent = step.stepName || 'Untitled email';
  card.querySelector('.seq-step-title span').textContent = `Day ${days[index]} · ${stepTime(step)} · ${step.subjectTemplate || 'No subject'}`;
  const badge = card.querySelector('.health');
  badge.className = `health ${health.grade}`;
  badge.textContent = health.label;
  const checks = card.querySelector(`[data-checks="${index}"]`);
  if (checks) checks.innerHTML = checksHtml(health);
  const count = card.querySelector(`[data-count="${index}"]`);
  if (count) count.textContent = `${health.words} words · ~${Math.max(1, Math.round(health.words / 3.5))}s read`;
}
function rerenderSequence(openIndex = state.openStep) {
  state.openStep = Math.max(0, Math.min(openIndex, state.draft.steps.length - 1));
  renderTab();
  renderHeaderMeta();
}
function insertAtCursor(field, index, text) {
  const input = document.querySelector(`[data-f="${field}"][data-i="${index}"]`);
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.setRangeText(text, start, end, 'end');
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function applyFormat(mode, index) {
  const input = document.querySelector(`[data-f="bodyTemplate"][data-i="${index}"]`);
  if (!input) return;
  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const selected = input.value.slice(start, end);
  if (mode === 'bold') input.setRangeText(`**${selected || 'bold text'}**`, start, end, 'end');
  if (mode === 'cta') input.setRangeText(`[${selected || 'Book a time that suits you'}]({{BOOKING_URL}})`, start, end, 'end');
  if (mode === 'link') {
    const url = prompt('Link URL (https://…)', 'https://');
    if (!url || !/^https?:\/\//i.test(url.trim())) return;
    input.setRangeText(`[${selected || 'link text'}](${url.trim()})`, start, end, 'end');
  }
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── Audience tab ────────────────────────────────────────────────────────
function audienceHtml() {
  if (!state.rules) return '<div class="card">Loading audience rules…</div>';
  const disabled = archived() ? 'disabled' : '';
  const set = state.rules.ruleSet;
  const toggle = (id, checked, title, desc) => `<label class="switch-row"><input type="checkbox" class="switch" id="${id}" ${checked ? 'checked' : ''} ${disabled}/><span><strong>${title}</strong><small>${desc}</small></span></label>`;
  return `<div class="aud-grid">
    <section class="card">
      <h3>Who gets enrolled</h3><p class="sub">Leads with an email that match these conditions can join this campaign.</p>
      <div class="logic">Match <select id="rulesMatchLogic" ${disabled}><option value="all" ${set.matchLogic === 'all' ? 'selected' : ''}>all conditions</option><option value="any" ${set.matchLogic === 'any' ? 'selected' : ''}>any condition</option></select></div>
      <div class="rule-list" id="triggerRules"></div>
      <div class="card-actions"><button type="button" class="ghost" id="addTriggerRule" ${disabled}>${ICON.plus}Add condition</button></div>
    </section>
    <section class="card">
      <h3>When to stop</h3><p class="sub">Contacts leave the sequence automatically when any of these happen.</p>
      ${toggle('stopOnReply', set.stopOnReply !== false, 'Stop when the contact replies', 'Recommended — never follow up on someone who already answered.')}
      ${toggle('autoStopEnabled', set.autoStopEnabled, 'Stop on call disposition', 'Stop when a rep logs one of the dispositions below.')}
      <div class="rule-list" id="stopRules" style="margin-top:8px"></div>
      <div class="card-actions"><button type="button" class="ghost" id="addStopRule" ${disabled}>${ICON.plus}Add stop condition</button></div>
      <p class="sub" style="margin:12px 0 0">Bounces, spam complaints, unsubscribes and qualified or not-interested leads are always excluded.</p>
    </section>
    <section class="card">
      <h3>Enrollment</h3><p class="sub">Choose how matching leads are added.</p>
      ${toggle('includeExistingOnActivate', set.includeExistingOnActivate, 'Enroll existing matches on activation', 'Adds everyone who already matches when you activate (up to 5,000).')}
      ${toggle('continuousEnroll', set.continuousEnroll, 'Keep enrolling new matches', 'Checks regularly and adds leads as they start matching.')}
    </section>
    <section class="card">
      <h3>Matching leads</h3><p class="sub">Save and preview who currently matches, then optionally backfill them now.</p>
      <div class="match-count" id="matchCount"><span class="v">—</span><span class="k">Run a preview to see matches</span></div>
      <div class="card-actions">
        <button type="button" class="ghost" id="previewRules">Preview matches</button>
        <label class="logic" style="margin:0">Backfill up to <select id="backfillCap">${[100, 250, 500, 1000, 2500, 5000].map((value) => `<option value="${value}" ${value === 500 ? 'selected' : ''}>${value.toLocaleString()}</option>`).join('')}</select></label>
        <button type="button" class="ghost" id="runBackfill" ${disabled}>Enroll matches now</button>
      </div>
      <div id="matchSample" style="margin-top:12px"></div>
    </section>
  </div>`;
}
function ruleRow(type, rule = {}) {
  const row = document.createElement('div');
  row.className = 'rule-row';
  row.dataset.ruleRow = type;
  const disabled = archived();
  const fields = type === 'stop' ? STOP_FIELDS : TRIGGER_FIELDS;
  const field = String(rule.field || (type === 'stop' ? 'disposition' : '')).toLowerCase();
  const operator = String(rule.operator || 'in').toLowerCase();
  row.innerHTML = `<select data-rule-field aria-label="Field" ${disabled ? 'disabled' : ''}><option value="">Field…</option>${fields.map(([value, label]) => `<option value="${value}" ${field === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <select data-rule-operator aria-label="Operator" ${disabled ? 'disabled' : ''}><option value="in" ${operator === 'in' ? 'selected' : ''}>is any of</option><option value="equals" ${operator === 'equals' ? 'selected' : ''}>is exactly</option></select>
    <div data-rule-value></div>
    <button type="button" class="ghost rm" data-remove-rule aria-label="Remove condition" ${disabled ? 'disabled' : ''}>${ICON.close}</button>`;
  fillRuleValues(row, Array.isArray(rule.value) ? rule.value : rule.value ? [rule.value] : []);
  return row;
}
function fillRuleValues(row, selected = []) {
  const field = row.querySelector('[data-rule-field]').value;
  const operator = row.querySelector('[data-rule-operator]').value;
  const host = row.querySelector('[data-rule-value]');
  const disabled = archived() ? 'disabled' : '';
  const chosen = selected.map((value) => String(value).trim().toLowerCase());
  const choices = RULE_VALUES[field] || [];
  if (!choices.length) { host.className = 'rule-values'; host.innerHTML = '<span class="none">Choose a field first</span>'; return; }
  if (operator === 'equals') {
    host.className = '';
    host.innerHTML = `<select aria-label="Value" ${disabled}><option value="">Value…</option>${choices.map(([value, label]) => `<option value="${esc(value)}" ${chosen.includes(value.toLowerCase()) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
    return;
  }
  host.className = 'rule-values';
  host.innerHTML = choices.map(([value, label]) => `<label><input type="checkbox" value="${esc(value)}" ${chosen.includes(value.toLowerCase()) ? 'checked' : ''} ${disabled}/>${esc(label)}</label>`).join('');
}
function mountRules() {
  if (!state.rules) return;
  const trig = $('triggerRules');
  const stop = $('stopRules');
  const empty = (text) => `<div class="rule-empty">${text}</div>`;
  trig.replaceChildren(...state.rules.triggerRules.map((rule) => ruleRow('trigger', rule)));
  stop.replaceChildren(...state.rules.stopRules.map((rule) => ruleRow('stop', rule)));
  if (!state.rules.triggerRules.length) trig.innerHTML = empty('No conditions yet — only contacts you add manually will be enrolled.');
}
function collectRules(type) {
  return [...document.querySelectorAll(`[data-rule-row="${type}"]`)].map((row) => {
    const field = row.querySelector('[data-rule-field]').value;
    const operator = row.querySelector('[data-rule-operator]').value;
    const host = row.querySelector('[data-rule-value]');
    const value = operator === 'in' ? [...host.querySelectorAll('input:checked')].map((input) => input.value) : host.querySelector('select')?.value || '';
    return { field, operator, value, active: true };
  }).filter((rule) => rule.field && (Array.isArray(rule.value) ? rule.value.length : rule.value));
}
function captureRulesFromDom() {
  if (!state.rules || !$('rulesMatchLogic')) return;
  state.rules.ruleSet = {
    matchLogic: $('rulesMatchLogic').value,
    includeExistingOnActivate: $('includeExistingOnActivate').checked,
    continuousEnroll: $('continuousEnroll').checked,
    autoStopEnabled: $('autoStopEnabled').checked,
    stopOnReply: $('stopOnReply').checked,
  };
  state.rules.triggerRules = collectRules('trigger');
  state.rules.stopRules = collectRules('stop');
}
async function loadRules() {
  const data = await api({ action:'get-rules', id: state.campaign.id });
  state.rules = { ruleSet: data.ruleSet, triggerRules: data.triggerRules || [], stopRules: data.stopRules || [] };
}
async function saveRules() {
  if (!state.rules || !state.dirtyParts.has('rules')) return;
  if (state.tab === 'audience') captureRulesFromDom();
  const { ruleSet, triggerRules, stopRules } = state.rules;
  const data = await api({ action:'save-rules', id: state.campaign.id, ...ruleSet, triggerRules, stopRules });
  state.rules = { ruleSet: data.ruleSet, triggerRules: data.triggerRules || [], stopRules: data.stopRules || [] };
  state.dirtyParts.delete('rules');
  setDirty(state.dirtyParts.size > 0);
}
async function previewMatches() {
  await saveRules();
  const data = await api({ action:'preview-rule-matches', id: state.campaign.id });
  $('matchCount').innerHTML = `<span class="v">${Number(data.count || 0).toLocaleString()}</span><span class="k">leads match right now and aren't enrolled yet</span>`;
  const leads = data.leads || [];
  $('matchSample').innerHTML = leads.length ? `<div class="tablewrap" style="max-height:320px"><table><thead><tr><th>Lead</th><th>Status</th><th>Sector</th></tr></thead><tbody>${leads.map((lead) => `<tr><td><span class="cell-main">${esc(lead.name || lead.email)}</span><span class="cell-sub">${esc(lead.company_name || '')} · ${esc(lead.email || '')}</span></td><td>${esc(lead.status || '')}</td><td>${esc([lead.sector, lead.sub_sector].filter(Boolean).join(' / '))}</td></tr>`).join('')}</tbody></table></div>${data.count > leads.length ? `<p class="m-note" style="margin-top:8px">Showing ${leads.length} of ${Number(data.count).toLocaleString()}.</p>` : ''}` : '';
}
async function runBackfill() {
  await saveRules();
  const cap = Number.parseInt($('backfillCap').value, 10) || 500;
  if (!confirm(`Enroll up to ${cap.toLocaleString()} matching leads into “${state.campaign.name}” now?`)) return;
  const data = await api({ action:'run-backfill', id: state.campaign.id, maxLeads: cap });
  toast(`Enrolled ${data.enrolled ?? 0} · skipped ${data.skipped ?? 0}`);
  await Promise.all([loadCampaigns(), loadEnrollments(), loadReport()]);
  renderHeaderMeta(); renderTabs();
}

// ── Contacts tab ────────────────────────────────────────────────────────
async function loadEnrollments() {
  const data = await api({ action:'enrollments', id: state.campaign.id });
  state.enrollments = data.enrollments || [];
}
function contactsHtml() {
  if (!state.enrollments) return '<div class="card">Loading contacts…</div>';
  const counts = { all: state.enrollments.length };
  ENROLLMENT_STATUSES.forEach((status) => { counts[status] = state.enrollments.filter((row) => row.status === status).length; });
  const query = state.contactQuery.trim().toLowerCase();
  const rows = state.enrollments.filter((row) => (state.contactFilter === 'all' || row.status === state.contactFilter)
    && (!query || [row.leadName, row.companyName, row.email].some((value) => String(value || '').toLowerCase().includes(query))));
  const total = state.draft.steps.length || 1;
  const canAdd = state.campaign.status === 'active';
  return `<div class="tab-toolbar">
      <div class="chip-filter" role="tablist">${[['all', 'All'], ...ENROLLMENT_STATUSES.map((status) => [status, status[0].toUpperCase() + status.slice(1)])].map(([key, label]) => `<button type="button" class="${state.contactFilter === key ? 'on' : ''}" data-contact-filter="${key}">${label} <span class="n">${counts[key]}</span></button>`).join('')}</div>
      <div class="search-field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="contactSearch" type="search" placeholder="Search contacts" value="${esc(state.contactQuery)}" aria-label="Search contacts" /></div>
      <span class="spacer"></span>
      ${counts.paused && state.campaign.status === 'active' ? `<button type="button" class="ghost" data-act="resume-all">Resume ${counts.paused} paused</button>` : ''}
      <button type="button" class="ghost" data-act="export-contacts" ${rows.length ? '' : 'disabled'}>${ICON.download}Export CSV</button>
      <button type="button" data-act="add-contacts" ${canAdd ? '' : 'disabled title="Activate the campaign to add contacts"'}>${ICON.plus}Add contacts</button>
    </div>
    ${canAdd ? '' : `<div class="banner">${ICON.info}<span>Contacts can be added once the campaign is active. Audience rules can also enroll leads automatically.</span></div>`}
    <div class="tablewrap"><table class="contacts-table"><thead><tr><th>Contact</th><th>Status</th><th>Progress</th><th>Next send</th><th>Last activity</th><th>Added via</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.map((row) => {
        const done = Math.min(total, Number(row.currentStep || 0));
        const reason = row.status === 'stopped' ? row.stoppedReason : row.status === 'paused' ? row.pausedReason : '';
        return `<tr>
          <td><span class="cell-main">${esc(row.leadName || row.email || 'Unknown')}</span><span class="cell-sub">${esc([row.companyName, row.email].filter(Boolean).join(' · '))}</span></td>
          <td><span class="status-pill ${esc(row.status)}">${esc(row.status)}</span>${reason ? `<span class="cell-sub">${esc(String(reason).replaceAll('_', ' '))}</span>` : ''}</td>
          <td><span class="progress"><span class="bar"><i style="width:${Math.round((done / total) * 100)}%"></i></span>${done}/${total}</span></td>
          <td>${row.status === 'active' ? esc(fmtDateTime(row.nextStepDue)) : '—'}</td>
          <td>${row.lastEventType ? `${esc(row.lastEventType)} <span class="cell-sub">${esc(relTime(row.lastEventAt))}</span>` : row.lastSentAt ? `sent <span class="cell-sub">${esc(relTime(row.lastSentAt))}</span>` : '—'}</td>
          <td>${esc(row.enrolledVia || 'manual')}<span class="cell-sub">${esc(relTime(row.enrolledAt))}</span></td>
          <td><div class="row-actions">${row.status === 'active' ? `<button type="button" class="ghost" data-enroll-act="pause-enrollment" data-eid="${esc(row.id)}">Pause</button>` : ''}${row.status === 'paused' ? `<button type="button" class="ghost" data-enroll-act="resume-enrollment" data-eid="${esc(row.id)}">Resume</button>` : ''}${['active', 'paused'].includes(row.status) ? `<button type="button" class="ghost" data-enroll-act="stop-enrollment" data-eid="${esc(row.id)}">Stop</button>` : ''}</div></td>
        </tr>`;
      }).join('') : `<tr><td colspan="7">${state.enrollments.length ? 'No contacts match this filter.' : 'Nobody is enrolled yet.'}</td></tr>`}
    </tbody></table></div>`;
}
async function enrollmentAction(action, enrollmentId) {
  if (action === 'stop-enrollment' && !confirm('Stop this contact? They will not receive any more emails from this campaign.')) return;
  await api({ action, id: state.campaign.id, enrollmentId });
  await loadEnrollments();
  renderTab(); renderTabs();
  toast(action === 'pause-enrollment' ? 'Contact paused' : action === 'resume-enrollment' ? 'Contact resumed' : 'Contact stopped');
}
async function resumeAllPaused() {
  const paused = (state.enrollments || []).filter((row) => row.status === 'paused').length;
  if (!confirm(`Resume ${plural(paused, 'paused contact')}? Their next email sends in the next business-hours window.`)) return;
  try {
    const data = await api({ action:'resume-all-enrollments', id: state.campaign.id });
    await loadEnrollments();
    renderTab(); renderTabs();
    toast(`${plural(data.resumed || 0, 'contact')} resumed`);
  } catch (error) { toast(error.message, 'bad'); }
}
function downloadCsv(filename, header, rows) {
  const cell = (value) => { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const csv = [header, ...rows].map((row) => row.map(cell).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type:'text/csv' }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function slug() { return String(state.campaign.name || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

// ── Analytics tab ───────────────────────────────────────────────────────
async function loadReport() {
  state.report = await api({ action:'report', id: state.campaign.id });
}
function analyticsHtml() {
  const report = state.report;
  if (!report) return '<div class="card">Loading analytics…</div>';
  const enrolled = (report.enrollmentStatuses || []).reduce((sum, row) => sum + row.count, 0);
  const byStatus = Object.fromEntries((report.enrollmentStatuses || []).map((row) => [row.status, row.count]));
  const activity = report.activity || [];
  const sent = activity.filter((row) => row.send_status !== 'pending' && row.send_status !== 'failed').length;
  const opened = activity.filter((row) => row.opened_count > 0).length;
  const clicked = activity.filter((row) => row.clicked_count > 0).length;
  const failed = activity.filter((row) => ['failed', 'bounced', 'complained'].includes(row.send_status)).length;
  const stepRows = state.draft.steps.map((step, index) => {
    const rows = activity.filter((row) => Number(row.step_order) === index + 1);
    const stepSent = rows.filter((row) => row.send_status !== 'pending' && row.send_status !== 'failed').length;
    return { step, stepSent, stepOpened: rows.filter((row) => row.opened_count > 0).length, stepClicked: rows.filter((row) => row.clicked_count > 0).length };
  });
  const bar = (part, whole, color) => `<span class="funnel-bar"><span class="bar"><i style="width:${whole ? Math.round((part / whole) * 100) : 0}%;background:${color}"></i></span><span class="pct">${pct(part, whole)}</span></span>`;
  const query = state.activityQuery.trim().toLowerCase();
  const filtered = activity.filter((row) => !query || [row.lead_name, row.recipient_email, row.company_name, row.owner_name, row.step_name].some((value) => String(value || '').toLowerCase().includes(query)));
  const log = report.ruleActivity || [];
  const logLabel = { campaign_rules_saved:'Audience rules saved', campaign_rules_backfill_run:'Backfill run', campaign_rules_auto_enroll:'Auto-enrolled new matches', campaign_rule_stop_applied:'Stop rule applied', campaign_activated:'Campaign activated' };
  const logDetail = (meta) => { const m = meta || {}; if (m.enrolled !== undefined) return `${m.enrolled} enrolled${m.skipped !== undefined ? `, ${m.skipped} skipped` : ''}`; if (m.backfillResult?.enrolled !== undefined) return `${m.backfillResult.enrolled} enrolled`; if (m.triggerRules !== undefined) return `${m.triggerRules} conditions, ${m.stopRules} stop rules`; if (m.stopped !== undefined) return `${m.stopped} stopped`; return ''; };
  return `<div class="an-grid">
    <section class="kpi-strip" style="margin:0">
      ${[['Enrolled', enrolled.toLocaleString()], ['Active', (byStatus.active || 0).toLocaleString()], ['Completed', (byStatus.completed || 0).toLocaleString()], ['Stopped', (byStatus.stopped || 0).toLocaleString()], ['Emails sent', sent.toLocaleString()], ['Open rate', pct(opened, sent)], ['Click rate', pct(clicked, sent)], ['Failed / bounced', failed.toLocaleString()]].map(([k, v]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}
    </section>
    <section class="card"><h3>Performance by email</h3><p class="sub">Unique opens and clicks per sent email. Open tracking can be affected by privacy features in some inboxes.</p>
      <div class="tablewrap"><table><thead><tr><th>Email</th><th>Sent</th><th>Opened</th><th>Clicked</th></tr></thead><tbody>
        ${stepRows.length ? stepRows.map(({ step, stepSent, stepOpened, stepClicked }, index) => `<tr><td><span class="cell-main">${index + 1}. ${esc(step.stepName)}</span><span class="cell-sub">${esc(step.subjectTemplate)}</span></td><td>${stepSent}</td><td>${bar(stepOpened, stepSent, 'var(--blue)')}</td><td>${bar(stepClicked, stepSent, 'var(--green)')}</td></tr>`).join('') : '<tr><td colspan="4">No emails in this sequence.</td></tr>'}
      </tbody></table></div>
    </section>
    <section class="card"><div class="tab-toolbar" style="margin-bottom:12px"><h3 style="margin:0">Send activity</h3><span class="spacer"></span><div class="search-field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="activitySearch" type="search" placeholder="Search activity" value="${esc(state.activityQuery)}" aria-label="Search activity" /></div><button type="button" class="ghost" data-act="export-activity" ${activity.length ? '' : 'disabled'}>${ICON.download}Export CSV</button><button type="button" class="ghost" data-act="refresh-report">Refresh</button></div>
      <div class="tablewrap" style="max-height:480px"><table><thead><tr><th>Recipient</th><th>Email</th><th>Status</th><th>Sent</th><th>Opens</th><th>Clicks</th><th>Enrollment</th><th>Stop reason</th></tr></thead><tbody>
        ${filtered.length ? filtered.slice(0, 500).map((row) => `<tr><td><span class="cell-main">${esc(row.lead_name || row.recipient_email || '')}</span><span class="cell-sub">${esc([row.company_name, row.owner_name].filter(Boolean).join(' · '))}</span></td><td>${esc(`${row.step_order}. ${row.step_name || ''}`)}</td><td><span class="status-pill ${['failed', 'bounced', 'complained'].includes(row.send_status) ? 'stopped' : row.send_status === 'pending' ? 'paused' : 'active'}">${esc(row.send_status || '')}</span></td><td>${esc(fmtDateTime(row.sent_at))}</td><td>${row.opened_count || 0}</td><td>${row.clicked_count || 0}</td><td>${esc(row.enrollment_status || '')}</td><td>${esc(String(row.stopped_reason || '').replaceAll('_', ' '))}</td></tr>`).join('') : `<tr><td colspan="8">${activity.length ? 'No activity matches your search.' : 'No emails have been sent yet.'}</td></tr>`}
      </tbody></table></div>${filtered.length > 500 ? '<p class="m-note" style="margin-top:8px">Showing the latest 500 — export CSV for everything.</p>' : ''}
    </section>
    <div class="aud-grid">
      <section class="card"><h3>Test sends</h3><p class="sub">Tests sent from the sequence editor.</p>
        <div class="tablewrap" style="max-height:320px"><table><thead><tr><th>To</th><th>From</th><th>Status</th><th>When</th></tr></thead><tbody>
          ${(report.testSends || []).length ? report.testSends.map((row) => `<tr><td>${esc(row.recipient_email || '')}</td><td>${esc(row.sender_name || row.sender_email || '')}</td><td>${esc(row.status || '')}${row.error ? `<span class="cell-sub">${esc(row.error)}</span>` : ''}</td><td>${esc(fmtDateTime(row.sent_at || row.created_at))}</td></tr>`).join('') : '<tr><td colspan="4">No test sends yet.</td></tr>'}
        </tbody></table></div>
      </section>
      <section class="card"><h3>Automation log</h3><p class="sub">Rule changes, backfills and automatic enrollments.</p>
        ${log.length ? `<ul class="log-list">${log.slice(0, 40).map((row) => `<li><time>${esc(fmtDateTime(row.created_at))}</time><span>${esc(logLabel[row.event] || row.event)}${logDetail(row.meta) ? ` · <span class="cell-sub" style="display:inline">${esc(logDetail(row.meta))}</span>` : ''}</span></li>`).join('')}</ul>` : '<p class="m-note">No automation activity yet.</p>'}
      </section>
    </div>
  </div>`;
}

// ── Settings tab ────────────────────────────────────────────────────────
function settingsHtml() {
  const campaign = state.campaign;
  const disabled = archived() ? 'disabled' : '';
  return `<div class="settings-grid">
    <div class="an-grid">
      <section class="card"><h3>General</h3><p class="sub">Internal details — contacts never see these.</p>
        <div class="an-grid" style="gap:12px">
          <label class="field">Description<textarea id="campaignDescription" rows="3" maxlength="2000" placeholder="What is this campaign for?" ${disabled}>${esc(state.draft.description)}</textarea></label>
          <label class="field">Booking link<input id="campaignBookingUrl" type="url" value="${esc(state.draft.bookingUrl)}" placeholder="${DEFAULT_BOOKING_URL}" ${disabled}/><span class="hint">Used for {{BOOKING_URL}}. First name and company are appended automatically so the booking form is pre-filled.</span></label>
        </div>
      </section>
      <section class="card"><h3>Sending schedule</h3><p class="sub">Applies to every email in this campaign.</p>
        <dl class="kv"><div><dt>Send days</dt><dd>Monday – Friday</dd></div><div><dt>Send window</dt><dd>09:00 – 17:00 UK time</dd></div><div><dt>Sender</dt><dd>Each contact's owning rep</dd></div><div><dt>Unsubscribe</dt><dd>One-click header on every email</dd></div></dl>
      </section>
    </div>
    <div class="an-grid">
      <section class="card"><h3>Details</h3>
        <dl class="kv" style="margin-top:10px"><div><dt>Status</dt><dd><span class="status-pill ${esc(campaign.status)}">${esc(campaign.status)}</span></dd></div><div><dt>Campaign ID</dt><dd>${esc(campaign.id)}</dd></div><div><dt>Created</dt><dd>${esc(fmtDateTime(campaign.createdAt))}</dd></div><div><dt>Activated</dt><dd>${esc(fmtDateTime(campaign.activatedAt))}</dd></div><div><dt>Paused</dt><dd>${esc(fmtDateTime(campaign.pausedAt))}</dd></div></dl>
      </section>
      <section class="card danger"><h3>Archive campaign</h3><p class="sub">Stops all active and paused contacts and removes the campaign from the list. Reporting is kept.</p>
        <button type="button" class="danger-btn" data-act="archive" ${disabled}>Archive campaign</button>
      </section>
    </div>
  </div>`;
}

// ── Save / lifecycle ────────────────────────────────────────────────────
function validateSteps() {
  const problems = state.draft.steps.map((step, index) => ({ index, missing: [!String(step.stepName || '').trim() && 'a name', !String(step.subjectTemplate || '').trim() && 'a subject', !String(step.bodyTemplate || '').trim() && 'a body'].filter(Boolean) })).filter((item) => item.missing.length);
  if (!problems.length) return true;
  state.openStep = problems[0].index;
  if (state.tab !== 'sequence') setTab('sequence'); else rerenderSequence(problems[0].index);
  toast(`Email ${problems[0].index + 1} needs ${problems[0].missing.join(', ')}`, 'bad');
  return false;
}
async function saveAll({ quiet = false } = {}) {
  if (!state.campaign || archived()) return false;
  if (state.tab === 'audience') captureRulesFromDom();
  const saveSteps = state.dirtyParts.has('steps') && !stepsLocked();
  if (saveSteps && state.draft.steps.length && !validateSteps()) return false;
  const button = $('saveBtn');
  if (button) { button.disabled = true; button.textContent = 'Saving…'; }
  try {
    if (state.dirtyParts.has('meta')) {
      await api({ action:'update', id: state.campaign.id, name: state.draft.name.trim() || state.campaign.name, description: state.draft.description, bookingUrl: state.draft.bookingUrl.trim() });
      state.dirtyParts.delete('meta');
    }
    await saveRules();
    if (saveSteps && state.draft.steps.length) {
      await api({ action:'save-steps', id: state.campaign.id, steps: state.draft.steps.map((step, index) => ({ ...step, stepOrder: index + 1, waitDays: index === 0 ? 0 : Number(step.waitDays) || 0 })) });
    }
    state.dirtyParts.delete('steps');
    const data = await api({ action:'get', id: state.campaign.id });
    state.campaign = data.campaign;
    state.draft.steps = data.campaign.steps.length ? data.campaign.steps.map((step) => ({ ...step })) : state.draft.steps;
    clearDirty();
    await loadCampaigns();
    renderHeaderMeta();
    if (!quiet) toast('Campaign saved');
    return true;
  } catch (error) {
    toast(error.message, 'bad');
    return false;
  } finally {
    if (button) button.textContent = 'Save';
    setDirty(state.dirtyParts.size > 0);
  }
}
function openActivateDialog() {
  const steps = state.draft.steps;
  if (!steps.length) { toast('Add at least one email before activating', 'warn'); setTab('sequence'); return; }
  const warnings = steps.reduce((sum, step) => sum + stepChecks(step).checks.filter(([tone]) => tone !== 'info').length, 0);
  const set = state.rules?.ruleSet || {};
  const days = stepDays(steps);
  const resuming = state.campaign.status === 'paused';
  const pausedByCampaign = (state.enrollments || []).filter((row) => row.status === 'paused' && row.pausedReason === 'campaign_paused').length;
  openModal(`
    <div class="m-head"><div><h2>${resuming ? 'Resume' : 'Activate'} “${esc(state.draft.name)}”?</h2><p>Emails start sending in the next business-hours window (Mon–Fri, 09:00–17:00 UK).</p></div><button type="button" class="x" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="m-body"><ul class="m-summary">
      <li><span>Sequence</span>${plural(steps.length, 'email')} over ${plural(days[days.length - 1] || 0, 'day')}</li>
      <li><span>Enroll existing matches</span>${set.includeExistingOnActivate ? 'Yes (up to 5,000)' : 'No'}</li>
      <li><span>Keep enrolling new matches</span>${set.continuousEnroll ? 'Yes' : 'No'}</li>
      <li><span>Stop on reply</span>${set.stopOnReply !== false ? 'Yes' : 'No'}</li>
      <li><span>Content suggestions</span>${warnings ? `${warnings} to review` : 'None'}</li>
    </ul>${pausedByCampaign ? `<label class="switch-row" style="border:0;padding:4px 0 0"><input type="checkbox" class="switch" id="resumeContacts" checked /><span><strong>Resume ${plural(pausedByCampaign, 'contact')} paused with the campaign</strong><small>Contacts you paused individually stay paused.</small></span></label>` : ''}<p class="m-note">Live campaigns are read-only. Pause to make edits.</p></div>
    <div class="m-foot"><button type="button" class="ghost" data-close>Cancel</button><button type="button" id="confirmActivate">${ICON.send}${resuming ? 'Resume' : 'Activate'} campaign</button></div>`);
  $('confirmActivate').addEventListener('click', async () => {
    $('confirmActivate').disabled = true;
    if (state.dirty && !(await saveAll({ quiet: true }))) { closeModal(); return; }
    try {
      const resumeContacts = $('resumeContacts')?.checked === true;
      const data = await api({ action:'activate', id: state.campaign.id });
      let resumed = 0;
      if (resumeContacts) resumed = (await api({ action:'resume-all-enrollments', id: state.campaign.id, onlyCampaignPaused: true })).resumed || 0;
      closeModal();
      state.campaign = data.campaign;
      await Promise.all([loadCampaigns(), loadEnrollments(), loadReport()]);
      renderWorkspace();
      toast(data.backfillResult ? `Campaign live · ${data.backfillResult.enrolled} contacts enrolled` : resumed ? `Campaign live · ${resumed} contacts resumed` : 'Campaign is live');
    } catch (error) { closeModal(); toast(error.message, 'bad'); }
  });
}
async function lifecycle(action) {
  if (action === 'archive' && !confirm(`Archive “${state.campaign.name}”? All active contacts will be stopped. This can't be undone.`)) return;
  if (action === 'pause' && !confirm('Pause this campaign? All active contacts will be paused and no more emails will send.')) return;
  try {
    const data = await api({ action, id: state.campaign.id });
    await loadCampaigns();
    if (action === 'archive') { state.campaign = null; state.dirty = false; state.dirtyParts.clear(); history.replaceState(null, '', '/campaigns'); renderList(); renderWorkspace(); toast('Campaign archived'); return; }
    state.campaign = data.campaign;
    await loadEnrollments();
    renderWorkspace();
    toast(action === 'pause' ? 'Campaign paused' : 'Updated');
  } catch (error) { toast(error.message, 'bad'); }
}
async function cloneCampaign() {
  if (!confirmDiscard()) return;
  try {
    const data = await api({ action:'clone', id: state.campaign.id });
    state.dirty = false; state.dirtyParts.clear();
    await loadCampaigns();
    await selectCampaign(data.campaign.id, { tab:'sequence' });
    toast('Duplicated as a new draft');
  } catch (error) { toast(error.message, 'bad'); }
}

// ── Modals ──────────────────────────────────────────────────────────────
function openModal(html, { wide = false } = {}) {
  const modal = $('modal');
  modal.className = `cmp-modal ${wide ? 'wide' : ''}`;
  modal.innerHTML = html;
  modal.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', closeModal));
  if (!modal.open) modal.showModal();
  modal.querySelector('input:not([type=radio]):not([type=checkbox]), select, textarea')?.focus();
}
function closeModal() { const modal = $('modal'); if (modal.open) modal.close(); }

function openNewCampaign() {
  if (!confirmDiscard()) return;
  openModal(`
    <div class="m-head"><div><h2>New campaign</h2><p>Campaigns start as drafts — nothing sends until you activate.</p></div><button type="button" class="x" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="m-body">
      <label class="field">Campaign name<input id="newName" maxlength="160" placeholder="e.g. Post-call follow-up · Q4" /></label>
      <div class="field">Start from
        <div class="choice-grid">
          <label class="choice"><input type="radio" name="start" value="growth" checked /><strong>Growth sequence</strong><span>6 proven emails over 14 days — requested info through to a polite close.</span></label>
          <label class="choice"><input type="radio" name="start" value="blank" /><strong>Blank</strong><span>Start with an empty sequence and add emails or templates yourself.</span></label>
        </div>
      </div>
    </div>
    <div class="m-foot"><button type="button" class="ghost" data-close>Cancel</button><button type="button" id="createCampaign">Create campaign</button></div>`);
  const submit = async () => {
    const name = $('newName').value.trim();
    if (!name) { $('newName').focus(); toast('Give the campaign a name', 'warn'); return; }
    const start = document.querySelector('input[name="start"]:checked')?.value;
    $('createCampaign').disabled = true;
    try {
      const data = await api({ action:'create', name, description:'' });
      if (start === 'growth') await api({ action:'save-steps', id: data.campaign.id, steps: starterSequence().map((step, index) => ({ ...step, stepOrder: index + 1 })) });
      closeModal();
      state.dirty = false; state.dirtyParts.clear();
      await loadCampaigns();
      await selectCampaign(data.campaign.id, { tab:'sequence' });
      toast('Draft campaign created');
    } catch (error) { $('createCampaign').disabled = false; toast(error.message, 'bad'); }
  };
  $('createCampaign').addEventListener('click', submit);
  $('newName').addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });
}
function openTemplatePicker() {
  const sectors = SUBSECTORS.filter((item) => item.label !== 'All sectors');
  const renderTemplates = (subsector) => {
    const variants = subsector === 'All sectors' ? GENERAL_VARIANTS : VARIANTS;
    $('tplList').innerHTML = variants.map((variant) => {
      const tpl = composeTemplate(subsector, variant.key);
      return tpl ? `<div class="tpl"><strong>${esc(variant.label)}</strong><span>${esc(variant.description)} · “${esc(tpl.subject)}”</span><button type="button" class="ghost" data-tpl="${esc(variant.key)}">Add</button></div>` : '';
    }).join('');
  };
  openModal(`
    <div class="m-head"><div><h2>Add from template</h2><p>Proven i3MEDIA copy. Everything stays editable after you add it.</p></div><button type="button" class="x" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="m-body">
      <label class="field">Audience<select id="tplSector"><option value="All sectors">General sequence (all sectors)</option>${sectors.map((item) => `<option value="${esc(item.label)}">${esc(item.sector)} · ${esc(item.label)}</option>`).join('')}</select></label>
      <div class="tpl-list" id="tplList"></div>
    </div>
    <div class="m-foot"><button type="button" class="ghost" data-close>Done</button></div>`, { wide: true });
  renderTemplates('All sectors');
  $('tplSector').addEventListener('change', (event) => renderTemplates(event.target.value));
  $('tplList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tpl]');
    if (!button) return;
    const subsector = $('tplSector').value;
    const variant = [...GENERAL_VARIANTS, ...VARIANTS].find((item) => item.key === button.dataset.tpl);
    const step = templateStep(subsector, variant, state.draft.steps.length);
    state.draft.steps.push(step);
    markDirty('steps');
    rerenderSequence(state.draft.steps.length - 1);
    button.textContent = 'Added';
    button.disabled = true;
    toast(`Added “${variant.label}” as email ${state.draft.steps.length}`);
  });
}
function openTestDialog(index) {
  const step = state.draft.steps[index];
  if (!step) return;
  const senderOptions = state.senders.map((sender) => `<option value="${esc(sender.email)}" ${sender.email === state.sample.senderEmail ? 'selected' : ''}>${esc(sender.displayName)} &lt;${esc(sender.email)}&gt;</option>`).join('') || '<option value="">No senders configured</option>';
  openModal(`
    <div class="m-head"><div><h2>Send a test of email ${index + 1}</h2><p>Uses the current (unsaved) copy with sample data. Test sends are logged under Analytics.</p></div><button type="button" class="x" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="m-body">
      <label class="field">Send to<input id="testTo" type="email" value="${esc(state.lastTestTo)}" placeholder="you@company.com" /></label>
      <label class="field">From<select id="testFrom">${senderOptions}</select></label>
      <div class="field-row" style="grid-template-columns:1fr 1fr"><label class="field">Sample first name<input id="testFirst" value="${esc(state.sample.firstName)}" /></label><label class="field">Sample company<input id="testCompany" value="${esc(state.sample.companyName)}" /></label></div>
    </div>
    <div class="m-foot"><button type="button" class="ghost" data-close>Cancel</button><button type="button" id="sendTest">${ICON.send}Send test</button></div>`);
  $('sendTest').addEventListener('click', async () => {
    const to = $('testTo').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { toast('Enter a valid email address', 'warn'); $('testTo').focus(); return; }
    const sender = state.senders.find((item) => item.email === $('testFrom').value);
    $('sendTest').disabled = true;
    $('sendTest').textContent = 'Sending…';
    try {
      const response = await fetch('/api/email-send', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'same-origin', body:JSON.stringify({ action:'send-test', toEmail: to, fromEmail: $('testFrom').value, fromName: sender?.displayName || '', testFirstName: $('testFirst').value.trim() || 'Alex', testCompanyName: $('testCompany').value.trim() || 'Acme Ltd', templateKey: `campaign:${state.campaign.id}:step:${index + 1}`, subjectTemplate: step.subjectTemplate, bodyTemplate: step.bodyTemplate, senderTitle:'', bookingUrl: state.draft.bookingUrl || DEFAULT_BOOKING_URL }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to send test email');
      state.lastTestTo = to;
      closeModal();
      toast(`Test sent to ${to}`);
      loadReport().then(() => { if (state.tab === 'analytics') renderTab(); }).catch(() => {});
    } catch (error) { $('sendTest').disabled = false; $('sendTest').innerHTML = `${ICON.send}Send test`; toast(error.message, 'bad'); }
  });
}
function openAddContacts() {
  const selected = new Map();
  openModal(`
    <div class="m-head"><div><h2>Add contacts</h2><p>Search leads by name, company or email. Suppressed, archived and already-enrolled leads are skipped.</p></div><button type="button" class="x" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="m-body">
      <div class="search-field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="leadSearch" type="search" placeholder="Start typing to search…" style="padding-left:32px" /></div>
      <div class="pick-list" id="leadResults"><div class="pv-empty">Type at least 2 characters.</div></div>
    </div>
    <div class="m-foot"><span class="m-note" id="pickCount">0 selected</span><span class="spacer"></span><button type="button" class="ghost" data-close>Cancel</button><button type="button" id="enrollSelected" disabled>Enroll selected</button></div>`, { wide: true });
  let timer = null;
  let seq = 0;
  const updateCount = () => { $('pickCount').textContent = `${selected.size} selected`; $('enrollSelected').disabled = !selected.size; };
  $('leadSearch').addEventListener('input', (event) => {
    clearTimeout(timer);
    const query = event.target.value.trim();
    timer = setTimeout(async () => {
      if (query.length < 2) { $('leadResults').innerHTML = '<div class="pv-empty">Type at least 2 characters.</div>'; return; }
      const mine = ++seq;
      try {
        const data = await api({ action:'search-leads', id: state.campaign.id, query });
        if (mine !== seq) return;
        const leads = data.leads || [];
        $('leadResults').innerHTML = leads.length ? leads.map((lead) => `<label class="pick ${lead.enrolled ? 'disabled' : ''}"><input type="checkbox" value="${esc(lead.id)}" ${lead.enrolled ? 'disabled checked' : selected.has(String(lead.id)) ? 'checked' : ''} /><span><span class="cell-main">${esc(lead.name || lead.email)}</span><span class="cell-sub">${esc([lead.companyName, lead.email, lead.owner].filter(Boolean).join(' · '))}</span></span><span class="tag">${lead.enrolled ? 'Already enrolled' : esc(lead.status || '')}</span></label>`).join('') : '<div class="pv-empty">No leads found.</div>';
      } catch (error) { $('leadResults').innerHTML = `<div class="pv-empty">${esc(error.message)}</div>`; }
    }, 250);
  });
  $('leadResults').addEventListener('change', (event) => {
    const input = event.target.closest('input[type=checkbox]');
    if (!input || input.disabled) return;
    if (input.checked) selected.set(input.value, true); else selected.delete(input.value);
    updateCount();
  });
  $('enrollSelected').addEventListener('click', async () => {
    $('enrollSelected').disabled = true;
    try {
      const data = await api({ action:'enroll', id: state.campaign.id, leadIds: [...selected.keys()].map(Number) });
      const results = data.results || [];
      const enrolled = results.filter((row) => row.status === 'enrolled').length;
      const blocked = results.filter((row) => row.status === 'blocked');
      closeModal();
      toast(`${enrolled} enrolled${blocked.length ? ` · ${blocked.length} skipped (${[...new Set(blocked.map((row) => row.reason.replaceAll('_', ' ')))].join(', ')})` : ''}`, blocked.length ? 'warn' : 'ok');
      await Promise.all([loadEnrollments(), loadCampaigns()]);
      renderTab(); renderTabs(); renderHeaderMeta();
    } catch (error) { $('enrollSelected').disabled = false; toast(error.message, 'bad'); }
  });
}

// ── Senders ─────────────────────────────────────────────────────────────
async function loadSenders() {
  try {
    const response = await fetch('/api/sq-auth', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'same-origin', body:JSON.stringify({ action:'list-users' }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) return;
    state.senders = (data.users || [])
      .filter((user) => user.active !== false && user.ghlOwnerId && (user.senderEmail || user.email))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .map((user) => { const first = String(user.name || user.email).trim().split(/\s+/)[0]; return { email: user.email, name: user.name, title: user.senderTitle || '', displayName: `${first} @ I3MEDIA`, signature: '' }; });
    if (!state.sample.senderEmail && state.senders[0]) state.sample.senderEmail = state.senders[0].email;
    if (state.tab === 'sequence') renderPreview();
  } catch { /* preview falls back to sample sender */ }
}

// ── Events ──────────────────────────────────────────────────────────────
document.addEventListener('click', (event) => {
  const target = event.target.closest('button, [data-toggle], [data-filter]');
  if (!target) return;
  if (target.closest('.menu-list')) target.closest('details')?.removeAttribute('open');
  const { act } = target.dataset;
  if (target.matches('.cmp-item')) { selectCampaign(target.dataset.id, { tab:'sequence' }).catch((error) => toast(error.message, 'bad')); return; }
  if (target.dataset.filter) { state.filter = target.dataset.filter; renderList(); return; }
  if (target.dataset.tab && target.closest('#wsTabs, .menu-list')) { if (state.tab === 'audience') captureRulesFromDom(); setTab(target.dataset.tab); return; }
  if (target.dataset.toggle !== undefined && !event.target.closest('.seq-tools')) {
    const index = Number(target.dataset.toggle);
    state.openStep = state.openStep === index ? -1 : index;
    document.querySelectorAll('.seq-step').forEach((card) => card.classList.toggle('open', Number(card.dataset.index) === state.openStep));
    if (state.openStep >= 0) renderPreview();
    return;
  }
  if (target.dataset.move !== undefined) {
    const from = Number(target.dataset.move); const to = from + Number(target.dataset.dir);
    const steps = state.draft.steps;
    if (to < 0 || to >= steps.length) return;
    [steps[from], steps[to]] = [steps[to], steps[from]];
    markDirty('steps'); rerenderSequence(to); return;
  }
  if (target.dataset.dup !== undefined) {
    const index = Number(target.dataset.dup);
    const copy = { ...state.draft.steps[index], id: undefined, stepName: `${state.draft.steps[index].stepName} (copy)`, waitDays: 3 };
    state.draft.steps.splice(index + 1, 0, copy);
    markDirty('steps'); rerenderSequence(index + 1); return;
  }
  if (target.dataset.del !== undefined) {
    const index = Number(target.dataset.del);
    if (!confirm(`Delete email ${index + 1} “${state.draft.steps[index].stepName}”?`)) return;
    state.draft.steps.splice(index, 1);
    markDirty('steps'); rerenderSequence(Math.max(0, index - 1)); return;
  }
  if (target.dataset.fmt) { applyFormat(target.dataset.fmt, Number(target.dataset.i)); return; }
  if (target.dataset.device) { state.device = target.dataset.device; renderPreview(); return; }
  if (target.dataset.contactFilter) { state.contactFilter = target.dataset.contactFilter; renderTab(); return; }
  if (target.dataset.enrollAct) { enrollmentAction(target.dataset.enrollAct, Number(target.dataset.eid)).catch((error) => toast(error.message, 'bad')); return; }
  if (target.matches('[data-remove-rule]')) { target.closest('.rule-row').remove(); markDirty('rules'); return; }
  if (target.id === 'addTriggerRule') { $('triggerRules').querySelector('.rule-empty')?.remove(); $('triggerRules').appendChild(ruleRow('trigger')); markDirty('rules'); return; }
  if (target.id === 'addStopRule') { $('stopRules').appendChild(ruleRow('stop', { field:'disposition', operator:'in', value:['Not interested'] })); markDirty('rules'); return; }
  if (target.id === 'previewRules') { previewMatches().catch((error) => toast(error.message, 'bad')); return; }
  if (target.id === 'runBackfill') { runBackfill().catch((error) => toast(error.message, 'bad')); return; }
  if (!act) return;
  if (act === 'new') openNewCampaign();
  else if (act === 'refresh-list') loadCampaigns().then(() => toast('Campaigns refreshed')).catch((error) => toast(error.message, 'bad'));
  else if (act === 'resume-all') resumeAllPaused();
  else if (act === 'save') saveAll();
  else if (act === 'activate') openActivateDialog();
  else if (act === 'pause' || act === 'archive') lifecycle(act);
  else if (act === 'clone') cloneCampaign();
  else if (act === 'tab') setTab(target.dataset.tab);
  else if (act === 'starter') { state.draft.steps = starterSequence(); markDirty('steps'); rerenderSequence(0); }
  else if (act === 'add-blank') { state.draft.steps.push(newStep({ waitDays: state.draft.steps.length ? 3 : 0 })); markDirty('steps'); rerenderSequence(state.draft.steps.length - 1); }
  else if (act === 'add-template') openTemplatePicker();
  else if (act === 'test') openTestDialog(Number(target.dataset.i));
  else if (act === 'add-contacts') openAddContacts();
  else if (act === 'refresh-report') loadReport().then(() => { renderTab(); toast('Analytics refreshed'); }).catch((error) => toast(error.message, 'bad'));
  else if (act === 'export-contacts') downloadCsv(`${slug()}-contacts.csv`, ['Name', 'Company', 'Email', 'Status', 'Current step', 'Next send', 'Last event', 'Enrolled via', 'Enrolled at', 'Stop reason'], (state.enrollments || []).map((row) => [row.leadName, row.companyName, row.email, row.status, row.currentStep, row.nextStepDue, row.lastEventType, row.enrolledVia, row.enrolledAt, row.stoppedReason || row.pausedReason]));
  else if (act === 'export-activity') downloadCsv(`${slug()}-activity.csv`, ['Recipient', 'Email address', 'Company', 'Owner', 'Step', 'Step name', 'Send status', 'Sent at', 'Opens', 'Clicks', 'Enrollment', 'Stop reason'], (state.report?.activity || []).map((row) => [row.lead_name, row.recipient_email, row.company_name, row.owner_name, row.step_order, row.step_name, row.send_status, row.sent_at, row.opened_count, row.clicked_count, row.enrollment_status, row.stopped_reason]));
});
document.addEventListener('input', (event) => {
  const target = event.target;
  if (target.id === 'campaignSearch') { state.query = target.value; renderList(); return; }
  if (target.id === 'contactSearch') { state.contactQuery = target.value; const pos = target.selectionStart; renderTab(); const next = $('contactSearch'); next.focus(); next.setSelectionRange(pos, pos); return; }
  if (target.id === 'activitySearch') { state.activityQuery = target.value; const pos = target.selectionStart; renderTab(); const next = $('activitySearch'); next.focus(); next.setSelectionRange(pos, pos); return; }
  if (!state.draft) return;
  if (target.id === 'campaignName') { state.draft.name = target.value; markDirty('meta'); return; }
  if (target.id === 'campaignDescription') { state.draft.description = target.value; markDirty('meta'); return; }
  if (target.id === 'campaignBookingUrl') { state.draft.bookingUrl = target.value; markDirty('meta'); return; }
  if (target.dataset.sample) { state.sample[target.dataset.sample] = target.value; renderPreview(); return; }
  if (target.dataset.wait !== undefined) {
    state.draft.steps[Number(target.dataset.wait)].waitDays = Math.max(0, Math.min(365, Number.parseInt(target.value, 10) || 0));
    markDirty('steps');
    const days = stepDays(state.draft.steps);
    document.querySelectorAll('.seq-wait .day').forEach((node, i) => { node.textContent = `· Day ${days[i + 1]}`; });
    state.draft.steps.forEach((_step, i) => refreshStepChrome(i));
    renderHeaderMeta();
    return;
  }
  if (target.dataset.f && target.dataset.i !== undefined) {
    const index = Number(target.dataset.i);
    const step = state.draft.steps[index];
    if (target.dataset.f === 'sendTime') { const [hour, minute] = target.value.split(':').map(Number); step.sendHour = Number.isFinite(hour) ? hour : 9; step.sendMinute = Number.isFinite(minute) ? minute : 0; }
    else step[target.dataset.f] = target.value;
    markDirty('steps');
    refreshStepChrome(index);
    if (index === state.openStep) renderPreview();
  }
});
document.addEventListener('change', (event) => {
  const target = event.target;
  if (target.dataset.insert) {
    if (target.value) insertAtCursor(target.dataset.insert, Number(target.dataset.i), `{{${target.value}}}`);
    target.value = '';
    return;
  }
  if (target.matches('[data-sample]')) { state.sample[target.dataset.sample] = target.value; renderPreview(); return; }
  const row = target.closest('.rule-row');
  if (row && (target.matches('[data-rule-field]') || target.matches('[data-rule-operator]'))) {
    const previous = [...row.querySelectorAll('[data-rule-value] input:checked')].map((input) => input.value);
    const single = row.querySelector('[data-rule-value] select')?.value;
    fillRuleValues(row, target.matches('[data-rule-field]') ? [] : previous.length ? previous : single ? [single] : []);
  }
  if (target.closest('.aud-grid') && target.id !== 'backfillCap') markDirty('rules');
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && state.campaign) { event.preventDefault(); if (state.dirty) saveAll(); }
});
window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });

SQ.init(async (caps) => {
  if (!caps?.isAdmin) { $('workspace').innerHTML = '<div class="ws-empty"><div class="ws-empty-card"><h2>Admin access required</h2><p>Only admins can manage email campaigns.</p></div></div>'; return; }
  renderWorkspace();
  try {
    await loadCampaigns();
    loadSenders();
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    const tab = TABS.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'sequence';
    if (id && state.campaigns.some((campaign) => String(campaign.id) === id)) await selectCampaign(id, { tab });
  } catch (error) { toast(error.message, 'bad'); }
});
