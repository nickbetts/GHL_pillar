/**
 * 3CX contact lookup (server-side CRM integration).
 *
 * 3CX calls this to resolve a caller/callee number (or email) to a queue lead,
 * for caller-ID name display and screen-pop. Returns a flat contact record.
 *
 * Security: shared secret via `x-3cx-secret` header or `?secret=`. Reuses
 * THREECX_WEBHOOK_SECRET. Fails closed.
 *
 * GET/POST params: number (or phone), email.
 * Screen-pop URL to configure in 3CX:
 *   Prefix: https://ghl-pillar.vercel.app/outbound?lead=
 *   Suffix: (empty)   — 3CX appends the returned ContactID.
 */

import { getSql } from './db.js';
import { findLeadByPhone } from './apollo-sales-queue.js';

function contactFrom(lead) {
  return {
    found: true,
    ContactID: String(lead.id),
    FirstName: lead.first_name || '',
    LastName: lead.last_name || '',
    Name: lead.name || [lead.first_name, lead.last_name].filter(Boolean).join(' '),
    CompanyName: lead.company_name || '',
    Email: lead.email || '',
    PhoneBusiness: lead.phone || '',
    Url: `https://ghl-pillar.vercel.app/outbound?lead=${lead.id}`,
  };
}

export default async function handler(req, res) {
  const expected = process.env.THREECX_WEBHOOK_SECRET;
  if (!expected) return res.status(503).json({ found: false, error: 'Lookup not configured' });
  const provided = req.headers?.['x-3cx-secret'] || req.query?.secret || req.body?.secret;
  if (provided !== expected) return res.status(401).json({ found: false, error: 'Unauthorized' });

  const number = req.query?.number || req.query?.phone || req.body?.number || req.body?.phone || null;
  const email = req.query?.email || req.body?.email || null;

  try {
    const sql = getSql();
    let lead = null;
    if (number) lead = await findLeadByPhone(sql, number);
    if (!lead && email) {
      const rows = await sql`SELECT * FROM queue_leads WHERE lower(email) = lower(${email}) ORDER BY updated_at DESC LIMIT 1`;
      lead = rows[0] || null;
    }
    if (!lead) return res.status(200).json({ found: false });
    return res.status(200).json(contactFrom(lead));
  } catch (error) {
    return res.status(500).json({ found: false, error: error.message });
  }
}
