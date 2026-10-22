/* Rep day: shared rendering for the rep "My day" card (call list) and the manager "Team today" page.
   Data comes from /api/rep-day. Targets and the block schedule are configured on the Team admin page. */
(function () {
  const STATUS = {
    ahead: ['ok', 'Ahead of pace'],
    on_track: ['ok', 'On pace'],
    done: ['ok', 'Floor hit'],
    behind: ['warn', 'Behind pace'],
    stalled: ['bad', 'Stalled'],
    missed: ['bad', 'Missed floor'],
    not_started: ['mute', 'Not started'],
    off_phone: ['mute', 'Off the phones'],
    off: ['mute', 'Off'],
  };
  const COLORS = ['#2563eb', '#d97706', '#16a34a', '#7c3aed', '#dc2626', '#0891b2'];
  const BLOCK_TIPS = {
    dial: 'Dial block: stay on the phones and keep the pace up.',
    admin: 'Admin block: send the info emails and finish your CRM notes.',
    break: 'Lunch: step away from the desk.',
    callbacks: 'Warm callbacks: work due callbacks and gatekeepers first.',
  };

  let lastMe = null;
  let timer = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '–');
  const fmtMins = (m) => (m == null ? '–' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

  async function fetchJson(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    return res.json().catch(() => ({ success: false, error: 'Request failed' }));
  }

  function chip(status) {
    const [tone, label] = STATUS[status] || ['mute', status];
    return `<span class="rd-chip rd-${tone}">${esc(label)}</span>`;
  }

  function scoreRows(day) {
    return day.scorecard.map((m) => {
      const max = Math.max(m.high, m.floor, m.value, 1);
      const fill = Math.min(100, (m.value / max) * 100);
      const floorPos = Math.min(100, (m.floor / max) * 100);
      let tone = m.metHigh ? 'high' : m.met ? 'met' : '';
      if (m.key === 'dials' && !m.met) tone = day.status === 'behind' || day.status === 'stalled' || day.status === 'missed' ? 'behind' : '';
      const unit = m.unit ? ` ${m.unit}` : '';
      return `<div class="rd-score ${tone ? `rd-${tone}` : ''}">
        <div class="rd-score-top"><span>${esc(m.label)}</span><b>${m.value}${unit}<small> / ${m.floor}${unit} floor · ${m.high}${unit} target</small></b></div>
        <div class="rd-track"><i style="width:${fill}%"></i><u style="left:${floorPos}%" title="Floor"></u></div>
        ${m.note ? `<em>${esc(m.note)}</em>` : ''}
      </div>`;
    }).join('');
  }

  function blockChips(day) {
    return `<div class="rd-blocks">${day.blocks.map((b) => {
      const count = b.target ? `${b.dials}/${b.target}` : `${b.dials}`;
      return `<div class="rd-block rd-b-${b.state} rd-t-${b.type}" title="${esc(b.note)}">
        <span>${esc(b.start)}–${esc(b.end)}</span><b>${esc(b.label)}</b><small>${b.type === 'break' ? 'break' : `${count} dials`}${b.offPhoneMinutes ? ` · ${b.offPhoneMinutes}m off the phones` : ''}</small>
        ${b.target ? `<div class="rd-track"><i style="width:${b.pct}%"></i></div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  /** Bars = calls per hour (red when below the minimum); dashes = the minimum for that hour; purple line = minutes talking. */
  function hourlyChart(day, { height = 96, talk = true } = {}) {
    const hours = day.hourly;
    const colW = 40;
    const W = hours.length * colW;
    const pad = 16;
    const maxDials = Math.max(20, ...hours.map((h) => h.dials), ...hours.map((h) => h.threshold)) * 1.1;
    const y = (v) => height - pad - (v / maxDials) * (height - pad - 6);
    const talkY = (v) => height - pad - (Math.min(v, 60) / 60) * (height - pad - 6);
    const bars = hours.map((h, i) => {
      const x = i * colW + 8;
      const cls = h.slump ? 'rd-bar-bad' : h.eligible ? 'rd-bar-ok' : 'rd-bar-dim';
      const top = y(h.dials);
      return `<g><title>${h.label}: ${h.dials} call${h.dials === 1 ? '' : 's'} made${h.talkMinutes ? `, ${h.talkMinutes} min talking` : ''}. ${h.eligible ? `Minimum expected: ${h.threshold}.` : 'Not a dial hour, so no minimum.'}</title>
        <rect class="${cls}${h.current ? ' rd-bar-now' : ''}" x="${x}" y="${top}" width="${colW - 16}" height="${Math.max(1, height - pad - top)}" rx="3"/>
        ${h.dials ? `<text class="rd-val" x="${x + (colW - 16) / 2}" y="${top - 3}" text-anchor="middle">${h.dials}</text>` : ''}
        ${h.eligible && h.threshold ? `<line class="rd-thresh" x1="${x - 3}" x2="${x + colW - 13}" y1="${y(h.threshold)}" y2="${y(h.threshold)}"/>` : ''}
        <text class="rd-lbl" x="${x + (colW - 16) / 2}" y="${height - 3}" text-anchor="middle">${String(h.hour).padStart(2, '0')}</text></g>`;
    }).join('');
    const points = hours.map((h, i) => `${i * colW + 8 + (colW - 16) / 2},${talkY(h.talkMinutes)}`);
    const line = talk && hours.some((h) => h.talkMinutes > 0)
      ? `<polyline class="rd-talk" points="${points.join(' ')}"/>${hours.map((h, i) => `<circle class="rd-talk-dot" cx="${i * colW + 8 + (colW - 16) / 2}" cy="${talkY(h.talkMinutes)}" r="2.5"/>`).join('')}`
      : '';
    return `<svg class="rd-hourly" viewBox="0 0 ${W} ${height}" role="img" aria-label="Dials per hour">${bars}${line}</svg>`;
  }

  /** Plain-English key for the hourly chart. */
  function hourlyKey(day) {
    const talk = day.hourly.some((h) => h.talkMinutes > 0);
    return `<div class="rd-key">
      <span><i class="rd-k-bar"></i>Calls made that hour</span>
      <span><i class="rd-k-line"></i>Minimum expected that hour</span>
      <span><i class="rd-k-red"></i>Below the minimum</span>
      <span><i class="rd-k-grey"></i>Admin, lunch or off the phones (no minimum)</span>
      <span><i class="rd-k-pale"></i>Hour still in progress</span>
      ${talk ? '<span><i class="rd-k-talk"></i>Minutes spent talking</span>' : ''}
    </div>`;
  }

  /** "Off the phones today: 10:00–11:00 Team meeting" */
  function offPhoneNote(day) {
    const list = day.offPhone || [];
    if (!list.length) return '';
    return `<p class="rd-offphone">Off the phones today: ${list.map((o) => `${esc(o.start)}–${esc(o.end)} ${esc(o.label)}`).join(', ')}. Targets and pace checks are adjusted for it.</p>`;
  }

  /** Quick stats that answer "are they actually on the phones?" */
  function gapStats(day) {
    const a = day.activity;
    return `<div class="rd-stats rd-stats-2">
      <div title="How long since the most recent call"><span>Since last call</span><b>${a.minutesSinceLast == null ? '–' : fmtMins(a.minutesSinceLast)}</b></div>
      <div title="Typical time between one call and the next"><span>Average gap</span><b>${a.avgGapMinutes == null ? '–' : `${a.avgGapMinutes} min`}</b><small>between calls</small></div>
    </div>`;
  }

  // ── Rep "My day" card ──────────────────────────────────────────────────────

  function currentBlockPanel(day) {
    const b = day.currentBlock;
    if (day.status === 'off') return '<div class="rd-now rd-mute-panel"><b>Off today</b><span>Your targets are paused.</span></div>';
    const away = (day.offPhone || []).find((o) => o.now);
    if (day.status === 'off_phone' && away) return `<div class="rd-now rd-mute-panel"><div><b>Off the phones: ${esc(away.label)}</b><span>until ${esc(away.end)} · your targets and pace checks are paused for this time</span></div></div>`;
    if (b) {
      const progress = b.target ? `<span class="rd-now-count">${b.dials}<small>/${b.target} dials</small></span>` : `<span class="rd-now-count">${b.dials}<small> dials</small></span>`;
      return `<div class="rd-now rd-t-${b.type}"><div><b>${esc(b.label)}</b><span>until ${esc(b.end)} · ${esc(BLOCK_TIPS[b.type] || '')}</span></div>${progress}</div>`;
    }
    if (day.nextBlock) return `<div class="rd-now rd-mute-panel"><b>Next: ${esc(day.nextBlock.label)}</b><span>starts at ${esc(day.nextBlock.start)}</span></div>`;
    return '<div class="rd-now rd-mute-panel"><b>Day complete</b><span>Log any last notes before you finish.</span></div>';
  }

  function renderMyDay(el, payload) {
    const day = payload.day;
    const nudge = day.status === 'stalled'
      ? `<div class="rd-nudge rd-bad">${esc(day.headline)}. Get back on the phones.</div>`
      : day.status === 'behind'
        ? `<div class="rd-nudge rd-warn">${esc(day.headline)}. ${day.pace.expectedDials} dials expected by now.</div>`
        : '';
    el.innerHTML = `
      <div class="callback-heading rd-head"><div><h2>My day</h2><div class="sub">${esc(day.headline)}</div></div>${chip(day.status)}</div>
      <div class="rd-body">
        ${nudge}
        ${currentBlockPanel(day)}
        ${offPhoneNote(day)}
        ${scoreRows(day)}
        ${blockChips(day)}
        <div class="rd-sub">Calls made each hour</div>
        <p class="rd-chart-note">Each bar is how many calls you made in that hour. The dashed line is the minimum we expect for it.</p>
        ${hourlyChart(day, { height: 92 })}
        ${hourlyKey(day)}
        ${gapStats(day)}
        <p class="rd-foot">Talk time is timed from pressing Call to logging the outcome, answered calls only.${day.flexCredit ? ` Your dial floor is ${day.flexCredit} lower today thanks to long conversations.` : ''}</p>
      </div>`;
    el.hidden = false;
  }

  async function refresh() {
    const el = document.getElementById('myDay');
    if (!el) return null;
    const data = await fetchJson('/api/rep-day?scope=me');
    if (!data.success) { el.hidden = true; return null; }
    lastMe = data;
    if (data.noOwner || !data.config?.enabled || !data.day) { el.hidden = true; return data; }
    renderMyDay(el, data);
    return data;
  }

  function mountMyDay() {
    if (!document.getElementById('myDay')) return;
    refresh();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  /** Default gatekeeper callback: configured time on the next business day. */
  function gatekeeperSlot() {
    if (lastMe?.gatekeeperCallbackAt) return new Date(lastMe.gatekeeperCallbackAt);
    const d = new Date();
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    d.setHours(15, 30, 0, 0);
    return d;
  }

  // ── Manager widgets ────────────────────────────────────────────────────────

  function leaderboard(reps) {
    const rows = reps.slice().sort((a, b) => b.day.totals.dials - a.day.totals.dials);
    const max = Math.max(1, ...rows.map((r) => Math.max(r.day.totals.dials, r.day.targets.dialsFloor)));
    return rows.map((r, i) => {
      const t = r.day.totals;
      const floor = r.day.targets.dialsFloor;
      const floorPos = (floor / max) * 100;
      const tone = t.dials >= floor ? 'rd-met' : r.day.status === 'behind' || r.day.status === 'stalled' ? 'rd-behind' : '';
      return `<div class="rd-lb ${tone}"><span class="rd-lb-rank">${i + 1}</span><div class="rd-lb-main">
        <div class="rd-score-top"><span>${esc(r.name)}</span><b>${t.dials}<small> / ${floor} floor</small></b></div>
        <div class="rd-track rd-track-lg"><i style="width:${Math.min(100, (t.dials / max) * 100)}%"></i><u style="left:${floorPos}%"></u></div></div></div>`;
    }).join('') || '<p class="rd-foot">No reps to show.</p>';
  }

  function teamLineChart(reps, config) {
    const hours = [];
    for (let h = 9; h <= 16; h += 1) hours.push(h);
    const W = 640;
    const H = 220;
    const padL = 34;
    const padB = 24;
    const series = reps.map((r) => hours.map((h) => (r.day.hourly.find((x) => x.hour === h)?.dials ?? 0)));
    const maxV = Math.max(30, config.alerts.minDialsPerHour + 5, ...series.flat()) * 1.1;
    const x = (i) => padL + (i / (hours.length - 1)) * (W - padL - 12);
    const y = (v) => H - padB - (v / maxV) * (H - padB - 10);
    const now = lastTeamNow ? new Date(lastTeamNow) : new Date();
    const curHour = Number(now.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/London' }));
    const grid = [0, 10, 20, 30, 40, 50].filter((v) => v <= maxV).map((v) => `<line class="rd-grid" x1="${padL}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}"/><text class="rd-axis" x="${padL - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join('');
    const labels = hours.map((h, i) => `<text class="rd-axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${String(h).padStart(2, '0')}:00</text>`).join('');
    const lines = reps.map((r, si) => {
      const color = COLORS[si % COLORS.length];
      const limit = lastTeamIsToday ? hours.filter((h) => h < curHour).length : hours.length; // today's current hour is still filling up
      const pts = series[si].slice(0, Math.max(1, limit)).map((v, i) => `${x(i)},${y(v)}`);
      return `<polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" points="${pts.join(' ')}"/>${series[si].slice(0, Math.max(1, limit)).map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${r.day.hourly.find((x) => x.hour === hours[i])?.slump ? '#dc2626' : color}"><title>${esc(r.name)} ${String(hours[i]).padStart(2, '0')}:00 — ${v} dials</title></circle>`).join('')}`;
    }).join('');
    const legend = reps.map((r, si) => `<span><i style="background:${COLORS[si % COLORS.length]}"></i>${esc(r.name)}</span>`).join('');
    return `<svg class="rd-linechart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hourly dials per rep">${grid}
      <line class="rd-slump" x1="${padL}" x2="${W - 8}" y1="${y(config.alerts.minDialsPerHour)}" y2="${y(config.alerts.minDialsPerHour)}"/>
      <text class="rd-slump-lbl" x="${W - 10}" y="${y(config.alerts.minDialsPerHour) - 4}" text-anchor="end">minimum ${config.alerts.minDialsPerHour} calls an hour</text>
      ${labels}${lines}</svg><div class="rd-legend">${legend}</div>`;
  }
  let lastTeamNow = null;
  let lastTeamIsToday = true;

  function funnel(f) {
    const steps = [
      ['Dials', f.dials], ['Answered', f.answered], ['Calls over 3 min', f.qualifiedCalls], ['Interested', f.interested], ['Meetings booked', f.meetings],
    ];
    const max = Math.max(1, steps[0][1]);
    return steps.map(([label, value], i) => {
      const prev = i ? steps[i - 1][1] : null;
      const rate = prev ? `${Math.round((value / prev) * 100)}%` : '';
      return `<div class="rd-fn"><div class="rd-score-top"><span>${esc(label)}</span><b>${value}${rate ? `<small> ${rate} of previous</small>` : ''}</b></div>
        <div class="rd-track rd-track-lg"><i style="width:${Math.max(value ? 3 : 0, (value / max) * 100)}%"></i></div></div>`;
    }).join('');
  }

  function historyTable(reps, config) {
    const dates = Array.from(new Set(reps.flatMap((r) => r.history.map((h) => h.date)))).sort().reverse().slice(0, 7);
    if (!dates.length) return '<p class="rd-foot">No history yet.</p>';
    const head = dates.map((d) => `<th>${new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</th>`).join('');
    const body = reps.map((r) => {
      const cells = dates.map((d) => {
        const h = r.history.find((x) => x.date === d);
        if (!h) return '<td class="rd-na">–</td>';
        const cls = h.dials >= config.dials.high ? 'rd-hi' : h.dials >= config.dials.floor ? 'rd-ok-cell' : 'rd-lo';
        return `<td class="${cls}"><b>${h.dials}</b><small>${h.talkMinutes}m talk · ${h.qualified} long</small></td>`;
      }).join('');
      return `<tr><th scope="row">${esc(r.name)}</th>${cells}</tr>`;
    }).join('');
    return `<div class="rd-scroll"><table class="rd-history"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function repCard(rep, config) {
    const day = rep.day;
    const a = day.activity;
    const stall = config.alerts.stallMinutes;
    const stats = [
      ['First call', fmtTime(a.firstCallAt), 'When their first call of the day was made'],
      ['Last call', fmtTime(a.lastCallAt), 'When their most recent call was made'],
      ['Since last call', a.minutesSinceLast == null ? '–' : fmtMins(a.minutesSinceLast), 'How long since their most recent call'],
      ['Average gap', a.avgGapMinutes == null ? '–' : `${a.avgGapMinutes} min`, 'Typical time from one call to the next'],
      [`Long gaps (${stall}+ min)`, a.idleMinutes ? `${fmtMins(a.idleMinutes)} · ${a.idleGaps} gap${a.idleGaps === 1 ? '' : 's'}` : 'None', `Time in dial blocks with no call for ${stall} minutes or more in a row. Admin and lunch are not counted.`],
      ['Late start', a.lateStartMinutes > config.alerts.lateStartMinutes ? fmtMins(a.lateStartMinutes) : 'On time', 'How long after the first dial block started their first call was made'],
      ['Answer rate', day.totals.dials ? `${Math.round((day.totals.answered / day.totals.dials) * 100)}%` : '–', 'Calls that were answered, out of all calls made'],
      ['Wrong numbers', day.totals.dials ? `${day.totals.wrongNumber} (${Math.round((day.totals.wrongNumber / day.totals.dials) * 100)}%)` : '0', 'Calls logged as a wrong number'],
    ];
    return `<section class="rd-card">
      <div class="rd-card-head"><div><h3>${esc(rep.name)}</h3><div class="rd-card-sub">${esc(day.headline)}${day.availability.hoursOff ? ` · ${day.availability.hoursOff}h off` : ''}</div></div>${chip(day.status)}</div>
      ${offPhoneNote(day)}
      ${scoreRows(day)}
      ${blockChips(day)}
      <div class="rd-sub">Calls made each hour</div>
      <p class="rd-chart-note">Each bar is how many calls were made in that hour. The dashed line is the minimum expected for it.</p>
      ${hourlyChart(day, { height: 110 })}
      ${hourlyKey(day)}
      <div class="rd-stats">${stats.map(([k, v, hint]) => `<div title="${esc(hint)}"><span>${esc(k)}</span><b>${esc(v)}</b><small>${esc(hint)}</small></div>`).join('')}</div>
    </section>`;
  }

  function setTeamContext(now, isToday) { lastTeamNow = now; lastTeamIsToday = isToday; }

  window.RepDay = {
    refresh, mountMyDay, gatekeeperSlot, chip, esc,
    leaderboard, teamLineChart, funnel, historyTable, repCard, setTeamContext, fetchJson,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountMyDay);
  else mountMyDay();
})();
