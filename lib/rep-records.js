/**
 * Rep activity records over a date range: per rep, a daily summary (calls, first/last call, talk time, time off the phones
 * by type) and the detailed off-phone log. Pure, so it can be tested without a database.
 */

import { londonClock, londonDateKey, londonDateTime } from '../api/business-time.js';

export const KIND_LABELS = {
  admin: 'Admin', client_meeting: 'Client meeting', internal_meeting: 'Internal meeting', lunch: 'Lunch', admin_logged: 'Logged by management',
};

const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));

/** Mon–Fri London date keys from fromKey to toKey inclusive. */
export function workdayKeys(fromKey, toKey) {
  const keys = [];
  const start = londonDateTime(fromKey, 12, 0).getTime();
  for (let i = 0; i < 400; i += 1) {
    const noon = new Date(start + i * 86400000);
    const key = londonDateKey(noon);
    if (key > toKey) break;
    const dow = londonClock(noon).weekday;
    if (dow !== 0 && dow !== 6) keys.push(key);
  }
  return keys;
}

/**
 * @param {object} p
 * @param {Array}  p.reps          [{ ownerId, name }]
 * @param {Array}  p.statusRows    rep_status_log rows
 * @param {Array}  p.adminRows     rep_off_phone rows (owner_id null = whole team)
 * @param {Map}    p.daily         owner -> Map(date -> { dials, answered, talkSec, firstAt, lastAt })
 * @param {number} p.plannedLunch  planned lunch minutes
 */
export function buildRepRecords({ reps, fromKey, toKey, statusRows, adminRows, daily, plannedLunch = 0, now = new Date() }) {
  const weekdays = workdayKeys(fromKey, toKey);
  return reps.map((rep) => {
    const self = statusRows.filter((r) => r.owner_id === rep.ownerId).map((r) => ({
      id: r.id, date: londonDateKey(r.started_at), kind: r.kind, label: KIND_LABELS[r.kind] || r.kind, reason: r.reason || '',
      start: r.started_at, end: r.ended_at || null, ongoing: !r.ended_at, minutes: minutesBetween(r.started_at, r.ended_at || now),
      endedBy: r.ended_by || null, loggedBy: r.logged_by || null, source: 'self',
    }));
    const managed = adminRows.filter((o) => !o.owner_id || o.owner_id === rep.ownerId).map((o) => ({
      id: o.id, date: londonDateKey(o.starts_at), kind: 'admin_logged', label: KIND_LABELS.admin_logged, reason: o.label,
      start: o.starts_at, end: o.ends_at, ongoing: false, minutes: minutesBetween(o.starts_at, o.ends_at), endedBy: null, loggedBy: null, source: 'management',
    }));
    const entries = [...self, ...managed].sort((a, b) => new Date(b.start) - new Date(a.start));

    const dayData = daily.get(rep.ownerId) || new Map();
    const dates = new Set([...weekdays, ...dayData.keys(), ...entries.map((e) => e.date)]);
    const days = [...dates].filter((d) => d >= fromKey && d <= toKey).sort().reverse().map((date) => {
      const d = dayData.get(date);
      const off = { admin: 0, client_meeting: 0, internal_meeting: 0, lunch: 0, management: 0 };
      for (const e of entries) {
        if (e.date !== date) continue;
        if (e.source === 'management') off.management += e.minutes; else off[e.kind] = (off[e.kind] || 0) + e.minutes;
      }
      return {
        date, calls: d?.dials || 0, answered: d?.answered || 0, talkMinutes: d ? Math.round(d.talkSec / 60) : 0,
        firstCallAt: d?.firstAt || null, lastCallAt: d?.lastAt || null, off,
        lunchOverMinutes: plannedLunch && off.lunch > plannedLunch ? off.lunch - plannedLunch : 0,
      };
    });

    const totals = days.reduce((t, d) => {
      t.calls += d.calls; t.answered += d.answered; t.talkMinutes += d.talkMinutes;
      for (const k of Object.keys(d.off)) t.off[k] = (t.off[k] || 0) + d.off[k];
      t.lunchOverMinutes += d.lunchOverMinutes;
      if (d.lunchOverMinutes) t.lunchOverDays += 1;
      if (d.calls) t.activeDays += 1;
      return t;
    }, { calls: 0, answered: 0, talkMinutes: 0, off: { admin: 0, client_meeting: 0, internal_meeting: 0, lunch: 0, management: 0 }, lunchOverMinutes: 0, lunchOverDays: 0, activeDays: 0 });
    totals.offTotal = Object.values(totals.off).reduce((a, b) => a + b, 0);
    return { ownerId: rep.ownerId, name: rep.name, entries, days, totals };
  });
}
