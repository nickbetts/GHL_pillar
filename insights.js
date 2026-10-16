/* Insights page: forecast, funnel conversion, win/loss, plus admin controls for the Teams feed and Monday report. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gbp = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;
  const pct = (n) => (n == null ? '–' : `${n}%`);

  let DATA = null;
  let GROUP = 'source';
  let DAYS = 30;

  async function load() {
    const res = await fetch(`/api/insights?days=${DAYS}&groupBy=${GROUP}`, { credentials: 'same-origin' });
    if (res.status === 401) { location.href = '/login?next=/insights'; return; }
    const data = await res.json().catch(() => ({ success: false, error: 'Request failed' }));
    if (!data.success) { $('inBody').innerHTML = `<p class="in-note">${esc(data.error || 'Could not load insights')}</p>`; return; }
    DATA = data;
    render();
  }

  const kpi = (label, value, small, cls = '') => `<div class="in-kpi ${cls}"><span>${esc(label)}</span><b>${esc(value)}</b>${small ? `<small>${esc(small)}</small>` : ''}</div>`;

  function forecastHtml(f) {
    const max = Math.max(1, ...f.stages.map((s) => s.value));
    const bars = f.stages.filter((s) => s.count).map((s) => `
      <div class="in-bar-row">
        <span class="in-bar-label">${esc(s.label)} <small style="color:var(--faint)">${s.count}</small></span>
        <div class="in-bar-track"><i class="v" style="width:${(s.value / max) * 100}%"></i><i class="w" style="width:${(s.weighted / max) * 100}%"></i></div>
        <span class="in-bar-num"><b>${gbp(s.weighted)}</b> of ${gbp(s.value)} · ${Math.round(s.weight * 100)}%</span>
      </div>`).join('') || '<p class="in-note">No open opportunities.</p>';
    const maxM = Math.max(1, ...f.monthly.map((m) => m.value));
    const months = f.monthly.length
      ? f.monthly.map((m) => `<div class="in-month" title="${esc(m.month)}: ${m.deals} won, ${gbp(m.value)}"><b>${gbp(m.value)}</b><i style="height:${Math.max(3, (m.value / maxM) * 100)}px"></i><span>${esc(m.month.slice(5))}/${esc(m.month.slice(2, 4))}</span></div>`).join('')
      : '<p class="in-note">No wins yet in the last six months.</p>';
    const owners = f.byOwner.map((o) => `<tr><td>${esc(o.owner)}</td><td>${o.count}</td><td>${gbp(o.value)}</td><td>${gbp(o.weighted)}</td></tr>`).join('');
    return `
      <h2 class="in-h">Pipeline forecast</h2>
      <p class="in-note">${esc(f.note)}</p>
      <div class="in-grid">
        ${kpi('Open pipeline', gbp(f.totalValue), `${f.openCount} opportunities`)}
        ${kpi('Weighted forecast', gbp(f.weightedValue), 'chance-adjusted by stage')}
        ${kpi('Likely within 30 days', gbp(f.likelyWithin30Days), 'decision date set, weighted')}
        ${kpi('Won this month', gbp(f.wonThisMonth.value), `${f.wonThisMonth.deals} deal${f.wonThisMonth.deals === 1 ? '' : 's'}, ${gbp(f.wonThisMonth.mrr)}/mo recurring`)}
      </div>
      <div class="in-grid2">
        <div class="in-card"><b>By stage</b>
          <div class="in-bars">${bars}</div>
          <div class="in-legend"><span><i style="background:var(--blue-200,#bfdbfe)"></i>Total value</span><span><i style="background:var(--blue)"></i>Weighted</span></div>
        </div>
        <div class="in-card"><b>Won, last six months</b><div class="in-months">${months}</div></div>
      </div>
      <div class="in-card in-scroll"><b>By rep</b>
        <table class="in-table" style="margin-top:8px"><thead><tr><th>Rep</th><th>Open</th><th>Value</th><th>Weighted</th></tr></thead><tbody>${owners || '<tr><td>No data</td><td></td><td></td><td></td></tr>'}</tbody></table>
      </div>`;
  }

  function funnelHtml(fn) {
    const t = fn.totals;
    const step = (label, n, prev) => `<div class="in-fstep"><b>${n.toLocaleString('en-GB')}</b><span>${esc(label)}</span><small>${prev ? pct(Math.round((n / prev) * 1000) / 10) : ''}</small></div>`;
    const rows = fn.rows.map((r) => `<tr>
      <td title="${esc(r.group)}">${esc(r.group)}</td><td>${r.calls}</td><td>${r.connected}</td><td>${pct(r.connectRate)}</td>
      <td>${r.qualified}</td><td>${r.meetings}</td><td>${r.proposals}</td><td>${r.won}</td><td>${gbp(r.wonValue)}</td>
      <td class="${r.callsPerWin ? '' : 'dim'}">${r.callsPerWin ?? '–'}</td></tr>`).join('') || '<tr><td>No activity in this range</td></tr>';
    return `
      <div class="in-head"><h2 class="in-h">Funnel conversion</h2>
        <div class="in-seg"><button type="button" data-g="source" class="${GROUP === 'source' ? 'on' : ''}">By source</button><button type="button" data-g="sector" class="${GROUP === 'sector' ? 'on' : ''}">By sector</button></div>
      </div>
      <p class="in-note">Calls to won over the last ${fn.days} days. Stage counts are leads that reached that stage in the period. Sector view shows the top ${fn.rows.length} groups.</p>
      <div class="in-card">
        <div class="in-funnel">${step('Calls', t.calls)}${step('Connected', t.connected, t.calls)}${step('Qualified', t.qualified, t.connected)}${step('Meetings', t.meetings, t.qualified)}${step('Proposals', t.proposals, t.meetings)}${step('Won', t.won, t.proposals)}</div>
        <div class="in-scroll"><table class="in-table"><thead><tr><th>${GROUP === 'sector' ? 'Sector' : 'Source'}</th><th>Calls</th><th>Connected</th><th>Connect %</th><th>Qualified</th><th>Meetings</th><th>Proposals</th><th>Won</th><th>Won value</th><th>Calls per win</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>`;
  }

  function winLossHtml(w) {
    const max = Math.max(1, ...w.reasons.map((r) => r.count));
    const reasons = w.reasons.map((r) => `
      <div class="in-bar-row">
        <span class="in-bar-label">${esc(r.category)}</span>
        <div class="in-bar-track"><i class="w" style="width:${(r.count / max) * 100}%"></i></div>
        <span class="in-bar-num"><b>${r.count}</b> · ${pct(r.share)} · ${gbp(r.value)}</span>
      </div>`).join('') || '<p class="in-note">Nothing lost in this period.</p>';
    const owners = w.owners.map((o) => `<tr><td>${esc(o.owner)}</td><td>${o.won}</td><td>${o.lost}</td><td>${pct(o.winRate)}</td><td>${gbp(o.wonValue)}</td></tr>`).join('');
    const recent = w.recentLost.map((l) => `<tr><td title="${esc(l.company || l.name)}">${esc(l.company || l.name || 'Unknown')}</td><td>${esc(l.owner || '')}</td><td>${gbp(l.value)}</td><td class="lost-reason">${esc(l.category)}${l.reason && l.reason !== l.category ? `: ${esc(l.reason)}` : ''}</td></tr>`).join('');
    return `
      <h2 class="in-h">Wins and losses</h2>
      <p class="in-note">Last ${w.days} days. The loss reason is captured when an opportunity is moved to Lost.</p>
      <div class="in-grid">
        ${kpi('Win rate', pct(w.winRate), `${w.won} won, ${w.lost} lost`)}
        ${kpi('Won value', gbp(w.wonValue), 'first-year value')}
        ${kpi('Lost value', gbp(w.lostValue), 'first-year value')}
        ${kpi('Average sales cycle', w.avgCycleDays == null ? '–' : `${w.avgCycleDays} days`, 'qualified to won')}
      </div>
      <div class="in-grid2">
        <div class="in-card"><b>Why deals are lost</b><div class="in-bars">${reasons}</div></div>
        <div class="in-card in-scroll"><b>By rep</b><table class="in-table" style="margin-top:8px"><thead><tr><th>Rep</th><th>Won</th><th>Lost</th><th>Win rate</th><th>Won value</th></tr></thead><tbody>${owners || '<tr><td>No data</td><td></td><td></td><td></td><td></td></tr>'}</tbody></table></div>
      </div>
      ${recent ? `<div class="in-card in-scroll"><b>Recently lost</b><table class="in-table" style="margin-top:8px"><thead><tr><th>Company</th><th>Rep</th><th>Value</th><th style="text-align:left">Reason</th></tr></thead><tbody>${recent}</tbody></table></div>` : ''}`;
  }

  function adminHtml(d) {
    if (!d.isAdmin) return '';
    const picked = new Set(d.reportRecipients || []);
    const people = (d.users || []).map((u) => `<label><input type="checkbox" data-email="${esc(u.email)}" ${picked.has(u.email) ? 'checked' : ''} /><span>${esc(u.name)}<br /><small>${esc(u.email)}</small></span></label>`).join('');
    return `
      <h2 class="in-h">Notifications</h2>
      <div class="in-grid2">
        <div class="in-card in-admin"><b>Microsoft Teams feed</b>
          <p class="in-note">${d.teamsConfigured ? 'Connected. Deals, proposal opens, callbacks, milestones and the 9am digest post to your channel.' : 'Not connected yet. Add the Workflows webhook URL as TEAMS_WEBHOOK_URL in the server settings.'}</p>
          <div class="in-row"><button type="button" id="inTeamsTest" ${d.teamsConfigured ? '' : 'disabled'}>Send a test message</button><span class="in-status" id="inTeamsStatus"></span></div>
        </div>
        <div class="in-card in-admin"><b>Monday morning report</b>
          <p class="in-note">Emailed at 8am every Monday to the people ticked below, and to nobody else.</p>
          <div class="in-people" id="inPeople">${people}</div>
          <div class="in-row"><button type="button" id="inSaveRecipients">Save recipients</button><button type="button" class="ghost" id="inTestReport">Email me a test</button><span class="in-status" id="inReportStatus"></span></div>
        </div>
      </div>`;
  }

  function render() {
    const d = DATA;
    const alert = d.staleCount ? `<a class="in-alert" href="/opportunities?stale=1">${d.staleCount} open opportunit${d.staleCount === 1 ? 'y has' : 'ies have'} had no next step for 3+ days. Open the list.</a>` : '';
    $('inBody').innerHTML = `<div class="in-view">${alert}${forecastHtml(d.forecast)}${funnelHtml(d.funnel)}${winLossHtml(d.winLoss)}${adminHtml(d)}</div>`;
    document.querySelectorAll('.in-seg button').forEach((b) => b.addEventListener('click', () => { GROUP = b.dataset.g; load(); }));
    bindAdmin();
  }

  async function post(body) {
    const res = await fetch('/api/insights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    return res.json().catch(() => ({ success: false, error: 'Request failed' }));
  }

  function bindAdmin() {
    const teams = $('inTeamsTest');
    if (teams) teams.addEventListener('click', async () => {
      $('inTeamsStatus').textContent = 'Sending…';
      const r = await post({ action: 'test-teams' });
      $('inTeamsStatus').textContent = r.success ? 'Sent. Check the channel.' : (r.error || 'Failed');
    });
    const save = $('inSaveRecipients');
    if (save) save.addEventListener('click', async () => {
      const emails = [...document.querySelectorAll('#inPeople input:checked')].map((i) => i.dataset.email);
      $('inReportStatus').textContent = 'Saving…';
      const r = await post({ action: 'set-report-recipients', emails });
      $('inReportStatus').textContent = r.success ? `Saved: ${r.reportRecipients.length} recipient${r.reportRecipients.length === 1 ? '' : 's'}` : (r.error || 'Failed');
    });
    const test = $('inTestReport');
    if (test) test.addEventListener('click', async () => {
      $('inReportStatus').textContent = 'Sending…';
      const r = await post({ action: 'send-test-report' });
      $('inReportStatus').textContent = r.success ? `Test sent to ${r.sentTo}` : (r.error || 'Failed');
    });
  }

  SQ.init(() => {
    $('inDays').addEventListener('change', () => { DAYS = Number($('inDays').value) || 30; load(); });
    load();
  });
})();
