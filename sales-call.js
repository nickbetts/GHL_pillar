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

  function buildUrl(tpl, phone) {
    const clean = String(phone || '').replace(/[^+0-9]/g, '');
    const digits = clean.replace(/\D/g, '');
    // %tel% = the full encoded tel: URI 3CX's PWA expects (#/tel/?s=%s). %number% keeps the encoded number.
    return tpl
      .replace(/%tel%/gi, encodeURIComponent('tel:' + clean))
      .replace(/%number%/gi, encodeURIComponent(clean))
      .replace(/%raw%/gi, clean)
      .replace(/%digits%/gi, digits)
      .replace(/%e164%/gi, encodeURIComponent(clean));
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
      ${canServer ? `<button type="button" class="call3cx" data-m="server">Ring my phone (${esc(ext)})</button>` : ''}
      <button type="button" class="call3cx" data-m="tel">Call via 3CX</button>
      ${CFG.serverDial ? `<span class="dial-ext">Ext <input id="scExt" value="${esc(ext)}" placeholder="e.g. 101" /></span>` : ''}`;
    el.querySelectorAll('[data-m]').forEach((n) => n.addEventListener('click', () => act(n.getAttribute('data-m'))));
    const extInput = document.getElementById('scExt');
    if (extInput) extInput.addEventListener('change', () => {
      const v = extInput.value.trim();
      if (v) localStorage.setItem('sq_3cx_ext', v); else localStorage.removeItem('sq_3cx_ext');
      renderPrimary();
    });
  }

  function act(method) {
    const phone = current?.lead?.phone;
    if (!phone) { toast('No phone number.'); return; }
    if (method === 'server') return serverDial();
    if (method === 'webclient') {
      if (!CFG.template) { toast('No web client URL set.'); return; }
      // Named target reuses one dialer tab instead of spawning a new one each call.
      window.open(buildUrl(CFG.template, phone), '3cx_dialer');
      toast('Calling ' + phone + ' via 3CX...');
      return;
    }
    // Use a real anchor click because some browsers/handlers accept tel: reliably only via link navigation.
    const tel = 'tel:' + String(phone).replace(/[^+0-9]/g, '');
    try {
      const a = document.createElement('a');
      a.href = tel;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      window.location.assign(tel);
    }
  }

  async function serverDial() {
    const ext = myExtension();
    const phone = current?.lead?.phone;
    if (!ext) { toast('Enter your extension in the Ext box first.'); return; }
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
    // Qualify shortcut: hand the lead to GHL via the board's questionnaire.
    let qz = document.getElementById('scQualifyBtn');
    if (window.SalesQualify && current && current.lead) {
      if (!qz) {
        qz = document.createElement('button');
        qz.id = 'scQualifyBtn';
        qz.type = 'button';
        qz.style.cssText = 'margin-top:12px;width:100%;background:#16a34a';
        wrap.appendChild(qz);
      }
      qz.textContent = '✓ Qualify → push to GHL';
      qz.style.display = '';
      qz.onclick = () => { const id = current && current.lead && current.lead.id; close(); if (id != null) window.SalesQualify.open(id); };
    } else if (qz) {
      qz.style.display = 'none';
    }
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

  window.SalesCall = { init, open, close, fetchCalls, renderTimeline };
})();
