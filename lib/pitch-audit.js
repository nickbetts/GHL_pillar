/** "Before" evidence for a client's current site: a screenshot plus Google PageSpeed scores when a key is configured. */

const PSI = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const MAX_SHOT_BYTES = 2_500_000;

async function fetchJson(url, ms) {
  const response = await fetch(url, { signal: AbortSignal.timeout(ms) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
  return data;
}

function summarizePsi(data) {
  const lr = data?.lighthouseResult;
  if (!lr) return null;
  const score = (k) => (lr.categories?.[k]?.score == null ? null : Math.round(lr.categories[k].score * 100));
  const audit = (k) => lr.audits?.[k];
  const failing = Object.values(lr.audits || {})
    .filter((a) => a && a.score != null && a.score < 0.5 && a.scoreDisplayMode === 'binary' || (a?.score != null && a.score < 0.5 && a.details?.type === 'opportunity'))
    .slice(0, 12)
    .map((a) => ({ id: a.id, title: a.title, value: a.displayValue || '' }));
  return {
    performance: score('performance'), seo: score('seo'), accessibility: score('accessibility'), bestPractices: score('best-practices'),
    lcp: audit('largest-contentful-paint')?.displayValue || null,
    cls: audit('cumulative-layout-shift')?.displayValue || null,
    tbt: audit('total-blocking-time')?.displayValue || null,
    fcp: audit('first-contentful-paint')?.displayValue || null,
    failing,
  };
}

export async function runPageSpeed(url, strategy, apiKey) {
  const params = new URLSearchParams({ url, strategy });
  for (const c of ['PERFORMANCE', 'SEO', 'ACCESSIBILITY', 'BEST_PRACTICES']) params.append('category', c);
  if (apiKey) params.set('key', apiKey);
  return summarizePsi(await fetchJson(`${PSI}?${params}`, 110_000));
}

/** Desktop screenshot of the top of the page via Microlink (free tier, no key needed). */
export async function captureScreenshot(url) {
  const params = new URLSearchParams({
    url, screenshot: 'true', meta: 'false', 'viewport.width': '1366', 'viewport.height': '900', 'viewport.deviceScaleFactor': '1',
    'screenshot.type': 'jpeg', waitForTimeout: '1500',
  });
  if (process.env.MICROLINK_API_KEY) params.set('apiKey', process.env.MICROLINK_API_KEY);
  const host = process.env.MICROLINK_API_KEY ? 'https://pro.microlink.io' : 'https://api.microlink.io';
  const data = await fetchJson(`${host}/?${params}`, 45_000);
  const shot = data?.data?.screenshot?.url;
  if (!shot || !/^https:\/\/[a-z0-9.-]*microlink\.io\//i.test(shot)) throw new Error('No screenshot returned');
  const response = await fetch(shot, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Screenshot download failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_SHOT_BYTES) throw new Error('Screenshot too large');
  return { bytes, mime: response.headers.get('content-type') || 'image/jpeg' };
}

/**
 * Runs the screenshot and (if PAGESPEED_API_KEY is set) mobile + desktop PageSpeed in parallel.
 * Nothing here is required: every part fails soft and reports what went wrong.
 */
export async function runAudit(url) {
  const apiKey = process.env.PAGESPEED_API_KEY || '';
  const errors = [];
  const [shot, mobile, desktop] = await Promise.all([
    captureScreenshot(url).catch((e) => { errors.push(`Screenshot: ${e.message}`); return null; }),
    apiKey ? runPageSpeed(url, 'mobile', apiKey).catch((e) => { errors.push(`PageSpeed mobile: ${e.message}`); return null; }) : null,
    apiKey ? runPageSpeed(url, 'desktop', apiKey).catch((e) => { errors.push(`PageSpeed desktop: ${e.message}`); return null; }) : null,
  ]);
  return {
    screenshot: shot,
    audit: { mobile, desktop, pagespeed: apiKey ? 'on' : 'no-key', errors, ranAt: new Date().toISOString() },
  };
}
