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
  const actingAs = window.__repStatusActingAs || null;

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
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/dock.css';
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
      ${actingAs ? `<div class="rs-ro-note">Testing as ${esc(actingAs.name.split(' ')[0])}. Changes are real and marked as yours. Remove them on Team today.</div>` : ''}
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
