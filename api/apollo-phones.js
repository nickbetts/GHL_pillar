/**
 * Apollo direct-dial webhook receiver.
 * Apollo POSTs here when an async phone reveal completes.
 * Patches the matching queue lead with the revealed number.
 */

import { getSql } from './db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }

  const person = body?.person || body;
  const apolloId = person?.id;
  const phone =
    person?.sanitized_phone ||
    person?.phone_numbers?.find?.((n) => n.type === 'work_direct')?.raw_number ||
    person?.phone_numbers?.[0]?.raw_number ||
    person?.organization?.phone ||
    null;

  if (!apolloId || !phone) return res.status(200).json({ ok: true, skipped: true });

  try {
    const sql = getSql();
    const rows = await sql`
      UPDATE queue_leads
      SET direct_phone = ${phone}, updated_at = now()
      WHERE apollo_id = ${String(apolloId)}
        AND (direct_phone IS NULL OR length(direct_phone) < length(${phone}))
      RETURNING id
    `;
    console.log(`[apollo-phones] ${apolloId} → ${phone} (updated ${rows.length})`);
    return res.status(200).json({ ok: true, apolloId, phone, updated: rows.length });
  } catch (err) {
    console.error('[apollo-phones] db error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
