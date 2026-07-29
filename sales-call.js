/* Shared call widget: dial modal + outcome logging + call timeline.
   Used by Outbound and Inbound. Config (3CX dial URL) is workspace-level.

   Usage:
     await SalesCall.init({ isAdmin: caps.isAdmin });
     SalesCall.open(leadObj, { canAct: caps.changeStatus, onDone: reloadFn });
     const calls = await SalesCall.fetchCalls(leadId);
     el.innerHTML = SalesCall.renderTimeline(calls);
*/
(function () {
  const CFG = { template: '', serverDial: false };
  let isAdmin = false;
  let current = null; // { lead, canAct, onDone }

  const OUTCOMES = [
    { key: 'answered_interested',     label: 'Answered · interested',     outcome: 'Answered - interested',  disposition: 'Interested',      status: null,              tone: 'good' },
    { key: 'answered_not_interested', label: 'Answered · not interested', outcome: 'Answered - not interested', disposition: 'Not interested', status: 'not_interested',  tone: 'bad'  },
    { key: 'wants_info',              label: 'Wants more info',           outcome: 'Answered - wants info',  disposition: 'Interested',      status: 'wants_more_info', tone: 'info' },
    { key: 'callback',                label: 'Callback booked',           outcome: 'Callback booked',        disposition: 'Callback booked', status: 'to_call_back', needsDate: true, tone: 'info' },
    { key: 'no_answer',               label: 'No answer',                 outcome: 'No answer',              disposition: 'No answer',       status: 'no_answer',       tone: 'warn' },
    { key: 'voicemail',               label: 'Left voicemail',            outcome: 'Left voicemail',         disposition: 'Left voicemail',  status: 'no_answer',       tone: 'warn' },
    { key: 'gatekeeper',              label: 'Gatekeeper',                outcome: 'Gatekeeper',             disposition: 'Gatekeeper',      status: null,              tone: 'warn' },
    { key: 'wrong_number',            label: 'Wrong number',              outcome: 'Wrong number',           disposition: 'Wrong number',    status: 'not_interested',  tone: 'bad'  },
  ];

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  async function api(body) {
    const res = await fetch('/api/apollo-sales-queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    return res.json().catch(() => ({ success: false, error: 'Request failed' }));
  }

  function myExtension() { return localStorage.getItem('sq_3cx_ext') || ''; }
  function setExtension() {
    const cur = myExtension();
    const v = prompt('Your 3CX extension (for "Ring my phone"):', cur || '');
    if (v === null) return;
    const clean = v.trim();
    if (clean) localStorage.setItem('sq_3cx_ext', clean); else localStorage.removeItem('sq_3cx_ext');
    if (current) renderPrimary();
  }

  async function configureTemplate() {
    if (!isAdmin) { toast('Only an admin can set the workspace 3CX dial URL.'); return; }
    const v = prompt('Workspace 3CX dial URL template. Use %number% for the phone number.\nExample: https://YOURPBX.3cx.eu/webclient/#/call/%number%', CFG.template || '');
    if (v === null) return;
    const d = await api({ action: 'set-config', threecxDialTemplate: v.trim() });
    if (d && d.success) { CFG.template = d.threecxDialTemplate || ''; toast('3CX dial URL saved for the workspace.'); if (current) renderPrimary(); }
    else toast((d && d.error) || 'Could not save config');
  }

  function buildUrl(tpl, phone) {
    const clean = String(phone || '').replace(/[^+0-9]/g, '');
    const digits = clean.replace(/\D/g, '');
    return tpl.replace(/%number%/gi, clean).replace(/%digits%/gi, digits).replace(/%e164%/gi, clean);
  }

  const MODAL_HTML = `
    <div id="scDialOverlay" class="overlay dial hidden">
      <div class="box">
        <div class="market-head">
          <h3 id="scTitle">Call</h3>
          <button class="ghost" id="scClose">Close</button>
        </div>
        <div class="dial-number" id="scNumber">–</div>
        <div class="dial-sub" id="scSub"></div>
        <div class="dial-primary" id="scPrimary"></div>
        <div id="scOutcomeWrap">
          <label class="f" style="margin-top:14px">Call notes (optional)</label>
          <textarea id="scNotes" placeholder="What happened on the call..."></textarea>
          <div id="scCbWrap" class="hidden">
            <label class="f" style="margin-top:10px">Callback date</label>
            <input type="date" id="scCb" style="width:100%" />
          </div>
          <label class="f" style="margin-top:14px">Log the outcome</label>
          <div class="outcome-grid" id="scOutcomes"></div>
        </div>
      </div>
    </div>`;

  function injectDom() {
    if (document.getElementById('scDialOverlay')) return;
    const holder = document.createElement('div');
    holder.innerHTML = MODAL_HTML.trim();
    document.body.appendChild(holder.firstElementChild);
    document.getElementById('scClose').addEventListener('click', close);
    document.getElementById('scDialOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) close(); });
  }

  function toast(msg) { const el = document.getElementById('status'); if (el) el.textContent = msg; }

  function renderPrimary() {
    const el = document.getElementById('scPrimary');
    if (!el) return;
    const ext = myExtension();
    const canServer = CFG.serverDial && ext && (current && current.canAct);
    el.innerHTML = `
      ${canServer ? `<button class="call3cx" data-m="server">Ring my phone (${esc(ext)})</button>` : ''}
      <button class="call3cx" data-m="3cx">Call via 3CX</button>
      <span class="dial-link" data-m="tel">Use softphone (tel:)</span>
      ${CFG.serverDial ? `<span class="dial-link" data-m="ext">${ext ? 'Change extension' : 'Set my extension'}</span>` : ''}
      ${isAdmin ? `<span class="dial-link" data-m="cfg" style="margin-left:auto">Configure 3CX dialing</span>` : ''}`;
    el.querySelectorAll('[data-m]').forEach((n) => n.addEventListener('click', () => act(n.getAttribute('data-m'))));
  }

  function act(method) {
    if (method === 'ext') return setExtension();
    if (method === 'cfg') return configureTemplate();
    const phone = current?.lead?.phone;
    if (!phone) { toast('No phone number.'); return; }
    if (method === 'server') return serverDial();
    if (method === '3cx') {
      if (!CFG.template) { if (isAdmin) return configureTemplate(); toast('Ask an admin to set the 3CX dial URL.'); return; }
      window.open(buildUrl(CFG.template, phone), '_blank', 'noopener');
      toast('Dialling ' + phone + ' via 3CX...');
      return;
    }
    // tel: fallback
    window.location.href = 'tel:' + String(phone).replace(/[^+0-9]/g, '');
  }

  async function serverDial() {
    const ext = myExtension();
    const phone = current?.lead?.phone;
    if (!ext) return setExtension();
    toast('Ringing your phone...');
    const res = await fetch('/api/3cx-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ number: phone, extension: ext }) });
    const d = await res.json().catch(() => ({}));
    toast(d.success ? 'Call started — your phone should ring.' : (d.error || 'Server dial failed'));
  }

  function renderOutcomes() {
    const wrap = document.getElementById('scOutcomeWrap');
    const canAct = !!(current && current.canAct);
    wrap.style.display = canAct ? '' : 'none';
    if (!canAct) return;
    const grid = document.getElementById('scOutcomes');
    grid.innerHTML = OUTCOMES.map((o) => `<button class="${o.tone}" data-k="${o.key}">${esc(o.label)}</button>`).join('');
    grid.querySelectorAll('[data-k]').forEach((n) => n.addEventListener('click', () => logOutcome(n.getAttribute('data-k'))));
  }

  function open(lead, opts = {}) {
    injectDom();
    if (!lead || !lead.phone) { toast('No phone number for this lead.'); return; }
    current = { lead, canAct: !!opts.canAct, onDone: opts.onDone || null };
    document.getElementById('scTitle').textContent = 'Call ' + (lead.name || 'lead');
    document.getElementById('scNumber').textContent = lead.phone;
    document.getElementById('scSub').textContent = [lead.title, lead.companyName].filter(Boolean).join(' · ');
    const notes = document.getElementById('scNotes'); if (notes) notes.value = '';
    const cbWrap = document.getElementById('scCbWrap'); if (cbWrap) cbWrap.classList.add('hidden');
    renderPrimary();
    renderOutcomes();
    document.getElementById('scDialOverlay').classList.remove('hidden');
  }

  function close() { const o = document.getElementById('scDialOverlay'); if (o) o.classList.add('hidden'); current = null; }

  async function logOutcome(key) {
    const o = OUTCOMES.find((x) => x.key === key);
    if (!o || !current) return;
    if (o.needsDate) {
      const cbWrap = document.getElementById('scCbWrap');
      if (cbWrap && cbWrap.classList.contains('hidden')) {
        cbWrap.classList.remove('hidden');
        const cb = document.getElementById('scCb'); if (cb && !cb.value) { const d = new Date(); d.setDate(d.getDate() + 1); cb.value = d.toISOString().slice(0, 10); }
        toast('Pick a callback date, then click Callback booked again.');
        return;
      }
    }
    const id = current.lead.id;
    const notes = document.getElementById('scNotes')?.value || '';
    const callbackAt = o.needsDate ? (document.getElementById('scCb')?.value || null) : null;
    toast('Logging call...');
    const d = await api({ action: 'log-call', id, outcome: o.outcome, direction: 'outbound', setStatus: o.status || undefined, setDisposition: o.disposition || undefined, callbackAt: callbackAt || undefined, notes: notes || undefined });
    if (d && d.success) {
      const done = current.onDone;
      close();
      toast('Logged: ' + o.outcome);
      if (typeof done === 'function') done(id);
    } else {
      toast((d && d.error) || 'Could not log call');
    }
  }

  function fmtTime(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function fmtDur(sec) { const n = Number(sec); if (!Number.isFinite(n) || n <= 0) return ''; const m = Math.floor(n / 60), s = n % 60; return `${m}m ${String(s).padStart(2, '0')}s`; }

  async function fetchCalls(leadId) {
    const d = await api({ action: 'call-history', id: leadId });
    return (d && d.success) ? (d.calls || []) : [];
  }

  function renderTimeline(calls) {
    if (!Array.isArray(calls)) return '<div class="sub">Loading call history...</div>';
    if (!calls.length) return '<div class="sub">No calls logged yet.</div>';
    return calls.map((ev) => {
      const dir = ev.direction === 'inbound' ? '↙ In' : '↗ Out';
      const dur = fmtDur(ev.durationSec);
      const rec = ev.recordingUrl ? ` · <a class="link" href="${esc(ev.recordingUrl)}" target="_blank" rel="noopener">recording</a>` : '';
      const who = ev.agent || ev.owner || '';
      const parts = [dir, ev.outcome ? esc(ev.outcome) : '', dur, who ? esc(who) : ''].filter(Boolean).join(' · ');
      return `<div class="sub" style="padding:3px 0;border-bottom:1px solid #f1f2f4">${fmtTime(ev.at)} · ${parts}${rec}</div>`;
    }).join('');
  }

  async function init(opts = {}) {
    isAdmin = !!opts.isAdmin;
    injectDom();
    try {
      const d = await api({ action: 'get-config' });
      if (d && d.success) { CFG.template = d.threecxDialTemplate || ''; CFG.serverDial = !!d.threecxServerDial; }
    } catch { /* ignore */ }
  }

  window.SalesCall = { init, open, close, fetchCalls, renderTimeline, setExtension };
})();
