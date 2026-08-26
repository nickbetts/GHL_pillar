import crypto from 'crypto';
import { getSql, initAuthTables, initQueueTable, isEmailSuppressed, writeAudit } from './db.js';

const MAX_PER_RUN = 25;
const BUSINESS_START = 9;
const BUSINESS_END = 17;

function safeText(value) { return String(value ?? '').trim(); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeText(value)); }
function timingSafeEqual(a, b) { const left = Buffer.from(String(a || '')); const right = Buffer.from(String(b || '')); return left.length === right.length && crypto.timingSafeEqual(left, right); }
function resolveTemplate(text, values) { return safeText(text).replace(/\{\{([A-Z_]+)\}\}/g, (_match, key) => values[key] == null ? '' : String(values[key])); }
function unresolved(text) { return [...new Set([...String(text).matchAll(/\{\{([A-Z_]+)\}\}/g)].map((match) => match[1]))]; }
function htmlEscape(value) { return String(value || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }
function signature(sender) { return safeText(sender.sender_signature).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim() || ['Best,', sender.name || sender.email, sender.sender_title || '', sender.email || sender.sender_email].filter(Boolean).join('\n'); }
function signatureHtml(sender) { const value = safeText(sender.sender_signature); return /<[^>]+>/.test(value) ? value : htmlEscape(signature(sender)).replace(/\n/g, '<br>'); }
function bookingUrl(lead) { const url = new URL('https://click.i3media.net/growth'); if (lead.first_name) url.searchParams.set('firstName', lead.first_name); if (lead.company_name) url.searchParams.set('companyName', lead.company_name); return url.toString(); }
function messageHtml(body, sig, sigHtml) { const withoutSignature = body.endsWith(sig) ? body.slice(0, -sig.length).trimEnd() : body; const linked = htmlEscape(withoutSignature).replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>'); return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827">${linked.replace(/\n/g, '<br>')}<br><div style="margin-top:14px">${sigHtml}</div></div>`; }
async function sendMailgun({ from, to, subject, text, html, replyTo }) { const key = process.env.MAILGUN_API_KEY; const domain = process.env.MAILGUN_DOMAIN; if (!key || !domain) throw new Error('Mailgun is not configured'); const payload = new URLSearchParams({ from, to, subject, text, html, 'h:Reply-To': replyTo }); const response = await fetch(`${(process.env.MAILGUN_BASE_URL || 'https://api.mailgun.net').replace(/\/$/, '')}/v3/${domain}/messages`, { method:'POST', headers:{ Authorization:`Basic ${Buffer.from(`api:${key}`).toString('base64')}`, 'Content-Type':'application/x-www-form-urlencoded' }, body:payload.toString() }); const data = (response.headers.get('content-type') || '').includes('application/json') ? await response.json().catch(() => ({})) : { message: await response.text() }; if (!response.ok) throw new Error(data.message || `Mailgun request failed (${response.status})`); return data; }
function nextBusinessTime(now, hour, minute = 0, timezone = 'Europe/London') {
  const targetHour = Math.max(BUSINESS_START, Math.min(BUSINESS_END - 1, Number(hour) || BUSINESS_START));
  const targetMinute = Math.max(0, Math.min(59, Number(minute) || 0));
  const candidate = new Date(now);
  candidate.setUTCMinutes(0, 0, 0);
  for (let index = 0; index < 96; index += 1) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(candidate);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (!['Sat', 'Sun'].includes(values.weekday) && Number(values.hour) === targetHour && Number(values.minute) === targetMinute && candidate > now) return candidate;
    candidate.setUTCHours(candidate.getUTCHours() + 1);
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ success:false, error:'Method not allowed' });
  const auth = req.headers.authorization;
  if (!process.env.CRON_SECRET || !timingSafeEqual(auth, `Bearer ${process.env.CRON_SECRET}`)) return res.status(401).json({ success:false, error:'Unauthorized' });
  try {
    const sql = getSql(); await initQueueTable(); await initAuthTables();
    const due = await sql`
      SELECT e.id AS enrollment_id, e.current_step, e.next_step_due, e.lead_id, c.id AS campaign_id, c.status AS campaign_status,
             s.id AS step_id, s.step_order, s.step_name, s.subject_template, s.body_template, s.wait_days, s.send_hour, s.send_minute,
             l.first_name, l.name AS lead_name, l.company_name, l.email, l.owner_id, l.status AS lead_status, l.archived_at,
             u.id AS sender_user_id, u.email AS sender_account_email, u.name AS sender_name, u.sender_email, u.sender_title, u.sender_signature
      FROM email_campaign_enrollments e
      JOIN email_campaigns c ON c.id = e.campaign_id AND c.status = 'active'
      JOIN email_campaign_steps s ON s.campaign_id = c.id AND s.step_order = e.current_step + 1 AND s.active = TRUE
      JOIN queue_leads l ON l.id = e.lead_id
      LEFT JOIN app_users u ON u.ghl_owner_id = l.owner_id AND u.active = TRUE
      WHERE e.status = 'active' AND e.next_step_due <= now() AND l.archived_at IS NULL
        AND l.status NOT IN ('qualified', 'not_interested', 'converted')
      ORDER BY e.next_step_due ASC LIMIT ${MAX_PER_RUN}
    `;
    const results = [];
    for (const item of due) {
      const scheduled = nextBusinessTime(new Date(Date.now() - 60 * 60 * 1000), item.send_hour, item.send_minute, item.send_timezone);
      if (item.current_step === 0 && scheduled.getTime() > Date.now() + 60 * 1000) {
        await sql`UPDATE email_campaign_enrollments SET next_step_due = ${scheduled.toISOString()}::timestamptz, updated_at = now() WHERE id = ${item.enrollment_id} AND status = 'active'`;
        results.push({ enrollmentId: item.enrollment_id, status: 'scheduled', nextStepDue: scheduled.toISOString() });
        continue;
      }
      const claimed = await sql`UPDATE email_campaign_enrollments SET updated_at = now(), next_step_due = now() + interval '5 minutes' WHERE id = ${item.enrollment_id} AND status = 'active' AND next_step_due <= now() RETURNING id`;
      if (!claimed.length) continue;
      if (!validEmail(item.email) || await isEmailSuppressed(sql, item.email)) { await sql`UPDATE email_campaign_enrollments SET status = 'stopped', stopped_at = now(), stopped_reason = 'suppressed_or_invalid', updated_at = now() WHERE id = ${item.enrollment_id}`; results.push({ enrollmentId:item.enrollment_id, status:'stopped' }); continue; }
      const senderEmail = safeText(item.sender_account_email || item.sender_email).toLowerCase();
      if (!validEmail(senderEmail)) { await sql`UPDATE email_campaign_enrollments SET status = 'stopped', stopped_at = now(), stopped_reason = 'sender_not_configured', next_step_due = NULL, updated_at = now() WHERE id = ${item.enrollment_id}`; results.push({ enrollmentId:item.enrollment_id, status:'stopped', error:'Sender is not configured' }); continue; }
      const sender = { email:item.sender_account_email, name:item.sender_name, sender_email:item.sender_email, sender_title:item.sender_title, sender_signature:item.sender_signature };
      const values = { FIRST_NAME:item.first_name || safeText(item.lead_name).split(/\s+/)[0], COMPANY_NAME:item.company_name || '', SENDER_NAME:item.sender_name || senderEmail, SENDER_TITLE:item.sender_title || '', SENDER_EMAIL:senderEmail, BOOKING_URL:bookingUrl(item), SIGNATURE:signature(sender), SIGNATURE_HTML:signatureHtml(sender) };
      const subject = resolveTemplate(item.subject_template, values); const textBody = resolveTemplate(item.body_template, values); const missing = unresolved(`${subject}\n${textBody}`);
      if (missing.length) { await sql`UPDATE email_campaign_enrollments SET status = 'stopped', stopped_at = now(), stopped_reason = ${`unresolved:${missing.join(',')}`}, updated_at = now() WHERE id = ${item.enrollment_id}`; results.push({ enrollmentId:item.enrollment_id, status:'stopped', error:'Unresolved variables' }); continue; }
      const previousSend = await sql`SELECT id, status FROM email_campaign_sends WHERE enrollment_id = ${item.enrollment_id} AND step_id = ${item.step_id} LIMIT 1`;
      if (previousSend[0]?.status === 'sent' || previousSend[0]?.status === 'delivered' || previousSend[0]?.status === 'opened' || previousSend[0]?.status === 'clicked') {
        const nextAfterRecovery = await sql`SELECT step_order, wait_days, send_hour, send_minute FROM email_campaign_steps WHERE campaign_id = ${item.campaign_id} AND step_order > ${item.step_order} AND active = TRUE ORDER BY step_order LIMIT 1`;
        if (!nextAfterRecovery.length) await sql`UPDATE email_campaign_enrollments SET status = 'completed', current_step = ${item.step_order}, next_step_due = NULL, last_sent_at = COALESCE(last_sent_at, now()), updated_at = now() WHERE id = ${item.enrollment_id}`;
        else await sql`UPDATE email_campaign_enrollments SET current_step = ${item.step_order}, next_step_due = ${nextBusinessTime(new Date(Date.now() + nextAfterRecovery[0].wait_days * 86400000), nextAfterRecovery[0].send_hour, nextAfterRecovery[0].send_minute, item.send_timezone).toISOString()}::timestamptz, last_sent_at = COALESCE(last_sent_at, now()), updated_at = now() WHERE id = ${item.enrollment_id}`;
        results.push({ enrollmentId: item.enrollment_id, status: 'skipped', reason: 'step_already_sent' });
        continue;
      }
      if (previousSend[0]?.status === 'pending') {
        results.push({ enrollmentId: item.enrollment_id, status: 'skipped', reason: 'step_requires_manual_recovery' });
        continue;
      }
      if (previousSend[0]?.status === 'failed') await sql`DELETE FROM email_campaign_sends WHERE id = ${previousSend[0].id}`;
      const sendClaim = await sql`
        INSERT INTO email_campaign_sends (enrollment_id, step_id, sender_user_id, status, rendered_subject, rendered_body)
        VALUES (${item.enrollment_id}, ${item.step_id}, ${item.sender_user_id}, 'pending', ${subject}, ${textBody})
        ON CONFLICT (enrollment_id, step_id) DO NOTHING
        RETURNING id
      `;
      if (!sendClaim.length) {
        results.push({ enrollmentId: item.enrollment_id, status: 'skipped', reason: 'step_already_claimed' });
        continue;
      }
      try {
        const response = await sendMailgun({ from:`${sender.name || senderEmail} <${senderEmail}>`, to:item.email, subject, text:textBody, html:messageHtml(textBody, values.SIGNATURE, values.SIGNATURE_HTML), replyTo:senderEmail });
        const logs = await sql`INSERT INTO email_send_logs (batch_key, lead_id, sender_user_id, sender_email, sender_name, recipient_email, recipient_name, lead_owner_id, sector, sub_sector, template_key, subject_template, body_template, rendered_subject, rendered_body, provider_message_id, provider_response, status, sent_at) VALUES (${crypto.randomUUID()}, ${item.lead_id}, ${item.sender_user_id}, ${senderEmail}, ${sender.name}, ${item.email}, ${item.lead_name}, ${item.owner_id}, NULL, NULL, ${`campaign:${item.campaign_id}:step:${item.step_order}`}, ${item.subject_template}, ${item.body_template}, ${subject}, ${textBody}, ${response.id || null}, ${JSON.stringify(response)}, 'sent', now()) RETURNING id`;
        const sendRows = await sql`UPDATE email_campaign_sends SET email_send_log_id = ${logs[0].id}, provider_message_id = ${response.id || null}, status = 'sent', sent_at = now() WHERE id = ${sendClaim[0].id} RETURNING id`;
        const nextStep = await sql`SELECT id, step_order, wait_days, send_hour, send_minute FROM email_campaign_steps WHERE campaign_id = ${item.campaign_id} AND step_order > ${item.step_order} AND active = TRUE ORDER BY step_order LIMIT 1`;
        if (!nextStep.length) await sql`UPDATE email_campaign_enrollments SET status = 'completed', current_step = ${item.step_order}, next_step_due = NULL, last_sent_at = now(), updated_at = now() WHERE id = ${item.enrollment_id}`;
        else await sql`UPDATE email_campaign_enrollments SET current_step = ${item.step_order}, next_step_due = ${nextBusinessTime(new Date(Date.now() + nextStep[0].wait_days * 86400000), nextStep[0].send_hour, nextStep[0].send_minute, item.send_timezone).toISOString()}::timestamptz, last_sent_at = now(), updated_at = now() WHERE id = ${item.enrollment_id}`;
        results.push({ enrollmentId:item.enrollment_id, status:'sent', sendId:sendRows[0].id });
      } catch (error) { await sql`UPDATE email_campaign_sends SET status = 'failed', error = ${error.message} WHERE id = ${sendClaim[0].id}`; await sql`UPDATE email_campaign_enrollments SET next_step_due = now() + interval '30 minutes', updated_at = now() WHERE id = ${item.enrollment_id}`; results.push({ enrollmentId:item.enrollment_id, status:'failed', error:error.message }); }
    }
    return res.status(200).json({ success:true, processed:results.length, results });
  } catch (error) { return res.status(500).json({ success:false, error:error.message }); }
}
