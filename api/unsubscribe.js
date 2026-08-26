import crypto from 'crypto';
import { getSql, initAuthTables, initQueueTable, upsertEmailSuppression } from './db.js';

function makeSignature(email) {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.QUEUE_PASSWORD || '';
  return crypto.createHmac('sha256', secret).update(String(email).trim().toLowerCase()).digest('hex');
}

function timingSafeHexEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const isPost = req.method === 'POST';
  const email = String(req.query?.email || req.body?.email || '').trim().toLowerCase();
  const sig = String(req.query?.sig || req.body?.sig || '').trim();

  if (!email || !sig || !timingSafeHexEqual(makeSignature(email), sig)) {
    return isPost
      ? res.status(400).json({ success: false, error: 'Invalid link' })
      : res.status(400).send('<!doctype html><p style="font-family:sans-serif;padding:2rem">Invalid unsubscribe link.</p>');
  }

  try {
    const sql = getSql();
    await initAuthTables();
    await initQueueTable();

    await upsertEmailSuppression(sql, {
      email,
      reason: 'Unsubscribed via link',
      provider: 'link',
      providerEvent: 'unsubscribed',
    });

    await sql`
      UPDATE email_campaign_enrollments e
      SET status = 'stopped',
          stopped_at = now(),
          stopped_reason = 'unsubscribed',
          next_step_due = NULL,
          last_event_at = now(),
          last_event_type = 'unsubscribed',
          updated_at = now()
      FROM queue_leads l
      WHERE e.lead_id = l.id
        AND lower(l.email) = ${email}
        AND e.status = 'active'
    `;

    if (isPost) return res.status(200).json({ success: true });
    return res.redirect(302, '/unsubscribed');
  } catch (error) {
    return isPost
      ? res.status(500).json({ success: false, error: 'Server error' })
      : res.status(500).send('<!doctype html><p style="font-family:sans-serif;padding:2rem">Something went wrong. Reply to the email to opt out.</p>');
  }
}
