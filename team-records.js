/* Activity records on the Team today page: a date-range view of every rep's calls, time off the phones and log entries.
   Data: /api/rep-day?scope=status-log&from=&to= */
(function () {
  const esc = RepDay.esc;
  const $ = (id) => document.getElementById(id);
  const TYPES = [
    ['admin', 'Admin', 'rd-k-admin'], ['client_meeting', 'Client meeting', 'rd-k-client'], ['internal_meeting', 'Internal meeting', 'rd-k-internal'],
    ['lunch', 'Lunch', 'rd-k-lunch'], ['admin_logged', 'Logged by management', 'rd-k-mgmt'],
  ];
  const KIND_CLASS = Object.fromEntries(TYPES.map(([k, , c]) => [k, c]));

  let isAdmin = false;
  let onChange = () => {};
  let data = null;
  const state = { preset: 'today', from: '', to: '', view: 'summary', rep: '', types: new Set(TYPES.map(([k]) => k)) };

  const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const shift = (key, days) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const weekday = (key) => new Date(`${key}T12:00:00Z`).getUTCDay();
  const mondayOf = (key) => shift(key, -((weekday(key) + 6) % 7));
  const num = (n) => Number(n).toLocaleString('en-GB');
  const fmtMin = (m) => (!m ? '–' : m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);
  const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '–');
  const dayLabel = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

  function applyPreset(p) {
    const t = todayKey();
    const lastWorking = shift(t, -1 - (weekday(t) === 1 ? 2 : weekday(t) === 0 ? 1 : 0));
    const map = {
      today: [t, t], yesterday: [lastWorking, lastWorking],
      this_week: [mondayOf(t), t], last_week: [shift(mondayOf(t), -7), shift(mondayOf(t), -3)],
      last7: [shift(t, -6), t], last30: [shift(t, -29), t], this_month: [`${t.slice(0, 7)}-01`, t],
    };
    if (map[p]) [state.from, state.to] = map[p];
  }

  function markup() {
    return `<div class="rd-panel-head">
        <div><h2>Activity records</h2><p class="rd-panel-sub">Calls, time off the phones and every status log entry per rep. Pick a date range, a rep or a type. Lunch is timed so you can see how long it really ran.</p></div>
        <div class="rd-toolbar">
          <span class="rd-seg" id="rcView"><button type="button" data-view="summary" class="on">Daily summary</button><button type="button" data-view="log">Detailed log</button></span>
          <button type="button" id="rcCsv">Export CSV</button>
        </div>
      </div>
      <div class="rd-filters">
        <label>Range<select id="rcPreset"><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this_week">This week</option><option value="last_week">Last week</option><option value="last7">Last 7 days</option><option value="last30">Last 30 days</option><option value="this_month">This month</option><option value="custom">Custom</option></select></label>
        <label>From<input type="date" id="rcFrom" /></label>
        <label>To<input type="date" id="rcTo" /></label>
        <label>Rep<select id="rcRep"><option value="">All reps</option></select></label>
        <div class="rd-typechips" id="rcTypes" hidden>${TYPES.map(([k, l, c]) => `<label class="rd-typechip"><input type="checkbox" data-type="${k}" checked /><span class="rd-kind ${c}">${l}</span></label>`).join('')}</div>
      </div>
      <p class="rd-foot" id="rcNote"></p>
      <div id="rcBody"><p class="rd-empty">Loading…</p></div>`;
  }

  function offChips(t) {
    return [['Admin', t.admin], ['Client meetings', t.client_meeting], ['Internal meetings', t.internal_meeting], ['Lunch', t.lunch], ['Logged by management', t.management]]
      .filter(([, v]) => v).map(([k, v]) => `<span class="rd-chip rd-mute">${k} ${fmtMin(v)}</span>`).join('');
  }

  function renderSummary(reps) {
    const floor = data.floor;
    const planned = data.plannedLunchMinutes;
    return reps.map((r) => {
      const t = r.totals;
      const lunchFlag = t.lunchOverDays
        ? `<span class="rd-chip rd-bad">Lunch over the planned ${fmtMin(planned)} on ${t.lunchOverDays} day${t.lunchOverDays === 1 ? '' : 's'} (${fmtMin(t.lunchOverMinutes)} in total)</span>`
        : (t.off.lunch ? `<span class="rd-chip rd-ok">Lunch within the planned ${fmtMin(planned)}</span>` : '');
      const rows = r.days.map((d) => {
        const hit = d.calls >= floor;
        const flag = d.lunchOverMinutes ? `<span class="rd-chip rd-bad">Lunch +${fmtMin(d.lunchOverMinutes)}</span>` : '';
        return `<tr><td>${dayLabel(d.date)}</td><td class="${d.calls ? (hit ? 'rd-ok-cell' : 'rd-lo') : 'rd-na'}"><b>${d.calls || '–'}</b></td><td>${clock(d.firstCallAt)}</td><td>${clock(d.lastCallAt)}</td><td>${d.talkMinutes ? `${d.talkMinutes}m` : '–'}</td>
          <td>${fmtMin(d.off.admin)}</td><td>${fmtMin(d.off.client_meeting)}</td><td>${fmtMin(d.off.internal_meeting)}</td><td>${fmtMin(d.off.lunch)}</td><td>${fmtMin(d.off.management)}</td><td>${flag}</td></tr>`;
      }).join('');
      return `<div class="rd-logrep"><div class="rd-logrep-head"><h3>${esc(r.name)}</h3><div class="rd-logchips"><span class="rd-chip rd-mute">${num(t.calls)} calls over ${t.activeDays} day${t.activeDays === 1 ? '' : 's'}</span>${t.talkMinutes ? `<span class="rd-chip rd-mute">Talk ${fmtMin(t.talkMinutes)}</span>` : ''}${offChips(t.off)}${lunchFlag}</div></div>
        ${r.days.length ? `<div class="rd-scroll"><table class="rd-archived"><thead><tr><th>Date</th><th>Calls</th><th>First call</th><th>Last call</th><th>Talk</th><th>Admin</th><th>Client</th><th>Internal</th><th>Lunch</th><th>Mgmt logged</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="rd-empty">No activity in this range.</p>'}</div>`;
    }).join('');
  }

  function visibleEntries(reps) {
    return reps.flatMap((r) => r.entries.filter((e) => state.types.has(e.kind)).map((e) => ({ ...e, rep: r.name, ownerId: r.ownerId })))
      .sort((a, b) => new Date(b.start) - new Date(a.start));
  }

  function renderLog(reps) {
    const rows = visibleEntries(reps);
    if (!rows.length) return '<p class="rd-empty">No log entries match these filters.</p>';
    const multi = reps.length > 1;
    return `<div class="rd-scroll"><table class="rd-archived"><thead><tr><th>Date</th>${multi ? '<th>Rep</th>' : ''}<th>Time</th><th>Type</th><th>Detail</th><th>Length</th><th></th></tr></thead><tbody>${rows.map((e) => `
      <tr><td>${dayLabel(e.date)}</td>${multi ? `<td>${esc(e.rep)}</td>` : ''}<td>${clock(e.start)} to ${e.ongoing ? '<b>now</b>' : clock(e.end)}</td><td><span class="rd-kind ${KIND_CLASS[e.kind] || ''}">${esc(e.label)}</span></td>
      <td>${esc(e.reason || '')}${e.endedBy === 'auto' ? ' <small>(left running, closed automatically)</small>' : ''}${e.endedBy === 'manager' ? ' <small>(ended by a manager)</small>' : ''}${e.loggedBy ? ` <span class="rd-kind rd-k-mgmt" title="Made by ${esc(e.loggedBy)} while viewing as this rep">test: ${esc(e.loggedBy.split('@')[0])}</span>` : ''}</td>
      <td>${fmtMin(e.minutes)}</td><td>${e.source === 'self' && e.ongoing ? `<button type="button" data-end="${esc(e.ownerId)}">End now</button>` : ''}${isAdmin && e.source === 'self' ? ` <button type="button" data-remove="${e.id}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function post(body) {
    const res = await fetch('/api/rep-day', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    return res.json().catch(() => ({}));
  }

  function render() {
    if (!data) return;
    const reps = state.rep ? data.reps.filter((r) => r.ownerId === state.rep) : data.reps;
    $('rcTypes').hidden = state.view !== 'log';
    $('rcNote').textContent = `${dayLabel(data.from)}${data.from === data.to ? '' : ` to ${dayLabel(data.to)}`}. Ranges are capped at 92 days.`;
    $('rcBody').innerHTML = !reps.length ? '<p class="rd-empty">No reps to show.</p>' : (state.view === 'log' ? renderLog(reps) : renderSummary(reps));
    $('rcBody').querySelectorAll('[data-end]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      const j = await post({ action: 'status-end', ownerId: b.dataset.end });
      if (j.success) { await load(); onChange(); } else { alert(j.error || 'Could not end that status'); b.disabled = false; }
    }));
    $('rcBody').querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this entry from the log? It stops counting as off-phone time.')) return;
      b.disabled = true;
      const j = await post({ action: 'status-remove', id: b.dataset.remove });
      if (j.success) { await load(); onChange(); } else { alert(j.error || 'Could not remove'); b.disabled = false; }
    }));
  }

  async function load() {
    const d = await RepDay.fetchJson(`/api/rep-day?scope=status-log&from=${state.from}&to=${state.to}`);
    if (!d.success) { $('rcBody').innerHTML = `<p class="rd-empty">${esc(d.error || 'Could not load the records')}</p>`; return; }
    data = d;
    state.from = d.from;
    state.to = d.to;
    $('rcFrom').value = d.from;
    $('rcTo').value = d.to;
    $('rcFrom').max = todayKey();
    $('rcTo').max = todayKey();
    const current = $('rcRep').value;
    $('rcRep').innerHTML = '<option value="">All reps</option>' + d.reps.map((r) => `<option value="${esc(r.ownerId)}">${esc(r.name)}</option>`).join('');
    $('rcRep').value = d.reps.some((r) => r.ownerId === current) ? current : '';
    state.rep = $('rcRep').value;
    render();
  }

  function csv() {
    if (!data) return;
    const reps = state.rep ? data.reps.filter((r) => r.ownerId === state.rep) : data.reps;
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let rows;
    if (state.view === 'log') {
      rows = [['Date', 'Rep', 'Start', 'End', 'Type', 'Detail', 'Minutes', 'Logged by'],
        ...visibleEntries(reps).map((e) => [e.date, e.rep, clock(e.start), e.ongoing ? 'running' : clock(e.end), e.label, e.reason, e.minutes, e.loggedBy || ''])];
    } else {
      rows = [['Date', 'Rep', 'Calls', 'Answered', 'First call', 'Last call', 'Talk minutes', 'Admin min', 'Client meeting min', 'Internal meeting min', 'Lunch min', 'Management logged min', 'Lunch over planned min'],
        ...reps.flatMap((r) => r.days.map((d) => [d.date, r.name, d.calls, d.answered, clock(d.firstCallAt), clock(d.lastCallAt), d.talkMinutes, d.off.admin, d.off.client_meeting, d.off.internal_meeting, d.off.lunch, d.off.management, d.lunchOverMinutes]))];
    }
    const blob = new Blob([`${rows.map((r) => r.map(cell).join(',')).join('\n')}\n`], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rep-${state.view === 'log' ? 'log' : 'daily'}-${state.from}-to-${state.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function init(opts = {}) {
    isAdmin = !!opts.isAdmin;
    onChange = opts.onChange || onChange;
    $('records').innerHTML = markup();
    applyPreset('today');
    $('rcPreset').addEventListener('change', (e) => { state.preset = e.target.value; if (state.preset !== 'custom') { applyPreset(state.preset); load(); } });
    const custom = () => { state.preset = 'custom'; $('rcPreset').value = 'custom'; state.from = $('rcFrom').value; state.to = $('rcTo').value; if (state.from && state.to) load(); };
    $('rcFrom').addEventListener('change', custom);
    $('rcTo').addEventListener('change', custom);
    $('rcRep').addEventListener('change', () => { state.rep = $('rcRep').value; render(); });
    $('rcTypes').addEventListener('change', (e) => {
      const t = e.target.dataset.type;
      if (!t) return;
      if (e.target.checked) state.types.add(t); else state.types.delete(t);
      render();
    });
    $('rcView').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (!b) return;
      state.view = b.dataset.view;
      $('rcView').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      render();
    });
    $('rcCsv').addEventListener('click', csv);
    load();
  }

  /** Called by the page's 60 second refresh: only reload when the range includes today. */
  function refreshIfLive() { if (data && state.to === todayKey()) load(); }

  window.TeamRecords = { init, refreshIfLive };
})();
