import { getSql, initQueueTable, initTimeOffTable } from './db.js';
import { londonDateKey, londonMidnight } from './business-time.js';
import { verifyOwnerToken } from '../lib/landingOwnerToken.js';

const SLOT_MINUTES = 30;
const BUFFER_MINUTES = 15;
const WORK_START = 9;
const WORK_END = 17;

function overlap(start, end, busyStart, busyEnd) { return start < busyEnd && end > busyStart; }
function parseDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }

function slotsForDay(dateKey, busy) {
  const dayStart = londonMidnight(dateKey);
  const slots = [];
  for (let minutes = WORK_START * 60; minutes + SLOT_MINUTES <= WORK_END * 60; minutes += SLOT_MINUTES) {
    const start = new Date(dayStart.getTime() + minutes * 60000);
    const end = new Date(start.getTime() + SLOT_MINUTES * 60000);
    if (start <= new Date()) continue;
    if (!busy.some((block) => overlap(start, end, block.start, block.end))) slots.push(start.toISOString());
  }
  return slots;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const owner = verifyOwnerToken(req.query?.t);
  if (!owner) return res.status(401).json({ success: false, error: 'Valid owner token required' });
  const from = parseDate(req.query?.from) || new Date();
  const days = Math.min(21, Math.max(1, Number(req.query?.days) || 14));
  try {
    const sql = getSql();
    await initQueueTable();
    await initTimeOffTable();
    const end = new Date(from.getTime() + days * 86400000);
    const [meetings, blocks, timeOff] = await Promise.all([
      sql`SELECT scheduled_for AS start, scheduled_for + interval '30 minutes' AS "end" FROM opportunity_meetings WHERE primary_owner_id = ${owner.ownerId} AND status = 'scheduled' AND scheduled_for >= ${from.toISOString()}::timestamptz AND scheduled_for < ${end.toISOString()}::timestamptz`,
      sql`SELECT starts_at AS start, ends_at AS "end" FROM manual_activity_blocks WHERE owner_id = ${owner.ownerId} AND starts_at < ${end.toISOString()}::timestamptz AND ends_at > ${from.toISOString()}::timestamptz`,
      sql`SELECT start_date, end_date, day_part FROM rep_time_off WHERE owner_id = ${owner.ownerId} AND canceled_at IS NULL AND end_date >= ${londonDateKey(from)} AND start_date <= ${londonDateKey(end)}`,
    ]);
    const availability = [];
    for (let i = 0; i < days; i += 1) {
      const key = londonDateKey(new Date(from.getTime() + i * 86400000));
      const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      const leave = timeOff.some((row) => String(row.start_date) <= key && String(row.end_date) >= key && String(row.day_part).toLowerCase() === 'full');
      if (leave) continue;
      const busy = [...meetings, ...blocks].map((row) => ({
        start: new Date(new Date(row.start).getTime() - BUFFER_MINUTES * 60000),
        end: new Date(new Date(row.end).getTime() + BUFFER_MINUTES * 60000),
      }));
      availability.push({ date: key, slots: slotsForDay(key, busy) });
    }
    return res.status(200).json({ success: true, owner: { id: owner.ownerId, name: owner.ownerName }, slotMinutes: SLOT_MINUTES, availability });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Could not load availability' });
  }
}
