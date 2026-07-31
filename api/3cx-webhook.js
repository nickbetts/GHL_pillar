/**
 * 3CX call-logging webhook.
 *
 * 3CX posts a call event here; we match it to a queue lead by phone number
 * and append a `call` event (direction, duration, outcome, recording, agent).
 * No lead → we return 200 with matched:false so 3CX does not retry forever.
 *
 * Security: requires `x-3cx-secret`. Set THREECX_WEBHOOK_SECRET in the environment.
 *
 * Field names are read defensively so this works with either the 3CX Call
 * Control API payload or a Custom CRM template that posts named fields:
 *   direction, from, to, agent, duration, outcome, recording, callId, time
 */

import { getSql } from './db.js';
import { findLeadByPhone, recordCall } from './apollo-sales-queue.js';
import { verifyBodySize, verifyWebhookSecret } from './webhook-security.js';

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

function normalizeDirection(raw) {
  const d = String(raw || '').toLowerCase();
  if (d.includes('out')) return 'outbound';
  if (d.includes('in')) return 'inbound';
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const verification = verifyWebhookSecret(req, {
    envName: 'THREECX_WEBHOOK_SECRET',
    headers: ['x-3cx-secret'],
  });
  if (!verification.ok) {
    return res.status(verification.status).json({ success: false, error: verification.error });
  }
  const bodySize = verifyBodySize(req);
  if (!bodySize.ok) return res.status(bodySize.status).json({ success: false, error: bodySize.error });

  try {
    const body = req.body || {};
    const direction = normalizeDirection(pick(body, ['direction', 'CallType', 'call_type', 'type']));
    const fromNumber = pick(body, ['from', 'From', 'caller', 'CallerNumber', 'from_number', 'source']);
    const toNumber = pick(body, ['to', 'To', 'callee', 'CalleeNumber', 'to_number', 'destination', 'dialed']);
    const agent = pick(body, ['agent', 'Agent', 'extension', 'Extension', 'agentName', 'AgentName']);
    const durationSec = pick(body, ['duration', 'Duration', 'talk_time', 'TalkTime', 'durationSec']);
    const outcome = pick(body, ['outcome', 'status', 'Status', 'result', 'Result', 'disposition']);
    const recordingUrl = pick(body, ['recording', 'Recording', 'recordingUrl', 'RecordingUrl', 'recording_url']);
    const callId = pick(body, ['callId', 'CallId', 'call_id', 'id', 'CallUUID']);
    const startedAt = pick(body, ['time', 'Time', 'startTime', 'StartTime', 'timestamp']);

    // For outbound the customer number is the callee; for inbound it's the caller.
    const leadNumber = direction === 'inbound' ? fromNumber : (toNumber || fromNumber);

    const sql = getSql();
    const lead = await findLeadByPhone(sql, leadNumber);
    if (!lead) {
      return res.status(200).json({ success: true, matched: false, number: leadNumber });
    }

    const result = await recordCall(sql, {
      lead,
      direction,
      fromNumber,
      toNumber,
      agent,
      durationSec,
      outcome,
      recordingUrl,
      callId,
      provider: '3cx',
      startedAt,
      raw: body,
    });

    return res.status(200).json({ success: true, matched: true, leadId: result.leadId });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
