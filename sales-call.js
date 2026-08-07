/* Shared call widget: dial modal + outcome logging + call timeline.
   Used by Outbound and Inbound. Config (3CX dial URL) is workspace-level.

   Usage:
     await SalesCall.init({ isAdmin: caps.isAdmin });
    SalesCall.open(leadObj, { canAct: !!(caps.changeStatus || caps.workOwnLeads), onDone: reloadFn });
     const calls = await SalesCall.fetchCalls(leadId);
     el.innerHTML = SalesCall.renderTimeline(calls);
*/
(function () {
  const CFG = { template: '', serverDial: false };
  let isAdmin = false;
  let current = null; // { lead, canAct, onDone }

  const OUTCOMES = [
    { key: 'answered_interested',     label: 'Interested, book callback', outcome: 'Answered - interested',  disposition: 'Interested',      status: 'to_call_back',    needsDate: true, tone: 'good' },
    { key: 'answered_not_interested', label: 'Answered · not interested', outcome: 'Answered - not interested', disposition: 'Not interested', status: 'not_interested',  tone: 'bad'  },
    { key: 'wants_info',              label: 'Wants more info',           outcome: 'Answered - wants info',  disposition: 'Interested',      status: 'wants_more_info', needsDate: true, allowEmailOnly: true, tone: 'info' },
    { key: 'no_answer',               label: 'No answer',                 outcome: 'No answer',              disposition: 'No answer',       status: 'no_answer',       tone: 'warn' },
    { key: 'voicemail',               label: 'Left voicemail',            outcome: 'Left voicemail',         disposition: 'Left voicemail',  status: 'no_answer',       tone: 'warn' },
    { key: 'gatekeeper',              label: 'Gatekeeper',                outcome: 'Gatekeeper',             disposition: 'Gatekeeper',      status: null,              tone: 'warn', needsBranch: true },
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
        <div class="dial-number-row">
          <span class="dial-number" id="scNumber">–</span>
          <button type="button" class="dial-copy" id="scCopyNumber" title="Copy number">Copy</button>
        </div>
        <div class="dial-sub" id="scSub"></div>
        <div class="dial-primary" id="scPrimary"></div>
        <div id="scInsightWrap" class="hidden" style="margin-top:14px"></div>
        <div id="scOutcomeWrap">
          <label class="f" style="margin-top:14px">Call notes (optional)</label>
          <textarea id="scNotes" placeholder="What happened on the call..."></textarea>
          <div id="scCbWrap" class="hidden">
            <label class="f" style="margin-top:10px">Callback date &amp; time</label>
            <input type="datetime-local" id="scCb" step="60" style="width:100%" />
          </div>
          <div id="scEmailOnlyWrap" class="hidden" style="margin-top:10px">
            <label class="f" style="display:flex;align-items:center;gap:8px;margin:0">
              <input type="checkbox" id="scEmailOnly" />
              Wants more info is email-only (no callback schedule)
            </label>
          </div>
          <label class="f" style="margin-top:14px">Log the outcome</label>
          <div id="scOutcomeChooser">
            <div class="outcome-grid" id="scOutcomes"></div>
          </div>
          <div id="scGatekeeperActions" class="hidden" style="margin-top:12px; gap:8px; flex-wrap:wrap">
            <button type="button" class="call3cx" id="scGatekeeperCallback" style="flex:1;min-width:180px">Gatekeeper → Call back</button>
            <button type="button" class="ghost" id="scGatekeeperSendEmail" style="flex:1;min-width:180px">Gatekeeper → Send email</button>
            <button type="button" class="ghost" id="scGatekeeperNotInterested" style="flex:1;min-width:180px">Gatekeeper → Dead end</button>
            <button type="button" class="ghost" id="scGatekeeperBack" style="flex:0 0 auto">Back</button>
          </div>
          <div id="scFollowupActions" class="hidden" style="margin-top:12px;gap:8px;flex-wrap:wrap">
            <button type="button" class="call3cx" id="scFollowupSave" style="flex:1;min-width:180px">Save callback</button>
            <button type="button" class="ghost" id="scFollowupBack" style="flex:0 0 auto">Back</button>
          </div>
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
    document.getElementById('scCopyNumber').addEventListener('click', copyNumber);
  }

  async function copyNumber() {
    const phone = current?.lead?.phone;
    if (!phone) { toast('No phone number to copy.'); return; }
    const btn = document.getElementById('scCopyNumber');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(phone);
      } else {
        const tmp = document.createElement('textarea');
        tmp.value = phone;
        tmp.style.position = 'fixed';
        tmp.style.opacity = '0';
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        document.body.removeChild(tmp);
      }
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = prev; btn.classList.remove('copied'); }, 1400);
      }
    } catch {
      toast('Could not copy number.');
    }
  }

  function toast(msg) { const el = document.getElementById('status'); if (el) el.textContent = msg; }

  function callbackIsoValue(value) {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d) ? null : d.toISOString();
  }

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

  function renderInsight() {
    const wrap = document.getElementById('scInsightWrap');
    if (!wrap) return;
    const insightHtml = window.getLeadInsightHtml ? window.getLeadInsightHtml(current?.lead) : '';
    if (!insightHtml) {
      wrap.classList.add('hidden');
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = insightHtml;
    wrap.classList.remove('hidden');
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
    const chooser = document.getElementById('scOutcomeChooser');
    const followup = document.getElementById('scFollowupActions');
    const gatekeeper = document.getElementById('scGatekeeperActions');
    if (chooser) chooser.classList.remove('hidden');
    if (gatekeeper) {
      gatekeeper.classList.add('hidden');
      gatekeeper.style.display = 'none';
    }
    if (followup) {
      followup.classList.add('hidden');
      followup.style.display = 'none';
    }
    const grid = document.getElementById('scOutcomes');
    grid.innerHTML = OUTCOMES.map((o) => `<button class="${o.tone}" data-k="${o.key}">${esc(o.label)}</button>`).join('');
    grid.querySelectorAll('[data-k]').forEach((n) => n.addEventListener('click', () => logOutcome(n.getAttribute('data-k'))));
  }

  function updateFollowupSaveVisibility(outcome) {
    const cbInput = document.getElementById('scCb');
    const emailOnlyInput = document.getElementById('scEmailOnly');
    const followupSave = document.getElementById('scFollowupSave');
    if (!followupSave || !outcome) return;
    const emailOnly = !!(outcome.allowEmailOnly && emailOnlyInput && emailOnlyInput.checked);
    const hasDate = !!(cbInput && cbInput.value);
    const canSave = emailOnly || hasDate;
    followupSave.disabled = !canSave;
    followupSave.style.opacity = canSave ? '1' : '.6';
    followupSave.style.cursor = canSave ? 'pointer' : 'not-allowed';
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
    const emailOnlyWrap = document.getElementById('scEmailOnlyWrap'); if (emailOnlyWrap) emailOnlyWrap.classList.add('hidden');
    const emailOnly = document.getElementById('scEmailOnly'); if (emailOnly) emailOnly.checked = false;
    const chooser = document.getElementById('scOutcomeChooser'); if (chooser) chooser.classList.remove('hidden');
    const gatekeeper = document.getElementById('scGatekeeperActions');
    if (gatekeeper) {
      gatekeeper.classList.add('hidden');
      gatekeeper.style.display = 'none';
    }
    const followup = document.getElementById('scFollowupActions');
    if (followup) {
      followup.classList.add('hidden');
      followup.style.display = 'none';
    }
    renderPrimary();
    renderInsight();
    renderOutcomes();
    document.getElementById('scDialOverlay').classList.remove('hidden');
  }

  function close() { const o = document.getElementById('scDialOverlay'); if (o) o.classList.add('hidden'); current = null; }

  async function logOutcome(key) {
    const o = OUTCOMES.find((x) => x.key === key);
    if (!o || !current) return;
    const cbWrap = document.getElementById('scCbWrap');
    const cbInput = document.getElementById('scCb');
    const emailOnlyWrap = document.getElementById('scEmailOnlyWrap');
    const emailOnlyInput = document.getElementById('scEmailOnly');
    const chooser = document.getElementById('scOutcomeChooser');
    const gatekeeper = document.getElementById('scGatekeeperActions');
    const gatekeeperCallback = document.getElementById('scGatekeeperCallback');
    const gatekeeperSendEmail = document.getElementById('scGatekeeperSendEmail');
    const gatekeeperNotInterested = document.getElementById('scGatekeeperNotInterested');
    const gatekeeperBack = document.getElementById('scGatekeeperBack');
    const followup = document.getElementById('scFollowupActions');
    const followupSave = document.getElementById('scFollowupSave');
    const followupBack = document.getElementById('scFollowupBack');

    if (o.needsBranch && gatekeeper && chooser) {
      chooser.classList.add('hidden');
      gatekeeper.classList.remove('hidden');
      gatekeeper.style.display = 'flex';
      if (cbWrap) cbWrap.classList.add('hidden');
      if (emailOnlyWrap) emailOnlyWrap.classList.add('hidden');
      if (followup) {
        followup.classList.add('hidden');
        followup.style.display = 'none';
      }
      if (gatekeeperBack) gatekeeperBack.onclick = () => {
        gatekeeper.classList.add('hidden');
        gatekeeper.style.display = 'none';
        chooser.classList.remove('hidden');
      };
      if (gatekeeperNotInterested) gatekeeperNotInterested.onclick = async () => {
        const id = current.lead.id;
        const notes = document.getElementById('scNotes')?.value || '';
        toast('Logging call...');
        const d = await api({ action: 'log-call', id, actionKey: 'gatekeeper_dead_end', actionLabel: 'Gatekeeper → Dead end', outcome: o.outcome, direction: 'outbound', setStatus: 'not_interested', setDisposition: 'Not interested', notes: notes || undefined });
        if (d && d.success) {
          const done = current.onDone;
          close();
          toast('Logged: Gatekeeper (dead end)');
          if (typeof done === 'function') done(id);
        } else {
          toast((d && d.error) || 'Could not log call');
        }
      };
      if (gatekeeperSendEmail) gatekeeperSendEmail.onclick = async () => {
        const id = current.lead.id;
        const notes = document.getElementById('scNotes')?.value || '';
        toast('Logging call...');
        const d = await api({ action: 'log-call', id, actionKey: 'gatekeeper_send_email', actionLabel: 'Gatekeeper → Send email', outcome: o.outcome, direction: 'outbound', setStatus: 'wants_more_info', setDisposition: 'Gatekeeper - send email', notes: notes || undefined });
        if (d && d.success) {
          const done = current.onDone;
          close();
          toast('Logged: Gatekeeper (send email)');
          if (typeof done === 'function') done(id);
        } else {
          toast((d && d.error) || 'Could not log call');
        }
      };
      if (gatekeeperCallback) gatekeeperCallback.onclick = () => {
        gatekeeper.classList.add('hidden');
        gatekeeper.style.display = 'none';
        if (cbWrap) cbWrap.classList.remove('hidden');
        if (cbInput) cbInput.value = '';
        if (emailOnlyWrap) emailOnlyWrap.classList.add('hidden');
        if (followup) {
          followup.classList.remove('hidden');
          followup.style.display = 'flex';
        }
        if (followupSave) {
          followupSave.textContent = 'Save callback';
          followupSave.disabled = true;
          followupSave.style.opacity = '.6';
          followupSave.style.cursor = 'not-allowed';
          followupSave.onclick = async () => {
            const callbackAt = cbInput ? cbInput.value : null;
            const callbackAtIso = callbackIsoValue(callbackAt);
            if (!callbackAtIso) { toast('Choose a callback date and time to continue.'); if (cbInput) cbInput.focus(); return; }
            const id = current.lead.id;
            const notes = document.getElementById('scNotes')?.value || '';
            toast('Logging call...');
            const d = await api({ action: 'log-call', id, actionKey: 'gatekeeper_callback', actionLabel: 'Gatekeeper → Call back', outcome: o.outcome, direction: 'outbound', setStatus: 'to_call_back', setDisposition: 'Gatekeeper', callbackAt: callbackAtIso, notes: notes || undefined });
            if (d && d.success) {
              const done = current.onDone;
              close();
              toast('Logged: Gatekeeper (callback booked)');
              if (typeof done === 'function') done(id);
            } else {
              toast((d && d.error) || 'Could not log call');
            }
          };
        }
        if (cbInput) cbInput.oninput = () => {
          const hasDate = !!cbInput.value;
          if (!followupSave) return;
          followupSave.disabled = !hasDate;
          followupSave.style.opacity = hasDate ? '1' : '.6';
          followupSave.style.cursor = hasDate ? 'pointer' : 'not-allowed';
        };
        if (followupBack) followupBack.onclick = () => {
          if (cbWrap) cbWrap.classList.add('hidden');
          if (followup) {
            followup.classList.add('hidden');
            followup.style.display = 'none';
          }
          gatekeeper.classList.remove('hidden');
          gatekeeper.style.display = 'flex';
        };
      };
      toast('Gatekeeper result: choose callback or not interested.');
      return;
    }

    if (o.needsDate && cbWrap && cbWrap.classList.contains('hidden')) {
      cbWrap.classList.remove('hidden');
      if (cbInput) cbInput.value = '';
      if (o.allowEmailOnly && emailOnlyWrap && emailOnlyInput) {
        emailOnlyWrap.classList.remove('hidden');
        emailOnlyInput.checked = false;
        toast('Pick a callback date and time, or tick email-only follow-up to continue.');
      } else {
        if (emailOnlyWrap) emailOnlyWrap.classList.add('hidden');
        toast('Pick a callback date and time to show save.');
      }
      if (chooser) chooser.classList.add('hidden');
      if (followup) {
        followup.classList.remove('hidden');
        followup.style.display = 'flex';
      }
      if (followupSave) followupSave.textContent = o.allowEmailOnly ? 'Save follow-up' : 'Save callback';
      if (followupSave) {
        followupSave.disabled = true;
        followupSave.style.opacity = '.6';
        followupSave.style.cursor = 'not-allowed';
      }
      if (cbInput) cbInput.oninput = () => updateFollowupSaveVisibility(o);
      if (emailOnlyInput) emailOnlyInput.onchange = () => updateFollowupSaveVisibility(o);
      updateFollowupSaveVisibility(o);
      if (followupBack) followupBack.onclick = () => {
        if (cbWrap) cbWrap.classList.add('hidden');
        if (emailOnlyWrap) emailOnlyWrap.classList.add('hidden');
        if (chooser) chooser.classList.remove('hidden');
        if (followup) {
          followup.classList.add('hidden');
          followup.style.display = 'none';
        }
        if (followupSave) {
          followupSave.disabled = true;
          followupSave.style.opacity = '.6';
          followupSave.style.cursor = 'not-allowed';
        }
      };
      if (followupSave) followupSave.onclick = async () => {
        const emailOnly = !!(o.allowEmailOnly && emailOnlyInput && emailOnlyInput.checked);
        const callbackAt = emailOnly ? null : (cbInput ? cbInput.value : null);
        const callbackAtIso = emailOnly ? null : callbackIsoValue(callbackAt);
        if (!emailOnly && !callbackAtIso) { toast('Choose a callback date and time to continue.'); if (cbInput) cbInput.focus(); return; }
        const disposition = emailOnly ? 'Send email requested' : (o.disposition || undefined);
        const id = current.lead.id;
        const notes = document.getElementById('scNotes')?.value || '';
        toast('Logging call...');
        const d = await api({ action: 'log-call', id, actionKey: emailOnly ? 'wants_info_email_only' : 'wants_info_callback', actionLabel: emailOnly ? 'Wants more info (email only)' : 'Wants more info (callback)', outcome: o.outcome, direction: 'outbound', setStatus: o.status || undefined, setDisposition: disposition, callbackAt: callbackAtIso || undefined, notes: notes || undefined });
        if (d && d.success) {
          const done = current.onDone;
          close();
          toast('Logged: ' + o.outcome);
          if (typeof done === 'function') done(id);
        } else {
          toast((d && d.error) || 'Could not log call');
        }
      };
      return;
    }

    let callbackAt = null;
    if (o.needsDate) {
      const emailOnly = !!(o.allowEmailOnly && emailOnlyInput && emailOnlyInput.checked);
      if (!emailOnly) {
        callbackAt = cbInput ? cbInput.value : null;
        if (!callbackIsoValue(callbackAt)) {
          toast('Choose a callback date and time to continue.');
          if (cbInput) cbInput.focus();
          return;
        }
      }
    }
    const callbackAtIso = callbackIsoValue(callbackAt);
    const id = current.lead.id;
    const notes = document.getElementById('scNotes')?.value || '';
    toast('Logging call...');
    const d = await api({ action: 'log-call', id, actionKey: o.key, actionLabel: o.label, outcome: o.outcome, direction: 'outbound', setStatus: o.status || undefined, setDisposition: o.disposition || undefined, callbackAt: callbackAtIso || undefined, notes: notes || undefined });
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
