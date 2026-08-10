import { getSql, initAuthTables, initQueueTable, initTimeOffTable } from './db.js';
import { resolveIdentity, hasMinRole } from './session.js';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_HISTORY = 12;

function requestBytes(req) {
  const declared = Number.parseInt(req.headers?.['content-length'] || '0', 10);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
}

function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 8000) }))
    .slice(-MAX_HISTORY);
}

async function tableExists(sql, tableName) {
  try {
    const rows = await sql`SELECT to_regclass(${tableName}) AS reg`;
    return !!rows?.[0]?.reg;
  } catch {
    return false;
  }
}

async function getDataBundle(sql) {
  const hasQueueEvents = await tableExists(sql, 'queue_events');
  const hasActivityBlocks = await tableExists(sql, 'manual_activity_blocks');
  const hasManualCalls = await tableExists(sql, 'manual_call_logs');

  const leadsBySourceStatusOwner = await sql`
    SELECT
      COALESCE(NULLIF(source, ''), 'outbound') AS source,
      status,
      COALESCE(owner, 'Unassigned') AS owner,
      COALESCE(owner_id, 'unassigned') AS owner_id,
      COUNT(*)::int AS leads
    FROM queue_leads
    WHERE archived_at IS NULL
    GROUP BY 1,2,3,4
    ORDER BY leads DESC
  `;

  const leadAging = await sql`
    SELECT
      COALESCE(NULLIF(source, ''), 'outbound') AS source,
      AVG(EXTRACT(EPOCH FROM (now() - created_at)) / 3600)::numeric(10,2) AS avg_age_hours,
      AVG(EXTRACT(EPOCH FROM (now() - updated_at)) / 3600)::numeric(10,2) AS avg_stale_hours,
      COUNT(*)::int AS leads
    FROM queue_leads
    WHERE archived_at IS NULL
    GROUP BY 1
    ORDER BY leads DESC
  `;

  const leadFlow7d = hasQueueEvents
    ? await sql`
        SELECT
          DATE(created_at AT TIME ZONE 'Europe/London') AS day,
          COALESCE(owner_name, 'Unknown') AS owner,
          COALESCE(meta->>'source', 'unknown') AS source,
          to_status,
          COUNT(*)::int AS events
        FROM queue_events
        WHERE event_type = 'status_change'
          AND created_at >= now() - interval '7 days'
        GROUP BY 1,2,3,4
        ORDER BY day ASC, events DESC
      `
    : [];

  const callHourly = hasQueueEvents
    ? await sql`
        SELECT
          EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Europe/London'))::int AS hour,
          COUNT(*)::int AS calls,
          COUNT(*) FILTER (WHERE COALESCE(meta->>'outcome', '') ILIKE 'Answered%')::int AS answered
        FROM queue_events
        WHERE event_type = 'call'
          AND created_at >= now() - interval '30 days'
        GROUP BY 1
        ORDER BY 1 ASC
      `
    : [];

  const callByOwnerOutcome = hasQueueEvents
    ? await sql`
        SELECT
          COALESCE(owner_name, 'Unknown') AS owner,
          COALESCE(meta->>'outcome', 'Unknown') AS outcome,
          COUNT(*)::int AS calls
        FROM queue_events
        WHERE event_type = 'call'
          AND created_at >= now() - interval '30 days'
        GROUP BY 1,2
        ORDER BY calls DESC
      `
    : [];

  const activityByHour = hasActivityBlocks
    ? await sql`
        SELECT
          EXTRACT(HOUR FROM (starts_at AT TIME ZONE 'Europe/London'))::int AS hour,
          COUNT(*)::int AS blocks
        FROM manual_activity_blocks
        WHERE starts_at >= now() - interval '30 days'
        GROUP BY 1
        ORDER BY 1 ASC
      `
    : [];

  const activityByOwner = hasActivityBlocks
    ? await sql`
        SELECT
          COALESCE(owner_name, 'Unknown') AS owner,
          COUNT(*)::int AS blocks,
          SUM(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 3600.0)::numeric(10,2) AS hours
        FROM manual_activity_blocks
        WHERE starts_at >= now() - interval '30 days'
        GROUP BY 1
        ORDER BY blocks DESC
      `
    : [];

  const manualCallsByOwner = hasManualCalls
    ? await sql`
        SELECT
          COALESCE(owner_name, 'Unknown') AS owner,
          COUNT(*)::int AS calls,
          COUNT(*) FILTER (WHERE COALESCE(meta->>'outcome', '') ILIKE 'Answered%')::int AS answered
        FROM manual_call_logs
        WHERE created_at >= now() - interval '30 days'
        GROUP BY 1
        ORDER BY calls DESC
      `
    : [];

  const activeTimeOff = await sql`
    SELECT
      owner_id,
      start_date,
      end_date,
      day_part,
      COALESCE(hours_off, 0)::numeric(10,2) AS hours_off
    FROM rep_time_off
    WHERE canceled_at IS NULL
      AND end_date >= ((now() AT TIME ZONE 'Europe/London')::date - 30)
      AND start_date <= ((now() AT TIME ZONE 'Europe/London')::date + 30)
    ORDER BY start_date DESC
  `;

  const quietHours = [];
  if (callHourly.length) {
    const values = callHourly.map((r) => Number(r.calls || 0)).sort((a, b) => a - b);
    const q1 = values[Math.floor(values.length * 0.25)] || 0;
    for (const row of callHourly) {
      if (Number(row.calls || 0) <= q1) quietHours.push(Number(row.hour));
    }
  }

  const quietHourActivityOverlap = activityByHour
    .filter((row) => quietHours.includes(Number(row.hour)))
    .map((row) => ({ hour: Number(row.hour), blocks: Number(row.blocks || 0) }));

  return {
    generatedAt: new Date().toISOString(),
    windows: {
      calls: 'last_30_days',
      leadFlow: 'last_7_days',
      activity: 'last_30_days',
    },
    dataHealth: {
      hasQueueEvents,
      hasActivityBlocks,
      hasManualCalls,
    },
    leadsBySourceStatusOwner,
    leadAging,
    leadFlow7d,
    callHourly,
    callByOwnerOutcome,
    activityByHour,
    activityByOwner,
    manualCallsByOwner,
    activeTimeOff,
    quietHourActivityOverlap,
  };
}

async function askAnthropic({ question, history, bundle }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const configuredModel = String(process.env.ANTHROPIC_MODEL || '').trim();
  const modelCandidates = [
    configuredModel,
    'claude-sonnet-4-20250514',
    'claude-3-7-sonnet-latest',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-sonnet-latest',
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);

  const systemPrompt = [
    'You are an internal analytics copilot for i3 Sales operations.',
    'You are talking to admins. Use only the provided data bundle and conversation context.',
    'If data is missing, say exactly what is missing and why the conclusion is uncertain.',
    'Provide practical conclusions, anomalies, and actions.',
    'When asked about trends or drops, quantify with counts/percentages where possible.',
    'If asked for comparisons (e.g., Apollo vs outreach), use source-level evidence from the bundle.',
    'Keep response concise and structured with short sections.',
  ].join(' ');

  const trimmedHistory = history.slice(-MAX_HISTORY).map((m) => ({
    role: m.role,
    content: [{ type: 'text', text: m.content }],
  }));

  const userPrompt = [
    'QUESTION:',
    question,
    '',
    'DATA_BUNDLE_JSON:',
    JSON.stringify(bundle),
  ].join('\n');

  const modelErrors = [];

  for (const model of modelCandidates) {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1400,
        temperature: 0.2,
        system: systemPrompt,
        messages: [...trimmedHistory, { role: 'user', content: [{ type: 'text', text: userPrompt }] }],
      }),
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : { error: { message: await response.text() } };

    if (response.ok) {
      const text = Array.isArray(payload?.content)
        ? payload.content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n\n').trim()
        : '';

      return {
        model: payload?.model || model,
        usage: payload?.usage || null,
        answer: text || 'No response text returned by model.',
      };
    }

    const message = String(payload?.error?.message || `Anthropic API request failed (${response.status})`);
    const lc = message.toLowerCase();
    const isModelError = lc.includes('model') && (lc.includes('not found') || lc.includes('invalid') || lc.includes('unsupported'));

    modelErrors.push(`${model}: ${message}`);
    if (!isModelError) {
      throw new Error(message);
    }
  }

  throw new Error(`No supported Anthropic model available for this key. Tried: ${modelErrors.join(' | ')}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (requestBytes(req) > MAX_BODY_BYTES) {
    return res.status(413).json({ success: false, error: 'Request body too large' });
  }

  const identity = resolveIdentity(req);
  if (!identity) {
    return res.status(401).json({ success: false, error: 'Not signed in' });
  }
  if (!hasMinRole(identity, 'admin')) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const body = req.body || {};
  const question = String(body.question || '').trim();
  if (!question) {
    return res.status(400).json({ success: false, error: 'Question is required' });
  }

  let sql;
  try {
    sql = getSql();
    await initAuthTables();
    await initQueueTable();
    await initTimeOffTable();
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  try {
    const history = normalizeHistory(body.history);
    const bundle = await getDataBundle(sql);
    const result = await askAnthropic({ question, history, bundle });

    return res.status(200).json({
      success: true,
      answer: result.answer,
      model: result.model,
      usage: result.usage,
      generatedAt: bundle.generatedAt,
      dataHealth: bundle.dataHealth,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
