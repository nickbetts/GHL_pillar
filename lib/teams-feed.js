/** Teams feed: event cards (deal moves, proposal activity, frenzy) and the scheduled jobs (callbacks, milestones, 9am digest). */

import { londonDateKey, londonMidnight } from '../api/business-time.js';
import { appUrl, buildCard, dealValueText, feed, claimFeedKey, releaseFeedKey, gbp, teamsConfigured } from './teams.js';
import { proposalCosts } from './proposalCosts.js';
import { pipelineForecast } from './insights.js';
import { findStaleOpportunities } from './staleOpportunities.js';

const londonTime = (value) => new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const hhmm = (value) => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
const company = (lead) => lead.company_name || lead.company || lead.name || 'Unknown company';
const link = (path) => `${appUrl()}${path}`;

async function winsThisMonth(sql) {
  const rows = await sql`SELECT COUNT(*)::int AS n FROM queue_leads WHERE archived_at IS NULL AND won_at >= (date_trunc('month', now() AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London')`;
  return rows[0]?.n || 0;
}

export function frenzyCard({ repName, companyName, value, endsAt, winNumber }) {
  return buildCard({
    title: `Double Point Frenzy is ON: ${repName} closed ${companyName}`,
    text: `Every leaderboard action scores 2× until ${londonTime(endsAt)}.`,
    facts: [['Deal value', value], ['Win this month', winNumber ? `#${winNumber}` : ''], ['Closed by', repName]],
    url: link('/weekly-dashboard'), urlLabel: 'Open the leaderboard', tone: 'bad',
  });
}

/** A lead moved on the opportunities board. Won becomes the frenzy announcement. */
export async function feedOpportunityStage(sql, { lead, fromStage, stage, backward = false, lossReason, oneOff, mrr, meetingAt, actorName }) {
  if (backward || stage === fromStage) return false;
  const one = oneOff ?? lead.one_off_value;
  const monthly = mrr ?? lead.mrr_value;
  const value = dealValueText(one, monthly);
  const rep = lead.owner || actorName || '';
  const name = company(lead);
  const url = link('/opportunities');
  if (stage === 'won') {
    return feed(sql, frenzyCard({ repName: rep || 'A teammate', companyName: name, value, endsAt: Date.now() + 48 * 3600000, winNumber: await winsThisMonth(sql) }));
  }
  const base = { url, urlLabel: 'Open opportunities' };
  const facts = [['Rep', rep], ['Contact', lead.name], ['Value', value]];
  if (stage === 'meeting_booked') return feed(sql, buildCard({ ...base, title: `Meeting booked: ${name}`, facts: [...facts, ['When', meetingAt ? londonTime(meetingAt) : '']], tone: 'good' }));
  if (stage === 'meeting_attended') return feed(sql, buildCard({ ...base, title: `Meeting attended: ${name}`, facts, tone: 'good' }));
  if (stage === 'scoping') return feed(sql, buildCard({ ...base, title: `Moved to scoping: ${name}`, facts, tone: 'accent' }));
  if (stage === 'proposal') return feed(sql, buildCard({ ...base, title: `Proposal stage: ${name}`, facts, tone: 'accent' }));
  if (stage === 'lost') return feed(sql, buildCard({ ...base, title: `Opportunity lost: ${name}`, facts: [...facts, ['Reason', lossReason]], tone: 'warn' }));
  return false;
}

/** The client opened their proposal; repeat opens are throttled to one per 3 hours. */
export function feedProposalOpened(sql, proposal, { views } = {}) {
  const bucket = Math.floor(Date.now() / (3 * 3600000));
  return feed(sql, buildCard({
    title: `Proposal opened: ${proposal.client_company || proposal.client_name || proposal.title}`,
    text: 'Now is a good time to call.',
    facts: [['Rep', proposal.owner_name], ['Contact', proposal.client_name], ['Proposal', proposal.title], ['Views', views]],
    url: link('/proposal-hub'), urlLabel: 'Open Proposal Hub', tone: 'good',
  }), `pview:${proposal.id}:${bucket}`);
}

export function feedProposalAccepted(sql, proposal) {
  return feed(sql, buildCard({
    title: `Proposal accepted: ${proposal.client_company || proposal.client_name || proposal.title}`,
    text: 'The contract has been sent for signature.',
    facts: [['Rep', proposal.owner_name], ['Contact', proposal.client_name], ['Value', dealValueText(proposal.one_off_value, proposal.mrr_value)]],
    url: link('/proposal-hub'), urlLabel: 'Open Proposal Hub', tone: 'good',
  }));
}

export function feedContractSigned(sql, proposal, { frenzyEndsAt = null, winNumber = null } = {}) {
  let costs = null;
  try { costs = proposalCosts(proposal); } catch { costs = null; }
  const value = costs ? dealValueText(costs.oneOff, costs.monthly) : dealValueText(proposal.one_off_value, proposal.mrr_value);
  return feed(sql, buildCard({
    title: `Contract signed: ${proposal.client_company || proposal.client_name || proposal.title}`,
    text: frenzyEndsAt ? `Deal won. Double Point Frenzy is on until ${londonTime(frenzyEndsAt)}.` : 'Deal won.',
    facts: [['Rep', proposal.owner_name], ['Signed by', proposal.contract_signed_by_name || proposal.client_name], ['Value', value], ['Payment terms', '50% upfront, 50% on sign-off'], ['Win this month', winNumber ? `#${winNumber}` : '']],
    url: link('/proposal-hub'), urlLabel: 'Open Proposal Hub', tone: 'bad',
  }), `signed:${proposal.id}`);
}
export { winsThisMonth };

// ── Scheduled jobs ──────────────────────────────────────────────────────────

function londonParts(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, hour: Number(p.hour), minute: Number(p.minute), dateKey: londonDateKey(now) };
}
const isWeekday = (w) => !['Sat', 'Sun'].includes(w);

/** Callbacks due in the next 10 minutes (date-only callbacks at midnight are ignored). */
export async function postCallbackReminders(sql) {
  const rows = await sql`
    SELECT id, name, company_name, owner, callback_at
    FROM queue_leads
    WHERE archived_at IS NULL AND callback_at IS NOT NULL
      AND status IN ('to_call_back', 'wants_more_info', 'qualified')
      AND COALESCE(opportunity_stage, '') NOT IN ('won', 'lost')
      AND callback_at > now() - interval '5 minutes' AND callback_at <= now() + interval '10 minutes'
      AND (callback_at AT TIME ZONE 'Europe/London')::time <> '00:00'
    ORDER BY callback_at ASC LIMIT 20
  `;
  const claimed = [];
  for (const row of rows) {
    if (await claimFeedKey(sql, `cb:${row.id}:${Math.floor(new Date(row.callback_at).getTime() / 1000)}`)) claimed.push(row);
  }
  if (!claimed.length) return 0;
  const sent = await feed(sql, buildCard({
    title: claimed.length === 1 ? 'Callback due soon' : `${claimed.length} callbacks due soon`,
    facts: claimed.slice(0, 8).map((r) => [`${hhmm(r.callback_at)} · ${r.owner || 'Unassigned'}`, `${company(r)}${r.name ? ` (${r.name})` : ''}`]),
    url: link('/call-list-zen'), urlLabel: 'Open the call list', tone: 'warn',
  }));
  if (!sent) {
    for (const row of claimed) await releaseFeedKey(sql, `cb:${row.id}:${Math.floor(new Date(row.callback_at).getTime() / 1000)}`).catch(() => {});
    return 0;
  }
  return claimed.length;
}

const CALL_STEPS = [50, 100, 150, 200];
const TEAM_CALL_STEPS = [250, 500, 750, 1000, 1500];
const MEETING_STEPS = [5, 10, 15, 20, 30, 40];

async function highestNewMilestone(sql, keyPrefix, value, steps) {
  let top = null;
  for (const step of steps) {
    if (value >= step && await claimFeedKey(sql, `${keyPrefix}:${step}`)) top = step;
  }
  return top;
}

/** Calls per rep today, team calls today, and team meetings booked this week. */
export async function postMilestones(sql, now = new Date()) {
  const { dateKey } = londonParts(now);
  const start = londonMidnight(dateKey);
  const posts = [];
  const perRep = await sql`
    SELECT COALESCE(e.owner_id, q.owner_id) AS owner_id, MAX(COALESCE(e.owner_name, q.owner)) AS owner_name, COUNT(*)::int AS calls
    FROM queue_events e JOIN queue_leads q ON q.id = e.lead_id
    WHERE e.event_type = 'call' AND e.created_at >= ${start.toISOString()}::timestamptz
    GROUP BY 1
  `;
  let teamCalls = 0;
  for (const r of perRep) {
    teamCalls += r.calls;
    if (!r.owner_id) continue;
    const step = await highestNewMilestone(sql, `ms:calls:${r.owner_id}:${dateKey}`, r.calls, CALL_STEPS);
    if (step) posts.push(feed(sql, buildCard({ title: `${r.owner_name || 'A rep'} has made ${step} calls today`, text: `${r.calls} dials so far.`, url: link('/weekly-dashboard'), urlLabel: 'Open the leaderboard', tone: 'good' })));
  }
  const teamStep = await highestNewMilestone(sql, `ms:team-calls:${dateKey}`, teamCalls, TEAM_CALL_STEPS);
  if (teamStep) posts.push(feed(sql, buildCard({ title: `The team has made ${teamStep} calls today`, text: `${teamCalls} dials across the team so far.`, url: link('/weekly-dashboard'), urlLabel: 'Open the leaderboard', tone: 'good' })));

  const weekday = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(londonParts(now).weekday) + 7) % 7;
  const weekStart = londonMidnight(dateKey, -weekday);
  const meetings = await sql`SELECT COUNT(*)::int AS n FROM queue_leads WHERE archived_at IS NULL AND meeting_booked_at >= ${weekStart.toISOString()}::timestamptz`;
  const weekKey = londonDateKey(weekStart);
  const meetingStep = await highestNewMilestone(sql, `ms:meetings:${weekKey}`, meetings[0]?.n || 0, MEETING_STEPS);
  if (meetingStep) posts.push(feed(sql, buildCard({ title: `${meetingStep} meetings booked this week`, text: `${meetings[0].n} so far.`, url: link('/opportunities'), urlLabel: 'Open opportunities', tone: 'good' })));
  await Promise.all(posts);
  return posts.length;
}

async function dayStats(sql, start, end) {
  const [calls, stages] = await Promise.all([
    sql`SELECT COUNT(*)::int AS calls,
               COUNT(*) FILTER (WHERE COALESCE(meta->>'outcome', '') ILIKE 'Answered%' OR COALESCE(NULLIF(meta->>'durationSec', '')::int, 0) > 0 OR COALESCE(meta->>'outcome', '') = 'Gatekeeper')::int AS connected
        FROM queue_events WHERE event_type = 'call' AND created_at >= ${start.toISOString()}::timestamptz AND created_at < ${end.toISOString()}::timestamptz`,
    sql`SELECT COUNT(*) FILTER (WHERE meeting_booked_at >= ${start.toISOString()}::timestamptz AND meeting_booked_at < ${end.toISOString()}::timestamptz)::int AS meetings,
               COUNT(*) FILTER (WHERE proposal_at >= ${start.toISOString()}::timestamptz AND proposal_at < ${end.toISOString()}::timestamptz)::int AS proposals,
               COUNT(*) FILTER (WHERE won_at >= ${start.toISOString()}::timestamptz AND won_at < ${end.toISOString()}::timestamptz)::int AS won
        FROM queue_leads WHERE archived_at IS NULL`,
  ]);
  return { ...calls[0], ...stages[0] };
}

export async function buildDigest(sql, now = new Date()) {
  const { dateKey, weekday } = londonParts(now);
  const prevOffset = weekday === 'Mon' ? -3 : -1;
  const prevStart = londonMidnight(dateKey, prevOffset);
  const prevEnd = londonMidnight(dateKey, prevOffset + 1);
  const todayStart = londonMidnight(dateKey);
  const todayEnd = londonMidnight(dateKey, 1);
  const [prev, callbacks, meetings, awaiting, stale, forecast, frenzy] = await Promise.all([
    dayStats(sql, prevStart, weekday === 'Mon' ? londonMidnight(dateKey, -2) : prevEnd),
    sql`SELECT COALESCE(owner, 'Unassigned') AS owner, COUNT(*)::int AS n FROM queue_leads
        WHERE archived_at IS NULL AND callback_at >= ${todayStart.toISOString()}::timestamptz AND callback_at < ${todayEnd.toISOString()}::timestamptz
          AND status IN ('to_call_back', 'wants_more_info', 'qualified') AND COALESCE(opportunity_stage, '') NOT IN ('won', 'lost')
        GROUP BY 1 ORDER BY 2 DESC`,
    sql`SELECT m.scheduled_for, m.primary_owner_name, q.company_name, q.name FROM opportunity_meetings m JOIN queue_leads q ON q.id = m.lead_id
        WHERE m.status = 'scheduled' AND m.scheduled_for >= ${todayStart.toISOString()}::timestamptz AND m.scheduled_for < ${todayEnd.toISOString()}::timestamptz
        ORDER BY m.scheduled_for ASC LIMIT 8`,
    sql`SELECT COUNT(*)::int AS out, COUNT(*) FILTER (WHERE view_count > 0)::int AS viewed FROM proposals WHERE stage = 'proposal' AND status IN ('active', 'viewed')`,
    findStaleOpportunities(sql).catch(() => []),
    pipelineForecast(sql).catch(() => null),
    sql`SELECT triggered_by_name, ends_at FROM point_frenzies WHERE ends_at > now() ORDER BY ends_at DESC LIMIT 1`,
  ]);
  const cbTotal = callbacks.reduce((s, r) => s + r.n, 0);
  const facts = [
    [weekday === 'Mon' ? 'Last working day' : 'Yesterday', `${prev.calls} calls, ${prev.connected} connected, ${prev.meetings} meetings booked, ${prev.proposals} proposals, ${prev.won} won`],
    ['Callbacks today', cbTotal ? `${cbTotal} (${callbacks.slice(0, 5).map((r) => `${r.owner.split(' ')[0]} ${r.n}`).join(', ')})` : 'None scheduled'],
    ['Meetings today', meetings.length ? meetings.map((m) => `${hhmm(m.scheduled_for)} ${(m.primary_owner_name || '').split(' ')[0]} · ${m.company_name || m.name || 'Meeting'}`).join('; ') : 'None scheduled'],
    ['Proposals out', `${awaiting[0]?.out || 0} awaiting a decision (${awaiting[0]?.viewed || 0} opened)`],
    ['No next step', stale.length ? `${stale.length} opportunit${stale.length === 1 ? 'y' : 'ies'} with no next step for 3+ days` : 'None'],
    ['Open pipeline', forecast ? `${gbp(forecast.totalValue)} (${gbp(forecast.weightedValue)} weighted), won this month ${gbp(forecast.wonThisMonth.value)}` : ''],
    ['Double Point Frenzy', frenzy[0] ? `Live until ${londonTime(frenzy[0].ends_at)} (triggered by ${frenzy[0].triggered_by_name})` : ''],
  ];
  return buildCard({ title: `Good morning. Sales digest for ${new Date(now).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' })}`, facts, url: link('/insights'), urlLabel: 'Open Insights', tone: 'accent' });
}

/** Posts the digest once on weekdays from 09:00 London; later runs that day catch up if a run was missed. */
export async function postDailyDigest(sql, now = new Date()) {
  const { weekday, hour, dateKey } = londonParts(now);
  if (!isWeekday(weekday) || hour < 9 || hour > 11) return false;
  return feed(sql, await buildDigest(sql, now), `digest:${dateKey}`);
}

export async function runTeamsFeedJobs(sql, now = new Date()) {
  if (!teamsConfigured()) return { skipped: 'TEAMS_WEBHOOK_URL is not set' };
  const out = {};
  for (const [name, job] of [['callbacks', () => postCallbackReminders(sql)], ['milestones', () => postMilestones(sql, now)], ['digest', () => postDailyDigest(sql, now)]]) {
    try { out[name] = await job(); } catch (error) { out[name] = `error: ${error.message}`; }
  }
  return out;
}
