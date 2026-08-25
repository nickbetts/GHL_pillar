import { getSql } from './db.js';
import { validOwner } from '../lib/landingOwnerToken.js';

const OWNERS = [
  { name: 'Brendon Mwatsenekenyi', id: '6FX5X4kH2JFJc6u9zhSC' },
  { name: 'Zain Safir-Sheikh', id: 'XbyxbOK1Q1raRCjjGx4O' },
  { name: 'Amir Ward', id: 's7OG2BM94q7uNRsHLqM7' },
];

function value(body, key, max = 500) {
  const raw = body?.[key];
  if (raw === undefined || raw === null) return null;
  return String(raw).trim().slice(0, max) || null;
}

async function pickOwner(sql) {
  const rows = await sql`
    SELECT owner_id, COUNT(*)::int AS count
    FROM queue_leads
    WHERE owner_id IS NOT NULL
      AND archived_at IS NULL
      AND status NOT IN ('qualified', 'not_interested')
    GROUP BY owner_id
  `;
  const counts = Object.fromEntries(rows.map((row) => [row.owner_id, row.count]));
  return OWNERS.reduce((best, owner) => (
    (counts[owner.id] || 0) < (counts[best.id] || 0) ? owner : best
  ), OWNERS[0]);
}

export async function findExistingOwner(sql, email) {
  if (!email) return null;
  const rows = await sql`
    SELECT owner_id, owner
    FROM queue_leads
    WHERE lower(email) = ${email.toLowerCase()}
      AND owner_id IS NOT NULL
    ORDER BY
      CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END,
      updated_at DESC NULLS LAST,
      created_at DESC NULLS LAST
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || !validOwner(row.owner_id)) return null;
  return row;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const body = req.body || {};
    if (value(body, 'website')) return res.status(200).json({ success: true });

    const submittedName = value(body, 'name', 240);
    const firstName = value(body, 'first_name', 120) || submittedName?.split(/\s+/)[0] || null;
    const lastName = value(body, 'last_name', 120) || submittedName?.split(/\s+/).slice(1).join(' ') || null;
    const email = value(body, 'email', 240)?.toLowerCase();
    const phone = value(body, 'phone', 80);
    const company = value(body, 'company', 240);
    const message = value(body, 'message', 2000);
    const submittedSource = value(body, 'source', 160);
    const source = submittedSource === 'I3 Growth LP' ? submittedSource : 'inbound';
    const campaign = value(body, 'campaign', 160);
    const medium = value(body, 'medium', 160);

    if (!firstName) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
    }

    const sql = getSql();
    await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'outbound'`;
    const existingOwner = await findExistingOwner(sql, email);
    const owner = existingOwner?.owner_id && validOwner(existingOwner.owner_id)
      ? { id: existingOwner.owner_id, name: existingOwner.owner || null }
      : await pickOwner(sql);
    const name = `${firstName} ${lastName}`.trim();
    const raw = JSON.stringify({ ...body, source, campaign, medium });
    const pageLabel = source.replace(/^click-pages\//, '').split(':')[0] || 'landing-page';
    const isGrowthLanding = /(?:\/|^)growth(?:\.html)?(?:[?#]|$)/i.test(String(body.referral_page || ''));
    const noteSource = isGrowthLanding ? 'I3 Growth LP' : pageLabel;
    const notes = [
      noteSource,
      `Name: ${name}`,
      `Work email: ${email || 'Not provided'}`,
      `Phone: ${phone || 'Not provided'}`,
      `Company: ${company || 'Not provided'}`,
      `Help requested: ${message || 'Not provided'}`,
    ].join('\n');

    const rows = await sql`
      INSERT INTO queue_leads (
        first_name, last_name, name, email, phone, company_name,
        priority, status, source, owner, owner_id, call_notes, raw, last_touch_at
      ) VALUES (
        ${firstName}, ${lastName}, ${name}, ${email}, ${phone}, ${company},
        'warm', 'to_contact', ${source}, ${owner.name}, ${owner.id}, ${notes}, ${raw}, now()
      )
      ON CONFLICT (email) DO UPDATE SET
        first_name = COALESCE(EXCLUDED.first_name, queue_leads.first_name),
        last_name = COALESCE(EXCLUDED.last_name, queue_leads.last_name),
        name = COALESCE(EXCLUDED.name, queue_leads.name),
        phone = COALESCE(EXCLUDED.phone, queue_leads.phone),
        company_name = COALESCE(EXCLUDED.company_name, queue_leads.company_name),
        source = ${source},
        owner = EXCLUDED.owner,
        owner_id = EXCLUDED.owner_id,
        call_notes = EXCLUDED.call_notes,
        raw = EXCLUDED.raw,
        last_touch_at = now(),
        updated_at = now()
      RETURNING id
    `;

    if (isGrowthLanding && email) {
      await sql`
        UPDATE email_campaign_enrollments e
        SET status = 'stopped',
            stopped_at = now(),
            stopped_reason = 'growth_form_submission',
            next_step_due = NULL,
            updated_at = now()
        FROM email_campaigns c, queue_leads l
        WHERE e.campaign_id = c.id
          AND c.campaign_type = 'growth'
          AND lower(l.email) = ${email}
          AND e.status = 'active'
      `;
    }

    return res.status(200).json({ success: true, leadId: rows[0]?.id || null });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Unable to submit the audit request' });
  }
}
