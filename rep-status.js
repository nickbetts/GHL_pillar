/* Rep status dock: a slim control rail on the right of every page where reps mark themselves off the phones
   (admin, client meeting, internal meeting, lunch). Loaded by sales-app.js for rep accounts. */
(function () {
  if (window.__repStatusDock) return;
  window.__repStatusDock = true;

  const KINDS = [
    { key: 'admin', label: 'Admin', icon: '<rect x="7" y="4" width="10" height="16" rx="2"/><path d="M9 4h6v3H9zM10 11h4M10 15h4"/>' },
    { key: 'client_meeting', label: 'Client meeting', icon: '<path d="M3 11l4-4 4 3 4-3 6 6-5 5-4-3-3 2-6-6z"/>' },
    { key: 'internal_meeting', label: 'Internal meeting', icon: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c3 0 6 1.7 6 5.5"/>' },
    { key: 'lunch', label: 'Lunch', icon: '<path d="M6 3v7a2 2 0 0 0 4 0V3M8 10v11M16 3c-2 1.5-3 4-3 7h3v11"/>' },
  ];
  const PROMPTS = {
    admin: { title: 'Admin', label: 'What are you working on?', required: true, placeholder: 'e.g. Updating CRM notes' },
    client_meeting: { title: 'Client meeting', label: 'Which client?', required: true, placeholder: 'Client or company name' },
    internal_meeting: { title: 'Internal meeting', label: 'Which meeting? (optional)', required: false, placeholder: 'e.g. Weekly sales meeting' },
  };

  let state = { active: null, entries: [], totals: null, now: null };
  let skew = 0; // server time minus browser time
  let dock = null;
  let pop = null;
  let busy = false;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nowMs = () => Date.now() + skew;
  const clock = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  function dur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
  }
  const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);

  async function api(body) {
    const res = await fetch('/api/rep-day', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    return res.json().catch(() => ({ success: false, error: 'Request failed' }));
  }

  function inject() {
    const css = document.createElement('style');
    css.textContent = `
      .rs-dock { position:fixed; right:0; top:88px; width:112px; z-index:900; background:#fff; border:1px solid #e5e7eb; border-right:0; border-radius:14px 0 0 14px; box-shadow:-6px 8px 28px rgba(16,24,40,.12); padding:10px 8px; display:flex; flex-direction:column; gap:8px; font-family:Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }
      .rs-head { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:#111827; line-height:1.2; }
      .rs-dot { flex:none; width:10px; height:10px; border-radius:50%; background:#16a34a; box-shadow:0 0 0 3px rgba(22,163,74,.18); }
      .rs-off .rs-dot { background:#d97706; box-shadow:0 0 0 3px rgba(217,119,6,.2); animation:rs-pulse 1.6s ease-in-out infinite; }
      @keyframes rs-pulse { 50% { box-shadow:0 0 0 6px rgba(217,119,6,.08); } }
      .rs-sub { font-size:11px; color:#6b7280; margin-top:-4px; line-height:1.3; word-break:break-word; }
      .rs-timer { font-size:15px; font-weight:700; font-variant-numeric:tabular-nums; color:#b45309; margin-top:-2px; }
      .rs-btns { display:flex; flex-direction:column; gap:6px; }
      .rs-btn { display:flex; flex-direction:column; align-items:center; gap:3px; border:1px solid #e5e7eb; background:#f9fafb; border-radius:10px; padding:7px 4px 6px; font:inherit; font-size:10.5px; font-weight:600; color:#374151; cursor:pointer; line-height:1.15; text-align:center; }
      .rs-btn svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      .rs-btn:hover { background:#eef2ff; border-color:#c7d2fe; color:#1d4ed8; }
      .rs-btn.on { background:#fef3c7; border-color:#f59e0b; color:#92400e; }
      .rs-back { border:0; border-radius:10px; padding:10px 6px; background:#16a34a; color:#fff; font:inherit; font-size:12px; font-weight:700; cursor:pointer; line-height:1.2; }
      .rs-back:hover { background:#15803d; }
      .rs-today { border:0; background:none; color:#6b7280; font:inherit; font-size:11px; font-weight:600; cursor:pointer; padding:2px; text-decoration:underline; text-underline-offset:2px; }
      .rs-dock[aria-busy=true] { opacity:.7; pointer-events:none; }
      .rs-pop { position:fixed; right:124px; width:270px; z-index:901; background:#fff; border:1px solid #e5e7eb; border-radius:14px; box-shadow:0 14px 40px rgba(16,24,40,.2); padding:14px; font-family:Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }
      .rs-pop h4 { margin:0 0 8px; font-size:14px; color:#111827; }
      .rs-pop label { display:block; font-size:12px; font-weight:600; color:#374151; margin-bottom:5px; }
      .rs-pop input { width:100%; box-sizing:border-box; height:38px; border:1px solid #d1d5db; border-radius:9px; padding:0 10px; font:inherit; font-size:13px; }
      .rs-pop input:focus { outline:none; border-color:#2563eb; box-shadow:0 0 0 3px rgba(37,99,235,.14); }
      .rs-pop .rs-actions { display:flex; gap:8px; margin-top:10px; }
      .rs-pop button { flex:1; height:36px; border-radius:9px; border:1px solid #d1d5db; background:#fff; font:inherit; font-size:13px; font-weight:600; color:#374151; cursor:pointer; }
      .rs-pop button.rs-go { background:#2563eb; border-color:#2563eb; color:#fff; }
      .rs-pop .rs-err { color:#b91c1c; font-size:12px; margin-top:6px; }
      .rs-pop ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; max-height:300px; overflow:auto; font-size:12.5px; color:#374151; }
      .rs-pop li { display:flex; justify-content:space-between; gap:8px; border-bottom:1px solid #f1f2f4; padding-bottom:6px; }
      .rs-pop li small { display:block; color:#6b7280; }
      .rs-pop .rs-totals { margin:10px 0 0; font-size:12px; color:#4b5563; line-height:1.5; }
      body.rs-pad .app-main { padding-right:124px; }
      @media (max-width: 860px) { .rs-dock, .rs-pop { display:none; } body.rs-pad .app-main { padding-right:0; } }`;
    document.head.appendChild(css);
    dock = document.createElement('aside');
    dock.className = 'rs-dock';
    dock.setAttribute('aria-label', 'Phone status');
    document.body.appendChild(dock);
    document.body.classList.add('rs-pad');
    dock.addEventListener('click', onDockClick);
  }

  function render() {
    const a = state.active;
    dock.classList.toggle('rs-off', !!a);
    const offToday = state.totals?.total || 0;
    dock.innerHTML = `
      <div class="rs-head"><span class="rs-dot"></span><span>${a ? esc(a.label) : 'On the phones'}</span></div>
      ${a ? `<div class="rs-sub">${a.reason ? esc(a.reason) : `since ${clock(a.startedAt)}`}</div><div class="rs-timer" id="rsTimer">${dur(nowMs() - new Date(a.startedAt).getTime())}</div>` : `<div class="rs-sub">${offToday ? `${mins(offToday)} off today` : 'Mark yourself off when you step away'}</div>`}
      ${a ? '<button class="rs-back" data-act="back" type="button">Back on the phones</button>' : ''}
      <div class="rs-btns">${KINDS.map((k) => `<button class="rs-btn ${a?.kind === k.key ? 'on' : ''}" data-kind="${k.key}" type="button" title="${esc(k.label)}"><svg viewBox="0 0 24 24" aria-hidden="true">${k.icon}</svg>${esc(k.label)}</button>`).join('')}</div>
      <button class="rs-today" data-act="log" type="button">Today's log</button>`;
  }

  function tick() {
    const el = document.getElementById('rsTimer');
    if (el && state.active) el.textContent = dur(nowMs() - new Date(state.active.startedAt).getTime());
  }

  function closePop() { if (pop) { pop.remove(); pop = null; } }

  function openPop(html, anchor) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'rs-pop';
    pop.setAttribute('role', 'dialog');
    pop.innerHTML = html;
    const rect = anchor.getBoundingClientRect();
    pop.style.top = `${Math.max(12, Math.min(rect.top - 10, window.innerHeight - 260))}px`;
    document.body.appendChild(pop);
    return pop;
  }

  function askReason(kind, anchor) {
    const spec = PROMPTS[kind];
    const el = openPop(`<h4>${esc(spec.title)}</h4><label for="rsReason">${esc(spec.label)}</label><input id="rsReason" maxlength="120" placeholder="${esc(spec.placeholder)}" autocomplete="off" />
      <div class="rs-err" id="rsErr"></div><div class="rs-actions"><button type="button" data-pop="cancel">Cancel</button><button type="button" class="rs-go" data-pop="go">Start</button></div>`, anchor);
    const input = el.querySelector('#rsReason');
    input.focus();
    const go = async () => {
      const reason = input.value.trim();
      if (spec.required && !reason) { el.querySelector('#rsErr').textContent = kind === 'client_meeting' ? 'Add which client it is with.' : 'Add what you are working on.'; return; }
      await setStatus(kind, reason);
    };
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-pop]'); if (!b) return; if (b.dataset.pop === 'cancel') closePop(); else go(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') closePop(); });
  }

  function showLog(anchor) {
    const rows = state.entries || [];
    const t = state.totals || {};
    const label = { admin: 'Admin', client_meeting: 'Client meetings', internal_meeting: 'Internal meetings', lunch: 'Lunch' };
    const el = openPop(`<h4>Today's log</h4>${rows.length ? `<ul>${rows.map((e) => `<li><span>${esc(e.label)}${e.reason ? `<small>${esc(e.reason)}</small>` : ''}</span><span>${clock(e.start)}<small>${e.ongoing ? 'now' : mins(e.minutes)}</small></span></li>`).join('')}</ul>
      <p class="rs-totals">${Object.keys(label).filter((k) => t[k]).map((k) => `${label[k]} ${mins(t[k])}`).join(' · ')}</p>` : '<p class="rs-totals">Nothing logged yet today.</p>'}
      <div class="rs-actions"><button type="button" data-pop="cancel">Close</button></div>`, anchor);
    el.addEventListener('click', (e) => { if (e.target.closest('[data-pop="cancel"]')) closePop(); });
  }

  function apply(res) {
    if (!res?.success) return;
    state = { active: res.active, entries: res.entries || [], totals: res.totals || null, now: res.now };
    if (res.now) skew = new Date(res.now).getTime() - Date.now();
    render();
    window.RepDay?.refresh?.();
  }

  async function setStatus(kind, reason) {
    if (busy) return;
    busy = true;
    dock.setAttribute('aria-busy', 'true');
    const res = await api({ action: 'status-start', kind, reason });
    busy = false;
    dock.removeAttribute('aria-busy');
    if (res.success) { closePop(); apply(res); }
    else if (pop?.querySelector('#rsErr')) pop.querySelector('#rsErr').textContent = res.error || 'Could not save';
    else alert(res.error || 'Could not save');
  }

  async function goBack() {
    if (busy) return;
    busy = true;
    dock.setAttribute('aria-busy', 'true');
    const res = await api({ action: 'status-end' });
    busy = false;
    dock.removeAttribute('aria-busy');
    closePop();
    apply(res);
  }

  function onDockClick(e) {
    const kindBtn = e.target.closest('[data-kind]');
    const actBtn = e.target.closest('[data-act]');
    if (actBtn?.dataset.act === 'back') return goBack();
    if (actBtn?.dataset.act === 'log') return pop ? closePop() : showLog(actBtn);
    if (kindBtn) {
      const kind = kindBtn.dataset.kind;
      if (state.active?.kind === kind && kind === 'lunch') return;
      if (kind === 'lunch') { closePop(); return setStatus('lunch', ''); }
      return askReason(kind, kindBtn);
    }
  }

  async function refresh() {
    if (busy || pop) return;
    const res = await api({ action: 'status-get' });
    if (res.success && !res.noOwner) apply(res);
    else if (res.noOwner && dock) { dock.remove(); document.body.classList.remove('rs-pad'); }
  }

  async function init() {
    inject();
    render();
    await refresh();
    setInterval(tick, 1000);
    setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
