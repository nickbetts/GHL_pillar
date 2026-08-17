/**
 * Inbound website-form lead intake.
 *
 * Your website form (or its provider) POSTs a submission here; we create a
 * queue lead with source='inbound' at status to_contact, round-robin assigned,
 * so it shows on the Inbound page ready to work.
 *
 * Security: requires a shared secret via `x-inbound-secret` header or
 * `?secret=`. Set INBOUND_WEBHOOK_SECRET in the environment. Fails closed.
 *
 * Accepts flexible field names:
 *   name | first_name/last_name, email, phone | tel, company | organisation,
 *   message | notes, source (e.g. "website", "chat")
 */

import { getSql } from './db.js';

const ROUND_ROBIN = [
  { name: 'Brendon Mwatsenekenyi', id: '6FX5X4kH2JFJc6u9zhSC' },
  { name: 'Zain Safir-Sheikh', id: 'XbyxbOK1Q1raRCjjGx4O' },
  { name: 'Amir Ward', id: 's7OG2BM94q7uNRsHLqM7' },
];

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

async function ensureLeadColumns(sql) {
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS sector TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS sub_sector TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'outbound'`;
}

async function findExistingOwner(sql, email) {
  if (!email) return null;
  const rows = await sql`
    SELECT owner_id, owner
    FROM queue_leads
    WHERE lower(email) = ${String(email).toLowerCase()}
      AND owner_id IS NOT NULL
    ORDER BY
      CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END,
      updated_at DESC NULLS LAST,
      created_at DESC NULLS LAST
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || !ROUND_ROBIN.some((rep) => rep.id === row.owner_id)) return null;
  return { id: row.owner_id, name: row.owner || ROUND_ROBIN.find((rep) => rep.id === row.owner_id)?.name || null };
}

async function pickLeastLoadedOwner(sql) {
  const rows = await sql`
    SELECT owner_id, COUNT(*)::int AS c FROM queue_leads
    WHERE owner_id IS NOT NULL
      AND archived_at IS NULL
      AND status NOT IN ('qualified', 'not_interested')
    GROUP BY owner_id
  `;
  const counts = Object.fromEntries(rows.map((r) => [r.owner_id, r.c]));
  let best = ROUND_ROBIN[0];
  let bestCount = Infinity;
  for (const rep of ROUND_ROBIN) {
    const c = counts[rep.id] || 0;
    if (c < bestCount) { bestCount = c; best = rep; }
  }
  return best;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const expected = process.env.INBOUND_WEBHOOK_SECRET;
  if (!expected) {
    return res.status(503).json({ success: false, error: 'Inbound webhook not configured' });
  }
  const provided = req.headers?.['x-inbound-secret'] || req.query?.secret;
  if (provided !== expected) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const body = req.body || {};

    // Basic honeypot: if a hidden field is filled, treat as spam and no-op.
    if (pick(body, ['_gotcha', 'honeypot'])) {
      return res.status(200).json({ success: true, ignored: 'spam' });
    }

    const first = pick(body, ['first_name', 'firstName']);
    const last = pick(body, ['last_name', 'lastName']);
    const fullName = pick(body, ['name', 'full_name', 'fullName']) || [first, last].filter(Boolean).join(' ') || null;
    const email = pick(body, ['email', 'Email']);
    const phone = pick(body, ['phone', 'tel', 'telephone', 'Phone', 'mobile']);
    const company = pick(body, ['company', 'organisation', 'organization', 'business']);
    const message = pick(body, ['message', 'notes', 'enquiry', 'inquiry', 'comments']);
    const source = pick(body, ['source', 'form', 'origin']) || 'website';

    if (!email && !phone) {
      return res.status(400).json({ success: false, error: 'email or phone required' });
    }

    const sql = getSql();
    await ensureLeadColumns(sql);
    const existingOwner = await findExistingOwner(sql, email);
    const owner = existingOwner || await pickLeastLoadedOwner(sql);

    const rows = await sql`
      INSERT INTO queue_leads (
        first_name, last_name, name, email, phone, company_name,
        priority, status, source, owner, owner_id, call_notes, raw, last_touch_at
      ) VALUES (
        ${first}, ${last}, ${fullName}, ${email}, ${phone}, ${company},
        'warm', 'to_contact', 'inbound', ${owner.name}, ${owner.id},
        ${message ? `Inbound (${source}): ${message}` : `Inbound lead from ${source}`},
        ${JSON.stringify(body)}, now()
      )
      ON CONFLICT (email) DO UPDATE SET
        phone = COALESCE(EXCLUDED.phone, queue_leads.phone),
        company_name = COALESCE(EXCLUDED.company_name, queue_leads.company_name),
        source = 'inbound',
        last_touch_at = now(),
        updated_at = now()
      RETURNING id
    `;
    const leadId = rows[0]?.id || null;

    if (leadId) {
      await sql`
        INSERT INTO queue_events (lead_id, event_type, to_status, owner_id, owner_name, meta)
        VALUES (${leadId}, 'ingest', 'to_contact', ${owner.id}, ${owner.name}, ${JSON.stringify({ source, channel: 'inbound' })})
      `;
    }

    return res.status(200).json({ success: true, leadId, owner: owner.name });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
