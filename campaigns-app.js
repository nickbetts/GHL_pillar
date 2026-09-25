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
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
};
const STOP_LABELS = {
  inbound_reply: 'Replied', growth_form_submission: 'Booked via landing page', unsubscribed: 'Unsubscribed', manual: 'Stopped manually',
  campaign_archived: 'Campaign archived', suppressed_or_invalid: 'Suppressed or invalid email', sender_not_configured: 'Sender not configured',
  campaign_paused: 'Paused with campaign', replied: 'Replied',
};
const reasonLabel = (reason) => STOP_LABELS[reason] || String(reason || '').replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase());
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
  senders: [], sample: { firstName: 'Alex', companyName: 'Acme Ltd', senderEmail: '', contactId: '' },
  device: 'desktop', lastTestTo: '', previewIndex: 0,
  contactFilter: 'all', contactQuery: '', activityQuery: '', selected: new Set(), restore: null,
};

// ── Helpers ─────────────────────────────────────────────────────────────
async function api(body) {
  const response = await fetch('/api/campaigns', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'same-origin', body:JSON.stringify(body) });
  const data = await response.json().catch(() => ({ success:false, error:'Request failed' }));
  if (response.status === 401) { location.href = '/login?next=/campaigns'; throw new Error('Not signed in'); }
  if (!response.ok || !data.success) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(text, tone = 'ok', { action, onAction } = {}) {
  const node = document.createElement('div');
  node.className = `toast ${tone}`;
  node.append(Object.assign(document.createElement('span'), { textContent: text }));
  if (action) {
    const button = Object.assign(document.createElement('button'), { type:'button', className:'toast-act', textContent: action });
    button.addEventListener('click', () => { node.remove(); onAction?.(); });
    node.append(button);
  }
  $('toastHost').appendChild(node);
  setTimeout(() => node.remove(), action ? 7000 : 3200);
}
function confirmDialog({ title, body = '', confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    openModal(`
      <div class="m-head"><div><h2>${esc(title)}</h2>${body ? `<p>${esc(body)}</p>` : ''}</div><button type="button" class="x" data-close aria-label="Close">${ICON.close}</button></div>
      <div class="m-foot"><button type="button" class="ghost" data-close>Cancel</button><button type="button" id="confirmOk" class="${danger ? 'danger-btn' : ''}">${esc(confirmLabel)}</button></div>`);
    $('confirmOk').focus();
    const modal = $('modal');
    // close() fires its event async, so ignore a stale one from the dialog this replaced.
    const onClose = () => { if (modal.open) return; modal.removeEventListener('close', onClose); finish(false); };
    modal.addEventListener('close', onClose);
    $('confirmOk').addEventListener('click', () => { modal.removeEventListener('close', onClose); finish(true); closeModal(); });
  });
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
const isTyping = (node) => node?.closest?.('input, textarea, select, [contenteditable]');
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

// ── Schedule projection (mirrors cron-send-campaign-steps nextBusinessTime) ──
const londonParts = new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/London', weekday:'short', hour:'2-digit', minute:'2-digit', hour12:false });
function nextBusinessTime(from, hour, minute = 0) {
  const targetHour = Math.max(BUSINESS_START, Math.min(BUSINESS_END - 1, Number(hour) || BUSINESS_START));
  const targetMinute = Math.max(0, Math.min(59, Number(minute) || 0));
  const candidate = new Date(from);
  candidate.setUTCMinutes(targetMinute, 0, 0);
  for (let index = 0; index < 200; index += 1) {
    const values = Object.fromEntries(londonParts.formatToParts(candidate).map((part) => [part.type, part.value]));
    if (!['Sat', 'Sun'].includes(values.weekday) && Number(values.hour) === targetHour && candidate > from) return candidate;
    candidate.setUTCHours(candidate.getUTCHours() + 1);
  }
  return new Date(from.getTime() + 86400000);
}
function projectSends(steps, startIndex = 0, firstAt = null) {
  const now = Date.now();
  const dates = [];
  let cursor = null;
  steps.forEach((step, index) => {
    if (index < startIndex) { dates.push(null); return; }
    if (index === startIndex) {
      if (firstAt) cursor = new Date(firstAt);
      else { cursor = nextBusinessTime(new Date(now - 3600000), step.sendHour, step.sendMinute); if (cursor.getTime() <= now + 60000) cursor = new Date(now); }
    } else {
      const wait = Number(step.waitDays) || 0;
      cursor = nextBusinessTime(new Date(cursor.getTime() + wait * 86400000 - (wait > 0 ? 3600000 : 0)), step.sendHour, step.sendMinute);
    }
    dates.push(cursor);
  });
  return dates;
}
const fmtShort = (date) => (date ? date.toLocaleString('en-GB', { timeZone:'Europe/London', weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '—');

// ── Stats from the report (shared by Sequence + Analytics) ─────────────
let statsCache = { key: null, value: null };
function campaignStats() {
  const report = state.report;
  const count = state.draft?.steps.length || 0;
  if (statsCache.key === report && statsCache.count === count) return statsCache.value;
  const activity = report?.activity || [];
  const isSent = (row) => !['pending', 'failed'].includes(row.send_status);
  const steps = Array.from({ length: count }, () => ({ sent:0, opened:0, clicked:0, replied:0, booked:0, bounced:0 }));
  const latest = new Map();
  const totals = { sent:0, opened:0, clicked:0, bounced:0 };
  activity.forEach((row) => {
    const bucket = steps[Number(row.step_order) - 1];
    const bounced = ['failed', 'bounced', 'complained'].includes(row.send_status);
    if (isSent(row)) totals.sent += 1;
    if (row.opened_count > 0) totals.opened += 1;
    if (row.clicked_count > 0) totals.clicked += 1;
    if (bounced) totals.bounced += 1;
    if (bucket) { if (isSent(row)) bucket.sent += 1; if (row.opened_count > 0) bucket.opened += 1; if (row.clicked_count > 0) bucket.clicked += 1; if (bounced) bucket.bounced += 1; }
    const key = row.enrollment_id ?? row.recipient_email;
    const prev = latest.get(key);
    if (isSent(row) && (!prev || Number(row.step_order) > Number(prev.step_order))) latest.set(key, row);
  });
  latest.forEach((row) => {
    const bucket = steps[Number(row.step_order) - 1];
    if (!bucket) return;
    if (['inbound_reply', 'replied'].includes(row.stopped_reason)) bucket.replied += 1;
    if (row.stopped_reason === 'growth_form_submission') bucket.booked += 1;
  });
  const reasons = Object.fromEntries((report?.stopReasons || []).map((row) => [row.reason, row.count]));
  totals.contacted = latest.size;
  totals.replied = (reasons.inbound_reply || 0) + (reasons.replied || 0) || steps.reduce((sum, step) => sum + step.replied, 0);
  totals.booked = reasons.growth_form_submission || steps.reduce((sum, step) => sum + step.booked, 0);
  totals.unsubscribed = reasons.unsubscribed || 0;
  const value = { steps, totals, reasons };
  statsCache = { key: report, count, value };
  return value;
}

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
  $('overviewBtn')?.classList.toggle('on', !state.campaign);
  $('campaignList').innerHTML = items.length ? items.map((campaign) => `
    <button type="button" class="cmp-item ${state.campaign?.id === campaign.id ? 'on' : ''}" data-id="${esc(campaign.id)}">
      <span class="dot ${esc(campaign.status)}" title="${esc(campaign.status)}"></span>
      <span><span class="nm">${esc(campaign.name)}</span><span class="mt">${plural(campaign.stepCount || 0, 'email')} · ${esc(campaign.activeCount ?? 0)} active${campaign.sentCount ? ` · ${pct(campaign.openedCount || 0, campaign.sentCount)} open` : ` · ${esc(relTime(campaign.updatedAt))}`}</span></span>
    </button>`).join('') : `<div class="cmp-empty">${state.campaigns.length ? 'No campaigns match.' : 'No campaigns yet.'}</div>`;
}
async function loadCampaigns() {
  const data = await api({ action:'list' });
  state.campaigns = data.campaigns || [];
  renderList();
  if (!state.campaign) renderWorkspace();
}

// ── Overview (Lemlist/Instantly-style campaign dashboard) ──────────────
function overviewHtml() {
  const list = state.campaigns;
  const sum = (key) => list.reduce((total, campaign) => total + (Number(campaign[key]) || 0), 0);
  const enrolled = sum('enrollmentCount');
  const sent = sum('sentCount');
  const kpis = [
    ['Live campaigns', list.filter((campaign) => campaign.status === 'active').length],
    ['Contacts enrolled', enrolled.toLocaleString()],
    ['In sequence now', sum('activeCount').toLocaleString()],
    ['Emails sent', sent.toLocaleString()],
    ['Open rate', pct(sum('openedCount'), sent)],
    ['Replies', sum('repliedCount').toLocaleString()],
    ['Meetings booked', sum('bookedCount').toLocaleString()],
    ['Unsubscribes', sum('unsubscribedCount').toLocaleString()],
  ];
  return `<div class="ws-head"><div class="ws-title"><h2 class="ov-title">All campaigns</h2><div class="ws-meta"><span>${plural(list.length, 'campaign')}</span><span>Sends Mon–Fri, 09:00–17:00 UK time from each contact's rep</span></div></div></div>
  <div class="ws-body">
    <section class="kpi-strip k8" style="margin:0 0 16px">${kpis.map(([k, v]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</section>
    <div class="tablewrap"><table class="ov-table"><thead><tr><th>Campaign</th><th>Status</th><th>Emails</th><th>Enrolled</th><th>Active</th><th>Sent</th><th>Opened</th><th>Replied</th><th>Booked</th><th>Updated</th></tr></thead><tbody>
      ${list.map((campaign) => `<tr class="clickable" data-open-campaign="${esc(campaign.id)}" tabindex="0">
        <td><span class="cell-main">${esc(campaign.name)}</span>${campaign.description ? `<span class="cell-sub">${esc(campaign.description)}</span>` : ''}</td>
        <td><span class="status-pill ${esc(campaign.status)}">${esc(campaign.status)}</span></td>
        <td>${campaign.stepCount || 0}</td>
        <td>${(campaign.enrollmentCount || 0).toLocaleString()}</td>
        <td>${(campaign.activeCount || 0).toLocaleString()}</td>
        <td>${(campaign.sentCount || 0).toLocaleString()}</td>
        <td>${pct(campaign.openedCount || 0, campaign.sentCount)}</td>
        <td>${campaign.repliedCount || 0}${campaign.enrollmentCount ? ` <span class="muted">${pct(campaign.repliedCount || 0, campaign.enrollmentCount)}</span>` : ''}</td>
        <td>${campaign.bookedCount || 0}</td>
        <td>${esc(relTime(campaign.updatedAt))}</td>
      </tr>`).join('')}
    </tbody></table></div>
    <p class="m-note" style="margin-top:10px">Reply rate is shown against enrolled contacts. Opens can be under-reported by inbox privacy features.</p>
  </div>`;
}

// ── Local draft recovery ────────────────────────────────────────────────────────
const draftKey = (id) => `cmp-draft:${id}`;
let draftTimer = null;
function stashDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (!state.campaign || !state.dirty) return;
    const parts = [...state.dirtyParts].filter((part) => part === 'meta' || part === 'steps');
    if (!parts.length) return;
    try { localStorage.setItem(draftKey(state.campaign.id), JSON.stringify({ savedAt: Date.now(), base: state.campaign.updatedAt, parts, draft: state.draft })); } catch { /* storage full or disabled */ }
  }, 500);
}
function forgetDraft(id) { clearTimeout(draftTimer); try { localStorage.removeItem(draftKey(id)); } catch { /* ignore */ } }
function readDraft(campaign) {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey(campaign.id)) || 'null');
    if (!saved?.draft || saved.base !== campaign.updatedAt) { if (saved) forgetDraft(campaign.id); return null; }
    return saved;
  } catch { return null; }
}
function restoreDraft() {
  const saved = state.restore;
  if (!saved) return;
  const parts = saved.parts.filter((part) => part !== 'steps' || !stepsLocked());
  if (parts.includes('meta')) Object.assign(state.draft, { name: saved.draft.name, description: saved.draft.description, bookingUrl: saved.draft.bookingUrl });
  if (parts.includes('steps')) state.draft.steps = saved.draft.steps.map((step) => ({ ...step }));
  state.restore = null;
  parts.forEach((part) => state.dirtyParts.add(part));
  renderWorkspace();
  setDirty(parts.length > 0);
  toast(parts.length ? 'Unsaved changes restored — save to keep them' : 'Nothing to restore — the emails are locked now', parts.length ? 'ok' : 'warn');
}
function renderNotice() {
  const host = $('wsNotice');
  if (!host) return;
  host.innerHTML = state.restore ? `<div class="banner restore">${ICON.info}<span>You have unsaved changes to this campaign from ${esc(relTime(new Date(state.restore.savedAt).toISOString()))}.</span><span class="spacer"></span><button type="button" class="ghost" data-act="discard-restore">Discard</button><button type="button" data-act="restore">Restore changes</button></div>` : '';
}

// ── Workspace ───────────────────────────────────────────────────────────
async function confirmDiscard() {
  if (!state.dirty) return true;
  const ok = await confirmDialog({ title:'Discard unsaved changes?', body:'Your edits to this campaign haven’t been saved yet.', confirmLabel:'Discard changes', danger:true });
  if (ok && state.campaign) forgetDraft(state.campaign.id);
  return ok;
}
function markDirty(part) {
  if (state.restore) { state.restore = null; renderNotice(); }
  state.dirtyParts.add(part); setDirty(true); stashDraft();
}
function clearDirty() { state.dirtyParts.clear(); setDirty(false); if (state.campaign) forgetDraft(state.campaign.id); }
function setDirty(value = true) {
  state.dirty = value;
  const save = $('saveBtn');
  if (save) { save.disabled = !value || archived(); save.classList.toggle('ghost', !value); }
  const flag = $('dirtyFlag');
  if (flag) flag.hidden = !value;
}
async function selectCampaign(id, { tab } = {}) {
  if (String(state.campaign?.id) !== String(id) && !(await confirmDiscard())) return;
  const data = await api({ action:'get', id });
  state.campaign = data.campaign;
  state.draft = { name: data.campaign.name, description: data.campaign.description || '', bookingUrl: data.campaign.bookingUrl || '', steps: data.campaign.steps.map((step) => ({ ...step })) };
  state.rules = null; state.report = null; state.enrollments = null;
  state.openStep = 0; state.tab = tab || state.tab || 'sequence';
  state.dirty = false; state.dirtyParts.clear(); state.selected.clear();
  state.restore = readDraft(data.campaign);
  history.replaceState(null, '', `/campaigns?id=${encodeURIComponent(id)}${state.tab !== 'sequence' ? `&tab=${state.tab}` : ''}`);
  renderList();
  renderWorkspace();
  Promise.allSettled([loadRules(), loadReport(), loadEnrollments()]).then(() => { if (String(state.campaign?.id) === String(id)) { renderHeaderMeta(); renderTabs(); if (state.tab !== 'sequence' || stepsLocked() || state.report?.activity?.length) renderTab(); } });
}
function showOverview() {
  state.campaign = null; state.draft = null; state.report = null; state.enrollments = null; state.rules = null;
  state.dirty = false; state.dirtyParts.clear(); state.restore = null;
  history.replaceState(null, '', '/campaigns');
  renderList();
  renderWorkspace();
}
function renderWorkspace() {
  const campaign = state.campaign;
  if (!campaign) {
    $('workspace').innerHTML = state.campaigns.length ? overviewHtml() : `<div class="ws-empty"><div class="ws-empty-card"><span class="ic">${ICON.mail}</span><h2>Build an email sequence</h2><p>Create multi-step campaigns with automatic waits, audience rules and stop conditions. Pick a campaign on the left or start a new one.</p><button type="button" data-act="new">${ICON.plus}New campaign</button></div></div>`;
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
          <button type="button" data-act="preview-full" ${state.draft.steps.length ? '' : 'disabled'}>${ICON.eye}Preview all emails</button>
          <button type="button" data-act="test-all" ${state.draft.steps.length ? '' : 'disabled'}>${ICON.send}Send test of every email</button>
          <button type="button" data-act="clone">${ICON.copy}Duplicate campaign</button>
          <button type="button" data-act="tab" data-tab="analytics">View analytics</button>
          <button type="button" class="danger" data-act="archive" ${archived() ? 'disabled' : ''}>${ICON.trash}Archive campaign</button>
        </div></details>
      </div>
    </div>
    <nav class="ws-tabs" role="tablist" id="wsTabs"></nav>
    <div id="wsNotice" class="ws-notice"></div>
    <div class="ws-body" id="tabBody"></div>`;
  renderHeaderMeta();
  renderTabs();
  renderNotice();
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
  const dates = projectSends(steps);
  return `${banner}
    <div class="seq-layout">
      <div>
        <div class="seq-summary"><span><strong>${plural(steps.length, 'email')}</strong> over ${plural(days[days.length - 1] || 0, 'day')}</span><span id="seqFinish" title="Projected for a contact enrolled right now, skipping weekends and out-of-hours">Enrolled now → last email ${esc(fmtShort(dates[dates.length - 1]))}</span><span>${totalWarnings ? `${plural(totalWarnings, 'suggestion')} to review` : 'All emails pass content checks'}</span><span class="spacer"></span><button type="button" class="ghost sm" data-act="preview-full">${ICON.eye}Preview all</button></div>
        <div id="steps">${steps.map((step, index) => `${index ? waitHtml(step, index, days[index], locked, dates[index]) : ''}${stepHtml(step, index, days[index], locked, dates[index])}`).join('')}</div>
        ${locked ? '' : `<div class="seq-add"><button type="button" class="ghost" data-act="add-blank">${ICON.plus}Add email</button><button type="button" class="ghost" data-act="add-template">Add from template</button></div>`}
      </div>
      <aside class="seq-preview" id="preview"></aside>
    </div>`;
}
function waitHtml(step, index, day, locked, date) {
  return `<div class="seq-wait">${ICON.clock}Wait <input type="number" min="0" max="365" value="${esc(step.waitDays)}" data-wait="${index}" aria-label="Days to wait before email ${index + 1}" ${locked ? 'disabled' : ''}/> days, then send <span class="day" data-day="${index}">· Day ${day} · e.g. ${esc(fmtShort(date))}</span></div>`;
}
function stepStatsHtml(index) {
  const stats = state.report?.activity?.length ? campaignStats().steps[index] : null;
  if (!stats?.sent) return '';
  return `<span class="seq-stats"><b>${stats.sent}</b> sent<i></i><b>${pct(stats.opened, stats.sent)}</b> opened<i></i><b>${pct(stats.clicked, stats.sent)}</b> clicked${stats.replied ? `<i></i><b>${stats.replied}</b> ${stats.replied === 1 ? 'reply' : 'replies'}` : ''}</span>`;
}
function stepHtml(step, index, day, locked, date) {
  const health = stepChecks(step);
  const open = state.openStep === index;
  const count = state.draft.steps.length;
  return `<article class="seq-step ${open ? 'open' : ''}" data-index="${index}">
    <header class="seq-step-head" data-toggle="${index}">
      <span class="seq-num">${index + 1}</span>
      <span class="seq-step-title"><strong>${esc(step.stepName || 'Untitled email')}</strong><span title="${index === 0 ? `e.g. ${esc(fmtShort(date))}` : ''}">Day ${day} · ${esc(stepTime(step))} · ${esc(step.subjectTemplate || 'No subject')}</span>${stepStatsHtml(index)}</span>
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
      <div class="step-foot"><button type="button" class="ghost" data-act="preview-full" data-i="${index}">${ICON.eye}Preview</button><button type="button" class="ghost" data-act="test" data-i="${index}">${ICON.send}Send test</button><span class="spacer"></span></div>
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
    <div class="pv-head"><strong>Preview · Email ${state.draft.steps.indexOf(step) + 1}</strong><div class="seg" role="group" aria-label="Preview size"><button type="button" class="${state.device === 'desktop' ? 'on' : ''}" data-device="desktop">Desktop</button><button type="button" class="${state.device === 'mobile' ? 'on' : ''}" data-device="mobile">Mobile</button></div><button type="button" class="ghost icon-btn" data-act="preview-full" data-i="${state.draft.steps.indexOf(step)}" title="Open full preview (P)" aria-label="Open full preview">${ICON.expand}</button></div>
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
function refreshSchedule() {
  const steps = state.draft.steps;
  const days = stepDays(steps);
  const dates = projectSends(steps);
  document.querySelectorAll('.seq-wait .day[data-day]').forEach((node) => { const i = Number(node.dataset.day); node.textContent = `· Day ${days[i]} · e.g. ${fmtShort(dates[i])}`; });
  const finish = $('seqFinish');
  if (finish) finish.textContent = `Enrolled now → last email ${fmtShort(dates[dates.length - 1])}`;
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
  if (mode === 'link') { openLinkDialog(index); return; }
  const input = document.querySelector(`[data-f="bodyTemplate"][data-i="${index}"]`);
  if (!input) return;
  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const selected = input.value.slice(start, end);
  if (mode === 'bold') input.setRangeText(`**${selected || 'bold text'}**`, start, end, 'end');
  if (mode === 'cta') input.setRangeText(`[${selected || 'Book a time that suits you'}]({{BOOKING_URL}})`, start, end, 'end');
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
  if (!(await confirmDialog({ title:`Enroll up to ${cap.toLocaleString()} matching leads now?`, body:`They join “${state.campaign.name}” straight away and get email 1 in the next business-hours window.`, confirmLabel:'Enroll matches' }))) return;
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
  const rows = visibleContacts();
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
    ${state.selected.size ? `<div class="bulk-bar" role="toolbar" aria-label="Bulk actions"><strong>${state.selected.size} selected</strong><button type="button" class="ghost" data-bulk="pause-enrollment">Pause</button><button type="button" class="ghost" data-bulk="resume-enrollment">Resume</button><button type="button" class="ghost" data-bulk="stop-enrollment">Stop</button><span class="spacer"></span><button type="button" class="ghost" data-act="clear-selection">Clear selection</button></div>` : ''}
    <div class="tablewrap"><table class="contacts-table"><thead><tr><th class="sel"><input type="checkbox" id="selAll" aria-label="Select all shown" ${rows.length && rows.every((row) => state.selected.has(row.id)) ? 'checked' : ''} ${rows.length ? '' : 'disabled'}/></th><th>Contact</th><th>Status</th><th>Progress</th><th>Next send</th><th>Last activity</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.map((row) => {
        const done = Math.min(total, Number(row.currentStep || 0));
        const reason = row.status === 'stopped' ? row.stoppedReason : row.status === 'paused' ? row.pausedReason : '';
        return `<tr class="${state.selected.has(row.id) ? 'picked' : ''}">
          <td class="sel"><input type="checkbox" data-sel="${esc(row.id)}" aria-label="Select ${esc(row.leadName || row.email || 'contact')}" ${state.selected.has(row.id) ? 'checked' : ''}/></td>
          <td><button type="button" class="link-btn" data-contact="${esc(row.id)}">${esc(row.leadName || row.email || 'Unknown')}</button><span class="cell-sub">${esc([row.companyName, row.email].filter(Boolean).join(' · '))}</span></td>
          <td><span class="status-pill ${esc(row.status)}">${esc(row.status)}</span>${reason ? `<span class="cell-sub">${esc(reasonLabel(reason))}</span>` : ''}</td>
          <td><span class="progress"><span class="bar"><i style="width:${Math.round((done / total) * 100)}%"></i></span>${done}/${total}</span></td>
          <td>${row.status === 'active' ? esc(fmtDateTime(row.nextStepDue)) : '—'}</td>
          <td>${row.lastEventType ? `${esc(row.lastEventType)} <span class="cell-sub">${esc(relTime(row.lastEventAt))}</span>` : row.lastSentAt ? `sent <span class="cell-sub">${esc(relTime(row.lastSentAt))}</span>` : '—'}</td>
          <td><div class="row-actions">${row.status === 'active' ? `<button type="button" class="ghost" data-enroll-act="pause-enrollment" data-eid="${esc(row.id)}">Pause</button>` : ''}${row.status === 'paused' ? `<button type="button" class="ghost" data-enroll-act="resume-enrollment" data-eid="${esc(row.id)}">Resume</button>` : ''}${['active', 'paused'].includes(row.status) ? `<button type="button" class="ghost" data-enroll-act="stop-enrollment" data-eid="${esc(row.id)}">Stop</button>` : ''}</div></td>
        </tr>`;
      }).join('') : `<tr><td colspan="7">${state.enrollments.length ? 'No contacts match this filter.' : 'Nobody is enrolled yet.'}</td></tr>`}
    </tbody></table></div>`;
}
function visibleContacts() {
  const query = state.contactQuery.trim().toLowerCase();
  return (state.enrollments || []).filter((row) => (state.contactFilter === 'all' || row.status === state.contactFilter)
    && (!query || [row.leadName, row.companyName, row.email].some((value) => String(value || '').toLowerCase().includes(query))));
}
const ENROLL_VERB = { 'pause-enrollment':'paused', 'resume-enrollment':'resumed', 'stop-enrollment':'stopped' };
async function enrollmentAction(action, enrollmentIds) {
  const ids = [].concat(enrollmentIds);
  if (action === 'stop-enrollment' && !(await confirmDialog({ title: ids.length > 1 ? `Stop ${ids.length} contacts?` : 'Stop this contact?', body:'They won’t receive any more emails from this campaign. This can’t be undone.', confirmLabel:'Stop', danger:true }))) return;
  try {
    const data = await api({ action, id: state.campaign.id, enrollmentIds: ids });
    ids.forEach((id) => state.selected.delete(id));
    await loadEnrollments();
    renderTab(); renderTabs();
    const skipped = ids.length - (data.updated || 0);
    toast(`${plural(data.updated || 0, 'contact')} ${ENROLL_VERB[action]}${skipped > 0 ? ` · ${skipped} skipped` : ''}`);
  } catch (error) { toast(error.message, 'bad'); }
}
async function resumeAllPaused() {
  const paused = (state.enrollments || []).filter((row) => row.status === 'paused').length;
  if (!(await confirmDialog({ title:`Resume ${plural(paused, 'paused contact')}?`, body:'Their next email sends in the next business-hours window.', confirmLabel:'Resume' }))) return;
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

function openContactTimeline(enrollmentId) {
  const row = (state.enrollments || []).find((item) => String(item.id) === String(enrollmentId));
  if (!row) return;
  const steps = state.draft.steps;
  const sends = (state.report?.activity || []).filter((item) => String(item.enrollment_id) === String(row.id));
  const current = Number(row.currentStep || 0);
  const upcoming = row.status === 'active' && current < steps.length ? projectSends(steps, current, row.nextStepDue ? new Date(row.nextStepDue) : null) : [];
  const owner = state.senders.find((sender) => String(sender.ghlOwnerId) === String(row.ownerId));
  const values = { ...sampleValues(), FIRST_NAME: firstName(row.leadName), COMPANY_NAME: row.companyName || '' };
  const items = steps.map((step, index) => {
    const send = sends.find((item) => Number(item.step_order) === index + 1);
    const title = `<strong>${index + 1}. ${esc(step.stepName || 'Untitled email')}</strong><span class="cell-sub">${esc(resolveVars(step.subjectTemplate, values))}</span>`;
    if (send) {
      const bad = ['failed', 'bounced', 'complained'].includes(send.send_status);
      return `<li class="${bad ? 'bad' : 'done'}">${title}<span class="tl-meta">${esc(send.send_status)} · ${esc(fmtDateTime(send.sent_at))}${send.opened_count ? ` · opened ${send.opened_count}×` : ''}${send.clicked_count ? ` · clicked ${send.clicked_count}×` : ''}</span></li>`;
    }
    if (upcoming[index]) return `<li class="${index === current ? 'next' : 'todo'}">${title}<span class="tl-meta">${index === current ? 'Next send' : 'Planned'} · ${esc(fmtShort(upcoming[index]))}</span></li>`;
    if (index < current) return `<li class="done">${title}<span class="tl-meta">Sent</span></li>`;
    return `<li class="todo">${title}<span class="tl-meta">${row.status === 'paused' ? 'Waiting — contact paused' : 'Not sent'}</span></li>`;
  });
  if (row.status === 'stopped') items.push(`<li class="bad"><strong>Stopped</strong><span class="tl-meta">${esc(reasonLabel(row.stoppedReason))} · ${esc(fmtDateTime(row.stoppedAt))}</span></li>`);
  if (row.status === 'completed') items.push('<li class="done"><strong>Completed the sequence</strong></li>');
  const actions = [
    row.status === 'active' ? `<button type="button" class="ghost" data-enroll-act="pause-enrollment" data-eid="${esc(row.id)}">Pause</button>` : '',
    row.status === 'paused' ? `<button type="button" class="ghost" data-enroll-act="resume-enrollment" data-eid="${esc(row.id)}">Resume</button>` : '',
    ['active', 'paused'].includes(row.status) ? `<button type="button" class="ghost" data-enroll-act="stop-enrollment" data-eid="${esc(row.id)}">Stop</button>` : '',
  ].join('');
  openModal(`
    <div class="m-head"><div><h2>${esc(row.leadName || row.email || 'Contact')}</h2><p>${esc([row.companyName, row.email].filter(Boolean).join(' · '))}</p></div><button type="button" class="x" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="m-body">
      <ul class="m-summary">
        <li><span>Status</span><span class="status-pill ${esc(row.status)}">${esc(row.status)}</span></li>
        <li><span>Sender</span>${esc(owner?.displayName || 'Owning rep')}</li>
        <li><span>Enrolled</span>${esc(row.enrolledVia || 'manual')} · ${esc(fmtDateTime(row.enrolledAt))}</li>
        <li><span>Last activity</span>${row.lastEventType ? `${esc(row.lastEventType)} · ${esc(relTime(row.lastEventAt))}` : row.lastSentAt ? `sent · ${esc(relTime(row.lastSentAt))}` : '—'}</li>
      </ul>
      <ol class="timeline">${items.join('')}</ol>
    </div>
    <div class="m-foot"><button type="button" class="ghost" data-preview-contact="${esc(row.id)}" data-i="${Math.min(current, steps.length - 1)}" ${steps.length ? '' : 'disabled'}>${ICON.eye}Preview as this contact</button><span class="spacer"></span>${actions}</div>`, { wide: true });
}

// ── Analytics tab ───────────────────────────────────────────────────────
async function loadReport() {
  state.report = await api({ action:'report', id: state.campaign.id });
}
function dailyChartHtml(activity) {
  const dayKey = (date) => date.toLocaleDateString('en-CA', { timeZone:'Europe/London' });
  const days = Array.from({ length: 14 }, (_, i) => { const date = new Date(Date.now() - (13 - i) * 86400000); const weekday = date.toLocaleDateString('en-GB', { timeZone:'Europe/London', weekday:'short' }); return { key: dayKey(date), label: date.toLocaleDateString('en-GB', { timeZone:'Europe/London', weekday:'short', day:'numeric', month:'short' }), short: date.toLocaleDateString('en-GB', { timeZone:'Europe/London', day:'numeric' }), weekend: ['Sat', 'Sun'].includes(weekday), sent:0, opened:0 }; });
  const byKey = new Map(days.map((day) => [day.key, day]));
  activity.forEach((row) => {
    if (!row.sent_at || ['pending', 'failed'].includes(row.send_status)) return;
    const bucket = byKey.get(dayKey(new Date(row.sent_at)));
    if (!bucket) return;
    bucket.sent += 1;
    if (row.opened_count > 0) bucket.opened += 1;
  });
  const max = Math.max(1, ...days.map((day) => day.sent));
  const total = days.reduce((sum, day) => sum + day.sent, 0);
  return `<div class="chart-legend"><span><i class="s"></i>Sent</span><span><i class="o"></i>Opened</span><span class="spacer"></span><span>${total.toLocaleString()} sent in the last 14 days</span></div>
    <div class="chart" role="img" aria-label="Emails sent per day over the last 14 days">${days.map((day) => `<div class="col ${day.weekend ? 'we' : ''}" title="${esc(day.label)}: ${day.sent} sent, ${day.opened} opened"><div class="bars"><i class="s" style="height:${(day.sent / max) * 100}%"></i><i class="o" style="height:${(day.opened / max) * 100}%"></i></div><span>${esc(day.short)}</span></div>`).join('')}</div>`;
}
function analyticsHtml() {
  const report = state.report;
  if (!report) return '<div class="card">Loading analytics…</div>';
  const enrolled = (report.enrollmentStatuses || []).reduce((sum, row) => sum + row.count, 0);
  const byStatus = Object.fromEntries((report.enrollmentStatuses || []).map((row) => [row.status, row.count]));
  const activity = report.activity || [];
  const { steps: perStep, totals } = campaignStats();
  const stepRows = state.draft.steps.map((step, index) => ({ step, ...(perStep[index] || {}) }));
  const bar = (part, whole, color) => `<span class="funnel-bar"><span class="bar"><i style="width:${whole ? Math.round((part / whole) * 100) : 0}%;background:${color}"></i></span><span class="pct">${pct(part, whole)}</span></span>`;
  const query = state.activityQuery.trim().toLowerCase();
  const filtered = activity.filter((row) => !query || [row.lead_name, row.recipient_email, row.company_name, row.owner_name, row.step_name].some((value) => String(value || '').toLowerCase().includes(query)));
  const log = report.ruleActivity || [];
  const logLabel = { campaign_rules_saved:'Audience rules saved', campaign_rules_backfill_run:'Backfill run', campaign_rules_auto_enroll:'Auto-enrolled new matches', campaign_rule_stop_applied:'Stop rule applied', campaign_activated:'Campaign activated' };
  const logDetail = (meta) => { const m = meta || {}; if (m.enrolled !== undefined) return `${m.enrolled} enrolled${m.skipped !== undefined ? `, ${m.skipped} skipped` : ''}`; if (m.backfillResult?.enrolled !== undefined) return `${m.backfillResult.enrolled} enrolled`; if (m.triggerRules !== undefined) return `${m.triggerRules} conditions, ${m.stopRules} stop rules`; if (m.stopped !== undefined) return `${m.stopped} stopped`; return ''; };
  const segments = [['active', 'Active', 'var(--green)'], ['paused', 'Paused', '#f59e0b'], ['completed', 'Completed', 'var(--blue)'], ['stopped', 'Stopped', 'var(--red)']];
  const reasons = report.stopReasons || [];
  return `<div class="an-grid">
    <section class="kpi-strip k8" style="margin:0">
      ${[['Enrolled', enrolled.toLocaleString(), ''], ['Contacted', totals.contacted.toLocaleString(), 'Received at least one email'], ['Emails sent', totals.sent.toLocaleString(), ''], ['Open rate', pct(totals.opened, totals.sent), 'Unique opens per sent email'], ['Click rate', pct(totals.clicked, totals.sent), 'Unique clicks per sent email'], ['Reply rate', pct(totals.replied, totals.contacted), `${totals.replied} replied`], ['Meetings booked', totals.booked.toLocaleString(), 'Booked via the landing page'], ['Bounced', totals.bounced.toLocaleString(), pct(totals.bounced, totals.sent)]].map(([k, v, hint]) => `<div class="kpi" ${hint ? `title="${esc(hint)}"` : ''}><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}
    </section>
    <div class="aud-grid">
      <section class="card"><h3>Daily sends</h3><p class="sub">Opens are counted on the day the email was sent.</p>${dailyChartHtml(activity)}</section>
      <section class="card"><h3>Contact outcomes</h3><p class="sub">Where everyone enrolled in this campaign is now.</p>
        <div class="stack-bar" role="img" aria-label="Enrollment status breakdown">${enrolled ? segments.map(([key, , color]) => (byStatus[key] ? `<i style="flex:${byStatus[key]};background:${color}" title="${key}: ${byStatus[key]}"></i>` : '')).join('') : ''}</div>
        <div class="stack-legend">${segments.map(([key, label, color]) => `<span><i style="background:${color}"></i>${label} <b>${(byStatus[key] || 0).toLocaleString()}</b></span>`).join('')}</div>
        ${reasons.length ? `<h4 class="mini-h">Why contacts stopped</h4><ul class="reason-list">${reasons.map((row) => `<li><span>${esc(reasonLabel(row.reason))}</span><b>${row.count.toLocaleString()}</b></li>`).join('')}</ul>` : ''}
      </section>
    </div>
    <section class="card"><h3>Performance by email</h3><p class="sub">Unique opens and clicks per sent email. Replies are credited to the last email a contact received. Opens can be under-reported by inbox privacy features.</p>
      <div class="tablewrap"><table><thead><tr><th>Email</th><th>Sent</th><th>Opened</th><th>Clicked</th><th>Replied</th><th></th></tr></thead><tbody>
        ${stepRows.length ? stepRows.map(({ step, sent = 0, opened = 0, clicked = 0, replied = 0 }, index) => `<tr><td><span class="cell-main">${index + 1}. ${esc(step.stepName)}</span><span class="cell-sub">${esc(step.subjectTemplate)}</span></td><td>${sent}</td><td>${bar(opened, sent, 'var(--blue)')}</td><td>${bar(clicked, sent, 'var(--green)')}</td><td>${replied}<span class="cell-sub">${pct(replied, sent)}</span></td><td><div class="row-actions"><button type="button" class="ghost" data-act="preview-full" data-i="${index}">${ICON.eye}Preview</button></div></td></tr>`).join('') : '<tr><td colspan="6">No emails in this sequence.</td></tr>'}
      </tbody></table></div>
    </section>
    <section class="card"><div class="tab-toolbar" style="margin-bottom:12px"><h3 style="margin:0">Send activity</h3><span class="spacer"></span><div class="search-field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="activitySearch" type="search" placeholder="Search activity" value="${esc(state.activityQuery)}" aria-label="Search activity" /></div><button type="button" class="ghost" data-act="export-activity" ${activity.length ? '' : 'disabled'}>${ICON.download}Export CSV</button><button type="button" class="ghost" data-act="refresh-report">Refresh</button></div>
      <div class="tablewrap" style="max-height:480px"><table><thead><tr><th>Recipient</th><th>Email</th><th>Status</th><th>Sent</th><th>Opens</th><th>Clicks</th><th>Enrollment</th><th>Stop reason</th></tr></thead><tbody>
        ${filtered.length ? filtered.slice(0, 500).map((row) => `<tr><td><span class="cell-main">${esc(row.lead_name || row.recipient_email || '')}</span><span class="cell-sub">${esc([row.company_name, row.owner_name].filter(Boolean).join(' · '))}</span></td><td>${esc(`${row.step_order}. ${row.step_name || ''}`)}</td><td><span class="status-pill ${['failed', 'bounced', 'complained'].includes(row.send_status) ? 'stopped' : row.send_status === 'pending' ? 'paused' : 'active'}">${esc(row.send_status || '')}</span></td><td>${esc(fmtDateTime(row.sent_at))}</td><td>${row.opened_count || 0}</td><td>${row.clicked_count || 0}</td><td>${esc(row.enrollment_status || '')}</td><td>${esc(row.stopped_reason ? reasonLabel(row.stopped_reason) : '')}</td></tr>`).join('') : `<tr><td colspan="8">${activity.length ? 'No activity matches your search.' : 'No emails have been sent yet.'}</td></tr>`}
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
    state.restore = null;
    renderNotice();
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
  if (action === 'archive' && !(await confirmDialog({ title:`Archive “${state.campaign.name}”?`, body:'All active and paused contacts are stopped and the campaign leaves the list. Reporting is kept. This can’t be undone.', confirmLabel:'Archive campaign', danger:true }))) return;
  if (action === 'pause' && !(await confirmDialog({ title:'Pause this campaign?', body:'All active contacts are paused and no more emails send until you resume.', confirmLabel:'Pause campaign' }))) return;
  try {
    const data = await api({ action, id: state.campaign.id });
    await loadCampaigns();
    if (action === 'archive') { forgetDraft(state.campaign.id); showOverview(); toast('Campaign archived'); return; }
    state.campaign = data.campaign;
    await loadEnrollments();
    renderWorkspace();
    toast(action === 'pause' ? 'Campaign paused' : 'Updated');
  } catch (error) { toast(error.message, 'bad'); }
}
async function cloneCampaign() {
  if (!(await confirmDiscard())) return;
  try {
    const data = await api({ action:'clone', id: state.campaign.id });
    state.dirty = false; state.dirtyParts.clear();
    await loadCampaigns();
    await selectCampaign(data.campaign.id, { tab:'sequence' });
    toast('Duplicated as a new draft');
  } catch (error) { toast(error.message, 'bad'); }
}

// ── Modals ──────────────────────────────────────────────────────────────
function openModal(html, { wide = false, size = '' } = {}) {
  const modal = $('modal');
  modal.className = `cmp-modal ${wide ? 'wide' : ''} ${size}`;
  modal.innerHTML = html;
  if (!modal.open) modal.showModal();
  modal.querySelector('input:not([type=radio]):not([type=checkbox]), select, textarea')?.focus();
}
function closeModal() { const modal = $('modal'); if (modal.open) modal.close(); }
let modalPressedBackdrop = false;
$('modal').addEventListener('mousedown', (event) => { modalPressedBackdrop = event.target === event.currentTarget; });
$('modal').addEventListener('click', (event) => {
  if ((event.target === event.currentTarget && modalPressedBackdrop) || event.target.closest('[data-close]')) closeModal();
});

// ── Full email preview (inbox view + message, step by step) ─────────────
function applyContactSample(enrollmentId) {
  const row = (state.enrollments || []).find((item) => String(item.id) === String(enrollmentId));
  if (!row) { Object.assign(state.sample, { firstName:'Alex', companyName:'Acme Ltd', contactId:'' }); return; }
  const sender = state.senders.find((item) => String(item.ghlOwnerId) === String(row.ownerId));
  Object.assign(state.sample, { firstName: firstName(row.leadName), companyName: row.companyName || '', contactId: String(row.id), ...(sender ? { senderEmail: sender.email } : {}) });
}
function plainSnippet(text) {
  return String(text || '').replace(/\[([^\]\n]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
}
function openPreviewModal(index = state.openStep) {
  if (!state.draft?.steps.length) return;
  state.previewIndex = Math.max(0, Math.min(Number.isFinite(index) ? index : 0, state.draft.steps.length - 1));
  openModal('<div class="pvm" id="pvm" tabindex="-1"></div>', { size:'xl tall' });
  renderPreviewModal();
  $('pvm').focus();
}
function renderPreviewModal() {
  const host = $('pvm');
  if (!host) return;
  const steps = state.draft.steps;
  const index = state.previewIndex;
  const step = steps[index];
  const email = renderEmailHtml(step);
  const days = stepDays(steps);
  const dates = projectSends(steps);
  const health = stepChecks(step);
  const locked = stepsLocked();
  const contacts = (state.enrollments || []).slice(0, 200);
  const senderOptions = state.senders.length ? state.senders.map((sender) => `<option value="${esc(sender.email)}" ${sender.email === state.sample.senderEmail ? 'selected' : ''}>${esc(sender.displayName)}</option>`).join('') : '<option value="">Sample sender</option>';
  const snippet = plainSnippet(resolveVars(step.bodyTemplate, email.values));
  host.innerHTML = `
    <div class="m-head"><div><h2>Email preview</h2><p>What contacts receive — variables filled in, signature and booking link included.</p></div><button type="button" class="x" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="pvm-body">
      <nav class="pvm-steps" aria-label="Emails in this sequence">${steps.map((item, i) => `<button type="button" class="pvm-step ${i === index ? 'on' : ''}" data-pv-step="${i}"><span class="seq-num">${i + 1}</span><span><strong>${esc(item.stepName || 'Untitled email')}</strong><small>Day ${days[i]} · ${esc(item.subjectTemplate || 'No subject')}</small></span><span class="dot ${stepChecks(item).grade}"></span></button>`).join('')}</nav>
      <div class="pvm-main">
        <div class="pvm-bar">
          <label>Preview as<select id="pvContact"><option value="">Sample contact · ${esc(state.sample.contactId ? 'Alex · Acme Ltd' : `${state.sample.firstName || 'Contact'} · ${state.sample.companyName || 'Company'}`)}</option>${contacts.map((row) => `<option value="${esc(row.id)}" ${String(row.id) === state.sample.contactId ? 'selected' : ''}>${esc(row.leadName || row.email)}${row.companyName ? ` · ${esc(row.companyName)}` : ''}</option>`).join('')}</select></label>
          <label>From<select data-sample="senderEmail">${senderOptions}</select></label>
          <span class="spacer"></span>
          <div class="seg" role="group" aria-label="Preview size"><button type="button" class="${state.device === 'desktop' ? 'on' : ''}" data-device="desktop">Desktop</button><button type="button" class="${state.device === 'mobile' ? 'on' : ''}" data-device="mobile">Mobile</button></div>
        </div>
        <div class="pvm-stage ${state.device === 'mobile' ? 'mobile' : ''}">
          <div class="pvm-inbox" aria-label="Inbox view">
            <span class="av">${esc((email.values.SENDER_NAME || 'Y')[0])}</span>
            <span class="who">${esc(email.values.SENDER_NAME)}</span>
            <span class="line"><b>${esc(email.subject) || '(no subject)'}</b> <span>— ${esc(snippet)}</span></span>
            <time>${esc(stepTime(step))}</time>
          </div>
          <div class="pv-frame ${state.device === 'mobile' ? 'mobile' : ''}">
            <div class="pv-mail-head"><span class="subj">${esc(email.subject) || '<span style="color:var(--faint)">(no subject)</span>'}</span><span><b>From</b> ${esc(email.values.SENDER_NAME)} &lt;${esc(email.values.SENDER_EMAIL)}&gt;</span><span><b>To</b> ${esc(state.sample.firstName || 'Contact')} · ${esc(state.sample.companyName || 'Company')}</span></div>
            <div class="pv-body">${email.html}<p class="pv-unsub">Unsubscribe link is added to the email header automatically.</p></div>
          </div>
        </div>
        <div class="pvm-facts"><span>Email ${index + 1} of ${steps.length}</span><span>Day ${days[index]} · e.g. ${esc(fmtShort(dates[index]))}</span><span>${health.words} words</span><span class="health ${health.grade}">${health.label}</span></div>
        ${health.checks.length ? `<ul class="checks">${checksHtml(health)}</ul>` : ''}
      </div>
    </div>
    <div class="m-foot"><span class="m-note kbd-hint"><kbd>←</kbd><kbd>→</kbd> switch emails</span><span class="spacer"></span><button type="button" class="ghost" data-pv-nav="-1" ${index === 0 ? 'disabled' : ''}>Previous</button><button type="button" class="ghost" data-pv-nav="1" ${index === steps.length - 1 ? 'disabled' : ''}>Next</button><button type="button" class="ghost" data-pv-edit="${index}">${locked ? 'Show in sequence' : 'Edit email'}</button><button type="button" data-pv-test="${index}">${ICON.send}Send test</button></div>`;
  if (!host.contains(document.activeElement)) host.focus({ preventScroll: true });
}
function refreshPreviews() { renderPreview(); renderPreviewModal(); }
function previewGo(delta) {
  const next = state.previewIndex + delta;
  if (next < 0 || next >= state.draft.steps.length) return;
  state.previewIndex = next;
  renderPreviewModal();
}
function editStep(index) {
  closeModal();
  if (state.tab !== 'sequence') setTab('sequence');
  state.openStep = index;
  rerenderSequence(index);
  const card = document.querySelector(`.seq-step[data-index="${index}"]`);
  card?.scrollIntoView({ block:'start', behavior:'smooth' });
  if (!stepsLocked()) card?.querySelector('textarea')?.focus({ preventScroll:true });
}

// ── Small dialogs ───────────────────────────────────────────────────────
function openLinkDialog(index) {
  const input = document.querySelector(`[data-f="bodyTemplate"][data-i="${index}"]`);
  if (!input) return;
  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const selected = input.value.slice(start, end).replace(/[[\]\n]/g, '');
  openModal(`
    <div class="m-head"><div><h2>Insert link</h2><p>Keep to one or two links per email for the best deliverability.</p></div><button type="button" class="x" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="m-body">
      <label class="field">Text to show<input id="linkText" value="${esc(selected)}" placeholder="e.g. our latest case study" maxlength="200" /></label>
      <label class="field">Web address<input id="linkUrl" type="url" placeholder="https://" maxlength="2000" /></label>
    </div>
    <div class="m-foot"><button type="button" class="ghost" data-close>Cancel</button><button type="button" id="linkOk">Insert link</button></div>`);
  if (selected) $('linkUrl').focus();
  const submit = () => {
    const url = $('linkUrl').value.trim();
    if (!/^https?:\/\/[^\s()]+$/i.test(url)) { toast('Enter a full web address starting with https://', 'warn'); $('linkUrl').focus(); return; }
    const label = $('linkText').value.replace(/[[\]\n]/g, '').trim() || url.replace(/^https?:\/\//i, '');
    closeModal();
    input.focus();
    input.setRangeText(`[${label}](${url})`, start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  $('linkOk').addEventListener('click', submit);
  $('modal').querySelectorAll('input').forEach((field) => field.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }));
}

async function openNewCampaign() {
  if (!(await confirmDiscard())) return;
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
  let current = null;
  const variantsFor = (subsector) => (subsector === 'All sectors' ? GENERAL_VARIANTS : VARIANTS);
  const showPreview = (subsector, key) => {
    const variant = variantsFor(subsector).find((item) => item.key === key);
    const tpl = variant && composeTemplate(subsector, variant.key);
    current = tpl ? { subsector, variant } : null;
    document.querySelectorAll('#tplList .tpl').forEach((node) => node.classList.toggle('on', node.dataset.tplView === key));
    if (!tpl) { $('tplPreview').innerHTML = '<div class="pv-empty">Pick a template to preview it.</div>'; return; }
    const email = renderEmailHtml({ subjectTemplate: tpl.subject, bodyTemplate: tpl.body });
    const words = stepChecks({ stepName: variant.label, subjectTemplate: tpl.subject, bodyTemplate: tpl.body, sendHour: 9 }).words;
    $('tplPreview').innerHTML = `<div class="pv-frame"><div class="pv-mail-head"><span class="subj">${esc(email.subject)}</span><span>${esc(variant.description)} · ${words} words</span></div><div class="pv-body">${email.html}</div></div>`;
  };
  const renderTemplates = (subsector) => {
    $('tplList').innerHTML = variantsFor(subsector).map((variant) => {
      const tpl = composeTemplate(subsector, variant.key);
      return tpl ? `<div class="tpl" data-tpl-view="${esc(variant.key)}" tabindex="0"><strong>${esc(variant.label)}</strong><span>“${esc(tpl.subject)}”</span><button type="button" class="ghost" data-tpl="${esc(variant.key)}">Add</button></div>` : '';
    }).join('');
    showPreview(subsector, variantsFor(subsector)[0]?.key);
  };
  const add = (key, button) => {
    const subsector = $('tplSector').value;
    const variant = variantsFor(subsector).find((item) => item.key === key);
    if (!variant) return;
    state.draft.steps.push(templateStep(subsector, variant, state.draft.steps.length));
    markDirty('steps');
    rerenderSequence(state.draft.steps.length - 1);
    if (button) { button.textContent = 'Added'; button.disabled = true; }
    toast(`Added “${variant.label}” as email ${state.draft.steps.length}`);
  };
  openModal(`
    <div class="m-head"><div><h2>Add from template</h2><p>Proven i3MEDIA copy, previewed with your sample contact. Everything stays editable after you add it.</p></div><button type="button" class="x" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="m-body">
      <label class="field">Audience<select id="tplSector"><option value="All sectors">General sequence (all sectors)</option>${sectors.map((item) => `<option value="${esc(item.label)}">${esc(item.sector)} · ${esc(item.label)}</option>`).join('')}</select></label>
      <div class="tpl-layout"><div class="tpl-list" id="tplList"></div><div class="tpl-preview" id="tplPreview"></div></div>
    </div>
    <div class="m-foot"><span class="m-note">Click a template to preview it.</span><span class="spacer"></span><button type="button" class="ghost" data-close>Done</button><button type="button" id="tplAddCurrent">${ICON.plus}Add this email</button></div>`, { size:'xl' });
  renderTemplates('All sectors');
  $('tplSector').addEventListener('change', (event) => renderTemplates(event.target.value));
  $('tplList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tpl]');
    if (button) { add(button.dataset.tpl, button); return; }
    const item = event.target.closest('[data-tpl-view]');
    if (item) showPreview($('tplSector').value, item.dataset.tplView);
  });
  $('tplList').addEventListener('keydown', (event) => {
    const item = event.target.closest('[data-tpl-view]');
    if (item && (event.key === 'Enter' || event.key === ' ') && event.target === item) { event.preventDefault(); showPreview($('tplSector').value, item.dataset.tplView); }
  });
  $('tplAddCurrent').addEventListener('click', () => {
    if (!current) return;
    add(current.variant.key, document.querySelector(`#tplList [data-tpl="${CSS.escape(current.variant.key)}"]`));
  });
}
async function sendTestEmail({ step, index, to, fromEmail, first, company }) {
  const sender = state.senders.find((item) => item.email === fromEmail);
  const response = await fetch('/api/email-send', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'same-origin', body:JSON.stringify({ action:'send-test', toEmail: to, fromEmail, fromName: sender?.displayName || '', testFirstName: first || 'Alex', testCompanyName: company || 'Acme Ltd', templateKey: `campaign:${state.campaign.id}:step:${index + 1}`, subjectTemplate: step.subjectTemplate, bodyTemplate: step.bodyTemplate, senderTitle:'', bookingUrl: state.draft.bookingUrl || DEFAULT_BOOKING_URL }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || 'Unable to send test email');
}
function openTestDialog(index, { all = false } = {}) {
  const steps = state.draft.steps;
  if (!steps[index] && !all) return;
  const senderOptions = state.senders.map((sender) => `<option value="${esc(sender.email)}" ${sender.email === state.sample.senderEmail ? 'selected' : ''}>${esc(sender.displayName)} &lt;${esc(sender.email)}&gt;</option>`).join('') || '<option value="">No senders configured</option>';
  openModal(`
    <div class="m-head"><div><h2>Send a test</h2><p>Uses the current (unsaved) copy with sample data. Test sends are logged under Analytics.</p></div><button type="button" class="x" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="m-body">
      <label class="field">Send to<input id="testTo" type="email" value="${esc(state.lastTestTo)}" placeholder="you@company.com" /></label>
      <label class="field">From<select id="testFrom">${senderOptions}</select></label>
      <div class="field-row" style="grid-template-columns:1fr 1fr"><label class="field">Sample first name<input id="testFirst" value="${esc(state.sample.firstName)}" /></label><label class="field">Sample company<input id="testCompany" value="${esc(state.sample.companyName)}" /></label></div>
      ${steps.length > 1 ? `<label class="switch-row" style="border:0;padding:4px 0 0"><input type="checkbox" class="switch" id="testAll" ${all ? 'checked' : ''} /><span><strong>Send every email in the sequence</strong><small>${plural(steps.length, 'test email')}, sent one after another so you can check the whole flow in your inbox.</small></span></label>` : ''}
      <p class="m-note" id="testWhich">${all ? `All ${steps.length} emails` : `Email ${index + 1} · ${esc(steps[index]?.stepName || '')}`}</p>
    </div>
    <div class="m-foot"><button type="button" class="ghost" data-close>Cancel</button><button type="button" id="sendTest">${ICON.send}Send test</button></div>`);
  $('testAll')?.addEventListener('change', (event) => { $('testWhich').textContent = event.target.checked ? `All ${steps.length} emails` : `Email ${index + 1} · ${steps[index]?.stepName || ''}`; });
  $('sendTest').addEventListener('click', async () => {
    const to = $('testTo').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { toast('Enter a valid email address', 'warn'); $('testTo').focus(); return; }
    const targets = $('testAll')?.checked ? steps.map((step, i) => [step, i]) : [[steps[index], index]];
    const options = { to, fromEmail: $('testFrom').value, first: $('testFirst').value.trim(), company: $('testCompany').value.trim() };
    $('sendTest').disabled = true;
    let sent = 0;
    try {
      for (const [step, i] of targets) {
        $('sendTest').textContent = targets.length > 1 ? `Sending ${sent + 1} of ${targets.length}…` : 'Sending…';
        await sendTestEmail({ ...options, step, index: i });
        sent += 1;
      }
      state.lastTestTo = to;
      closeModal();
      toast(targets.length > 1 ? `${sent} test emails sent to ${to}` : `Test sent to ${to}`);
    } catch (error) {
      $('sendTest').disabled = false; $('sendTest').innerHTML = `${ICON.send}Send test`;
      toast(sent ? `${sent} sent, then: ${error.message}` : error.message, 'bad');
    }
    loadReport().then(() => { if (state.tab === 'analytics') renderTab(); }).catch(() => {});
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
      .map((user) => { const first = String(user.name || user.email).trim().split(/\s+/)[0]; return { email: user.email, name: user.name, title: user.senderTitle || '', displayName: `${first} @ I3MEDIA`, signature: '', ghlOwnerId: user.ghlOwnerId }; });
    if (!state.sample.senderEmail && state.senders[0]) state.sample.senderEmail = state.senders[0].email;
    if (state.tab === 'sequence') renderPreview();
  } catch { /* preview falls back to sample sender */ }
}

// ── Events ──────────────────────────────────────────────────────────────
document.addEventListener('click', (event) => {
  const target = event.target.closest('button, [data-toggle], [data-filter], [data-open-campaign]');
  if (!target || target.closest('#tplList')) return;
  if (target.closest('.menu-list')) target.closest('details')?.removeAttribute('open');
  const { act } = target.dataset;
  if (target.matches('.cmp-item')) { selectCampaign(target.dataset.id, { tab:'sequence' }).catch((error) => toast(error.message, 'bad')); return; }
  if (target.dataset.openCampaign) { selectCampaign(target.dataset.openCampaign, { tab:'sequence' }).catch((error) => toast(error.message, 'bad')); return; }
  if (target.dataset.pvStep !== undefined) { state.previewIndex = Number(target.dataset.pvStep); renderPreviewModal(); return; }
  if (target.dataset.pvNav) { previewGo(Number(target.dataset.pvNav)); return; }
  if (target.dataset.pvEdit !== undefined) { editStep(Number(target.dataset.pvEdit)); return; }
  if (target.dataset.pvTest !== undefined) { openTestDialog(Number(target.dataset.pvTest)); return; }
  if (target.dataset.previewContact) { applyContactSample(target.dataset.previewContact); openPreviewModal(Number(target.dataset.i) || 0); renderPreview(); return; }
  if (target.dataset.contact) { openContactTimeline(target.dataset.contact); return; }
  if (target.dataset.bulk) { enrollmentAction(target.dataset.bulk, [...state.selected]); return; }
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
    const campaignId = state.campaign.id;
    const [removed] = state.draft.steps.splice(index, 1);
    markDirty('steps'); rerenderSequence(Math.max(0, index - 1));
    toast(`Deleted “${removed.stepName || `email ${index + 1}`}”`, 'ok', { action:'Undo', onAction: () => {
      if (state.campaign?.id !== campaignId || stepsLocked()) return;
      state.draft.steps.splice(Math.min(index, state.draft.steps.length), 0, removed);
      markDirty('steps'); rerenderSequence(index);
    } });
    return;
  }
  if (target.dataset.fmt) { applyFormat(target.dataset.fmt, Number(target.dataset.i)); return; }
  if (target.dataset.device) { state.device = target.dataset.device; refreshPreviews(); return; }
  if (target.dataset.contactFilter) { state.contactFilter = target.dataset.contactFilter; renderTab(); return; }
  if (target.dataset.enrollAct) { if (target.closest('#modal')) closeModal(); enrollmentAction(target.dataset.enrollAct, Number(target.dataset.eid)); return; }
  if (target.matches('[data-remove-rule]')) { target.closest('.rule-row').remove(); markDirty('rules'); return; }
  if (target.id === 'addTriggerRule') { $('triggerRules').querySelector('.rule-empty')?.remove(); $('triggerRules').appendChild(ruleRow('trigger')); markDirty('rules'); return; }
  if (target.id === 'addStopRule') { $('stopRules').appendChild(ruleRow('stop', { field:'disposition', operator:'in', value:['Not interested'] })); markDirty('rules'); return; }
  if (target.id === 'previewRules') { previewMatches().catch((error) => toast(error.message, 'bad')); return; }
  if (target.id === 'runBackfill') { runBackfill().catch((error) => toast(error.message, 'bad')); return; }
  if (!act) return;
  if (act === 'new') openNewCampaign();
  else if (act === 'overview') { confirmDiscard().then((ok) => { if (ok) showOverview(); }); }
  else if (act === 'preview-full') openPreviewModal(target.dataset.i !== undefined ? Number(target.dataset.i) : Math.max(0, state.openStep));
  else if (act === 'test-all') openTestDialog(0, { all: true });
  else if (act === 'restore') restoreDraft();
  else if (act === 'discard-restore') { forgetDraft(state.campaign.id); state.restore = null; renderNotice(); }
  else if (act === 'clear-selection') { state.selected.clear(); renderTab(); }
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
  if (target.dataset.sample) { state.sample[target.dataset.sample] = target.value; if (target.dataset.sample !== 'senderEmail') state.sample.contactId = ''; refreshPreviews(); return; }
  if (target.dataset.wait !== undefined) {
    state.draft.steps[Number(target.dataset.wait)].waitDays = Math.max(0, Math.min(365, Number.parseInt(target.value, 10) || 0));
    markDirty('steps');
    state.draft.steps.forEach((_step, i) => refreshStepChrome(i));
    refreshSchedule();
    renderHeaderMeta();
    return;
  }
  if (target.dataset.f && target.dataset.i !== undefined) {
    const index = Number(target.dataset.i);
    const step = state.draft.steps[index];
    if (target.dataset.f === 'sendTime') { const [hour, minute] = target.value.split(':').map(Number); step.sendHour = Number.isFinite(hour) ? hour : 9; step.sendMinute = Number.isFinite(minute) ? minute : 0; refreshSchedule(); }
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
  if (target.matches('[data-sample]')) { state.sample[target.dataset.sample] = target.value; refreshPreviews(); return; }
  if (target.id === 'pvContact') { applyContactSample(target.value); refreshPreviews(); return; }
  if (target.dataset.sel) { const id = Number(target.dataset.sel); if (target.checked) state.selected.add(id); else state.selected.delete(id); renderTab(); return; }
  if (target.id === 'selAll') { visibleContacts().forEach((row) => (target.checked ? state.selected.add(row.id) : state.selected.delete(row.id))); renderTab(); return; }
  const row = target.closest('.rule-row');
  if (row && (target.matches('[data-rule-field]') || target.matches('[data-rule-operator]'))) {
    const previous = [...row.querySelectorAll('[data-rule-value] input:checked')].map((input) => input.value);
    const single = row.querySelector('[data-rule-value] select')?.value;
    fillRuleValues(row, target.matches('[data-rule-field]') ? [] : previous.length ? previous : single ? [single] : []);
  }
  if (target.closest('.aud-grid') && target.id !== 'backfillCap') markDirty('rules');
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && state.campaign) { event.preventDefault(); if (state.dirty) saveAll(); return; }
  if (event.key === 'Escape' && $('modal').open) { event.preventDefault(); closeModal(); return; }
  if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
  if ($('pvm') && $('modal').open) {
    if (['ArrowRight', 'ArrowDown', 'j'].includes(event.key)) { event.preventDefault(); previewGo(1); }
    if (['ArrowLeft', 'ArrowUp', 'k'].includes(event.key)) { event.preventDefault(); previewGo(-1); }
    return;
  }
  if (event.key === 'Enter' && event.target.matches?.('[data-open-campaign]')) { event.target.click(); return; }
  if (event.key.toLowerCase() === 'p' && !$('modal').open && state.campaign && state.draft.steps.length) { event.preventDefault(); openPreviewModal(Math.max(0, state.openStep)); }
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
