/**
 * Monday scorecard: last week's calls, meetings, streaks and the one thing to focus on.
 * Sent once on Monday morning: a Teams card, a manager email (weekly report recipients) and, optionally, each rep's own email.
 */

import { londonClock, londonDateKey, londonMidnight } from '../api/business-time.js';
import { sendViaMailgun } from '../api/email-send.js';
import { appUrl, buildCard, claimFeedKey, feed, releaseFeedKey } from './teams.js';
import { getReportRecipients, weeklyReportFrom } from './weekly-report.js';
import { buildFunnel, buildRecords, loadConfig } from './rep-targets.js';
import { loadDailyDials, loadFunnelCounts, loadMonthMeetings, loadReps } from './rep-data.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const noonKey = (dateKey, offsetDays) => londonDateKey(new Date(londonMidnight(dateKey, offsetDays).getTime() + 12 * 3600000));
const dayName = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
const fmt = (r) => (r == null ? '–' : r < 1 ? `${r.toFixed(2)}%` : `${Math.round(r * 10) / 10}%`);

/** Pure: turn last week's numbers into the emails and the Teams card. */
export function buildScorecards({ config, weekKeys, reps, daily, meetings, funnels, records, base }) {
  const floor = config.dials.floor;
  const mt = config.meetings;
  const rows = reps.map((rep) => {
    const byDate = new Map((daily.get(rep.ownerId) || []).map((r) => [r.date, r.dials]));
    const perDay = weekKeys.map((k) => ({ key: k, dials: byDate.get(k) || 0 }));
    const total = perDay.reduce((t, d) => t + d.dials, 0);
    const daysAtFloor = perDay.filter((d) => d.dials >= floor).length;
    const best = perDay.reduce((b, d) => (d.dials > (b?.dials ?? -1) ? d : b), null);
    const booked = meetings.get(rep.ownerId) || 0;
    const funnel = funnels.get(rep.ownerId);
    const rec = records.get(rep.ownerId);
    const strong = funnel?.stages.filter((s) => s.key !== 'endtoend' && s.status === 'smashing').sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0))[0] || null;
    const weak = funnel?.stages.find((s) => s.key === funnel.bottleneck) || null;
    return { ...rep, perDay, total, daysAtFloor, best, booked, funnel, rec, strong, weak };
  });

  const meetingsVerdict = (n) => (n >= mt.stretchPerWeek ? 'a stretch week' : n >= mt.targetPerWeek ? 'on target' : n >= mt.floorPerWeek ? 'at the floor' : 'below the floor');

  const repMails = rows.map((r) => {
    const first = (r.name || 'there').split(' ')[0];
    const lines = [
      `Calls: ${r.total} (${r.daysAtFloor} of ${weekKeys.length} days at the ${floor} floor${r.best ? `, best day ${r.best.dials} on ${dayName(r.best.key)}` : ''})`,
      `Meetings booked: ${r.booked} (${meetingsVerdict(r.booked)}; weekly floor ${mt.floorPerWeek}, target ${mt.targetPerWeek})`,
    ];
    if (r.rec?.currentStreak) lines.push(`Streak: ${r.rec.currentStreak} working day${r.rec.currentStreak === 1 ? '' : 's'} in a row at the floor`);
    const win = r.strong ? `Going well: ${r.strong.label.toLowerCase()} is ${fmt(r.strong.rate)}, above the ${fmt(r.strong.bench.max)} top of the benchmark range.` : '';
    const focus = r.weak ? `One thing to focus on: ${r.weak.label.toLowerCase()} is ${fmt(r.weak.rate)} against a benchmark of ${fmt(r.weak.bench.min)} to ${fmt(r.weak.bench.max)}. ${r.weak.message}` : '';
    const link = `${appUrl()}/targets`;
    const text = [`Morning ${first},`, '', "Here is how last week went.", '', ...lines, '', win, focus, '', `The full picture, with what-ifs and your trends, is on the Targets page: ${link}`].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0B0B0F;max-width:560px;line-height:1.55">
      <p>Morning ${esc(first)},</p><p>Here is how last week went.</p>
      <ul style="padding-left:18px">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      ${win ? `<p style="background:#f0fdf4;border-radius:8px;padding:10px 12px">${esc(win)}</p>` : ''}
      ${focus ? `<p style="background:#fffbeb;border-radius:8px;padding:10px 12px">${esc(focus)}</p>` : ''}
      <p><a href="${esc(link)}" style="color:#4463FF;font-weight:600">Open your Targets page</a></p></div>`;
    return { ownerId: r.ownerId, name: r.name, email: r.email, subject: `Your weekly scorecard: ${r.total} calls, ${r.booked} meeting${r.booked === 1 ? '' : 's'}`, text, html };
  });

  const total = rows.reduce((t, r) => t + r.total, 0);
  const totalBooked = rows.reduce((t, r) => t + r.booked, 0);
  const mgrLines = rows.map((r) => `${r.name}: ${r.total} calls, ${r.daysAtFloor}/${weekKeys.length} days at floor, ${r.booked} meetings${r.weak ? `, focus: ${r.weak.label.toLowerCase()} ${fmt(r.weak.rate)}` : ''}`);
  const teamStages = base ? base.stages.filter((s) => s.status !== 'low_data' && s.key !== 'endtoend') : [];
  const manager = {
    subject: `Team scorecard: ${total} calls, ${totalBooked} meetings last week`,
    text: ['Last week by rep:', '', ...mgrLines, '', `Team: ${total} calls, ${totalBooked} meetings booked.`, '', `Team today: ${appUrl()}/team-day`, `Targets: ${appUrl()}/targets`].join('\n'),
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0B0B0F;max-width:640px;line-height:1.5"><p>Last week by rep:</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px"><tr style="background:#f4f5f7;text-align:left"><th style="padding:8px">Rep</th><th style="padding:8px">Calls</th><th style="padding:8px">Days at floor</th><th style="padding:8px">Meetings</th><th style="padding:8px">Focus</th></tr>
      ${rows.map((r) => `<tr><td style="padding:8px;border-bottom:1px solid #eee"><b>${esc(r.name)}</b></td><td style="padding:8px;border-bottom:1px solid #eee">${r.total}</td><td style="padding:8px;border-bottom:1px solid #eee">${r.daysAtFloor}/${weekKeys.length}</td><td style="padding:8px;border-bottom:1px solid #eee">${r.booked}</td><td style="padding:8px;border-bottom:1px solid #eee">${r.weak ? `${esc(r.weak.label)} ${fmt(r.weak.rate)}` : '–'}</td></tr>`).join('')}</table>
      <p><b>Team:</b> ${total} calls, ${totalBooked} meetings booked.</p>
      ${teamStages.length ? `<p style="color:#555">Last 90 days: ${teamStages.map((s) => `${esc(s.label.toLowerCase())} ${fmt(s.rate)}`).join(', ')}.</p>` : ''}
      <p><a href="${esc(appUrl())}/team-day" style="color:#4463FF;font-weight:600">Team today</a> · <a href="${esc(appUrl())}/targets" style="color:#4463FF;font-weight:600">Targets</a></p></div>`,
  };

  const teams = {
    title: `Last week: ${total} calls, ${totalBooked} meetings booked`,
    facts: rows.map((r) => [r.name, `${r.total} calls (${r.daysAtFloor}/${weekKeys.length} days at floor), ${r.booked} meeting${r.booked === 1 ? '' : 's'}`]),
  };
  return { repMails, manager, teams };
}

/** Mondays 08:00 to 11:59 London, once per week. Safe to call every few minutes. */
export async function runScorecardJob(sql, now = new Date()) {
  const clock = londonClock(now);
  if (clock.weekday !== 1 || clock.hour < 8 || clock.hour > 11) return 'not due';
  const config = await loadConfig(sql);
  if (!config.scorecard.enabled) return 'disabled';
  const key = `scorecard:${clock.dateKey}`;
  if (!(await claimFeedKey(sql, key))) return 'already sent';
  try {
    const today = clock.dateKey;
    const weekKeys = [-7, -6, -5, -4, -3].map((o) => noonKey(today, o));
    const reps = await sql`
      SELECT name, email, ghl_owner_id FROM app_users
      WHERE role = 'rep' AND active = TRUE AND ghl_owner_id IS NOT NULL AND ghl_owner_id <> '' ORDER BY name`;
    const tracked = reps.map((r) => ({ name: r.name || r.email, email: r.email, ownerId: r.ghl_owner_id }));
    if (!tracked.length) { await releaseFeedKey(sql, key).catch(() => {}); return 'no reps'; }

    const to = londonMidnight(today);
    const from30 = londonMidnight(today, -30);
    const [daily, longDaily, meetings, cur, prev, base] = await Promise.all([
      loadDailyDials(sql, weekKeys[0], weekKeys[4]), loadDailyDials(sql, noonKey(today, -125), weekKeys[4]),
      loadMonthMeetings(sql, weekKeys[0], weekKeys[4]), loadFunnelCounts(sql, from30, to), loadFunnelCounts(sql, londonMidnight(today, -60), from30),
      loadFunnelCounts(sql, londonMidnight(today, -90), to),
    ]);
    const funnels = new Map(tracked.map((r) => [r.ownerId, buildFunnel({ config, counts: cur.get(r.ownerId), prev: prev.get(r.ownerId) })]));
    const records = new Map(tracked.map((r) => [r.ownerId, buildRecords({ rows: longDaily.get(r.ownerId) || [], config, todayKey: weekKeys[4] })]));
    const meetingCounts = new Map(tracked.map((r) => [r.ownerId, (meetings.get(r.ownerId) || []).length]));
    const teamBase = buildFunnel({ config, counts: [...base.entries()].filter(([o]) => tracked.some((t) => t.ownerId === o)).reduce((t, [, c]) => { for (const k of Object.keys(c)) t[k] = (t[k] || 0) + c[k]; return t; }, {}) });
    const out = buildScorecards({ config, weekKeys, reps: tracked, daily, meetings: meetingCounts, funnels, records, base: teamBase });

    const results = [];
    const mailReady = !!(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN);
    const from = weeklyReportFrom();
    if (mailReady) {
      const managers = await getReportRecipients(sql);
      if (managers.length) {
        try { await sendViaMailgun({ from, to: managers.join(','), subject: out.manager.subject, text: out.manager.text, html: out.manager.html, transactional: true }); results.push(`managers ${managers.length}`); } catch (error) { results.push(`manager email failed: ${error.message}`); }
      }
      if (config.scorecard.emailReps) {
        for (const m of out.repMails) {
          if (!m.email) continue;
          try { await sendViaMailgun({ from, to: m.email, subject: m.subject, text: m.text, html: m.html, transactional: true }); results.push(`rep ${m.name}`); } catch (error) { results.push(`rep ${m.name} failed: ${error.message}`); }
        }
      }
    } else results.push('mail not configured');
    const posted = await feed(sql, buildCard({ title: out.teams.title, facts: out.teams.facts, url: `${appUrl()}/team-day`, urlLabel: 'Open Team today', tone: 'accent' }));
    results.push(posted ? 'teams posted' : 'teams skipped');
    return results.join(', ');
  } catch (error) {
    await releaseFeedKey(sql, key).catch(() => {});
    throw error;
  }
}
