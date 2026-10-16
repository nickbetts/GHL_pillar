/**
 * GET  /api/insights?days=30&groupBy=source|sector — pipeline forecast, funnel conversion, win/loss (managers and admins).
 * POST { action: 'set-report-recipients', emails } — who gets the Monday report (admin).
 * POST { action: 'send-test-report' }              — sends the report to the signed-in admin only.
 * POST { action: 'test-teams' }                    — posts a test card to the Teams feed (admin).
 */

import { getSql } from './db.js';
import { hasMinRole, resolveIdentity } from './session.js';
import { pipelineForecast, funnelConversion, winLoss } from '../lib/insights.js';
import { findStaleOpportunities } from '../lib/staleOpportunities.js';
import { getReportRecipients, setReportRecipients, sendWeeklyReport } from '../lib/weekly-report.js';
import { buildCard, postToTeams, teamsConfigured, appUrl } from '../lib/teams.js';
import { londonDateKey, londonMidnight } from './business-time.js';

const SECTOR_LIMIT = 25;

function lastWeekStartKey(now = new Date()) {
  const key = londonDateKey(now);
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(now);
  const sinceMonday = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday) + 7) % 7;
  return londonDateKey(londonMidnight(key, -sinceMonday - 7));
}

export default async function handler(req, res) {
  const identity = resolveIdentity(req);
  if (!identity) return res.status(401).json({ success: false, error: 'Not signed in' });
  if (!hasMinRole(identity, 'manager')) return res.status(403).json({ success: false, error: 'Insights are for managers and admins' });
  const isAdmin = hasMinRole(identity, 'admin');
  const sql = getSql();

  try {
    if (req.method === 'GET') {
      const days = Math.max(7, Math.min(365, Number.parseInt(req.query?.days, 10) || 30));
      const groupBy = req.query?.groupBy === 'sector' ? 'sector' : 'source';
      const [forecast, funnel, wl, stale] = await Promise.all([
        pipelineForecast(sql),
        funnelConversion(sql, { days, groupBy }),
        winLoss(sql, { days: Math.max(days, 30) }),
        findStaleOpportunities(sql).catch(() => []),
      ]);
      if (funnel.rows.length > SECTOR_LIMIT) funnel.rows = funnel.rows.slice(0, SECTOR_LIMIT);
      const out = { success: true, days, groupBy, forecast, funnel, winLoss: wl, staleCount: stale.length, teamsConfigured: teamsConfigured(), isAdmin };
      if (isAdmin) {
        const users = await sql`SELECT name, email FROM app_users WHERE active = TRUE AND email IS NOT NULL ORDER BY lower(COALESCE(name, email))`;
        out.users = users.map((u) => ({ name: u.name || u.email, email: String(u.email).toLowerCase() }));
        out.reportRecipients = await getReportRecipients(sql);
      }
      return res.status(200).json(out);
    }

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    if (!isAdmin) return res.status(403).json({ success: false, error: 'Admins only' });
    const body = req.body || {};

    if (body.action === 'set-report-recipients') {
      const known = new Set((await sql`SELECT lower(email) AS email FROM app_users WHERE active = TRUE`).map((u) => u.email));
      const emails = (Array.isArray(body.emails) ? body.emails : []).map((e) => String(e || '').trim().toLowerCase()).filter((e) => known.has(e));
      return res.status(200).json({ success: true, reportRecipients: await setReportRecipients(sql, emails) });
    }

    if (body.action === 'send-test-report') {
      if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) return res.status(400).json({ success: false, error: 'Email is not configured' });
      if (!identity.email) return res.status(400).json({ success: false, error: 'Your account has no email address' });
      await sendWeeklyReport(sql, { to: [identity.email], weekStartKey: lastWeekStartKey(), subjectPrefix: '[TEST] ' });
      return res.status(200).json({ success: true, sentTo: identity.email });
    }

    if (body.action === 'test-teams') {
      if (!teamsConfigured()) return res.status(400).json({ success: false, error: 'TEAMS_WEBHOOK_URL is not set on the server yet' });
      const result = await postToTeams(buildCard({ title: 'Stream test message', text: `Sent by ${identity.name || identity.email}. The Teams feed is connected.`, url: `${appUrl()}/insights`, urlLabel: 'Open Insights', tone: 'good' }));
      return result.ok ? res.status(200).json({ success: true }) : res.status(502).json({ success: false, error: `Teams did not accept the message (${result.reason})` });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
