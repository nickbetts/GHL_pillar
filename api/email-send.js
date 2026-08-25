import crypto from 'crypto';
import { getSql, initAuthTables, initQueueTable, isEmailSuppressed, writeAudit } from './db.js';
import { hasMinRole, resolveIdentity } from './session.js';

const MAX_BODY_BYTES = 128 * 1024;
const MAX_LEADS_PER_REQUEST = 200;

function requestBytes(req) {
  const declared = Number.parseInt(req.headers?.['content-length'] || '0', 10);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (value == null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function resolveTemplate(text, values) {
  const map = values || {};
  return String(text || '').replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    const resolved = map[key];
    // Known variables that are blank should render as empty text, not remain as placeholders.
    return resolved == null ? '' : String(resolved);
  });
}

function unresolvedVariables(text) {
  return [...new Set([...String(text || '').matchAll(/\{\{([A-Z_]+)\}\}/g)].map((match) => match[1]))];
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/tr>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

function buildSignature(sender, body) {
  const customSignature = String(sender?.sender_signature || '').trim();
  if (customSignature) return stripHtml(customSignature);
  const name = String(sender?.name || '').trim();
  const title = String(body?.senderTitle || sender?.sender_title || '').trim();
  const email = String(sender?.sender_email || sender?.email || body?.fromEmail || '').trim().toLowerCase();
  const lines = ['Best,'];
  if (name) lines.push(name);
  if (title) lines.push(title);
  if (email) lines.push(email);
  return lines.join('\n');
}

function buildSignatureHtml(sender, body) {
  const customSignature = String(sender?.sender_signature || '').trim();
  if (customSignature && /<[^>]+>/.test(customSignature)) return customSignature;
  return escapeHtml(buildSignature(sender, body)).replace(/\n/g, '<br>');
}

function personalizeBookingUrl(url, lead) {
  const value = String(url || '').trim() || 'https://click.i3media.net/growth';
  if (!value) return '';
  try {
    const parsed = new URL(value, 'https://www.i3media.net');
    const firstName = String(lead?.first_name || '').trim();
    const companyName = String(lead?.company_name || '').trim();
    if (firstName) parsed.searchParams.set('firstName', firstName);
    if (companyName) parsed.searchParams.set('companyName', companyName);
    return parsed.toString();
  } catch {
    return value;
  }
}

function textToHtml(text, signatureText, signatureHtml) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const withoutSignature = signatureText && normalized.endsWith(signatureText)
    ? normalized.slice(0, -signatureText.length).replace(/\s+$/, '')
    : normalized;
  const signatureMarkup = signatureHtml ? `<br><div style="margin-top:14px">${signatureHtml}</div>` : '';
  const linkedBody = escapeHtml(withoutSignature).replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const withBareLinks = linkedBody.replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const formattedBody = withBareLinks.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827">${formattedBody.replace(/\n/g, '<br>')}${signatureMarkup}</div>`;
}

async function sendViaMailgun({ from, to, subject, text, html, replyTo }) {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const baseUrl = process.env.MAILGUN_BASE_URL || 'https://api.mailgun.net';
  if (!apiKey || !domain) {
    throw new Error('Mailgun is not configured');
  }

  const payload = new URLSearchParams();
  payload.set('from', from);
  payload.set('to', to);
  payload.set('subject', subject);
  payload.set('text', text);
  if (html) payload.set('html', html);
  if (replyTo) payload.set('h:Reply-To', replyTo);

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload.toString(),
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : { message: await response.text() };

  if (!response.ok) {
    throw new Error(data?.message || `Mailgun request failed (${response.status})`);
  }

  return data;
}

async function loadLeads(sql, leadIds) {
  return sql`
    SELECT id, first_name, last_name, name, title, email, company_name, owner_id, owner, sector, sub_sector, status, disposition, archived_at
    FROM queue_leads
    WHERE id = ANY(${leadIds})
    ORDER BY id ASC
  `;
}

function buildValues(lead, sender, body) {
  const signature = buildSignature(sender, body);
  return {
    FIRST_NAME: lead.first_name || String(lead.name || '').split(/\s+/)[0] || '',
    COMPANY_NAME: lead.company_name || '',
    SENDER_NAME: sender.name || sender.email || '',
    SENDER_TITLE: String(body.senderTitle || sender.sender_title || '').trim() || '',
    SENDER_EMAIL: String(sender.sender_email || sender.email || body.fromEmail || '').trim().toLowerCase(),
    BOOKING_URL: personalizeBookingUrl(body.bookingUrl, lead),
    SIGNATURE: signature,
    SIGNATURE_HTML: buildSignatureHtml(sender, body),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (requestBytes(req) > MAX_BODY_BYTES) {
    return res.status(413).json({ success: false, error: 'Request body too large' });
  }

  let sql;
  try {
    sql = getSql();
    await initAuthTables();
    await initQueueTable();
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  const identity = resolveIdentity(req);
  if (!identity || !identity.email || identity.email === 'system') {
    return res.status(401).json({ success: false, error: 'Not signed in' });
  }

  const body = req.body || {};
  const action = String(body.action || 'send-leads').trim().toLowerCase();

  const subjectTemplate = String(body.subjectTemplate || '').trim();
  const bodyTemplate = String(body.bodyTemplate || '').trim();
  const templateKey = String(body.templateKey || body.variantKey || 'custom').trim();
  if (!subjectTemplate || !bodyTemplate) {
    return res.status(400).json({ success: false, error: 'Subject and body templates are required' });
  }

  try {
    const senderRows = await sql`
      SELECT id, email, name, sender_email, sender_title, sender_signature, ghl_owner_id, role, active
      FROM app_users
      WHERE lower(email) = ${identity.email.toLowerCase()}
      LIMIT 1
    `;
    const sender = senderRows[0];
    if (!sender || !sender.active) {
      return res.status(403).json({ success: false, error: 'Sender account is inactive' });
    }

    if (action === 'send-test') {
      if (!hasMinRole(identity, 'admin')) {
        return res.status(403).json({ success: false, error: 'Admin access required for test sends' });
      }

      const toEmail = String(body.toEmail || '').trim().toLowerCase();
      const toName = String(body.toName || '').trim() || null;
      const fromEmail = String(body.fromEmail || sender.sender_email || '').trim().toLowerCase();
      const fromName = String(body.fromName || sender.name || fromEmail).trim();
      const batchKey = crypto.randomUUID();

      if (!isValidEmail(toEmail)) {
        return res.status(400).json({ success: false, error: 'A valid test recipient email is required' });
      }
      if (!isValidEmail(fromEmail)) {
        return res.status(400).json({ success: false, error: 'A valid sender email is required for test send' });
      }
      if (await isEmailSuppressed(sql, toEmail)) {
        return res.status(400).json({ success: false, error: 'Recipient is suppressed and cannot be emailed' });
      }

      const testLead = {
        first_name: String(body.testFirstName || '').trim(),
        name: String(body.testFirstName || '').trim(),
        company_name: String(body.testCompanyName || '').trim(),
      };
    const teamMemberRows = await sql`
        SELECT id, email, name, sender_email, sender_title, sender_signature
        FROM app_users
        WHERE active = TRUE AND (lower(email) = ${fromEmail} OR lower(sender_email) = ${fromEmail})
        LIMIT 1
      `;
    const selectedSender = teamMemberRows[0];
      if (!selectedSender) {
        return res.status(400).json({ success: false, error: 'Select an active platform user as the sender' });
      }
      const selectedFirstName = String(selectedSender.name || fromEmail).trim().split(/\s+/)[0];
      const testSender = { ...selectedSender, email: fromEmail };
      const testFromName = `${selectedFirstName} @ I3MEDIA`;
      const testBody = { ...body, senderTitle: selectedSender.sender_title || body.senderTitle };
      const values = buildValues(testLead, testSender, testBody);
      const renderedSubject = resolveTemplate(subjectTemplate, values).trim();
      const renderedBody = resolveTemplate(bodyTemplate, values).trim();
      const unresolved = unresolvedVariables(`${renderedSubject}\n${renderedBody}`);

      if (unresolved.length) {
        const error = `Unresolved variables: ${unresolved.join(', ')}`;
        await sql`
          INSERT INTO email_send_logs (
            batch_key, lead_id, sender_user_id, sender_email, sender_name, recipient_email, recipient_name,
            lead_owner_id, sector, sub_sector, template_key, subject_template, body_template,
            rendered_subject, rendered_body, status, error
          ) VALUES (
            ${batchKey}, ${null}, ${sender.id}, ${fromEmail}, ${fromName || null}, ${toEmail}, ${toName},
            ${null}, ${null}, ${null}, ${templateKey}, ${subjectTemplate}, ${bodyTemplate},
            ${renderedSubject}, ${renderedBody}, ${'blocked'}, ${error}
          )
        `;
        return res.status(400).json({ success: false, error });
      }

      try {
        const response = await sendViaMailgun({
          from: `${testFromName} <${fromEmail}>`,
          to: toName ? `${toName} <${toEmail}>` : toEmail,
          subject: renderedSubject,
          text: renderedBody,
          html: textToHtml(renderedBody, values.SIGNATURE, values.SIGNATURE_HTML),
          replyTo: fromEmail,
        });

        await sql`
          INSERT INTO email_send_logs (
            batch_key, lead_id, sender_user_id, sender_email, sender_name, recipient_email, recipient_name,
            lead_owner_id, sector, sub_sector, template_key, subject_template, body_template,
            rendered_subject, rendered_body, provider_message_id, provider_response, status, sent_at
          ) VALUES (
            ${batchKey}, ${null}, ${sender.id}, ${fromEmail}, ${testFromName}, ${toEmail}, ${toName},
            ${null}, ${null}, ${null}, ${templateKey}, ${subjectTemplate}, ${bodyTemplate},
            ${renderedSubject}, ${renderedBody}, ${response?.id || null}, ${JSON.stringify(response || {})}, ${'sent'}, now()
          )
        `;

        await writeAudit(sql, {
          actorEmail: sender.email,
          actorRole: sender.role,
          event: 'email_test_send',
          target: `batch:${batchKey}`,
          meta: { templateKey, toEmail, fromEmail, providerMessageId: response?.id || null },
        });

        return res.status(200).json({
          success: true,
          batchKey,
          result: { status: 'sent', providerMessageId: response?.id || null, toEmail, fromEmail },
        });
      } catch (error) {
        await sql`
          INSERT INTO email_send_logs (
            batch_key, lead_id, sender_user_id, sender_email, sender_name, recipient_email, recipient_name,
            lead_owner_id, sector, sub_sector, template_key, subject_template, body_template,
            rendered_subject, rendered_body, status, error
          ) VALUES (
            ${batchKey}, ${null}, ${sender.id}, ${fromEmail}, ${testFromName}, ${toEmail}, ${toName},
            ${null}, ${null}, ${null}, ${templateKey}, ${subjectTemplate}, ${bodyTemplate},
            ${renderedSubject}, ${renderedBody}, ${'failed'}, ${error.message}
          )
        `;
        return res.status(502).json({ success: false, error: error.message });
      }
    }

    const leadIds = normalizeList(body.leadIds || body.leadId)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0);

    if (!leadIds.length) {
      return res.status(400).json({ success: false, error: 'Lead id(s) required' });
    }
    if (leadIds.length > MAX_LEADS_PER_REQUEST) {
      return res.status(400).json({ success: false, error: `Too many leads in one request (max ${MAX_LEADS_PER_REQUEST})` });
    }

    const fromEmail = String(sender.sender_email || '').trim().toLowerCase();
    if (!fromEmail) {
      return res.status(400).json({ success: false, error: 'Sender email is not configured for this rep' });
    }
    if (!isValidEmail(fromEmail)) {
      return res.status(400).json({ success: false, error: 'Sender email is invalid' });
    }

    const leads = await loadLeads(sql, leadIds);
    const leadById = new Map(leads.map((lead) => [Number(lead.id), lead]));
    const results = [];
    const batchKey = crypto.randomUUID();

    for (const leadId of leadIds) {
      const lead = leadById.get(leadId);
      if (!lead) {
        results.push({ leadId, status: 'blocked', error: 'Lead not found' });
        continue;
      }
      if (lead.archived_at) {
        results.push({ leadId, status: 'blocked', error: 'Lead is archived' });
        continue;
      }
      if (!lead.email) {
        results.push({ leadId, status: 'blocked', error: 'Lead has no email address' });
        continue;
      }
      if (String(lead.owner_id || '') !== String(identity.ghlOwnerId || '')) {
        results.push({ leadId, status: 'blocked', error: 'Lead is not assigned to this rep' });
        continue;
      }
      if (await isEmailSuppressed(sql, lead.email)) {
        results.push({ leadId, status: 'blocked', error: 'Recipient is suppressed' });
        continue;
      }

      const values = buildValues(lead, sender, body);
      const renderedSubject = resolveTemplate(subjectTemplate, values).trim();
      const renderedBody = resolveTemplate(bodyTemplate, values).trim();
      const unresolved = unresolvedVariables(`${renderedSubject}\n${renderedBody}`);
      if (unresolved.length) {
        const error = `Unresolved variables: ${unresolved.join(', ')}`;
        results.push({ leadId, status: 'blocked', error });
        await sql`
          INSERT INTO email_send_logs (
            batch_key, lead_id, sender_user_id, sender_email, sender_name, recipient_email, recipient_name,
            lead_owner_id, sector, sub_sector, template_key, subject_template, body_template,
            rendered_subject, rendered_body, status, error
          ) VALUES (
            ${batchKey}, ${lead.id}, ${sender.id}, ${fromEmail}, ${sender.name || null}, ${lead.email}, ${lead.name || null},
            ${lead.owner_id || null}, ${lead.sector || null}, ${lead.sub_sector || null}, ${templateKey}, ${subjectTemplate}, ${bodyTemplate},
            ${renderedSubject}, ${renderedBody}, ${'blocked'}, ${error}
          )
        `;
        continue;
      }

      try {
        const response = await sendViaMailgun({
          from: `${sender.name || fromEmail} <${fromEmail}>`,
          to: lead.email,
          subject: renderedSubject,
          text: renderedBody,
          html: textToHtml(renderedBody, values.SIGNATURE, values.SIGNATURE_HTML),
          replyTo: fromEmail,
        });

        await sql`
          INSERT INTO email_send_logs (
            batch_key, lead_id, sender_user_id, sender_email, sender_name, recipient_email, recipient_name,
            lead_owner_id, sector, sub_sector, template_key, subject_template, body_template,
            rendered_subject, rendered_body, provider_message_id, provider_response, status, sent_at
          ) VALUES (
          html: textToHtml(renderedBody, values.SIGNATURE, values.SIGNATURE_HTML),
            ${lead.owner_id || null}, ${lead.sector || null}, ${lead.sub_sector || null}, ${templateKey}, ${subjectTemplate}, ${bodyTemplate},
            ${renderedSubject}, ${renderedBody}, ${response?.id || null}, ${JSON.stringify(response || {})}, ${'sent'}, now()
          )
        `;

        results.push({ leadId, status: 'sent', providerMessageId: response?.id || null });
      } catch (error) {
        await sql`
          INSERT INTO email_send_logs (
            batch_key, lead_id, sender_user_id, sender_email, sender_name, recipient_email, recipient_name,
            lead_owner_id, sector, sub_sector, template_key, subject_template, body_template,
            rendered_subject, rendered_body, status, error
          ) VALUES (
            ${batchKey}, ${lead.id}, ${sender.id}, ${fromEmail}, ${sender.name || null}, ${lead.email}, ${lead.name || null},
            ${lead.owner_id || null}, ${lead.sector || null}, ${lead.sub_sector || null}, ${templateKey}, ${subjectTemplate}, ${bodyTemplate},
            ${renderedSubject}, ${renderedBody}, ${'failed'}, ${error.message}
          )
        `;
        results.push({ leadId, status: 'failed', error: error.message });
      }
    }

    await writeAudit(sql, {
      actorEmail: sender.email,
      actorRole: sender.role,
      event: 'email_send_batch',
      target: `batch:${batchKey}`,
      meta: {
        templateKey,
        leadIds,
        results,
      },
    });

    return res.status(200).json({
      success: true,
      batchKey,
      summary: {
        requested: leadIds.length,
        sent: results.filter((item) => item.status === 'sent').length,
        failed: results.filter((item) => item.status === 'failed').length,
        blocked: results.filter((item) => item.status === 'blocked').length,
      },
      results,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}