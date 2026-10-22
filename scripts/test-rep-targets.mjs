import test from 'node:test';
import assert from 'node:assert/strict';
import { londonDateTime, nextBusinessDayKey, londonWeekToDate } from '../api/business-time.js';
import { buildRepDay, normalizeConfig, gatekeeperCallbackInstant, hourFlexFactor, callOutcomeRules, buildFunnel, rateStatus } from '../lib/rep-targets.js';

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
  assert.equal(row.floor, 2); // ceil(0.5 * 3 days)
  assert.equal(row.high, 3);
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
