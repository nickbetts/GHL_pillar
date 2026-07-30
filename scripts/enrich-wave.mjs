/**
 * Enrich a released wave: call Apollo People Bulk Match to reveal emails/phones,
 * then push each enriched contact into the outbound queue via enrich-wave.
 *
 * Usage:
 *   APOLLO_API_KEY=... QUEUE_AUTH=... \
 *   API_BASE=https://ghl-pillar.vercel.app \
 *   node scripts/enrich-wave.mjs [wave_number]
 *
 * Defaults to wave 1. Set DRY_RUN=1 to skip the enrich-wave push.
 */

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const QUEUE_AUTH = process.env.QUEUE_AUTH;
const API_BASE = process.env.API_BASE || 'https://ghl-pillar.vercel.app';
const WAVE = Number.parseInt(process.argv[2] || '1', 10);
const DRY_RUN = process.env.DRY_RUN === '1';
const BATCH_SIZE = 10; // Apollo bulk match max per call

if (!APOLLO_API_KEY) { console.error('APOLLO_API_KEY missing'); process.exit(1); }
if (!QUEUE_AUTH) { console.error('QUEUE_AUTH missing'); process.exit(1); }

async function queueApi(payload) {
  const res = await fetch(`${API_BASE}/api/apollo-sales-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-queue-auth': QUEUE_AUTH },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(`Queue API ${payload.action}: HTTP ${res.status} – ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function apolloBulkMatch(people) {
  const res = await fetch('https://api.apollo.io/api/v1/people/bulk_match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
    body: JSON.stringify({ people, reveal_personal_emails: false }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Apollo bulk_match HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

function extractContact(match) {
  if (!match) return null;
  // Apollo returns the matched person in match.person or match directly.
  const p = match.person || match;
  if (!p?.id) return null;
  const phone = p.phone_numbers?.[0]?.raw_number || p.phone_numbers?.[0] || null;
  const org = p.organization || {};
  return {
    apollo_id: p.id,
    first_name: p.first_name || null,
    last_name: p.last_name || null,
    name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
    title: p.title || null,
    email: p.email || null,
    phone: phone || null,
    company_name: org.name || p.organization_name || null,
    company_website: org.website_url || null,
    company_industry: org.industry || null,
    company_employees: org.estimated_num_employees || null,
    company_revenue: org.annual_revenue ? String(org.annual_revenue) : null,
    linkedin_url: p.linkedin_url || null,
  };
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run() {
  console.log(`Fetching wave ${WAVE} candidates...`);
  const stats = await queueApi({ action: 'candidate-stats' });
  console.log(`Pool: ${stats.total} total, ${stats.released} released, ${stats.enqueued} enqueued`);

  // Fetch all released but unenriched candidates for this wave.
  const data = await queueApi({ action: 'candidate-list', wave: WAVE, includeEnqueued: false, waveSize: 5000 });
  const candidates = (data.candidates || []).filter((c) => !c.email);
  console.log(`${candidates.length} candidates to enrich in wave ${WAVE}`);

  if (!candidates.length) { console.log('Nothing to enrich.'); return; }

  let totalEnriched = 0;
  let totalPromoted = 0;
  let totalNoEmail = 0;
  const batches = Math.ceil(candidates.length / BATCH_SIZE);

  for (let b = 0; b < batches; b++) {
    const batch = candidates.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    const people = batch.map((c) => ({ id: c.apollo_id, first_name: c.first_name, last_name: c.last_name, organization_name: c.company_name }));

    let matched;
    try {
      matched = await apolloBulkMatch(people);
    } catch (err) {
      console.error(`Batch ${b + 1}/${batches} match failed: ${err.message}`);
      await sleep(2000);
      continue;
    }

    const matches = matched.matches || matched.people || [];
    const enriched = matches.map(extractContact).filter((c) => c && c.email);
    totalNoEmail += batch.length - enriched.length;
    totalEnriched += enriched.length;

    process.stderr.write(`Batch ${b + 1}/${batches}: ${enriched.length}/${batch.length} with email\n`);

    if (enriched.length && !DRY_RUN) {
      try {
        const r = await queueApi({ action: 'enrich-wave', contacts: enriched });
        totalPromoted += r.promoted || 0;
      } catch (err) {
        console.error(`Batch ${b + 1} enrich-wave failed: ${err.message}`);
      }
    }

    // Polite pacing: stay within Apollo rate limits.
    if (b < batches - 1) await sleep(350);
  }

  console.log(JSON.stringify({ wave: WAVE, enriched: totalEnriched, promoted: totalPromoted, noEmail: totalNoEmail, dryRun: DRY_RUN }, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
