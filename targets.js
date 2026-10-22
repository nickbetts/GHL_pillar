/* Targets page: plain-English targets, why they are what they are, what they lead to, and how each rep is doing.
   Data: /api/rep-day?scope=funnel. Forecast maths: forecast-model.js (shared with the Offerings page). */
(function () {
  const esc = RepDay.esc;
  const FM = window.ForecastModel;
  const $ = (id) => document.getElementById(id);
  const RATE_KEYS = ['connection', 'qualification', 'booking', 'showup', 'close'];
  const RATE_META = {
    connection: { label: 'Connection rate', hint: 'answered ÷ calls', max: 50 },
    qualification: { label: 'Interest rate', hint: 'interested ÷ answered', max: 15 },
    booking: { label: 'Booking rate', hint: 'meetings ÷ interested', max: 100 },
    showup: { label: 'Show-up rate', hint: 'attended ÷ (attended + no-shows)', max: 100 },
    close: { label: 'Close rate', hint: 'won ÷ attended', max: 60 },
  };

  let days = 30;
  let data = null;
  let model = null; // { basis, rates (percent), dialsPerDay, goal }

  const gbp = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;
  const num = (n) => Number(n).toLocaleString('en-GB');
  const dec = (n, d = 1) => (Math.round(Number(n) * 10 ** d) / 10 ** d).toString();
  const fmtRate = (r) => (r == null ? '–' : r < 1 ? `${r.toFixed(2)}%` : `${dec(r, 1)}%`);
  const fmtBench = (b) => `${fmtRate(b.min)} to ${fmtRate(b.max)}`;
  const dayLabel = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  function view() {
    const which = $('who').value;
    if (which === 'team') return data.team;
    if (which === 'me') return data.me;
    return data.reps.find((r) => r.ownerId === which) || data.team;
  }
  const repsIn = (v) => (v === data.team ? Math.max(1, data.team.repCount || 1) : 1);

  // ── Rates for the model ────────────────────────────────────────────────────

  function baseRates(v, basis) {
    const out = {};
    const info = {};
    for (const key of RATE_KEYS) {
      const st = v.base.stages.find((s) => s.key === key);
      const mid = (st.bench.min + st.bench.max) / 2;
      let value;
      let src;
      if (basis === 'top') { value = st.bench.max; src = 'benchmark top'; }
      else if (basis === 'mid') { value = mid; src = 'benchmark middle'; }
      else if (st.status === 'low_data') { value = mid; src = 'benchmark middle (not enough of our own data yet)'; }
      else { value = st.rate; src = 'our last 90 days'; }
      out[key] = Math.max(0, Math.min(RATE_META[key].max, value));
      info[key] = src;
    }
    return { rates: out, info };
  }

  const toFractions = (r) => Object.fromEntries(RATE_KEYS.map((k) => [k, r[k] / 100]));

  function resetModel(keepGoal) {
    const v = view();
    const { rates } = baseRates(v, 'actual');
    const avg = v.records?.avgRecent;
    model = {
      basis: 'actual', rates,
      dialsPerDay: data.config.dials.floor,
      nowDials: avg || data.config.dials.floor,
      goal: keepGoal && model ? model.goal : 2,
    };
  }

  function sim(rates, dialsPerDay, v) {
    const reps = repsIn(v);
    const monthly = FM.chain({ reps, dialsPerDay, workDays: data.config.forecast.workDaysPerMonth, rates: toFractions(rates) });
    const months = FM.simulate(monthly.won, true);
    const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
    const revenue = sum(months, (x) => x.rev.gf + x.rev.gl + x.rev.dom + x.rev.care + x.rev.one);
    const last = months[months.length - 1];
    return { monthly, months, revenue, mrr: last.rev.gf + last.rev.gl + last.rev.dom + last.rev.care, reps };
  }

  // ── Targets in plain English ───────────────────────────────────────────────

  function renderTargets(v) {
    const c = data.config;
    const base = baseRates(v, 'actual').rates;
    const f = toFractions(base);
    const meetingsPerDayAtFloor = c.dials.floor * f.connection * f.qualification * f.booking;
    const weekly = meetingsPerDayAtFloor * 5;
    const recent = v.records;

    let dialsWhy = 'Hitting this every day is what makes the rest of the numbers on this page work.';
    if (recent?.avgRecent) {
      const gapPct = Math.round(((c.dials.floor / recent.avgRecent) - 1) * 100);
      const best = recent.bestDay ? ` and your best day was <b>${recent.bestDay.dials}</b>` : '';
      dialsWhy = gapPct <= 0
        ? `Over your last ${recent.recentCount} working days you averaged <b>${recent.avgRecent}</b> calls${best}. You are already above the floor on average, so the job is to keep it steady every day.`
        : `Over your last ${recent.recentCount} working days you averaged <b>${recent.avgRecent}</b> calls${best}. The floor is ${gapPct}% above your recent average${recent.bestDay && recent.bestDay.dials >= c.dials.floor ? ', and you have already shown you can reach it' : ''}.`;
    }
    const need = (target) => {
      const mult = weekly > 0 ? target / weekly : null;
      if (!mult) return '';
      const needed = Math.min(100, base.booking * mult);
      return mult <= 1.05 ? 'about where the rates are today' : `${dec(mult, 1)}x today's conversion (for example booking rate from ${dec(base.booking, 0)}% to ${dec(needed, 0)}%)`;
    };
    const m = c.meetings;
    const tiles = [
      { k: 'Calls', big: `${c.dials.floor}`, sub: 'a day, minimum', body: `Make at least <b>${c.dials.floor}</b> calls a day. A great day is <b>${c.dials.high}+</b>.`, why: dialsWhy, note: c.why.dials },
      { k: 'Talk time', big: `${c.talkMinutes.floor} min`, sub: 'a day, minimum', body: `Spend at least <b>${c.talkMinutes.floor} minutes</b> actually talking to people. A great day is <b>${c.talkMinutes.high}+</b>.`, why: `${c.talkMinutes.floor} minutes is about ${Math.round(c.talkMinutes.floor / 5)} proper five-minute conversations. Conversations are where meetings come from.`, note: c.why.talk },
      { k: `Conversations over ${dec(c.qualified.minSeconds / 60, 1)} min`, big: `${c.qualified.floor}`, sub: 'a day, minimum', body: `Have at least <b>${c.qualified.floor}</b> proper conversations longer than ${dec(c.qualified.minSeconds / 60, 1)} minutes. A great day is <b>${c.qualified.high}+</b>.`, why: 'A short brush-off rarely turns into a meeting. The longer conversations are the ones that do.', note: c.why.qualified },
      { k: 'Meetings booked', big: `${m.floorPerWeek}`, sub: 'a week, minimum', body: `Book at least <b>${m.floorPerWeek}</b> meetings a week. Target <b>${m.targetPerWeek}</b>. Stretch <b>${m.stretchPerWeek}</b>.`, why: weekly > 0
        ? `At ${c.dials.floor} calls a day and the rates from the last 90 days you would book about <b>${dec(weekly, 1)}</b> a week. Floor (${m.floorPerWeek}): ${need(m.floorPerWeek)}. Target (${m.targetPerWeek}): ${need(m.targetPerWeek)}. Stretch (${m.stretchPerWeek}): ${need(m.stretchPerWeek)}.`
        : 'There is not enough data yet to say what is realistic.', note: c.why.meetings },
    ];
    $('tiles').innerHTML = tiles.map((t) => `<div class="rd-tile"><span>${t.k}</span><b>${esc(t.big)}</b><small class="rd-tile-sub">${esc(t.sub)}</small><p>${t.body}</p>
      <p class="rd-why"><i>Why this number</i>${t.why}</p>${t.note ? `<p class="rd-why rd-why-note"><i>From management</i>${esc(t.note)}</p>` : ''}</div>`).join('');
    const credit = Math.round(20 * c.flex.dialsPerTalkMinute);
    $('flex').innerHTML = `<h3>Long conversations never count against you</h3>
      <p>Good conversations take time, so they lower your call floor for the day. Each minute you spend talking credits you about ${c.flex.dialsPerTalkMinute} calls (up to ${c.flex.maxCreditPct}% of the floor). A 20 minute conversation takes roughly <b>${credit} calls</b> off your floor.</p>
      <p class="rd-foot">Talk time is measured from pressing Call to logging the outcome, on answered calls only. Always press Call from the app so your conversations are counted.</p>`;
    $('schedule').innerHTML = `<div class="rd-timeline">${c.blocks.map((b) => `<div class="rd-tl rd-t-${b.type}"><span>${esc(b.start)} to ${esc(b.end)}</span><div><b>${esc(b.label)}</b><small>${esc(b.note || '')}${b.type === 'dial' && b.dialTarget ? ` · aim for about ${b.dialTarget} calls` : ''}</small></div></div>`).join('')}</div>`;
    const auto = [];
    if (c.rules.archiveWrongNumber) auto.push('<b>Wrong number?</b> Log it and the contact is removed so nobody dials it again. Your numbers stay clean.');
    if (c.rules.archiveGatekeeperDeadEnd) auto.push('<b>Gatekeeper dead end?</b> Log it and the contact is removed from the queue.');
    if (c.rules.gatekeeperCallback.enabled) auto.push(`<b>Gatekeeper callback?</b> It is booked for you at <b>${esc(c.rules.gatekeeperCallback.time)}</b> the next working day as a hot task. You can change the time if you prefer.`);
    auto.push('<b>Internal meeting or training?</b> Management logs it, and your targets, pace checks and stall alerts are adjusted for that time automatically.');
        auto.push('<b>Log every call</b> from the call list so your day, your talk time and your report are accurate.');
    $('automations').innerHTML = `<ul class="rd-list">${auto.map((a) => `<li>${a}</li>`).join('')}</ul>`;
    if (c.coachNote) { $('coach').hidden = false; $('coach').innerHTML = `<b>From management</b><p>${esc(c.coachNote)}</p>`; }
  }

  // ── Your day in numbers ────────────────────────────────────────────────────

  function renderDay(v) {
    const c = data.config;
    const base = baseRates(v, 'actual');
    const reps = repsIn(v);
    const daily = FM.chain({ reps: 1, dialsPerDay: c.dials.floor, workDays: 1, rates: toFractions(base.rates) });
    const steps = [
      ['Calls', daily.dials, 'you make'], ['Conversations', daily.answered, 'people pick up'], ['Interested', daily.interested, 'show real interest'],
      ['Meetings booked', daily.booked, 'get booked'], ['Meetings held', daily.attended, 'actually happen'], ['Clients won', daily.won, 'sign'],
    ];
    $('dayFlow').innerHTML = steps.map(([k, n, w], i) => `<div class="rd-step"><span>${k}</span><b>${n >= 10 ? Math.round(n) : dec(n, n < 0.1 ? 3 : 2)}</b><small>${w}</small></div>${i < steps.length - 1 ? '<em aria-hidden="true">›</em>' : ''}`).join('');
    const lambdaDay = daily.booked;
    const pDay = 1 - Math.exp(-lambdaDay);
    const pWeek = 1 - Math.exp(-lambdaDay * 5);
    const month = FM.chain({ reps: 1, dialsPerDay: c.dials.floor, workDays: c.forecast.workDaysPerMonth, rates: toFractions(base.rates) });
    $('dayText').innerHTML = `<p>Hitting the floor every day, on the rates from the last 90 days, means about <b>${dec(month.dials, 0)}</b> calls, <b>${dec(month.booked, 1)}</b> meetings booked, <b>${dec(month.attended, 1)}</b> held and <b>${dec(month.won, 2)}</b> clients a month${reps > 1 ? ' per rep' : ''}.</p>
      <p><b>That is why most days have no meeting, and that is normal.</b> On any single day the chance of booking one is about <b>${Math.round(pDay * 100)}%</b>. Across a week it is about <b>${Math.round(pWeek * 100)}%</b>. Meetings come from volume done consistently, which is why the daily targets are about calls and conversations and the meeting target is weekly.</p>
      <p class="rd-foot">Rates used: ${RATE_KEYS.map((k) => `${RATE_META[k].label.toLowerCase()} ${fmtRate(base.rates[k])}${base.info[k].startsWith('our') ? '' : '*'}`).join(', ')}. * not enough of our own data yet, so the benchmark middle is used.</p>`;
  }

  // ── The maths: ladder, forecast and what-if ────────────────────────────────

  function ladderRows(goal, rates, v) {
    const f = toFractions(rates);
    const won = goal;
    const attended = f.close > 0 ? won / f.close : Infinity;
    const booked = f.showup > 0 ? attended / f.showup : Infinity;
    const interested = f.booking > 0 ? booked / f.booking : Infinity;
    const answered = f.qualification > 0 ? interested / f.qualification : Infinity;
    const dials = f.connection > 0 ? answered / f.connection : Infinity;
    const perRepDay = dials / repsIn(v) / data.config.forecast.workDaysPerMonth;
    return { won, attended, booked, interested, answered, dials, perRepDay };
  }

  const big = (n) => (!isFinite(n) ? 'no limit' : n >= 100 ? num(Math.round(n)) : dec(n, 1));

  function renderModel(v) {
    renderControls(v);
    renderOutputs(v);
  }

  function renderControls(v) {
    const c = data.config;
    const m = model;
    $('goal').value = m.goal;
    $('basis').innerHTML = [['actual', 'Our last 90 days'], ['mid', 'Benchmark middle'], ['top', 'Benchmark top']].map(([k, l]) => `<button type="button" data-basis="${k}" class="${m.basis === k ? 'on' : ''}">${l}</button>`).join('');
    const info = baseRates(v, m.basis === 'custom' ? 'actual' : m.basis).info;
    $('sliders').innerHTML = RATE_KEYS.map((k) => {
      const st = v.base.stages.find((s) => s.key === k);
      return `<label class="rd-ctl"><span>${RATE_META[k].label} <small>${RATE_META[k].hint}</small></span>
        <input type="range" min="0" max="${RATE_META[k].max}" step="${RATE_META[k].max > 20 ? 0.5 : 0.1}" value="${m.rates[k]}" data-rate="${k}" />
        <b data-out="${k}">${fmtRate(m.rates[k])}</b><em>${m.basis === 'custom' ? 'your setting' : esc(info[k])}${st.bench ? ` · benchmark ${fmtBench(st.bench)}` : ''}</em></label>`;
    }).join('') + `<label class="rd-ctl"><span>Calls per rep per day <small>the floor is ${c.dials.floor}</small></span>
        <input type="range" min="50" max="300" step="5" value="${m.dialsPerDay}" data-dials="1" /><b data-out="dials">${m.dialsPerDay}</b><em>${m.nowDials ? `you are averaging ${m.nowDials} at the moment` : ''}</em></label>`;

  }

  function renderOutputs(v) {
    const c = data.config;
    const m = model;
    const cur = sim(m.rates, m.dialsPerDay, v);
    const reps = cur.reps;
    const weeklyPerRep = cur.monthly.booked / reps / (c.forecast.workDaysPerMonth / 5);

    // outcomes
    $('modelKpis').innerHTML = [
      ['Meetings booked', `${dec(cur.monthly.booked, 1)}<small> a month</small>`, `${dec(weeklyPerRep, 1)} a week${reps > 1 ? ' per rep' : ''}, against a floor of ${c.meetings.floorPerWeek} and a target of ${c.meetings.targetPerWeek}`],
      ['Clients won', `${dec(cur.monthly.won, 2)}<small> a month</small>`, `${dec(cur.monthly.won * 12, 1)} a year`],
      ['Year-one revenue', gbp(cur.revenue), 'from the Offerings forecast, recurring plus one-off builds'],
      ['Monthly recurring at month 12', gbp(cur.mrr), 'the run-rate going into year two'],
    ].map(([k, v2, s]) => `<div class="rd-kpi"><span>${k}</span><b>${v2}</b><small>${s}</small></div>`).join('');
    $('fcChart').innerHTML = forecastChart(cur.months);

    // ladder
    const l = ladderRows(m.goal, m.rates, v);
    const within = l.perRepDay <= c.dials.floor * 1.05;
    const stretch = !within && l.perRepDay <= c.dials.high * 1.3;
    const verdict = within ? `<span class="rd-chip rd-v-smashing">Within the floor</span>` : stretch ? `<span class="rd-chip rd-v-below">A big stretch</span>` : `<span class="rd-chip rd-v-concern">Not realistic by calling more</span>`;
    $('goalWord').textContent = `new client${m.goal === 1 ? '' : 's'} a month${reps > 1 ? ` across ${reps} reps` : ''}`;
    $('ladder').innerHTML = `<div class="rd-flow rd-flow-back">${[
        ['Clients won', l.won, ''], ['Meetings held', l.attended, `at ${fmtRate(m.rates.close)} close rate`], ['Meetings booked', l.booked, `at ${fmtRate(m.rates.showup)} show-up`],
        ['Interested', l.interested, `at ${fmtRate(m.rates.booking)} booking`], ['Conversations', l.answered, `at ${fmtRate(m.rates.qualification)} interest`], ['Calls', l.dials, `at ${fmtRate(m.rates.connection)} connection`],
      ].map(([k, n, s], i) => `<div class="rd-step"><span>${k}</span><b>${big(n)}</b><small>${s || 'a month'}</small></div>${i < 5 ? '<em aria-hidden="true">‹</em>' : ''}`).join('')}</div>
      <p class="rd-ladder-out">That is <b>${big(l.perRepDay)}</b> calls per rep per day, against a floor of ${c.dials.floor}. ${verdict}</p>
      ${within ? '' : `<p class="rd-foot">Moving the sliders above shows what closes the gap. Improving the weakest rates is quicker, and cheaper, than making more calls.</p>`}`;

    // levers
    const baseRev = cur.revenue;
    const levers = [];
    const plus = sim(m.rates, m.dialsPerDay + 20, v);
    levers.push({ label: '+20 calls per rep per day', rev: plus.revenue - baseRev, won: plus.monthly.won - cur.monthly.won });
    for (const k of RATE_KEYS) {
      const st = v.base.stages.find((s) => s.key === k);
      const mid = (st.bench.min + st.bench.max) / 2;
      if (m.rates[k] < mid) {
        const r2 = { ...m.rates, [k]: mid };
        const s2 = sim(r2, m.dialsPerDay, v);
        levers.push({ label: `${RATE_META[k].label} up to ${fmtRate(mid)} (benchmark middle)`, rev: s2.revenue - baseRev, won: s2.monthly.won - cur.monthly.won });
      }
    }
    levers.sort((a, b) => b.rev - a.rev);
    const maxRev = Math.max(1, ...levers.map((x) => x.rev));
    $('levers').innerHTML = levers.map((x) => `<div class="rd-lever"><div class="rd-score-top"><span>${esc(x.label)}</span><b>+${gbp(x.rev)}<small> year one · +${dec(x.won, 2)} clients a month</small></b></div><div class="rd-track"><i style="width:${Math.max(2, (x.rev / maxRev) * 100)}%"></i></div></div>`).join('');
  }

  function forecastChart(months) {
    const W = 720;
    const H = 230;
    const pad = { l: 46, b: 24, t: 10 };
    const parts = (x) => [['rd-fc-pkg', x.rev.gf + x.rev.gl + x.rev.dom], ['rd-fc-care', x.rev.care], ['rd-fc-one', x.rev.one]];
    const max = Math.max(100, ...months.map((x) => parts(x).reduce((t, p) => t + p[1], 0))) * 1.1;
    const bw = (W - pad.l - 8) / months.length;
    const y = (v) => H - pad.b - (v / max) * (H - pad.b - pad.t);
    const grid = [0, 0.25, 0.5, 0.75, 1].map((p) => { const v = max * p; return `<line class="rd-grid" x1="${pad.l}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}"/><text class="rd-axis" x="${pad.l - 6}" y="${y(v) + 3}" text-anchor="end">${v >= 1000 ? `£${dec(v / 1000, 1)}k` : `£${Math.round(v)}`}</text>`; }).join('');
    const bars = months.map((x, i) => {
      let top = 0;
      const segs = parts(x).map(([cls, v]) => { const y1 = y(top + v); const h = y(top) - y1; top += v; return `<rect class="${cls}" x="${pad.l + i * bw + 4}" y="${y1}" width="${bw - 8}" height="${Math.max(0, h)}"/>`; }).join('');
      return `<g><title>Month ${x.m}: ${gbp(top)}</title>${segs}<text class="rd-axis" x="${pad.l + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">M${x.m}</text></g>`;
    }).join('');
    return `<svg class="rd-linechart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Year-one revenue forecast by month">${grid}${bars}</svg>
      <div class="rd-legend"><span><i style="background:#2563eb"></i>Packages</span><span><i style="background:#16a34a"></i>Website, shop and CRM monthly fees</span><span><i style="background:#d97706"></i>One-off builds</span></div>`;
  }

  // ── Month burn-up ──────────────────────────────────────────────────────────

  function renderBurnup(v) {
    const c = data.config;
    const keys = data.month.workDays;
    const todayIdx = Math.max(0, keys.filter((k) => k <= data.today).length - 1);
    const reps = repsIn(v);
    const perDayFloor = (c.meetings.floorPerWeek / 5) * reps;
    const perDayTarget = (c.meetings.targetPerWeek / 5) * reps;
    const booked = keys.map((k) => v.monthMeetings.filter((d) => d <= k).length);
    const W = 720;
    const H = 230;
    const pad = { l: 36, b: 24, t: 10 };
    const maxV = Math.max(4, Math.ceil((Math.max(perDayTarget * keys.length, booked[todayIdx]) * 1.05) / 4) * 4);
    const x = (i) => pad.l + (i / Math.max(1, keys.length - 1)) * (W - pad.l - 10);
    const y = (n) => H - pad.b - (n / maxV) * (H - pad.b - pad.t);
    const line = (fn, cls, upto = keys.length - 1) => `<polyline class="${cls}" fill="none" points="${keys.slice(0, upto + 1).map((_, i) => `${x(i)},${y(fn(i))}`).join(' ')}"/>`;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((p) => `<line class="rd-grid" x1="${pad.l}" x2="${W - 4}" y1="${y(maxV * p)}" y2="${y(maxV * p)}"/><text class="rd-axis" x="${pad.l - 6}" y="${y(maxV * p) + 3}" text-anchor="end">${Math.round(maxV * p)}</text>`).join('');
    const labels = keys.map((k, i) => (i % 3 === 0 || i === keys.length - 1 ? `<text class="rd-axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${Number(k.slice(8))}</text>` : '')).join('');
    $('burnup').innerHTML = `<svg class="rd-linechart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Meetings booked this month against pace">${grid}${labels}
      ${line((i) => perDayFloor * (i + 1), 'rd-bu-floor')}${line((i) => perDayTarget * (i + 1), 'rd-bu-target')}${line((i) => booked[i], 'rd-bu-you', todayIdx)}
      <circle cx="${x(todayIdx)}" cy="${y(booked[todayIdx])}" r="4.5" class="rd-bu-dot"/></svg>
      <div class="rd-legend"><span><i style="background:#2563eb"></i>${v === data.team ? 'Team' : 'You'}: meetings booked</span><span><i style="background:#9ca3af"></i>Floor pace (${c.meetings.floorPerWeek} a week${reps > 1 ? ' each' : ''})</span><span><i style="background:#16a34a"></i>Target pace (${c.meetings.targetPerWeek} a week${reps > 1 ? ' each' : ''})</span></div>`;
    const proj = todayIdx >= 0 ? (booked[todayIdx] / (todayIdx + 1)) * keys.length : 0;
    const monthFloor = perDayFloor * keys.length;
    const monthTarget = perDayTarget * keys.length;
    $('burnupText').innerHTML = `<b>${booked[todayIdx]}</b> booked so far this month, on course for about <b>${dec(proj, 0)}</b> by the end of it (floor pace ${dec(monthFloor, 0)}, target pace ${dec(monthTarget, 0)}). ${proj >= monthTarget ? 'That is on target. Keep going.' : proj >= monthFloor ? 'Above the floor. A little more on booking rate gets to target.' : 'Behind floor pace, but meetings arrive in lumps, so judge it over weeks rather than days.'}`;
  }

  // ── How you are doing ──────────────────────────────────────────────────────

  function trendCell(st) {
    if (!st.trend) return '<td class="rd-na">–</td>';
    const arrow = st.trend === 'up' ? '▲' : st.trend === 'down' ? '▼' : '▬';
    const pts = st.delta ? `${st.delta > 0 ? '+' : ''}${st.rate < 1 ? st.delta.toFixed(2) : dec(st.delta, 1)} pts` : 'no change';
    return `<td class="rd-trend rd-tr-${st.trend}" title="Previous period: ${fmtRate(st.prevRate)}">${arrow} <small>${pts}</small></td>`;
  }

  function bar(stage) {
    const { min, max } = stage.bench;
    const scale = Math.max(max * 2, (stage.rate || 0) * 1.15, 0.0001);
    const pos = stage.rate == null ? null : Math.min(100, (stage.rate / scale) * 100);
    return `<div class="rd-range"><i class="rd-band" style="left:${(min / scale) * 100}%;width:${Math.max(((max - min) / scale) * 100, 1.5)}%" title="Benchmark ${fmtBench(stage.bench)}"></i>${pos == null ? '' : `<u class="rd-dot rd-st-${stage.status}" style="left:${pos}%"></u>`}</div>`;
  }

  function renderReport(v) {
    const f = v.funnel;
    const isTeam = v === data.team;
    const mine = v === data.me;
    const subject = isTeam ? 'The team is' : mine ? 'You are' : `${esc(v.name)} is`;
    const s = f.summary;
    if (!s.judged) $('summary').innerHTML = '<div class="rd-banner rd-b-mute"><b>Not enough data yet.</b> Keep logging your calls and this fills in as the numbers grow.</div>';
    else {
      const good = s.smashing + s.onPar;
      const worst = f.stages.find((x) => x.key === f.bottleneck);
      $('summary').innerHTML = `<div class="rd-banner ${good >= s.below ? 'rd-b-ok' : 'rd-b-warn'}"><b>${subject} at or above the benchmark on ${good} of ${s.judged} measures.</b>
        ${worst ? ` The biggest opportunity is <b>${esc(worst.label.toLowerCase())}</b>. That is a good thing to know: one fix there lifts everything after it.` : ' Nothing is falling behind. Keep going.'}</div>`;
    }
    const colName = isTeam ? 'Team' : mine ? 'You' : esc(v.name);
    $('funnel').innerHTML = `<thead><tr><th>Stage</th><th>${colName}</th><th>Rate</th><th>Where that sits</th><th>vs previous ${days} days</th>${isTeam ? '' : '<th>Team</th>'}<th>Benchmark</th><th>Verdict</th></tr></thead>
      <tbody>${f.stages.map((st, i) => `<tr><th scope="row">${esc(st.label)}<small>${esc(st.hint)}</small></th>
        <td>${num(st.numerator)} <small>of ${num(st.denominator)}</small></td><td class="rd-rate">${fmtRate(st.rate)}</td><td class="rd-rangecell">${bar(st)}</td>${trendCell(st)}
        ${isTeam ? '' : `<td>${fmtRate(data.team.funnel.stages[i].rate)}</td>`}<td>${fmtBench(st.bench)}</td><td><span class="rd-chip rd-v-${st.status}">${esc(st.statusLabel)}</span></td></tr>`).join('')}</tbody>`;
    const weak = f.stages.filter((x) => x.status === 'below' || x.status === 'concern').sort((a, b) => (a.gap ?? 9) - (b.gap ?? 9));
    const strong = f.stages.filter((x) => x.status === 'smashing' || x.status === 'on_par');
    $('focus').innerHTML = weak.length ? `<h3 class="rd-h3">Where to focus</h3><div class="rd-cardrow">${weak.map((x) => `
      <div class="rd-advice ${x.status === 'concern' ? 'rd-a-concern' : ''}"><div class="rd-advice-head"><b>${esc(x.label)}: ${fmtRate(x.rate)}</b><span class="rd-chip rd-v-${x.status}">${esc(x.statusLabel)}</span></div><p>${esc(x.message)}</p></div>`).join('')}</div>
      ${data.config.funnel.fixes.length ? `<div class="rd-fixes"><h3>Quick wins to try</h3><ol>${data.config.funnel.fixes.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : ''}` : '';
    $('wins').innerHTML = strong.length ? `<h3 class="rd-h3">Where it is going well</h3><div class="rd-cardrow">${strong.map((x) => `
      <div class="rd-advice rd-a-good"><div class="rd-advice-head"><b>${esc(x.label)}: ${fmtRate(x.rate)}</b><span class="rd-chip rd-v-${x.status}">${esc(x.statusLabel)}</span></div><p>${esc(x.message)}</p></div>`).join('')}</div>` : '';
    $('foot').textContent = `Last ${days} days compared with the ${days} before. Interest counts calls logged as interested or wants info, plus anything qualified. Booking rate is capped at 100%. A measure with too few calls is marked as not enough data rather than judged.`;

    const pts = v.talkingPoints;
    $('prepPanel').hidden = !pts?.length;
    if (pts?.length) $('prep').innerHTML = `<ul class="rd-prep">${pts.map((p) => `<li class="rd-prep-${p.tone}">${esc(p.text)}</li>`).join('')}</ul>`;
  }

  // ── Streaks, bests and the last 7 days ─────────────────────────────────────

  function renderStreaks(v) {
    const r = v.records;
    const floor = data.config.dials.floor;
    $('streakPanel').hidden = !r;
    if (!r) return;
    const t = [
      ['Days at the floor in a row', r.currentStreak, r.currentStreak ? 'Keep it going' : `Hit ${floor} calls to start a streak`],
      ['Best run so far', r.bestStreak, r.bestStreak ? 'working days in a row' : 'not yet, but it starts with one day'],
      ['Best day ever', r.bestDay ? r.bestDay.dials : '–', r.bestDay ? `calls on ${dayLabel(r.bestDay.date)}` : 'no calls logged yet'],
      ['This week at the floor', `${r.weekHits}/${r.weekDaysSoFar}`, 'working days so far'],
    ];
    $('streaks').innerHTML = t.map(([k, n, s]) => `<div class="rd-tile"><span>${k}</span><b>${n}</b><p>${s}</p></div>`).join('');
    const h = v.history || [];
    const max = Math.max(floor, ...h.map((x) => x.dials), 1);
    $('history').innerHTML = h.length ? `<div class="rd-days">${h.slice().reverse().map((x) => `<div class="rd-day ${x.dials >= floor ? 'rd-hit' : ''}"><div class="rd-daybar"><i style="height:${Math.max(3, (x.dials / max) * 100)}%"></i><u style="bottom:${(floor / max) * 100}%"></u></div><b>${x.dials}</b><span>${new Date(`${x.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</span><small>${x.talkMinutes}m talk</small></div>`).join('')}</div>` : '';
  }

  // ── Assumptions and sources ────────────────────────────────────────────────

  function renderSources(v) {
    const c = data.config;
    const rows = v.base.stages.filter((s) => s.key !== 'endtoend').map((s) => {
      const used = s.status === 'low_data' ? 'Benchmark middle (not enough of our own data)' : `${fmtRate(s.rate)} (our own)`;
      return `<tr><th scope="row">${esc(s.label)}</th><td>${fmtBench(s.bench)}</td><td>${esc(s.source || 'Set by management.')}</td><td>${num(s.numerator)} of ${num(s.denominator)}${s.denominator < s.minSample ? ` <small>(needs ${s.minSample}+ to be judged)</small>` : ''}</td><td>${esc(used)}</td></tr>`;
    }).join('');
    $('sources').innerHTML = `<div class="rd-scroll"><table class="rd-funnel"><thead><tr><th>Assumption</th><th>Benchmark</th><th>Where it comes from</th><th>Our last 90 days</th><th>Used in the forecast</th></tr></thead><tbody>${rows}
      <tr><th scope="row">Working days a month</th><td>${c.forecast.workDaysPerMonth}</td><td>Set by management.</td><td>–</td><td>${c.forecast.workDaysPerMonth}</td></tr>
      <tr><th scope="row">Package prices, churn, upsells and build take-up</th><td colspan="2">Same assumptions as the Year-one forecast on the <a href="/offerings">Offerings page</a>, including their sources.</td><td>–</td><td>Offerings forecast</td></tr></tbody></table></div>
      <p class="rd-foot">Benchmarks are rule-of-thumb ranges set by management, not promises. Our own rates replace them as soon as there are enough calls to judge.</p>`;
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  function renderAll() {
    const v = view();
    renderTargets(v);
    renderDay(v);
    if (!model) resetModel(false);
    renderModel(v);
    renderBurnup(v);
    renderReport(v);
    renderStreaks(v);
    renderSources(v);
  }

  function fillWho() {
    const opts = [];
    if (data.me) opts.push(['me', 'You']);
    opts.push(['team', 'Team']);
    data.reps.filter((r) => r.ownerId !== data.me?.ownerId).forEach((r) => opts.push([r.ownerId, r.name]));
    const current = $('who').value;
    $('who').innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    if (opts.some(([v]) => v === current)) $('who').value = current;
    $('who').hidden = opts.length < 2;
  }

  async function load() {
    const res = await RepDay.fetchJson(`/api/rep-day?scope=funnel&days=${days}`);
    if (!res.success) { $('err').hidden = false; $('err').textContent = res.error || 'Could not load your targets'; return; }
    data = res;
    try {
      fillWho();
      resetModel(true);
      renderAll();
      $('err').hidden = true;
      $('content').hidden = false;
    } catch (error) {
      console.error(error);
      $('err').hidden = false;
      $('err').textContent = `Could not draw the page: ${error.message}`;
    }
  }

  document.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
    days = Number(b.dataset.days);
    document.querySelectorAll('[data-days]').forEach((x) => x.classList.toggle('on', x === b));
    load();
  }));
  $('who').addEventListener('change', () => { resetModel(true); renderAll(); });
  $('modelPanel').addEventListener('click', (e) => {
    const b = e.target.closest('[data-basis]');
    if (b) {
      const basis = b.dataset.basis;
      model.basis = basis;
      model.rates = baseRates(view(), basis).rates;
      renderModel(view());
    }
    if (e.target.id === 'resetModel') { resetModel(true); renderModel(view()); }
  });
  $('modelPanel').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.rate) {
      model.rates[t.dataset.rate] = Number(t.value);
      if (model.basis !== 'custom') { model.basis = 'custom'; document.querySelectorAll('[data-basis]').forEach((b) => b.classList.remove('on')); }
      const out = document.querySelector(`[data-out="${t.dataset.rate}"]`);
      if (out) out.textContent = fmtRate(model.rates[t.dataset.rate]);
    } else if (t.dataset.dials) {
      model.dialsPerDay = Number(t.value);
      const out = document.querySelector('[data-out="dials"]');
      if (out) out.textContent = model.dialsPerDay;
    } else if (t.id === 'goal') {
      model.goal = Math.max(0.1, Number(t.value) || 0.1);
    } else return;
    renderOutputs(view());
  });
  SQ.init(() => load());
})();
