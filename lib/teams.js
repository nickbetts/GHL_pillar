/** Microsoft Teams feed via a Power Automate Workflows webhook ("When a Teams webhook request is received"). */

const POST_TIMEOUT_MS = 5000;

export const appUrl = () => (process.env.APP_URL || 'https://ghl-pillar.vercel.app').replace(/\/$/, '');
export const teamsConfigured = () => /^https:\/\//i.test(String(process.env.TEAMS_WEBHOOK_URL || '').trim());

export const gbp = (n) => {
  const v = Number(n) || 0;
  return `£${v.toLocaleString('en-GB', Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** "£12,000 one-off + £800/mo", or '' when there is no value. */
export function dealValueText(oneOff, monthly) {
  const parts = [];
  if (Number(oneOff) > 0) parts.push(`${gbp(oneOff)} one-off`);
  if (Number(monthly) > 0) parts.push(`${gbp(monthly)}/mo`);
  return parts.join(' + ');
}

const TONES = { accent: 'Accent', good: 'Good', warn: 'Warning', bad: 'Attention', plain: 'Default' };

/** An Adaptive Card message in the envelope the Workflows webhook expects. */
export function buildCard({ title, text, facts, url, urlLabel, tone = 'accent' }) {
  const body = [{ type: 'TextBlock', text: String(title), weight: 'Bolder', size: 'Medium', wrap: true, color: TONES[tone] || TONES.accent }];
  if (text) body.push({ type: 'TextBlock', text: String(text), wrap: true, spacing: 'Small' });
  const rows = (facts || []).filter((f) => f && f[1] !== undefined && f[1] !== null && String(f[1]).trim() !== '');
  if (rows.length) body.push({ type: 'FactSet', facts: rows.map(([name, value]) => ({ title: String(name), value: String(value) })) });
  const content = { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body };
  if (url) content.actions = [{ type: 'Action.OpenUrl', title: urlLabel || 'Open in Stream', url }];
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content }] };
}

export async function postToTeams(card) {
  if (!teamsConfigured()) return { ok: false, reason: 'not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetch(process.env.TEAMS_WEBHOOK_URL.trim(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card), signal: controller.signal,
    });
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, reason: `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, reason: error?.name === 'AbortError' ? 'timed out' : String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

let logReady = null;
function ensureFeedLog(sql) {
  if (!logReady) {
    logReady = sql`CREATE TABLE IF NOT EXISTS teams_feed_log (key TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`
      .catch((error) => { logReady = null; throw error; });
  }
  return logReady;
}

/** True the first time a key is claimed, so a scheduled job posts each thing once. */
export async function claimFeedKey(sql, key) {
  await ensureFeedLog(sql);
  const rows = await sql`INSERT INTO teams_feed_log (key) VALUES (${key}) ON CONFLICT (key) DO NOTHING RETURNING key`;
  return rows.length > 0;
}

export async function releaseFeedKey(sql, key) {
  await ensureFeedLog(sql);
  await sql`DELETE FROM teams_feed_log WHERE key = ${key}`;
}

/**
 * Best-effort feed post: never throws, so a Teams hiccup can't break a sale or a signature.
 * With a `key` the post is sent at most once; a failed send releases the key so it can retry.
 */
export async function feed(sql, card, key = null) {
  if (!teamsConfigured()) return false;
  try {
    if (key && !(await claimFeedKey(sql, key))) return false;
    const result = await postToTeams(card);
    if (!result.ok && key) await releaseFeedKey(sql, key).catch(() => {});
    return result.ok;
  } catch {
    return false;
  }
}
