import { getSql, initQueueTable, initTimeOffTable } from './db.js';
import { verifyOwnerToken } from '../lib/landingOwnerToken.js';

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const SLOT_MINUTES = 30;
const WORK_START = 9;
const WORK_END = 17;

function value(body, key, max = 500) {
  const raw = body?.[key];
  return raw == null ? '' : String(raw).trim().slice(0, max);
}
function overlap(start, end, busyStart, busyEnd) { return start < busyEnd && end > busyStart; }
function validSlot(date) {
  const hour = date.getHours();
  return date.getMinutes() % SLOT_MINUTES === 0 && hour >= WORK_START && hour < WORK_END;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const body = req.body || {};
  const owner = verifyOwnerToken(body.token);
  if (!owner) return res.status(401).json({ success: false, error: 'Valid owner token required' });

  const firstName = value(body, 'first_name', 120);
  const lastName = value(body, 'last_name', 120);
  const email = value(body, 'email', 240).toLowerCase();
  const company = value(body, 'company', 240);
  const slot = new Date(value(body, 'slot'));
  if (!firstName || !email || !company || !EMAIL_RE.test(email)) return res.status(400).json({ success: false, error: 'Name, work email and firm name are required' });
  if (Number.isNaN(slot.getTime()) || !validSlot(slot) || slot <= new Date()) return res.status(400).json({ success: false, error: 'Choose a valid future 30-minute slot' });

  const slotEnd = new Date(slot.getTime() + SLOT_MINUTES * 60000);
  try {
    const sql = getSql();
    await initQueueTable();
    await initTimeOffTable();
    await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS meeting_booked_at TIMESTAMPTZ`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS opportunity_meetings_owner_slot_idx ON opportunity_meetings (primary_owner_id, scheduled_for) WHERE status = 'scheduled'`;
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`${owner.ownerId}:${slot.toISOString()}`}))`;

    const busy = await sql`
      SELECT scheduled_for AS start, scheduled_for + interval '30 minutes' AS "end"
      FROM opportunity_meetings
      WHERE primary_owner_id = ${owner.ownerId}
        AND status = 'scheduled'
        AND scheduled_for < ${slotEnd.toISOString()}::timestamptz
        AND scheduled_for + interval '30 minutes' > ${slot.toISOString()}::timestamptz
      UNION ALL
      SELECT starts_at AS start, ends_at AS "end"
      FROM manual_activity_blocks
      WHERE owner_id = ${owner.ownerId}
        AND starts_at < ${slotEnd.toISOString()}::timestamptz
        AND ends_at > ${slot.toISOString()}::timestamptz
    `;
    if (busy.some((row) => overlap(slot, slotEnd, new Date(row.start), new Date(row.end)))) {
      return res.status(409).json({ success: false, error: 'That slot has just been taken. Please choose another.' });
    }

    const name = [firstName, lastName].filter(Boolean).join(' ');
    const leadRows = await sql`
      INSERT INTO queue_leads (first_name, last_name, name, email, company_name, priority, status, source, owner, owner_id, call_notes, meeting_booked_at, raw, last_touch_at)
      VALUES (${firstName}, ${lastName || null}, ${name}, ${email}, ${company}, 'warm', 'qualified', 'landing-page', ${owner.ownerName}, ${owner.ownerId}, 'Booked via financial advisers landing page', ${slot.toISOString()}::timestamptz, ${JSON.stringify(body)}, now())
      ON CONFLICT (email) DO UPDATE SET
        first_name = COALESCE(EXCLUDED.first_name, queue_leads.first_name),
        last_name = COALESCE(EXCLUDED.last_name, queue_leads.last_name),
        name = COALESCE(EXCLUDED.name, queue_leads.name),
        company_name = COALESCE(EXCLUDED.company_name, queue_leads.company_name),
        owner = EXCLUDED.owner,
        owner_id = EXCLUDED.owner_id,
        status = 'qualified',
        meeting_booked_at = EXCLUDED.meeting_booked_at,
        last_touch_at = now(),
        updated_at = now()
      RETURNING id
    `;
    const leadId = leadRows[0]?.id;
    const sequenceRows = await sql`SELECT COALESCE(MAX(sequence_no), 0)::int + 1 AS sequence_no FROM opportunity_meetings WHERE lead_id = ${leadId}`;
    const meetingRows = await sql`
      INSERT INTO opportunity_meetings (lead_id, sequence_no, meeting_type, status, scheduled_for, booking_channel, primary_owner_id, primary_owner_name, notes, calendar_provider, meta)
      VALUES (${leadId}, ${sequenceRows[0].sequence_no}, 'discovery', 'scheduled', ${slot.toISOString()}::timestamptz, 'landing-page', ${owner.ownerId}, ${owner.ownerName}, 'Booked from owner-specific financial advisers landing page', 'internal-calendar', ${JSON.stringify({ ownerLocked: true, page: 'financial-advisers' })})
      RETURNING id, scheduled_for
    `;
    return res.status(200).json({ success: true, owner: owner.ownerName, meetingId: meetingRows[0].id, scheduledFor: meetingRows[0].scheduled_for, message: `Booked with ${owner.ownerName}` });
  } catch (error) {
    if (error?.code === '23505') return res.status(409).json({ success: false, error: 'That slot has just been taken. Please choose another.' });
    return res.status(500).json({ success: false, error: 'Could not book that slot' });
  }
}
