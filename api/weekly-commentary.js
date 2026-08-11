import { resolveIdentity, hasMinRole } from './session.js';

const LONDON_TZ = 'Europe/London';
const MAX_REPS = 10;
const MAX_TEXT = 180;

function normalizeBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function addDaysKey(dateKey, days) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function londonToUtcDate(year, month, day, hour = 0, minute = 0, second = 0) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(guess).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const diff = asUtc - guess.getTime();
  return new Date(guess.getTime() - diff);
}

function releaseForWeek(filters = {}) {
  const weekStart = String(filters.weekStart || filters.from || '').trim();
  const targetFriday = addDaysKey(weekStart, 4);
  if (!targetFriday) return null;
  const [y, m, d] = targetFriday.split('-').map(Number);
  const releaseAt = londonToUtcDate(y, m, d, 15, 0, 0);
  return { targetFriday, releaseAt };
}

function sanitizeReps(reps = []) {
  return (Array.isArray(reps) ? reps : []).slice(0, MAX_REPS).map((rep) => ({
    owner: String(rep?.owner || 'Rep').slice(0, 80),
    score: Number(rep?.score || 0),
    displayRank: Number(rep?.displayRank || rep?.rank || 0),
    rankText: String(rep?.rankText || '').slice(0, 40),
    deltas: {
      score: Number(rep?.deltas?.score || 0),
      qualifiedContacts: Number(rep?.deltas?.qualifiedContacts || 0),
      meetingsBooked: Number(rep?.deltas?.meetingsBooked || 0),
      meetingsAttended: Number(rep?.deltas?.meetingsAttended || 0),
      dealsClosed: Number(rep?.deltas?.dealsClosed || 0),
    },
    streak: Number(rep?.streak || 0),
    callout: String(rep?.callout || '').slice(0, MAX_TEXT),
  }));
}

function sanitizeTotals(totals = {}) {
  return {
    dealsClosed: Number(totals?.dealsClosed || 0),
    meetingsAttended: Number(totals?.meetingsAttended || 0),
    meetingsBooked: Number(totals?.meetingsBooked || 0),
    qualifiedContacts: Number(totals?.qualifiedContacts || 0),
    calls: Number(totals?.calls || 0),
  };
}

async function askAnthropicCommentary({ reps, totals, filters, release }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fallbackCommentary(reps, totals, filters);
  }

  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const configuredModel = String(process.env.ANTHROPIC_MODEL || '').trim();
  const modelCandidates = [configuredModel, 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-3-7-sonnet-latest'].filter((v, i, arr) => v && arr.indexOf(v) === i);

  const systemPrompt = [
    'You write short, high-energy sales team commentary for a weekly leaderboard.',
    'Positive vibes only. No negative tone. No shaming language.',
    'When someone underperforms, encourage with morale-boosting framing and practical optimism.',
    'Keep it concise and punchy: 4 bullet lines max, plain text only.',
    'Mention top wins, momentum, and one team-level encouragement line.',
    'Use UK English. No markdown tables. No code blocks.',
  ].join(' ');

  const userPrompt = [
    `WEEK: ${filters?.weekStart || filters?.from || ''} to ${filters?.weekEnd || filters?.to || ''}`,
    `RELEASE: ${release?.targetFriday || ''} 15:00 Europe/London`,
    'TOTALS_JSON:',
    JSON.stringify(totals),
    'REPS_JSON:',
    JSON.stringify(reps),
    'Write a morale-boosting weekly commentary now.',
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
        max_tokens: 420,
        temperature: 0.55,
        system: systemPrompt,
        messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
      }),
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : { error: { message: await response.text() } };

    if (response.ok) {
      const text = Array.isArray(payload?.content)
        ? payload.content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n').trim()
        : '';
      if (text) return text;
      return fallbackCommentary(reps, totals, filters);
    }

    const message = String(payload?.error?.message || `Anthropic API request failed (${response.status})`);
    modelErrors.push(`${model}: ${message}`);
    if (!message.toLowerCase().includes('model')) {
      return fallbackCommentary(reps, totals, filters);
    }
  }

  return fallbackCommentary(reps, totals, filters);
}

function fallbackCommentary(reps, totals) {
  const top = reps[0];
  const second = reps[1];
  const lines = [];
  if (top) lines.push(`- Big energy from ${top.owner}: ${top.score} points and setting the pace this week.`);
  if (second) lines.push(`- Strong chase group too: ${second.owner} is keeping pressure on with steady output.`);
  lines.push(`- Team totals are moving: ${totals.dealsClosed} closed, ${totals.meetingsAttended} attended, ${totals.meetingsBooked} booked.`);
  lines.push('- Keep momentum high: every call and qualification compounds into next week wins.');
  return lines.join('\n');
}

function getCache() {
  if (!globalThis.__weeklyCommentaryCache) globalThis.__weeklyCommentaryCache = new Map();
  return globalThis.__weeklyCommentaryCache;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const identity = resolveIdentity(req);
  if (!identity) return res.status(401).json({ success: false, error: 'Not signed in' });
  if (!hasMinRole(identity, 'rep')) {
    return res.status(403).json({ success: false, error: 'You do not have access to weekly commentary' });
  }

  const body = normalizeBody(req);
  const filters = body?.filters || {};
  const release = releaseForWeek(filters);
  if (!release) {
    return res.status(400).json({ success: false, error: 'Missing week range context' });
  }

  const now = new Date();
  const countdownSeconds = Math.max(0, Math.floor((release.releaseAt.getTime() - now.getTime()) / 1000));
  const available = countdownSeconds <= 0;

  if (!available) {
    return res.status(200).json({
      success: true,
      available: false,
      releaseAt: release.releaseAt.toISOString(),
      countdownSeconds,
      message: 'Commentary unlocks at 3:00pm Friday (London time).',
    });
  }

  const reps = sanitizeReps(body?.reps || []);
  const totals = sanitizeTotals(body?.totals || {});
  const cacheKey = `${filters?.weekStart || filters?.from || 'unknown'}::${filters?.weekEnd || filters?.to || 'unknown'}`;
  const cache = getCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.status(200).json({ success: true, available: true, releaseAt: release.releaseAt.toISOString(), commentary: cached.commentary, generatedAt: cached.generatedAt, source: cached.source });
  }

  const commentary = await askAnthropicCommentary({ reps, totals, filters, release });
  const payload = {
    commentary: String(commentary || fallbackCommentary(reps, totals)).trim(),
    generatedAt: new Date().toISOString(),
    source: process.env.ANTHROPIC_API_KEY ? 'ai' : 'fallback',
  };
  cache.set(cacheKey, payload);

  return res.status(200).json({ success: true, available: true, releaseAt: release.releaseAt.toISOString(), ...payload });
}
