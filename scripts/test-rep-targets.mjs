import test from 'node:test';
import assert from 'node:assert/strict';
import { londonDateTime, nextBusinessDayKey, londonWeekToDate } from '../api/business-time.js';
import { buildRepDay, normalizeConfig, gatekeeperCallbackInstant, hourFlexFactor, callOutcomeRules, buildFunnel, rateStatus, buildRecords, talkingPoints } from '../lib/rep-targets.js';

const config = normalizeConfig({});
const DATE = '2026-10-21'; // Wednesday, BST
const at = (h, m = 0) => londonDateTime(DATE, h, m);
const dial = (h, m, outcome = 'No answer', durationSec = null) => ({ at: at(h, m), outcome, durationSec });
const week = londonWeekToDate(DATE);

function run(calls, nowH, nowM = 0, extra = {}) {
  return buildRepDay({ config, now: at(nowH, nowM), dateKey: DATE, calls, weekdayKeys: week, ...extra });
}

test('config defaults match the plan and are clamped', () => {
  assert.equal(config.dials.floor, 150);
  assert.equal(config.talkMinutes.floor, 45);
  assert.equal(config.qualified.minSeconds, 180);
  const odd = normalizeConfig({ dials: { floor: -5, high: 1 }, blocks: [{ start: '10:00', end: '09:00' }], rules: { gatekeeperCallback: { time: 'nope' } } });
  assert.equal(odd.dials.floor, 1);
  assert.equal(odd.dials.high, 1);
  assert.equal(odd.blocks.length, 5); // invalid blocks fall back to the default schedule
  assert.equal(odd.rules.gatekeeperCallback.time, '15:30');
});

test('London time helpers handle weekends and BST', () => {
  assert.equal(nextBusinessDayKey('2026-10-23'), '2026-10-26'); // Fri -> Mon
  assert.equal(nextBusinessDayKey('2026-10-21'), '2026-10-22');
  assert.equal(londonDateTime('2026-07-01', 15, 30).toISOString(), '2026-07-01T14:30:00.000Z');
  assert.equal(londonDateTime('2026-01-15', 15, 30).toISOString(), '2026-01-15T15:30:00.000Z');
  assert.deepEqual(londonWeekToDate('2026-10-21'), ['2026-10-19', '2026-10-20', '2026-10-21']);
  const slot = gatekeeperCallbackInstant(config, at(14));
  assert.equal(slot.toISOString(), londonDateTime('2026-10-22', 15, 30).toISOString());
});

test('only answered calls count as talk time, capped per call', () => {
  const day = run([
    dial(9, 5, 'Answered - not interested', 400),
    dial(9, 10, 'No answer', 600),
    dial(9, 20, 'Answered - interested', 5000),
  ], 10);
  assert.equal(day.totals.dials, 3);
  assert.equal(day.totals.answered, 2);
  assert.equal(day.totals.talkMinutes, Math.round(((400 + 1200) / 60) * 10) / 10);
  assert.equal(day.totals.qualifiedCalls, 2);
  assert.equal(day.totals.interested, 1);
});

test('talk time lowers the dial floor via flex credit, capped', () => {
  const none = run([dial(9, 5)], 10);
  assert.equal(none.targets.dialsFloor, 150);
  const calls = [];
  for (let i = 0; i < 3; i += 1) calls.push(dial(9, 5 + i * 20, 'Answered - interested', 1200));
  const flexed = run(calls, 11);
  assert.equal(flexed.flexCredit, Math.round(Math.min(0.3 * 150, 60 * 0.8)));
  assert.equal(flexed.targets.dialsFloor, 150 - flexed.flexCredit);
  assert.equal(hourFlexFactor(20) < 0.5, true);
});

test('pace status: behind, on track, stalled, done/missed', () => {
  const behind = run([dial(9, 5), dial(9, 30), dial(9, 50), dial(10, 8)], 10, 15);
  assert.equal(behind.status, 'behind');

  const calls = [];
  for (let i = 0; i < 40; i += 1) calls.push(dial(9, 1 + Math.floor(i * 1.5)));
  for (let i = 0; i < 25; i += 1) calls.push(dial(10, 5 + Math.floor(i * 2)));
  const ok = run(calls, 10, 59);
  assert.ok(['on_track', 'ahead'].includes(ok.status), ok.status);

  const stalled = run([dial(9, 5), dial(9, 30)], 10, 0);
  assert.equal(stalled.status, 'stalled');
  assert.equal(stalled.activity.minutesSinceLast, 30);

  const noLunchStall = run([dial(11, 20)], 12, 45);
  assert.notEqual(noLunchStall.status, 'stalled');

  assert.equal(run([dial(9, 5)], 17).status, 'missed');
  assert.equal(run([], 8, 30).status, 'not_started');
});

test('idle time ignores admin and lunch blocks', () => {
  const day = run([dial(11, 25), dial(13, 35)], 13, 40);
  assert.equal(day.activity.idleGaps >= 1, true); // 09:00 -> 11:25 morning gap
  const clean = run([dial(11, 29), dial(13, 31)], 13, 32);
  // 11:29 -> 13:31 only overlaps working blocks for ~2 minutes
  assert.ok(clean.activity.longestGapMinutes >= 100); // the morning gap before first call
  assert.equal(clean.activity.idleGaps, 1);
});

test('hourly slump flags quiet working hours only', () => {
  const calls = [];
  for (let i = 0; i < 25; i += 1) calls.push(dial(9, 1 + i));
  calls.push(dial(10, 5));
  const day = run(calls, 12);
  const h9 = day.hourly.find((h) => h.hour === 9);
  const h10 = day.hourly.find((h) => h.hour === 10);
  const h12 = day.hourly.find((h) => h.hour === 12);
  assert.equal(h9.slump, false);
  assert.equal(h10.slump, true);
  assert.equal(h12.eligible, false); // 12:00-12:30 admin, 12:30-13:00 lunch
});

test('time off scales targets and disables blocks', () => {
  const half = run([], 14, 0, { timeOff: [{ dayPart: 'am' }] });
  assert.equal(half.targets.dialsFloor, 75);
  assert.equal(half.blocks.find((b) => b.key === 'morning').state, 'off');
  const off = run([], 14, 0, { timeOff: [{ dayPart: 'full' }] });
  assert.equal(off.status, 'off');
});

test('meetings scorecard compares the week so far with the daily target', () => {
  const meetingsWeek = [{ at: londonDateTime('2026-10-19', 14, 0) }, { at: at(11, 0) }];
  const day = run([dial(9, 5)], 12, 0, { meetingsWeek });
  const row = day.scorecard.find((m) => m.key === 'meetings');
  assert.equal(row.value, 2);
  assert.equal(row.floor, 2); // weekly floor
  assert.equal(row.high, 3); // weekly target
  assert.equal(row.met, true);
  assert.equal(day.totals.meetingsToday, 1);
});

test('call outcome rules: gatekeeper callback task and bad-data archiving', () => {
  const now = at(14);
  const gk = callOutcomeRules({ config, outcome: 'Gatekeeper', setStatus: 'to_call_back', callbackAt: null, now });
  assert.equal(gk.gatekeeperTask, true);
  assert.equal(gk.priority, 'hot');
  assert.equal(gk.callbackAt, londonDateTime('2026-10-22', 15, 30).toISOString());
  assert.equal(gk.archiveReason, null);

  const own = callOutcomeRules({ config, outcome: 'Gatekeeper', setStatus: 'to_call_back', callbackAt: '2026-10-30T10:00:00.000Z', now });
  assert.equal(own.callbackAt, '2026-10-30T10:00:00.000Z'); // a rep-chosen time is respected

  const wrong = callOutcomeRules({ config, outcome: 'Wrong number', setStatus: 'not_interested', now });
  assert.equal(wrong.archiveReason, 'bad_data');
  const dead = callOutcomeRules({ config, outcome: 'Gatekeeper', setStatus: 'not_interested', now });
  assert.equal(dead.archiveReason, 'gatekeeper_dead_end');
  const email = callOutcomeRules({ config, outcome: 'Gatekeeper', setStatus: 'wants_more_info', now });
  assert.equal(email.archiveReason, null);
  assert.equal(email.gatekeeperTask, false);
  const interested = callOutcomeRules({ config, outcome: 'Answered - not interested', setStatus: 'not_interested', now });
  assert.equal(interested.archiveReason, null);

  const off = normalizeConfig({ rules: { archiveWrongNumber: false, archiveGatekeeperDeadEnd: false, gatekeeperCallback: { enabled: false } } });
  assert.equal(callOutcomeRules({ config: off, outcome: 'Wrong number', setStatus: 'not_interested', now }).archiveReason, null);
  assert.equal(callOutcomeRules({ config: off, outcome: 'Gatekeeper', setStatus: 'to_call_back', now }).callbackAt, null);
});

test('funnel rates and benchmark verdicts', () => {
  const f = buildFunnel({ config, counts: { dials: 1997, answered: 273, interested: 12, booked: 10, attended: 3, noShow: 6 } });
  const by = Object.fromEntries(f.stages.map((s) => [s.key, s]));
  assert.equal(by.connection.status, 'on_par'); // 13.7% sits in 10-15%
  assert.equal(by.booking.status, 'smashing'); // 83% > 50%
  assert.equal(by.showup.status, 'concern'); // 33% is well under 70%
  assert.equal(f.bottleneck, 'showup');
  assert.ok(by.showup.message.length > 0);
  assert.equal(by.booking.message, config.funnel.stages.booking.praise);
});

test('funnel handles thin data, zero denominators and caps booking at 100%', () => {
  const none = buildFunnel({ config, counts: {} });
  assert.ok(none.stages.every((s) => s.status === 'low_data' && s.rate == null));
  assert.equal(none.summary.judged, 0);
  const capped = buildFunnel({ config, counts: { dials: 500, answered: 100, interested: 6, booked: 9 } });
  assert.equal(capped.stages.find((s) => s.key === 'booking').rate, 100);
  assert.equal(rateStatus(1.5, { min: 2, max: 5 }, 100, 30), 'below');
  assert.equal(rateStatus(1.1, { min: 2, max: 5 }, 100, 30), 'concern');
  assert.equal(rateStatus(1.5, { min: 2, max: 5 }, 10, 30), 'low_data');
});

test('funnel benchmarks and advice are admin-editable and clamped', () => {
  const edited = normalizeConfig({ funnel: { stages: { connection: { min: 20, max: 5, minSample: 0, advice: '  Call earlier  ' } }, fixes: ['One', '', 'Two'] }, coachNote: ' Focus on booking ' });
  assert.equal(edited.funnel.stages.connection.min, 20);
  assert.equal(edited.funnel.stages.connection.max, 20); // max never below min
  assert.equal(edited.funnel.stages.connection.minSample, 1);
  assert.equal(edited.funnel.stages.connection.advice, 'Call earlier');
  assert.equal(edited.funnel.stages.booking.min, 30); // untouched stages keep defaults
  assert.deepEqual(edited.funnel.fixes, ['One', 'Two']);
  assert.equal(edited.coachNote, 'Focus on booking');
  const f = buildFunnel({ config: edited, counts: { dials: 1000, answered: 130, interested: 5, booked: 2, attended: 1, noShow: 1 } });
  assert.equal(f.stages[0].status, 'below'); // 13% vs a 20% benchmark
});

test('meeting targets are weekly and stay ordered', () => {
  assert.deepEqual(config.meetings, { floorPerWeek: 2, targetPerWeek: 3, stretchPerWeek: 4 });
  const odd = normalizeConfig({ meetings: { floorPerWeek: 5, targetPerWeek: 1, stretchPerWeek: 2 } });
  assert.deepEqual(odd.meetings, { floorPerWeek: 5, targetPerWeek: 5, stretchPerWeek: 5 });
  // an old saved config with per-day keys falls back to the weekly defaults
  assert.equal(normalizeConfig({ meetings: { floorPerDay: 1, targetPerDay: 2 } }).meetings.floorPerWeek, 2);
});

test('funnel has a close rate stage and trend arrows against the previous period', () => {
  const cur = { dials: 2000, answered: 400, interested: 20, booked: 10, attended: 8, noShow: 2, won: 2 };
  const prev = { dials: 2000, answered: 300, interested: 20, booked: 12, attended: 10, noShow: 2, won: 3 };
  const f = buildFunnel({ config, counts: cur, prev });
  const by = Object.fromEntries(f.stages.map((s) => [s.key, s]));
  assert.equal(by.close.rate, 25);
  assert.equal(by.close.status, 'low_data'); // only 8 attended, below the min sample of 10
  assert.equal(by.connection.trend, 'up'); // 20% vs 15%
  assert.equal(by.connection.delta, 5);
  assert.equal(by.booking.trend, 'down'); // 50% vs 60%
  assert.equal(by.showup.prevRate, 83.333);
  assert.ok(config.funnel.stages.close.source.length > 0);
});

test('records: best day, streaks and week hits ignore an unfinished today', () => {
  // Wed 2026-10-21; floor 150
  const rows = [
    { date: '2026-10-14', dials: 160 }, { date: '2026-10-15', dials: 155 }, { date: '2026-10-16', dials: 100 },
    { date: '2026-10-19', dials: 151 }, { date: '2026-10-20', dials: 170 }, { date: '2026-10-21', dials: 40 },
  ];
  const r = buildRecords({ rows, config, todayKey: '2026-10-21' });
  assert.deepEqual(r.bestDay, { date: '2026-10-20', dials: 170 });
  assert.equal(r.currentStreak, 2); // Mon + Tue; Wed is not over yet
  assert.equal(r.bestStreak, 2);
  assert.equal(r.weekHits, 2);
  assert.equal(r.weekDaysSoFar, 3);
  assert.equal(r.avgRecent, Math.round((155 + 100 + 151 + 170 + 40) / 5));
  const missed = buildRecords({ rows: rows.map((x) => (x.date === '2026-10-20' ? { ...x, dials: 90 } : x)), config, todayKey: '2026-10-21' });
  assert.equal(missed.currentStreak, 0);
});

test('talking points flag the weakest stage with a coaching question', () => {
  const f = buildFunnel({ config, counts: { dials: 1800, answered: 380, interested: 7, booked: 1, attended: 2, noShow: 0, won: 0 } });
  const records = { avgRecent: 110, recentCount: 5, weekHits: 0, weekDaysSoFar: 3, bestDay: { dials: 143 }, currentStreak: 0 };
  const points = talkingPoints({ funnel: f, records, config });
  assert.ok(points.some((p) => /Volume: averaging 110 dials/.test(p.text) && p.tone === 'bad'));
  assert.ok(points.some((p) => /Booking rate: 14\.3%/.test(p.text) && /book a slot while the prospect is on the phone/.test(p.text)));
  assert.ok(points.length <= 6);
  const empty = talkingPoints({ funnel: buildFunnel({ config, counts: {} }), records: null, config });
  assert.ok(empty.some((p) => /not much data/.test(p.text)));
});

test('forecast model: chain and dials needed agree, and simulate is deterministic', async () => {
  await import('../forecast-model.js');
  const FM = globalThis.ForecastModel;
  const rates = { connection: 0.2, qualification: 0.04, booking: 0.4, showup: 0.6, close: 0.2 };
  const m = FM.chain({ reps: 2, dialsPerDay: 150, workDays: 21, rates });
  assert.equal(m.dials, 6300);
  assert.ok(Math.abs(m.won - 6300 * 0.2 * 0.04 * 0.4 * 0.6 * 0.2) < 1e-9);
  const needed = FM.dialsNeeded({ clientsPerMonth: m.won, reps: 2, workDays: 21, rates });
  assert.ok(Math.abs(needed - 150) < 1e-9);
  assert.equal(FM.dialsNeeded({ clientsPerMonth: 2, reps: 2, workDays: 21, rates: { ...rates, close: 0 } }), Infinity);
  const a = FM.simulate(2, true);
  assert.equal(a.length, 12);
  assert.deepEqual(a, FM.simulate(2, true));
  assert.ok(a[11].rev.gf + a[11].rev.gl + a[11].rev.dom > 0);
  assert.equal(FM.simulate(0, true)[11].rev.gf, 0);
});

test('Monday scorecard builds rep emails, a manager email and a Teams card', async () => {
  const { buildScorecards } = await import('../lib/rep-scorecard.js');
  const weekKeys = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
  const funnel = buildFunnel({ config, counts: { dials: 1800, answered: 380, interested: 7, booked: 1, attended: 2, noShow: 0, won: 0 } });
  const out = buildScorecards({
    config, weekKeys,
    reps: [{ name: 'Brendon Mwatsenekenyi', email: 'b@example.com', ownerId: 'o1' }],
    daily: new Map([['o1', [{ date: '2026-10-12', dials: 160 }, { date: '2026-10-13', dials: 100 }]]]),
    meetings: new Map([['o1', 1]]),
    funnels: new Map([['o1', funnel]]),
    records: new Map([['o1', { currentStreak: 0 }]]),
    base: funnel,
  });
  assert.equal(out.repMails.length, 1);
  const mail = out.repMails[0];
  assert.match(mail.subject, /260 calls, 1 meeting$/);
  assert.match(mail.text, /1 of 5 days at the 150 floor, best day 160 on Mon/);
  assert.match(mail.text, /below the floor/); // 1 meeting vs a weekly floor of 2
  assert.match(mail.text, /One thing to focus on: booking rate is 14\.3%/);
  assert.match(mail.text, /Morning Brendon,/);
  assert.match(out.manager.subject, /260 calls, 1 meetings/);
  assert.match(out.manager.html, /<b>Brendon Mwatsenekenyi<\/b>/);
  assert.deepEqual(out.teams.facts[0], ['Brendon Mwatsenekenyi', '260 calls (1/5 days at floor), 1 meeting']);
});

test('average gap between calls ignores lunch', () => {
  // 11:20 -> 11:50 = 30 min, 11:50 -> 13:40 = 110 min minus the 60 min lunch = 50 min
  const day = run([dial(11, 20), dial(11, 50), dial(13, 40)], 14, 0);
  assert.equal(day.activity.avgGapMinutes, 40);
  const one = run([dial(9, 10)], 9, 30);
  assert.equal(one.activity.avgGapMinutes, null);
  const steady = run([dial(9, 0), dial(9, 2), dial(9, 5), dial(9, 6)], 9, 10);
  assert.equal(steady.activity.avgGapMinutes, 2);
});

test('lunch and admin time never read as a stall right after the break', () => {
  // Last call 11:25, back from lunch at 13:35: only 10 working minutes have passed since then.
  const day = run([dial(11, 25)], 13, 35);
  assert.notEqual(day.status, 'stalled');
  assert.equal(run([dial(11, 25)], 14, 0).status, 'stalled'); // 5 + 30 working minutes
});

test('off-phone time (internal meetings) is excluded from stalls, gaps and hourly minimums', () => {
  const meeting = { start: at(10, 0), end: at(11, 0), label: 'Team meeting' };
  const during = run([dial(9, 55)], 10, 30, { offPhone: [meeting] });
  assert.equal(during.status, 'off_phone');
  assert.match(during.headline, /Off the phones until 11:00: Team meeting/);
  assert.equal(during.offPhone[0].now, true);

  // 09:55 call; 5 working min before the meeting + 10 after = 15 (<20): fine. 25 minutes later: 5 + 25 = 30: stalled.
  assert.notEqual(run([dial(9, 55)], 11, 10, { offPhone: [meeting] }).status, 'stalled');
  assert.equal(run([dial(9, 55)], 11, 25, { offPhone: [meeting] }).status, 'stalled');
  // without the meeting the same rep would already be stalled at 10:30
  assert.equal(run([dial(9, 55)], 10, 30).status, 'stalled');

  const day = run([dial(9, 2), dial(9, 17), dial(9, 33), dial(9, 50), dial(9, 58), dial(11, 5)], 11, 15, { offPhone: [meeting] });
  assert.equal(day.activity.idleGaps, 0); // 09:58 -> 11:05 is a 67 minute gap, but only 7 of it was working time
  assert.equal(day.activity.avgGapMinutes, 12.6); // (15 + 16 + 17 + 8 + 7) / 5
  const h10 = day.hourly.find((h) => h.hour === 10);
  assert.equal(h10.eligible, false);
  assert.equal(h10.slump, false);
  assert.equal(h10.offPhoneMinutes, 60);
});

test('off-phone time lowers the day floor, block targets and expected pace', () => {
  const morning = { start: at(9, 0), end: at(11, 30), label: 'Training' };
  const day = run([], 14, 0, { offPhone: [morning] });
  // morning block (90 of 155 planned dial target) is gone, so the floor scales to the afternoon share
  assert.equal(day.targets.dialsFloor, Math.round(150 * (65 / 155)));
  assert.equal(day.blocks.find((b) => b.key === 'morning').target, 0);
  assert.equal(day.blocks.find((b) => b.key === 'morning').offPhoneMinutes, 150);
  assert.equal(day.pace.expectedDials, Math.round(day.targets.dialsFloor * 0.25)); // 30 of 120 afternoon minutes
  assert.match(day.scorecard[0].note, /adjusted for 150 min off the phones/);

  const part = run([], 10, 0, { offPhone: [{ start: at(9, 0), end: at(9, 30), label: 'Stand-up' }] });
  assert.equal(part.targets.dialsFloor, Math.round(150 * ((90 * (120 / 150) + 65) / 155)));
});
