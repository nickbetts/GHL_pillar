/** Pipeline forecast, funnel conversion and win/loss analysis. Read-only; shared by the Insights page, the Teams digest and the weekly report. */

// Default chance an open opportunity at each stage ends up won; used for the weighted forecast.
export const STAGE_WEIGHTS = {
  qualified: 0.05,
  meeting_booked: 0.1,
  meeting_no_show: 0.03,
  meeting_attended: 0.2,
  scoping: 0.35,
  proposal: 0.55,
  limbo: 0.08,
};
export const STAGE_LABELS = {
  qualified: 'Qualified', meeting_booked: 'Meeting booked', meeting_no_show: 'No-show', meeting_attended: 'Meeting attended',
  scoping: 'Scoping', proposal: 'Proposal', limbo: 'Limbo', won: 'Won', lost: 'Lost',
};
const OPEN_STAGES = Object.keys(STAGE_WEIGHTS);

/** First-year value: one-off plus twelve months of recurring. */
export const firstYearValue = (oneOff, mrr) => (Number(oneOff) || 0) + (Number(mrr) || 0) * 12;

const rangeStart = (days) => new Date(Date.now() - Math.max(1, Math.min(730, Number(days) || 30)) * 86400000).toISOString();
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

export async function pipelineForecast(sql) {
  const open = await sql`
    SELECT id, name, company_name, owner, owner_id, COALESCE(opportunity_stage, 'qualified') AS stage,
           mrr_value, one_off_value, decision_deadline_at
    FROM queue_leads
    WHERE archived_at IS NULL AND status = 'qualified'
      AND COALESCE(opportunity_stage, 'qualified') = ANY(${OPEN_STAGES})
  `;
  const byStage = Object.fromEntries(OPEN_STAGES.map((s) => [s, { stage: s, label: STAGE_LABELS[s], weight: STAGE_WEIGHTS[s], count: 0, value: 0, weighted: 0 }]));
  const byOwner = new Map();
  let soonWeighted = 0;
  const soonCutoff = Date.now() + 30 * 86400000;
  for (const row of open) {
    const value = firstYearValue(row.one_off_value, row.mrr_value);
    const weighted = value * (STAGE_WEIGHTS[row.stage] ?? 0);
    const bucket = byStage[row.stage];
    bucket.count += 1; bucket.value += value; bucket.weighted += weighted;
    const owner = row.owner || 'Unassigned';
    const o = byOwner.get(owner) || { owner, count: 0, value: 0, weighted: 0 };
    o.count += 1; o.value += value; o.weighted += weighted;
    byOwner.set(owner, o);
    if (row.decision_deadline_at && new Date(row.decision_deadline_at).getTime() <= soonCutoff && new Date(row.decision_deadline_at).getTime() >= Date.now() - 86400000) soonWeighted += weighted;
  }
  const monthly = await sql`
    SELECT to_char(date_trunc('month', won_at AT TIME ZONE 'Europe/London'), 'YYYY-MM') AS month,
           COUNT(*)::int AS deals,
           COALESCE(SUM(COALESCE(one_off_value, 0) + COALESCE(mrr_value, 0) * 12), 0)::float8 AS value,
           COALESCE(SUM(COALESCE(mrr_value, 0)), 0)::float8 AS mrr
    FROM queue_leads
    WHERE won_at IS NOT NULL AND won_at >= date_trunc('month', now() AT TIME ZONE 'Europe/London') - interval '5 months'
    GROUP BY 1 ORDER BY 1
  `;
  const stages = OPEN_STAGES.map((s) => ({ ...byStage[s], value: round(byStage[s].value), weighted: round(byStage[s].weighted) }));
  const totalValue = stages.reduce((s, r) => s + r.value, 0);
  const totalWeighted = stages.reduce((s, r) => s + r.weighted, 0);
  const thisMonthKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }).slice(0, 7);
  const wonThisMonth = monthly.find((m) => m.month === thisMonthKey) || { deals: 0, value: 0, mrr: 0 };
  return {
    openCount: open.length,
    totalValue: round(totalValue),
    weightedValue: round(totalWeighted),
    likelyWithin30Days: round(soonWeighted),
    wonThisMonth: { deals: wonThisMonth.deals, value: round(wonThisMonth.value), mrr: round(wonThisMonth.mrr) },
    stages,
    byOwner: [...byOwner.values()].map((o) => ({ ...o, value: round(o.value), weighted: round(o.weighted) })).sort((a, b) => b.weighted - a.weighted),
    monthly: monthly.map((m) => ({ month: m.month, deals: m.deals, value: round(m.value), mrr: round(m.mrr) })),
    note: 'Value is first-year (one-off + 12 months recurring). Weighted by stage using default win rates.',
  };
}

/** Calls to won by lead source or sector for the last `days` days. */
export async function funnelConversion(sql, { days = 30, groupBy = 'source' } = {}) {
  const since = rangeStart(days);
  const by = groupBy === 'sector' ? 'sector' : 'source';
  const calls = await sql`
    SELECT COALESCE(NULLIF(BTRIM(CASE WHEN ${by} = 'sector' THEN q.sector ELSE q.source END), ''), 'Unknown') AS grp,
           COUNT(*)::int AS calls,
           COUNT(DISTINCT e.lead_id)::int AS leads_called,
           COUNT(*) FILTER (WHERE COALESCE(e.meta->>'outcome', '') ILIKE 'Answered%'
                              OR COALESCE(NULLIF(e.meta->>'durationSec', '')::int, 0) > 0
                              OR COALESCE(e.meta->>'outcome', '') = 'Gatekeeper')::int AS connected
    FROM queue_events e JOIN queue_leads q ON q.id = e.lead_id
    WHERE e.event_type = 'call' AND e.created_at >= ${since}::timestamptz
    GROUP BY 1
  `;
  const stages = await sql`
    SELECT COALESCE(NULLIF(BTRIM(CASE WHEN ${by} = 'sector' THEN q.sector ELSE q.source END), ''), 'Unknown') AS grp,
           COUNT(*) FILTER (WHERE q.qualified_at >= ${since}::timestamptz)::int AS qualified,
           COUNT(*) FILTER (WHERE q.meeting_booked_at >= ${since}::timestamptz)::int AS meetings,
           COUNT(*) FILTER (WHERE q.proposal_at >= ${since}::timestamptz)::int AS proposals,
           COUNT(*) FILTER (WHERE q.won_at >= ${since}::timestamptz)::int AS won,
           COALESCE(SUM(COALESCE(q.one_off_value, 0) + COALESCE(q.mrr_value, 0) * 12) FILTER (WHERE q.won_at >= ${since}::timestamptz), 0)::float8 AS won_value
    FROM queue_leads q
    WHERE q.archived_at IS NULL
    GROUP BY 1
  `;
  const merged = new Map();
  const empty = (grp) => ({ group: grp, calls: 0, leadsCalled: 0, connected: 0, qualified: 0, meetings: 0, proposals: 0, won: 0, wonValue: 0 });
  for (const r of calls) Object.assign(merged.get(r.grp) || merged.set(r.grp, empty(r.grp)).get(r.grp), { calls: r.calls, leadsCalled: r.leads_called, connected: r.connected });
  for (const r of stages) Object.assign(merged.get(r.grp) || merged.set(r.grp, empty(r.grp)).get(r.grp), { qualified: r.qualified, meetings: r.meetings, proposals: r.proposals, won: r.won, wonValue: round(r.won_value) });
  const rows = [...merged.values()]
    .filter((r) => r.calls || r.qualified || r.meetings || r.proposals || r.won)
    .map((r) => ({
      ...r,
      connectRate: pct(r.connected, r.calls),
      callToQualified: pct(r.qualified, r.connected),
      qualifiedToMeeting: pct(r.meetings, r.qualified),
      meetingToProposal: pct(r.proposals, r.meetings),
      proposalToWon: pct(r.won, r.proposals),
      callsPerWin: r.won ? Math.round(r.calls / r.won) : null,
    }))
    .sort((a, b) => b.won - a.won || b.meetings - a.meetings || b.calls - a.calls);
  const totals = rows.reduce((t, r) => {
    for (const k of ['calls', 'connected', 'qualified', 'meetings', 'proposals', 'won']) t[k] += r[k];
    t.wonValue += r.wonValue;
    return t;
  }, { calls: 0, connected: 0, qualified: 0, meetings: 0, proposals: 0, won: 0, wonValue: 0 });
  return { days: Number(days) || 30, groupBy: by, rows, totals: { ...totals, wonValue: round(totals.wonValue), connectRate: pct(totals.connected, totals.calls) } };
}

export const LOSS_CATEGORIES = ['Price / budget', 'Went with a competitor', 'Timing', 'No response', 'Not a fit', 'Internal hold', 'Other'];

/** Maps the free-text/dropdown loss reason onto a fixed set of categories. */
export function lossCategory(reason) {
  const t = String(reason || '').trim().toLowerCase();
  if (!t) return 'No reason recorded';
  if (/budget|price|cost|expens|afford/.test(t)) return 'Price / budget';
  if (/competitor|another agency|went with|chose|in-house|in house/.test(t)) return 'Went with a competitor';
  if (/timing|not now|later|next year|next quarter/.test(t)) return 'Timing';
  if (/respon|stall|ghost|quiet|no reply|unreach/.test(t)) return 'No response';
  if (/not a fit|no fit|not relevant|not interested|no need/.test(t)) return 'Not a fit';
  if (/hold/.test(t)) return 'Internal hold';
  return 'Other';
}

export async function winLoss(sql, { days = 90 } = {}) {
  const since = rangeStart(days);
  const lost = await sql`
    SELECT id, name, company_name, owner, loss_reason, lost_at, COALESCE(one_off_value, 0)::float8 AS one_off, COALESCE(mrr_value, 0)::float8 AS mrr,
           COALESCE(opportunity_stage, '') AS stage, source
    FROM queue_leads
    WHERE archived_at IS NULL AND lost_at >= ${since}::timestamptz
    ORDER BY lost_at DESC
  `;
  const won = await sql`
    SELECT owner, COALESCE(one_off_value, 0)::float8 AS one_off, COALESCE(mrr_value, 0)::float8 AS mrr,
           EXTRACT(EPOCH FROM (won_at - COALESCE(qualified_at, created_at))) / 86400 AS cycle_days
    FROM queue_leads
    WHERE archived_at IS NULL AND won_at >= ${since}::timestamptz
  `;
  const reasons = new Map();
  for (const l of lost) {
    const cat = lossCategory(l.loss_reason);
    const r = reasons.get(cat) || { category: cat, count: 0, value: 0 };
    r.count += 1; r.value += firstYearValue(l.one_off, l.mrr);
    reasons.set(cat, r);
  }
  const owners = new Map();
  const bump = (name, key, value) => {
    const o = owners.get(name || 'Unassigned') || { owner: name || 'Unassigned', won: 0, lost: 0, wonValue: 0, lostValue: 0 };
    o[key] += 1; o[`${key}Value`] += value;
    owners.set(o.owner, o);
  };
  for (const w of won) bump(w.owner, 'won', firstYearValue(w.one_off, w.mrr));
  for (const l of lost) bump(l.owner, 'lost', firstYearValue(l.one_off, l.mrr));
  const cycle = won.map((w) => Number(w.cycle_days)).filter((n) => Number.isFinite(n) && n >= 0);
  const wonValue = won.reduce((s, w) => s + firstYearValue(w.one_off, w.mrr), 0);
  const lostValue = lost.reduce((s, l) => s + firstYearValue(l.one_off, l.mrr), 0);
  return {
    days: Number(days) || 90,
    won: won.length, lost: lost.length, winRate: pct(won.length, won.length + lost.length),
    wonValue: round(wonValue), lostValue: round(lostValue),
    avgCycleDays: cycle.length ? Math.round(cycle.reduce((a, b) => a + b, 0) / cycle.length) : null,
    reasons: [...reasons.values()].map((r) => ({ ...r, value: round(r.value), share: pct(r.count, lost.length) })).sort((a, b) => b.count - a.count),
    owners: [...owners.values()].map((o) => ({ ...o, winRate: pct(o.won, o.won + o.lost), wonValue: round(o.wonValue), lostValue: round(o.lostValue) })).sort((a, b) => b.won - a.won),
    recentLost: lost.slice(0, 15).map((l) => ({ id: l.id, name: l.name, company: l.company_name, owner: l.owner, reason: l.loss_reason || '', category: lossCategory(l.loss_reason), value: round(firstYearValue(l.one_off, l.mrr)), lostAt: l.lost_at })),
  };
}
