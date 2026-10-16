/** Monday-morning sales report emailed to the users picked on the Insights page (nobody by default). */

import { londonDateKey, londonMidnight } from '../api/business-time.js';
import { sendViaMailgun } from '../api/email-send.js';
import { appUrl, claimFeedKey, releaseFeedKey, gbp } from './teams.js';
import { pipelineForecast, winLoss } from './insights.js';
import { findStaleOpportunities } from './staleOpportunities.js';

export const RECIPIENTS_KEY = 'weekly_report_recipients';
const BLUE = '#4463FF';
const INK = '#0B0B0F';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const looksLikeEmail = (v) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(String(v || '').trim());

async function ensureConfig(sql) {
  await sql`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
}

export async function getReportRecipients(sql) {
  await ensureConfig(sql);
  const rows = await sql`SELECT value FROM app_config WHERE key = ${RECIPIENTS_KEY} LIMIT 1`;
  try {
    const list = JSON.parse(rows[0]?.value || '[]');
    return [...new Set((Array.isArray(list) ? list : []).map((e) => String(e || '').trim().toLowerCase()).filter(looksLikeEmail))];
  } catch { return []; }
}

export async function setReportRecipients(sql, emails) {
  await ensureConfig(sql);
  const clean = [...new Set((Array.isArray(emails) ? emails : []).map((e) => String(e || '').trim().toLowerCase()).filter(looksLikeEmail))];
  await sql`
    INSERT INTO app_config (key, value, updated_at) VALUES (${RECIPIENTS_KEY}, ${JSON.stringify(clean)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return clean;
}

async function weekStats(sql, start, end) {
  const s = start.toISOString(); const e = end.toISOString();
  const [calls, leads] = await Promise.all([
    sql`SELECT COALESCE(ev.owner_id, q.owner_id) AS owner_id, MAX(COALESCE(ev.owner_name, q.owner)) AS owner,
               COUNT(*)::int AS calls,
               COUNT(*) FILTER (WHERE COALESCE(ev.meta->>'outcome', '') ILIKE 'Answered%' OR COALESCE(NULLIF(ev.meta->>'durationSec', '')::int, 0) > 0 OR COALESCE(ev.meta->>'outcome', '') = 'Gatekeeper')::int AS connected
        FROM queue_events ev JOIN queue_leads q ON q.id = ev.lead_id
        WHERE ev.event_type = 'call' AND ev.created_at >= ${s}::timestamptz AND ev.created_at < ${e}::timestamptz GROUP BY 1`,
    sql`SELECT owner_id, MAX(owner) AS owner,
               COUNT(*) FILTER (WHERE meeting_booked_at >= ${s}::timestamptz AND meeting_booked_at < ${e}::timestamptz)::int AS meetings,
               COUNT(*) FILTER (WHERE proposal_at >= ${s}::timestamptz AND proposal_at < ${e}::timestamptz)::int AS proposals,
               COUNT(*) FILTER (WHERE won_at >= ${s}::timestamptz AND won_at < ${e}::timestamptz)::int AS won,
               COALESCE(SUM(COALESCE(one_off_value, 0) + COALESCE(mrr_value, 0) * 12) FILTER (WHERE won_at >= ${s}::timestamptz AND won_at < ${e}::timestamptz), 0)::float8 AS won_value
        FROM queue_leads WHERE archived_at IS NULL AND owner_id IS NOT NULL GROUP BY 1`,
  ]);
  const reps = new Map();
  const rep = (id, name) => reps.get(id) || reps.set(id, { owner: name || 'Unassigned', calls: 0, connected: 0, meetings: 0, proposals: 0, won: 0, wonValue: 0 }).get(id);
  for (const r of calls) Object.assign(rep(r.owner_id || 'none', r.owner), { calls: r.calls, connected: r.connected });
  for (const r of leads) Object.assign(rep(r.owner_id, r.owner), { meetings: r.meetings, proposals: r.proposals, won: r.won, wonValue: r.won_value });
  const rows = [...reps.values()].filter((r) => r.calls || r.meetings || r.proposals || r.won).sort((a, b) => b.won - a.won || b.meetings - a.meetings || b.calls - a.calls);
  const total = rows.reduce((t, r) => { for (const k of ['calls', 'connected', 'meetings', 'proposals', 'won', 'wonValue']) t[k] += r[k]; return t; }, { calls: 0, connected: 0, meetings: 0, proposals: 0, won: 0, wonValue: 0 });
  return { rows, total };
}

/** Builds the report for the Monday-to-Sunday week ending before `weekStart` + 7 days. */
export async function buildWeeklyReport(sql, { weekStartKey, origin = appUrl() }) {
  const start = londonMidnight(weekStartKey);
  const end = londonMidnight(weekStartKey, 7);
  const [stats, forecast, losses, stale] = await Promise.all([
    weekStats(sql, start, end),
    pipelineForecast(sql),
    winLoss(sql, { days: 7 }),
    findStaleOpportunities(sql).catch(() => []),
  ]);
  const label = `${new Date(start).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' })} to ${new Date(end.getTime() - 3600000).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' })}`;
  const t = stats.total;
  const tiles = [['Calls', t.calls], ['Connected', t.connected], ['Meetings booked', t.meetings], ['Proposals', t.proposals], ['Won', `${t.won}${t.wonValue ? ` (${gbp(t.wonValue)})` : ''}`]];
  const tileHtml = tiles.map(([k, v]) => `<td style="padding:12px 10px;background:#EEF1FF;border-radius:10px;text-align:center"><div style="font:700 20px ${FONT};color:${INK}">${esc(v)}</div><div style="font:600 11px ${FONT};color:#3149E8;text-transform:uppercase;letter-spacing:.05em;margin-top:2px">${esc(k)}</div></td>`).join('<td width="8"></td>');
  const th = (s) => `<th align="left" style="padding:8px 10px;font:600 11px ${FONT};color:#6B7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #E5E7EB">${s}</th>`;
  const td = (s, extra = '') => `<td style="padding:8px 10px;font:14px ${FONT};color:${INK};border-bottom:1px solid #F1F5F9;${extra}">${esc(s)}</td>`;
  const repRows = stats.rows.map((r) => `<tr>${td(r.owner, 'font-weight:600')}${td(r.calls)}${td(r.connected)}${td(r.meetings)}${td(r.proposals)}${td(r.won)}</tr>`).join('') || `<tr>${td('No activity recorded')}<td colspan="5"></td></tr>`;
  const reasons = losses.reasons.slice(0, 4).map((r) => `${r.category} (${r.count})`).join(', ') || 'None lost this week';
  const section = (title) => `<div style="font:700 13px ${FONT};color:${INK};margin:22px 0 8px;text-transform:uppercase;letter-spacing:.05em">${esc(title)}</div>`;
  const html = `<!doctype html><html><body style="margin:0;background:#F6F6F3;padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;overflow:hidden">
<tr><td style="background:${BLUE};padding:22px 28px"><img src="${esc(origin)}/brand/stream-logo-email.png" width="120" alt="Stream" style="display:block;border:0"><div style="font:700 20px ${FONT};color:#fff;margin-top:14px">Weekly sales report</div><div style="font:14px ${FONT};color:#DDE3FF;margin-top:2px">${esc(label)}</div></td></tr>
<tr><td style="padding:24px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${tileHtml}</tr></table>
${section('By rep')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${th('Rep')}${th('Calls')}${th('Connected')}${th('Meetings')}${th('Proposals')}${th('Won')}</tr>${repRows}</table>
${section('Pipeline now')}
<div style="font:14px/1.6 ${FONT};color:${INK}">${esc(forecast.openCount)} open opportunities worth ${esc(gbp(forecast.totalValue))} first-year value, ${esc(gbp(forecast.weightedValue))} weighted. Won this month: ${esc(forecast.wonThisMonth.deals)} (${esc(gbp(forecast.wonThisMonth.value))}).</div>
${section('Lost this week')}
<div style="font:14px/1.6 ${FONT};color:${INK}">${esc(losses.lost)} lost${losses.lost ? `: ${esc(reasons)}` : ''}.</div>
${section('Needs attention')}
<div style="font:14px/1.6 ${FONT};color:${INK}">${stale.length ? `${esc(stale.length)} opportunit${stale.length === 1 ? 'y has' : 'ies have'} had no next step for 3+ days.` : 'Every open opportunity has a next step.'}</div>
<div style="margin-top:24px"><a href="${esc(origin)}/insights" style="display:inline-block;background:${BLUE};color:#fff;text-decoration:none;font:600 14px ${FONT};padding:11px 20px;border-radius:9px">Open Insights</a></div>
</td></tr></table></td></tr></table></body></html>`;
  const text = [
    `Weekly sales report, ${label}`, '',
    `Calls ${t.calls}, connected ${t.connected}, meetings booked ${t.meetings}, proposals ${t.proposals}, won ${t.won}${t.wonValue ? ` (${gbp(t.wonValue)})` : ''}`, '',
    ...stats.rows.map((r) => `${r.owner}: ${r.calls} calls, ${r.connected} connected, ${r.meetings} meetings, ${r.proposals} proposals, ${r.won} won`), '',
    `Pipeline: ${forecast.openCount} open, ${gbp(forecast.totalValue)} (${gbp(forecast.weightedValue)} weighted).`,
    `Lost this week: ${losses.lost}${losses.lost ? ` (${reasons})` : ''}.`,
    stale.length ? `${stale.length} opportunities have had no next step for 3+ days.` : 'Every open opportunity has a next step.', '',
    `${origin}/insights`,
  ].join('\n');
  return { subject: `Weekly sales report: ${label}`, html, text };
}

export const weeklyReportFrom = (env = process.env) => `Stream <${looksLikeEmail(env.WEEKLY_REPORT_FROM_EMAIL) ? env.WEEKLY_REPORT_FROM_EMAIL.trim() : 'reports@i3media.net'}>`;

function previousWeekStartKey(now) {
  const key = londonDateKey(now);
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(now);
  const sinceMonday = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday) + 7) % 7;
  return londonDateKey(londonMidnight(key, -sinceMonday - 7));
}

export async function sendWeeklyReport(sql, { to, weekStartKey, subjectPrefix = '' }) {
  const report = await buildWeeklyReport(sql, { weekStartKey });
  await sendViaMailgun({ from: weeklyReportFrom(), to: to.join(','), subject: `${subjectPrefix}${report.subject}`, text: report.text, html: report.html, transactional: true });
  return report;
}

/** Mondays from 08:00 London, once, to the selected users only. */
export async function runWeeklyReportJob(sql, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday !== 'Mon' || Number(parts.hour) < 8 || Number(parts.hour) > 11) return 'not due';
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) return 'mail not configured';
  const to = await getReportRecipients(sql);
  if (!to.length) return 'no recipients selected';
  const key = `weekly-report:${londonDateKey(now)}`;
  if (!(await claimFeedKey(sql, key))) return 'already sent';
  try {
    await sendWeeklyReport(sql, { to, weekStartKey: previousWeekStartKey(now) });
    return `sent to ${to.length}`;
  } catch (error) {
    await releaseFeedKey(sql, key).catch(() => {});
    throw error;
  }
}
