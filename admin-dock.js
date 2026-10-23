/* Admin dock: quick actions on the right of every page for admins.
   - Off the phones: internal meeting or admin, for the whole team or one rep, with a start/stop timer or a set time
   - Sick day: log a rep as off sick (full day, morning or afternoon, one day or a range)
   - Who's off right now, with End / Remove */
(function () {
  if (window.__adminDock) return;
  window.__adminDock = true;

  const ICONS = {
    off: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sick: '<path d="M12 3v10.5a3.5 3.5 0 1 1-4 0V3a2 2 0 0 1 4 0z"/><path d="M12 11v4"/>',
    now: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c3 0 6 1.7 6 5.5"/>',
  };

  let dock = null;
  let pop = null;
  let reps = [];
  let offNow = [];
  let busy = false;
  let timers = [];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const londonDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const londonTime = (d = new Date()) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const clock = (iso) => londonTime(new Date(iso));
  const elapsed = (iso) => {
    const t = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    const h = Math.floor(t / 3600);
    const mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };
  // Timers the admin started: one per rep, grouped so a team timer shows (and stops) as one.
  const runningTimers = () => {
    const groups = new Map();
    for (const o of offNow) {
      if (o.source !== 'self' || !o.loggedBy) continue;
      const key = `${o.label}|${o.loggedBy}`;
      const g = groups.get(key) || { label: o.label, since: o.since, ownerIds: [], names: [] };
      g.ownerIds.push(o.ownerId);
      g.names.push(o.who);
      if (new Date(o.since) < new Date(g.since)) g.since = o.since;
      groups.set(key, g);
    }
    return [...groups.values()];
  };
  const addMinutes = (hhmm, m) => {
    const [h, mm] = hhmm.split(':').map(Number);
    const t = Math.min(23 * 60 + 59, h * 60 + mm + m);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    return res.json().catch(() => ({ success: false, error: 'Request failed' }));
  }

  function inject() {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/dock.css';
    document.head.appendChild(css);
    dock = document.createElement('aside');
    dock.className = 'rs-dock';
    dock.setAttribute('aria-label', 'Admin quick actions');
    document.body.appendChild(dock);
    document.body.classList.add('rs-pad');
    dock.addEventListener('click', onClick);
  }

  function render() {
    timers = runningTimers();
    const n = offNow.length;
    dock.classList.toggle('rs-off', n > 0);
    const btn = (key, label, count) => `<button class="rs-btn" data-open="${key}" type="button" title="${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[key]}</svg>${esc(label)}${count ? ` (${count})` : ''}</button>`;
    dock.innerHTML = `
      <div class="rs-head"><span class="rs-dot"></span><span>Team status</span></div>
      <div class="rs-sub">${n ? `${n} off the phones now` : 'Everyone on the phones'}</div>
      ${timers.map((t, i) => `<div class="ad-run"><b title="${esc(t.label)}">${esc(t.label)}</b><small>${t.names.length > 1 && t.names.length === reps.length ? 'Whole team' : esc(t.names.join(', '))}</small><span class="rs-timer" data-since="${esc(t.since)}">${elapsed(t.since)}</span><button type="button" class="rs-back ad-stop" data-stop="${i}">Stop &amp; save</button></div>`).join('')}
      <div class="rs-btns">${btn('off', 'Off the phones')}${btn('sick', 'Sick day')}${btn('now', "Who's off", n)}</div>`;
  }

  function closePop() { if (pop) { pop.remove(); pop = null; } }

  function openPop(html, anchor, wide) {
    closePop();
    pop = document.createElement('div');
    pop.className = `rs-pop${wide ? ' ad-wide' : ''}`;
    pop.setAttribute('role', 'dialog');
    pop.innerHTML = html;
    const rect = anchor.getBoundingClientRect();
    pop.style.top = `${Math.max(12, Math.min(rect.top - 10, window.innerHeight - 520))}px`;
    document.body.appendChild(pop);
    return pop;
  }

  const repOptions = (withTeam) => (withTeam ? '<option value="">Whole team</option>' : '<option value="">Choose a rep…</option>') + reps.map((r) => `<option value="${esc(r.ownerId)}">${esc(r.name)}</option>`).join('');

  // ── Off the phones ─────────────────────────────────────────────────────────
  function offForm(anchor) {
    let kind = 'internal_meeting';
    let mode = 'timer';
    const from = londonTime();
    const el = openPop(`<h4>Off the phones</h4>
      <div class="ad-seg"><button type="button" data-kind="internal_meeting" class="on">Internal meeting</button><button type="button" data-kind="admin">Admin</button></div>
      <div class="ad-field"><label for="adWho">Who</label><select id="adWho">${repOptions(true)}</select></div>
      <div class="ad-field"><label for="adReason" id="adReasonLabel">Which meeting? (optional)</label><input id="adReason" maxlength="70" placeholder="e.g. Weekly sales meeting" autocomplete="off" /></div>
      <div class="ad-seg"><button type="button" data-mode="timer" class="on">Start timer</button><button type="button" data-mode="set">Set a time</button></div>
      <p class="rs-totals" id="adTimerHint">Starts now and keeps running until you press Stop, then the time is saved.</p>
      <div id="adSet" hidden>
        <label>For how long?</label>
        <div class="ad-chips">${[15, 30, 45, 60, 90, 120].map((m) => `<button type="button" data-min="${m}">${m >= 60 ? `${m / 60}h` : `${m}m`}</button>`).join('')}</div>
        <div class="ad-row"><div><label for="adDate">Date</label><input type="date" id="adDate" value="${londonDate()}" /></div><div><label for="adFrom">From</label><input type="time" id="adFrom" value="${from}" /></div><div><label for="adTo">To</label><input type="time" id="adTo" value="${addMinutes(from, 60)}" /></div></div>
      </div>
      <div class="rs-err" id="adErr"></div><div class="ad-ok" id="adOk"></div>
      <div class="rs-actions"><button type="button" data-pop="cancel">Cancel</button><button type="button" class="rs-go" data-pop="go" id="adGo">Start timer</button></div>`, anchor, true);
    const reasonLabel = el.querySelector('#adReasonLabel');
    el.addEventListener('click', async (e) => {
      const k = e.target.closest('[data-kind]');
      if (k) {
        kind = k.dataset.kind;
        el.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b === k));
        reasonLabel.textContent = kind === 'admin' ? 'What is the admin for?' : 'Which meeting? (optional)';
        el.querySelector('#adReason').placeholder = kind === 'admin' ? 'e.g. CRM clean-up' : 'e.g. Weekly sales meeting';
        return;
      }
      const md = e.target.closest('[data-mode]');
      if (md) {
        mode = md.dataset.mode;
        el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b === md));
        el.querySelector('#adSet').hidden = mode !== 'set';
        el.querySelector('#adTimerHint').hidden = mode !== 'timer';
        el.querySelector('#adGo').textContent = mode === 'timer' ? 'Start timer' : 'Add';
        return;
      }
      const m = e.target.closest('[data-min]');
      if (m) { const start = el.querySelector('#adFrom').value || londonTime(); el.querySelector('#adTo').value = addMinutes(start, Number(m.dataset.min)); return; }
      const p = e.target.closest('[data-pop]');
      if (!p) return;
      if (p.dataset.pop === 'cancel') return closePop();
      const reason = el.querySelector('#adReason').value.trim();
      const err = el.querySelector('#adErr');
      err.textContent = '';
      if (kind === 'admin' && !reason) { err.textContent = 'Add what the admin is for.'; return; }
      const typeLabel = kind === 'admin' ? 'Admin' : 'Internal meeting';
      if (busy) return;
      busy = true;
      const res = mode === 'timer'
        ? await post('/api/rep-day', { action: 'admin-timer-start', kind, reason, ownerId: el.querySelector('#adWho').value })
        : await post('/api/rep-day', {
          action: 'add-off-phone', ownerId: el.querySelector('#adWho').value, date: el.querySelector('#adDate').value,
          start: el.querySelector('#adFrom').value, end: el.querySelector('#adTo').value, label: reason ? `${typeLabel}: ${reason}` : typeLabel, repeatWeeks: 0,
        });
      busy = false;
      if (!res.success) { err.textContent = res.error || 'Could not save'; return; }
      closePop();
      await refresh();
      window.RepDay?.refresh?.();
      flash(mode === 'timer' ? `${typeLabel} timer started. Press Stop in the dock when it is over.` : `${typeLabel} logged. Targets and stall alerts are adjusted.`);
    });
  }

  // ── Sick day ───────────────────────────────────────────────────────────────
  function sickForm(anchor) {
    const today = londonDate();
    const el = openPop(`<h4>Sick day</h4>
      <div class="ad-field"><label for="sdWho">Rep</label><select id="sdWho">${repOptions(false)}</select></div>
      <div class="ad-field"><label for="sdPart">How much of the day?</label><select id="sdPart"><option value="full">Full day</option><option value="am">Morning</option><option value="pm">Afternoon</option></select></div>
      <div class="ad-row"><div><label for="sdFrom">From</label><input type="date" id="sdFrom" value="${today}" /></div><div><label for="sdTo">To (optional)</label><input type="date" id="sdTo" /></div></div>
      <div class="ad-field"><label for="sdNote">Note (optional)</label><input id="sdNote" maxlength="120" placeholder="e.g. Called in sick" autocomplete="off" /></div>
      <div class="rs-err" id="sdErr"></div><div class="ad-ok" id="sdOk"></div>
      <div class="rs-actions"><button type="button" data-pop="cancel">Cancel</button><button type="button" class="rs-go" data-pop="go">Log sick day</button></div>`, anchor, true);
    let lastId = null;
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-undo]')) {
        const res = await post('/api/sq-auth', { action: 'cancel-time-off', id: lastId });
        el.querySelector('#sdOk').textContent = res.success ? 'Removed.' : (res.error || 'Could not undo');
        window.RepDay?.refresh?.();
        return;
      }
      const p = e.target.closest('[data-pop]');
      if (!p) return;
      if (p.dataset.pop === 'cancel') return closePop();
      const ownerId = el.querySelector('#sdWho').value;
      const err = el.querySelector('#sdErr');
      if (!ownerId) { err.textContent = 'Choose a rep.'; return; }
      const startDate = el.querySelector('#sdFrom').value;
      const endDate = el.querySelector('#sdTo').value || startDate;
      if (!startDate) { err.textContent = 'Choose a date.'; return; }
      const dayPart = el.querySelector('#sdPart').value;
      if (busy) return;
      busy = true;
      const note = el.querySelector('#sdNote').value.trim();
      const res = await post('/api/sq-auth', { action: 'create-time-off', ownerId, dayPart, startDate, endDate, note: note ? `Sick: ${note}` : 'Sick' });
      busy = false;
      if (!res.success) { err.textContent = res.error || 'Could not save'; return; }
      lastId = res.entry?.id;
      err.textContent = '';
      const name = reps.find((r) => r.ownerId === ownerId)?.name || 'the rep';
      el.querySelector('#sdOk').innerHTML = `Logged for ${esc(name)}. Their targets are paused for that time. <button type="button" class="ad-link" data-undo="1">Undo</button>`;
      window.RepDay?.refresh?.();
    });
  }

  // ── Who's off now ──────────────────────────────────────────────────────────
  function nowList(anchor) {
    const rows = offNow.map((o, i) => `<li><span><span class="ad-who">${esc(o.who)}</span><small>${esc(o.label)} · ${o.source === 'management' ? `until ${clock(o.until)}` : `since ${clock(o.since)}`}</small></span>
      <button type="button" class="ad-mini" data-i="${i}">${o.source === 'management' ? 'Remove' : 'End now'}</button></li>`).join('');
    const el = openPop(`<h4>Off the phones now</h4>${rows ? `<ul>${rows}</ul>` : '<p class="rs-totals">Everyone is on the phones.</p>'}<div class="rs-actions"><button type="button" data-pop="cancel">Close</button><button type="button" data-pop="records">All records</button></div>`, anchor, true);
    el.addEventListener('click', async (e) => {
      const p = e.target.closest('[data-pop]');
      if (p?.dataset.pop === 'cancel') return closePop();
      if (p?.dataset.pop === 'records') { location.href = '/team-day'; return; }
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const o = offNow[Number(b.dataset.i)];
      b.disabled = true;
      const res = o.source === 'management'
        ? await post('/api/rep-day', { action: 'cancel-off-phone', id: o.id })
        : await post('/api/rep-day', { action: 'status-end', ownerId: o.ownerId });
      if (!res.success) { b.disabled = false; alert(res.error || 'Could not change that'); return; }
      await refresh();
      window.RepDay?.refresh?.();
      nowList(anchor);
    });
  }

  function flash(text) {
    const note = document.createElement('div');
    note.className = 'rs-ro-note ad-note';
    note.textContent = text;
    note.style.cssText = 'position:fixed;right:124px;top:88px;width:230px;z-index:902;box-shadow:0 8px 24px rgba(16,24,40,.18);font-size:12px;padding:10px 12px;border-radius:10px';
    document.body.appendChild(note);
    setTimeout(() => note.remove(), 4000);
  }

  async function stopTimer(i, btn) {
    const t = timers[i];
    if (!t || busy) return;
    busy = true;
    btn.disabled = true;
    const mins = Math.max(1, Math.round((Date.now() - new Date(t.since).getTime()) / 60000));
    const res = await post('/api/rep-day', { action: 'admin-timer-stop', ownerIds: t.ownerIds });
    busy = false;
    if (!res.success) { btn.disabled = false; alert(res.error || 'Could not stop the timer'); return; }
    await refresh();
    window.RepDay?.refresh?.();
    flash(`Saved: ${t.label}, ${mins} min.`);
  }

  function onClick(e) {
    const stop = e.target.closest('[data-stop]');
    if (stop) { stopTimer(Number(stop.dataset.stop), stop); return; }
    const b = e.target.closest('[data-open]');
    if (!b) return;
    if (pop) { const same = pop.dataset.for === b.dataset.open; closePop(); if (same) return; }
    if (b.dataset.open === 'off') offForm(b);
    else if (b.dataset.open === 'sick') sickForm(b);
    else nowList(b);
    if (pop) pop.dataset.for = b.dataset.open;
  }

  async function refresh() {
    try {
      const res = await fetch('/api/rep-day?scope=dock', { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) return;
      reps = d.reps || [];
      offNow = d.offNow || [];
      render();
      // If a form was opened before the rep list arrived, fill its dropdowns now.
      for (const [id, withTeam] of [['adWho', true], ['sdWho', false]]) {
        const sel = document.getElementById(id);
        if (sel && sel.options.length <= 1) { const v = sel.value; sel.innerHTML = repOptions(withTeam); sel.value = v; }
      }
    } catch { /* keep the last known state */ }
  }

  function init() {
    inject();
    render();
    refresh();
    setInterval(() => { if (!document.hidden && !pop) refresh(); }, 60000);
    setInterval(() => { dock.querySelectorAll('[data-since]').forEach((n) => { n.textContent = elapsed(n.dataset.since); }); }, 1000);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
