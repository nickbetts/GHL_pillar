import crypto from 'crypto';
import { getSql, initAuthTables, initQueueTable, markWebhookProcessed, upsertEmailSuppression } from './db.js';

function requestBytes(req) {
  const declared = Number.parseInt(req.headers?.['content-length'] || '0', 10);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
}

function timingSafeEqualStr(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyMailgunSignature(body) {
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (!signingKey) {
    return { ok: false, status: 503, error: 'Mailgun webhook is not configured' };
  }

  const signature = body?.signature || {};
  const timestamp = String(signature.timestamp || '').trim();
  const token = String(signature.token || '').trim();
  const provided = String(signature.signature || '').trim();
  if (!timestamp || !token || !provided) {
    return { ok: false, status: 400, error: 'Invalid webhook signature payload' };
  }

  const expected = crypto.createHmac('sha256', signingKey).update(`${timestamp}${token}`).digest('hex');
  if (!timingSafeEqualStr(provided, expected)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  return { ok: true };
}

function normalizeEvent(body) {
  const event = String(body?.['event-data']?.event || body?.event || '').toLowerCase();
  const recipient = String(body?.['event-data']?.recipient || body?.recipient || '').trim().toLowerCase();
  const messageId = String(body?.['event-data']?.id || body?.messageId || body?.['event-data']?.['message-id'] || '').trim();
  const reason = String(body?.['event-data']?.['delivery-status']?.message || body?.reason || '').trim();
  const severity = String(body?.['event-data']?.severity || '').trim().toLowerCase();
  return { event, recipient, messageId, reason, severity };
}

async function updateSendLog(sql, { messageId, recipient, status, reason, raw }) {
  const rows = messageId
    ? await sql`
        UPDATE email_send_logs
        SET status = ${status}, error = ${reason || null}, provider_response = ${raw ? JSON.stringify(raw) : null}, updated_at = now()
        WHERE provider = 'mailgun' AND provider_message_id = ${messageId}
        RETURNING id
      `
    : await sql`
        UPDATE email_send_logs
        SET status = ${status}, error = ${reason || null}, provider_response = ${raw ? JSON.stringify(raw) : null}, updated_at = now()
        WHERE provider = 'mailgun' AND lower(recipient_email) = ${recipient}
          AND status IN ('pending', 'sent')
        RETURNING id
      `;
  return rows.length;
}

async function updateCampaignState(sql, { messageId, recipient, event, raw, stopReason }) {
  const rows = messageId
    ? await sql`
        SELECT s.id AS send_id, s.enrollment_id
        FROM email_campaign_sends s
        WHERE s.provider_message_id = ${messageId}
        LIMIT 1
      `
    : await sql`
        SELECT s.id AS send_id, s.enrollment_id
        FROM email_campaign_sends s
        JOIN email_campaign_enrollments e ON e.id = s.enrollment_id
        JOIN queue_leads l ON l.id = e.lead_id
        WHERE lower(l.email) = ${recipient}
        ORDER BY s.created_at DESC
        LIMIT 1
      `;
  if (!rows[0]) return;
  const send = rows[0];
  await sql`
    INSERT INTO email_campaign_events (enrollment_id, send_id, event_type, provider_data)
    VALUES (${send.enrollment_id}, ${send.send_id}, ${event}, ${JSON.stringify(raw || {})})
  `;
  await sql`
    UPDATE email_campaign_sends
    SET status = ${event}, last_event_at = now(), last_event_type = ${event}
    WHERE id = ${send.send_id}
  `;
  await sql`
    UPDATE email_campaign_enrollments
    SET last_event_at = now(), last_event_type = ${event},
        status = CASE WHEN ${stopReason || null}::text IS NOT NULL THEN 'stopped' ELSE status END,
        stopped_at = CASE WHEN ${stopReason || null}::text IS NOT NULL THEN now() ELSE stopped_at END,
        stopped_reason = CASE WHEN ${stopReason || null}::text IS NOT NULL THEN ${stopReason || null} ELSE stopped_reason END,
        next_step_due = CASE WHEN ${stopReason || null}::text IS NOT NULL THEN NULL ELSE next_step_due END,
        updated_at = now()
    WHERE id = ${send.enrollment_id}
  `;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (requestBytes(req) > 128 * 1024) {
    return res.status(413).json({ success: false, error: 'Request body too large' });
  }

  const signatureCheck = verifyMailgunSignature(req.body || {});
  if (!signatureCheck.ok) {
    return res.status(signatureCheck.status).json({ success: false, error: signatureCheck.error });
  }

  let sql;
  try {
    sql = getSql();
    await initAuthTables();
    await initQueueTable();
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  const body = req.body || {};
  const deliveryId = body?.['event-data']?.id || body?.messageId || body?.signature?.token || null;
  if (deliveryId) {
    const fresh = await markWebhookProcessed(sql, 'mailgun', String(deliveryId));
    if (!fresh) {
      return res.status(200).json({ success: true, status: 'duplicate', deliveryId });
    }
  }

  const { event, recipient, messageId, reason, severity } = normalizeEvent(body);
  if (!event) {
    return res.status(400).json({ success: false, error: 'Missing Mailgun event type' });
  }

  try {
    let status = null;
    let suppress = false;
    let suppressionReason = null;

    if (event === 'delivered') status = 'delivered';
    else if (event === 'accepted' || event === 'stored') status = 'sent';
    else if (event === 'opened') status = 'opened';
    else if (event === 'clicked') status = 'clicked';
    else if (event === 'failed' || event === 'rejected') {
      status = 'failed';
      if (/permanent|hard|invalid|unknown|no such user/i.test(reason) || severity === 'permanent') {
        suppress = true;
        suppressionReason = reason || 'Permanent delivery failure';
      }
    } else if (event === 'bounced') {
      status = 'bounced';
      suppress = true;
      suppressionReason = reason || 'Bounced';
    } else if (event === 'complained' || event === 'unsubscribed') {
      status = 'complained';
      suppress = true;
      suppressionReason = reason || 'Complaint or unsubscribe';
    } else {
      status = 'processed';
    }

    await updateSendLog(sql, { messageId, recipient, status, reason, raw: body });
    await updateCampaignState(sql, {
      messageId,
      recipient,
      event,
      raw: body,
      stopReason: suppress ? event : null,
    });

    if (suppress && recipient) {
      await upsertEmailSuppression(sql, {
        email: recipient,
        reason: suppressionReason,
        providerEvent: event,
        providerData: body,
      });
    }

    return res.status(200).json({ success: true, event, status, recipient, suppressed: suppress });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}