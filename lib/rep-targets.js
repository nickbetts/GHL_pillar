/**
 * Rep daily targets + block schedule: config defaults and the pure
 * calculation that turns a rep's calls into progress against the plan.
 * No DB access here so it can be unit-tested (see scripts/test-rep-targets.mjs).
 */

import { londonClock, londonDateKey, londonDateTime, londonMidnight, nextBusinessDayKey } from '../api/business-time.js';

export const CONFIG_KEY = 'rep_targets';
export const WORKDAY_HOURS = 8;
const DAY_END_MIN = 17 * 60;

export const DEFAULT_CONFIG = {
  enabled: true,
  dials: { floor: 150, high: 190 },
  talkMinutes: { floor: 45, high: 75 },
  qualified: { floor: 2, high: 4, minSeconds: 180 },
  meetings: { floorPerDay: 0.5, targetPerDay: 1 },
  // A long conversation absorbs dial capacity: each talk minute credits this many dials, capped as a % of the floor.
  flex: { dialsPerTalkMinute: 0.8, maxCreditPct: 30 },
  maxTalkSecondsPerCall: 1200,
  alerts: { minDialsPerHour: 15, stallMinutes: 20, lateStartMinutes: 15 },
  blocks: [
    { key: 'morning', label: 'Morning Blitz', start: '09:00', end: '11:30', type: 'dial', dialTarget: 90, note: 'Peak dials' },
    { key: 'admin', label: 'Admin & Email Catch-up', start: '11:30', end: '12:30', type: 'admin', dialTarget: 0, note: 'Info emails & CRM logging' },
    { key: 'lunch', label: 'Lunch Break', start: '12:30', end: '13:30', type: 'break', dialTarget: 0, note: 'Full disconnect' },
    { key: 'afternoon', label: 'Afternoon Blitz', start: '13:30', end: '15:30', type: 'dial', dialTarget: 65, note: 'Keep the energy up' },
    { key: 'callbacks', label: 'Warm Callbacks', start: '15:30', end: '16:30', type: 'callbacks', dialTarget: 0, note: 'Gatekeepers & interested leads' },
  ],
  rules: {
    archiveWrongNumber: true,
    archiveGatekeeperDeadEnd: true,
    gatekeeperCallback: { enabled: true, time: '15:30' },
  },
};

const BLOCK_TYPES = new Set(['dial', 'admin', 'break', 'callbacks']);

export function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function num(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeBlocks(raw) {
  if (!Array.isArray(raw)) return DEFAULT_CONFIG.blocks.map((b) => ({ ...b }));
  const blocks = [];
  raw.slice(0, 12).forEach((block, index) => {
    const start = timeToMinutes(block?.start);
    const end = timeToMinutes(block?.end);
    if (start == null || end == null || end <= start) return;
    const type = BLOCK_TYPES.has(block?.type) ? block.type : 'dial';
    blocks.push({
      key: String(block?.key || `block${index + 1}`).replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || `block${index + 1}`,
      label: String(block?.label || 'Block').slice(0, 40),
      start: block.start,
      end: block.end,
      type,
      dialTarget: type === 'dial' ? Math.round(num(block?.dialTarget, 0, 0, 500)) : 0,
      note: String(block?.note || '').slice(0, 80),
    });
  });
  blocks.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  return blocks.length ? blocks : DEFAULT_CONFIG.blocks.map((b) => ({ ...b }));
}

/** Merge a stored/posted config over the defaults, clamping every value. */
export function normalizeConfig(raw) {
  const d = DEFAULT_CONFIG;
  const r = raw && typeof raw === 'object' ? raw : {};
  const dialsFloor = Math.round(num(r.dials?.floor, d.dials.floor, 1, 1000));
  const talkFloor = Math.round(num(r.talkMinutes?.floor, d.talkMinutes.floor, 0, 480));
  const qualifiedFloor = Math.round(num(r.qualified?.floor, d.qualified.floor, 0, 100));
  const gkTime = timeToMinutes(r.rules?.gatekeeperCallback?.time) != null ? r.rules.gatekeeperCallback.time : d.rules.gatekeeperCallback.time;
  return {
    enabled: bool(r.enabled, d.enabled),
    dials: { floor: dialsFloor, high: Math.round(num(r.dials?.high, d.dials.high, dialsFloor, 2000)) },
    talkMinutes: { floor: talkFloor, high: Math.round(num(r.talkMinutes?.high, d.talkMinutes.high, talkFloor, 960)) },
    qualified: {
      floor: qualifiedFloor,
      high: Math.round(num(r.qualified?.high, d.qualified.high, qualifiedFloor, 200)),
      minSeconds: Math.round(num(r.qualified?.minSeconds, d.qualified.minSeconds, 30, 3600)),
    },
    meetings: {
      floorPerDay: num(r.meetings?.floorPerDay, d.meetings.floorPerDay, 0, 20),
      targetPerDay: num(r.meetings?.targetPerDay, d.meetings.targetPerDay, 0, 20),
    },
    flex: {
      dialsPerTalkMinute: num(r.flex?.dialsPerTalkMinute, d.flex.dialsPerTalkMinute, 0, 5),
      maxCreditPct: Math.round(num(r.flex?.maxCreditPct, d.flex.maxCreditPct, 0, 80)),
    },
    maxTalkSecondsPerCall: Math.round(num(r.maxTalkSecondsPerCall, d.maxTalkSecondsPerCall, 60, 7200)),
    alerts: {
      minDialsPerHour: Math.round(num(r.alerts?.minDialsPerHour, d.alerts.minDialsPerHour, 0, 200)),
      stallMinutes: Math.round(num(r.alerts?.stallMinutes, d.alerts.stallMinutes, 5, 120)),
      lateStartMinutes: Math.round(num(r.alerts?.lateStartMinutes, d.alerts.lateStartMinutes, 0, 120)),
    },
    blocks: normalizeBlocks(r.blocks),
    rules: {
      archiveWrongNumber: bool(r.rules?.archiveWrongNumber, d.rules.archiveWrongNumber),
      archiveGatekeeperDeadEnd: bool(r.rules?.archiveGatekeeperDeadEnd, d.rules.archiveGatekeeperDeadEnd),
      gatekeeperCallback: { enabled: bool(r.rules?.gatekeeperCallback?.enabled, d.rules.gatekeeperCallback.enabled), time: gkTime },
    },
  };
}

export async function loadConfig(sql) {
  await sql`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  const rows = await sql`SELECT value FROM app_config WHERE key = ${CONFIG_KEY} LIMIT 1`;
  if (!rows[0]?.value) return normalizeConfig({});
  try { return normalizeConfig(JSON.parse(rows[0].value)); } catch { return normalizeConfig({}); }
}

export async function saveConfig(sql, config) {
  const clean = normalizeConfig(config);
  await sql`
    INSERT INTO app_config (key, value, updated_at) VALUES (${CONFIG_KEY}, ${JSON.stringify(clean)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return clean;
}

// ── Call classification ──────────────────────────────────────────────────────

export function isAnswered(outcome) {
  return /^answered/i.test(String(outcome || ''));
}

export function isInterested(outcome) {
  return outcome === 'Answered - interested' || outcome === 'Answered - wants info';
}

/** Talk seconds for one call: only answered calls count, capped to a sane maximum. */
export function talkSeconds(call, config) {
  if (!isAnswered(call?.outcome)) return 0;
  const d = Number(call?.durationSec);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.min(d, config.maxTalkSecondsPerCall);
}

export function isQualifiedCall(call, config) {
  return talkSeconds(call, config) >= config.qualified.minSeconds;
}

/** Fraction (0.4–1) of a normal hour's dial target left after talk time in that hour. */
export function hourFlexFactor(talkMinutesInHour) {
  return Math.max(0.4, 1 - talkMinutesInHour / 30);
}

// ── Availability (time off) ──────────────────────────────────────────────────

export function availabilityFor(timeOff = []) {
  let off = 0;
  let amOff = false;
  let pmOff = false;
  for (const entry of timeOff) {
    if (entry.dayPart === 'full') off += WORKDAY_HOURS;
    else if (entry.dayPart === 'am') { off += 4; amOff = true; }
    else if (entry.dayPart === 'pm') { off += 4; pmOff = true; }
    else off += Number(entry.hoursOff) || 0;
  }
  off = Math.min(WORKDAY_HOURS, off);
  return { hoursOff: off, factor: (WORKDAY_HOURS - off) / WORKDAY_HOURS, amOff, pmOff, isOff: off >= WORKDAY_HOURS };
}

// ── The per-rep day ──────────────────────────────────────────────────────────

function overlap(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * @param {object} p
 * @param {object} p.config      normalized config
 * @param {Date}   p.now
 * @param {string} p.dateKey     London date being reported (YYYY-MM-DD)
 * @param {Array}  p.calls       [{ at, outcome, durationSec }] for that date
 * @param {Array}  p.meetingsWeek  [{ at }] meetings booked Mon..dateKey
 * @param {Array}  p.weekdayKeys  Mon..dateKey London date keys
 * @param {Array}  p.timeOff     [{ dayPart, hoursOff }]
 */
export function buildRepDay({ config, now = new Date(), dateKey, calls = [], meetingsWeek = [], weekdayKeys = [], timeOff = [] }) {
  const midnight = londonMidnight(dateKey).getTime();
  const isToday = londonDateKey(now) === dateKey;
  const nowMin = isToday ? (now.getTime() - midnight) / 60000 : DAY_END_MIN + 60;
  const avail = availabilityFor(timeOff);
  const factor = avail.factor;

  const blocks = config.blocks.map((b) => {
    const start = timeToMinutes(b.start);
    const end = timeToMinutes(b.end);
    const offBlock = avail.isOff || (avail.amOff && end <= 750) || (avail.pmOff && start >= 750);
    return { ...b, startMin: start, endMin: end, offBlock };
  });
  const workBlocks = blocks.filter((b) => (b.type === 'dial' || b.type === 'callbacks') && !b.offBlock);

  const rows = calls
    .map((c) => ({ ...c, min: (new Date(c.at).getTime() - midnight) / 60000, talk: talkSeconds(c, config) }))
    .filter((c) => Number.isFinite(c.min))
    .sort((a, b) => a.min - b.min);

  const totals = { dials: rows.length, answered: 0, talkMinutes: 0, qualifiedCalls: 0, interested: 0, noAnswer: 0, voicemail: 0, gatekeeper: 0, wrongNumber: 0, notInterested: 0, withDuration: 0 };
  let talkSec = 0;
  for (const c of rows) {
    const outcome = String(c.outcome || '');
    if (isAnswered(outcome)) totals.answered += 1;
    if (isInterested(outcome)) totals.interested += 1;
    if (isQualifiedCall(c, config)) totals.qualifiedCalls += 1;
    if (/^no answer/i.test(outcome)) totals.noAnswer += 1;
    if (/voicemail/i.test(outcome)) totals.voicemail += 1;
    if (outcome === 'Gatekeeper') totals.gatekeeper += 1;
    if (outcome === 'Wrong number') totals.wrongNumber += 1;
    if (/not interested/i.test(outcome)) totals.notInterested += 1;
    if (Number(c.durationSec) > 0) totals.withDuration += 1;
    talkSec += c.talk;
  }
  totals.talkMinutes = Math.round((talkSec / 60) * 10) / 10;

  const dialsFloorBase = Math.round(config.dials.floor * factor);
  const flexCredit = Math.round(Math.min(
    (config.flex.maxCreditPct / 100) * dialsFloorBase,
    totals.talkMinutes * config.flex.dialsPerTalkMinute,
  ));
  const dialsFloor = Math.max(0, dialsFloorBase - flexCredit);
  const dialsHigh = Math.round(config.dials.high * factor);

  // Block progress
  const blockRows = blocks.map((b) => {
    const inBlock = rows.filter((c) => c.min >= b.startMin && c.min < b.endMin);
    const talk = inBlock.reduce((sum, c) => sum + c.talk, 0) / 60;
    const target = b.type === 'dial' && !b.offBlock ? Math.round(b.dialTarget * factor) : null;
    const state = b.offBlock ? 'off' : nowMin >= b.endMin ? 'done' : nowMin >= b.startMin ? 'live' : 'upcoming';
    return {
      key: b.key, label: b.label, type: b.type, start: b.start, end: b.end, note: b.note,
      state, dials: inBlock.length, target, talkMinutes: Math.round(talk * 10) / 10,
      pct: target ? Math.min(100, Math.round((inBlock.length / target) * 100)) : null,
    };
  });
  const liveBlock = blockRows.find((b) => b.state === 'live') || null;
  const nextBlock = blockRows.find((b) => b.state === 'upcoming') || null;

  // Hourly dials (09:00 → last hour with activity or the end of the working blocks)
  const lastBlockEnd = Math.max(...blocks.map((b) => b.endMin), 16 * 60);
  const lastHour = Math.max(Math.ceil(lastBlockEnd / 60) - 1, ...rows.map((c) => Math.floor(c.min / 60)));
  const firstHour = Math.min(9, ...rows.map((c) => Math.floor(c.min / 60)));
  const hourly = [];
  for (let h = firstHour; h <= lastHour; h += 1) {
    const hs = h * 60;
    const he = hs + 60;
    const inHour = rows.filter((c) => c.min >= hs && c.min < he);
    const talk = inHour.reduce((sum, c) => sum + c.talk, 0) / 60;
    const coverage = workBlocks.reduce((sum, b) => sum + overlap(hs, he, b.startMin, b.endMin), 0) / 60;
    const eligible = coverage >= 0.5;
    const threshold = eligible ? Math.round(config.alerts.minDialsPerHour * coverage * hourFlexFactor(talk) * factor) : 0;
    const complete = nowMin >= he;
    hourly.push({
      hour: h, label: `${String(h).padStart(2, '0')}:00`, dials: inHour.length, talkMinutes: Math.round(talk * 10) / 10,
      eligible, threshold, slump: eligible && complete && inHour.length < threshold && !avail.isOff,
      current: nowMin >= hs && nowMin < he,
    });
  }

  // Idle time inside working blocks (gaps between calls, plus the gap to "now")
  const stall = config.alerts.stallMinutes;
  let idleMinutes = 0;
  let idleGaps = 0;
  let longestGap = 0;
  const firstWorkStart = workBlocks.length ? Math.min(...workBlocks.map((b) => b.startMin)) : null;
  const points = [];
  if (firstWorkStart != null && nowMin > firstWorkStart) points.push(firstWorkStart);
  rows.forEach((c) => points.push(c.min));
  if (isToday && nowMin < DAY_END_MIN) points.push(Math.min(nowMin, lastBlockEnd));
  for (let i = 1; i < points.length; i += 1) {
    const gap = workBlocks.reduce((sum, b) => sum + overlap(points[i - 1], points[i], b.startMin, b.endMin), 0);
    longestGap = Math.max(longestGap, gap);
    if (gap >= stall) { idleGaps += 1; idleMinutes += gap; }
  }

  const first = rows[0] || null;
  const last = rows[rows.length - 1] || null;
  const minutesSinceLast = isToday && last ? Math.max(0, Math.round(nowMin - last.min)) : null;
  const lateStartMinutes = first && firstWorkStart != null ? Math.max(0, Math.round(first.min - firstWorkStart)) : 0;

  // Pace against the floor for how far through the dial blocks we are
  const dialBlocks = blocks.filter((b) => b.type === 'dial' && !b.offBlock && b.dialTarget > 0);
  const totalDialTarget = dialBlocks.reduce((sum, b) => sum + b.dialTarget, 0);
  const elapsed = dialBlocks.reduce((sum, b) => sum + b.dialTarget * Math.min(1, Math.max(0, (nowMin - b.startMin) / (b.endMin - b.startMin))), 0);
  const fraction = totalDialTarget ? elapsed / totalDialTarget : 0;
  const expectedDials = Math.round(dialsFloor * fraction);
  const dayOver = nowMin >= lastBlockEnd;
  const inWork = workBlocks.some((b) => nowMin >= b.startMin && nowMin < b.endMin);
  const sinceActivity = last ? nowMin - last.min : nowMin - (firstWorkStart ?? nowMin);

  let status;
  let headline;
  if (!config.enabled) { status = 'off'; headline = 'Targets are switched off'; }
  else if (avail.isOff) { status = 'off'; headline = 'Off today'; }
  else if (isToday && firstWorkStart != null && nowMin < firstWorkStart) { status = 'not_started'; headline = `Day starts at ${blocks.find((b) => b.startMin === firstWorkStart)?.start || '09:00'}`; }
  else if (dayOver) {
    status = totals.dials >= dialsFloor ? 'done' : 'missed';
    headline = totals.dials >= dialsFloor ? 'Floor hit — nice work' : `Finished ${dialsFloor - totals.dials} short of the floor`;
  } else if (isToday && inWork && sinceActivity >= stall) {
    status = 'stalled';
    headline = last ? `No calls for ${Math.round(sinceActivity)} min` : `No calls yet — ${Math.round(sinceActivity)} min into the block`;
  } else if (totals.dials >= expectedDials * 1.1 && totals.dials > 0) { status = 'ahead'; headline = `${totals.dials - expectedDials} ahead of pace`; }
  else if (totals.dials >= expectedDials * 0.85) { status = 'on_track'; headline = 'Tracking to the floor'; }
  else { status = 'behind'; headline = `${expectedDials - totals.dials} behind pace`; }

  // Meetings: this week vs expected through today
  const daysThroughToday = Math.max(1, weekdayKeys.length);
  const meetingsToday = meetingsWeek.filter((m) => londonDateKey(m.at) === dateKey).length;
  const meetingsWtd = meetingsWeek.length;

  const scorecard = [
    { key: 'dials', label: 'Dials', unit: '', value: totals.dials, floor: dialsFloor, high: dialsHigh, note: flexCredit ? `−${flexCredit} flex credit for talk time` : '' },
    { key: 'talk', label: 'Talk time', unit: 'min', value: Math.round(totals.talkMinutes), floor: Math.round(config.talkMinutes.floor * factor), high: Math.round(config.talkMinutes.high * factor), note: totals.dials && !totals.withDuration ? 'No call timings yet' : '' },
    { key: 'qualified', label: `Calls over ${Math.round(config.qualified.minSeconds / 60 * 10) / 10} min`, unit: '', value: totals.qualifiedCalls, floor: Math.round(config.qualified.floor * factor), high: Math.round(config.qualified.high * factor), note: '' },
    { key: 'meetings', label: 'Meetings this week', unit: '', value: meetingsWtd, floor: Math.ceil(config.meetings.floorPerDay * daysThroughToday - 1e-9), high: Math.ceil(config.meetings.targetPerDay * daysThroughToday - 1e-9), note: `${meetingsToday} today` },
  ].map((m) => ({ ...m, met: m.value >= m.floor, metHigh: m.value >= m.high && m.high > 0 }));

  return {
    date: dateKey,
    availability: { hoursOff: avail.hoursOff, factor, isOff: avail.isOff },
    status, headline,
    totals: { ...totals, meetingsToday, meetingsWeek: meetingsWtd },
    flexCredit,
    targets: { dialsFloor, dialsHigh },
    pace: { expectedDials, fraction: Math.round(fraction * 1000) / 1000, delta: totals.dials - expectedDials },
    scorecard, blocks: blockRows, hourly,
    currentBlock: liveBlock ? { key: liveBlock.key, label: liveBlock.label, type: liveBlock.type, end: liveBlock.end, dials: liveBlock.dials, target: liveBlock.target } : null,
    nextBlock: nextBlock ? { key: nextBlock.key, label: nextBlock.label, start: nextBlock.start } : null,
    activity: {
      firstCallAt: first ? new Date(midnight + first.min * 60000).toISOString() : null,
      lastCallAt: last ? new Date(midnight + last.min * 60000).toISOString() : null,
      minutesSinceLast, lateStartMinutes, longestGapMinutes: Math.round(longestGap), idleGaps, idleMinutes: Math.round(idleMinutes),
    },
  };
}

/** Default gatekeeper callback instant: HH:MM London on the next business day. */
export function gatekeeperCallbackInstant(config, now = new Date()) {
  const minutes = timeToMinutes(config.rules.gatekeeperCallback.time) ?? 15 * 60 + 30;
  const key = nextBusinessDayKey(londonClock(now).dateKey);
  return londonDateTime(key, Math.floor(minutes / 60), minutes % 60);
}

/**
 * Automation rules applied when a call outcome is logged.
 * Returns the callback time/priority for gatekeeper callbacks and the archive reason for bad data.
 */
export function callOutcomeRules({ config, outcome, setStatus, callbackAt, now = new Date() }) {
  const gatekeeperTask = config.rules.gatekeeperCallback.enabled && outcome === 'Gatekeeper' && setStatus === 'to_call_back';
  const archiveReason = config.rules.archiveWrongNumber && outcome === 'Wrong number'
    ? 'bad_data'
    : (config.rules.archiveGatekeeperDeadEnd && outcome === 'Gatekeeper' && setStatus === 'not_interested' ? 'gatekeeper_dead_end' : null);
  return {
    gatekeeperTask,
    callbackAt: callbackAt || (gatekeeperTask ? gatekeeperCallbackInstant(config, now)?.toISOString() : null) || null,
    priority: gatekeeperTask ? 'hot' : null,
    archiveReason,
  };
}
