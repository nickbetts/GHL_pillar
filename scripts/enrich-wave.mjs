/**
 * Enrich a released wave: call Apollo people/match by ID to reveal emails,
 * then push each enriched contact into the outbound queue via enrich-wave.
 *
 * Usage:
 *   APOLLO_API_KEY=... QUEUE_AUTH=... \
 *   API_BASE=https://ghl-pillar.vercel.app \
 *   node scripts/enrich-wave.mjs [wave_number]
 *
 * Set DRY_RUN=1 to skip the enrich-wave push (just count what we'd get).
 */

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const QUEUE_AUTH = process.env.QUEUE_AUTH;
const API_BASE = process.env.API_BASE || 'https://ghl-pillar.vercel.app';
const WAVE = Number.parseInt(process.argv[2] || '1', 10);
const DRY_RUN = process.env.DRY_RUN === '1';
const INCLUDE_ENQUEUED = process.env.INCLUDE_ENQUEUED === '1';
const REFRESH_MASKED = process.env.REFRESH_MASKED === '1';
const CONCURRENCY = 5;
const BATCH_PAUSE_MS = 800;

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

async function apolloMatchById(apolloId) {
  const res = await fetch('https://api.apollo.io/api/v1/people/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
    body: JSON.stringify({ id: apolloId, reveal_personal_emails: false }),
  });
  if (res.status === 429) throw new Error('RATE_LIMIT');
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.person || null;
}

function extractContact(p) {
  if (!p?.id || !p?.email) return null;
  // Office/company number only: never use direct-dial/sanitized personal numbers.
  const orgPhone = p.organization?.phone || p.organization?.primary_phone?.number || null;
  const org = p.organization || {};
  return {
    apollo_id: p.id,
    first_name: p.first_name || null,
    last_name: p.last_name || null,
    name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
    title: p.title || null,
    email: p.email,
    phone: orgPhone || null,
    company_name: org.name || p.organization_name || null,
    company_website: org.website_url || null,
    company_industry: org.industry || null,
    company_employees: org.estimated_num_employees || null,
    company_revenue: org.annual_revenue ? String(org.annual_revenue) : null,
    linkedin_url: p.linkedin_url || null,
  };
}

function hasMaskedName(candidate) {
  const name = String(candidate?.name || '');
  const last = String(candidate?.last_name || candidate?.lastName || '');
  return name.includes('*') || last.includes('*');
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run() {
  console.log(`Fetching wave ${WAVE} candidates...`);
  const stats = await queueApi({ action: 'candidate-stats' });
  console.log(`Pool: ${stats.total} total, ${stats.released} released, ${stats.enqueued} enqueued`);

  const data = await queueApi({ action: 'candidate-list', wave: WAVE, includeEnqueued: INCLUDE_ENQUEUED, waveSize: 1111 });
  let candidates = (data.candidates || []).filter((c) => {
    if (REFRESH_MASKED) return !c.email || !c.phone || hasMaskedName(c);
    return true;
  });
  const MAX_ENRICH = Number.parseInt(process.env.APOLLO_MAX_ENRICH || '0', 10);
  if (MAX_ENRICH > 0 && candidates.length > MAX_ENRICH) {
    console.log(`Budget guard: capping ${candidates.length} → ${MAX_ENRICH} candidates (APOLLO_MAX_ENRICH)`);
    candidates = candidates.slice(0, MAX_ENRICH);
  }
  console.log(`${candidates.length} candidates to enrich in wave ${WAVE} (includeEnqueued=${INCLUDE_ENQUEUED}, refreshMasked=${REFRESH_MASKED})`);

  if (!candidates.length) { console.log('Nothing to enrich.'); return; }

  let totalEnriched = 0;
  let totalPromoted = 0;
  let totalNoEmail = 0;
  const totalBatches = Math.ceil(candidates.length / CONCURRENCY);

  for (let b = 0; b < totalBatches; b++) {
    const batch = candidates.slice(b * CONCURRENCY, (b + 1) * CONCURRENCY);

    const results = await Promise.all(batch.map(async (c) => {
      if (!c.apollo_id) return null;
      try {
        return { person: await apolloMatchById(c.apollo_id), candidate: c };
      } catch (err) {
        if (err.message === 'RATE_LIMIT') {
          process.stderr.write('Rate limited — pausing 10s\n');
          await sleep(10000);
          try { return { person: await apolloMatchById(c.apollo_id), candidate: c }; } catch { return null; }
        }
        return null;
      }
    }));

    // Merge Apollo-revealed fields with candidate metadata (sector, sub-sector, company fallbacks).
    const enriched = results.map((r) => {
      if (!r) return null;
      const contact = extractContact(r.person);
      if (!contact) return null;
      const cand = r.candidate;
      return {
        ...contact,
        company_name: contact.company_name || cand.company_name || null,
        company_website: contact.company_website || cand.company_website || null,
        company_employees: contact.company_employees || cand.company_employees || null,
        company_revenue: contact.company_revenue || cand.company_revenue || null,
        company_industry: contact.company_industry || cand.company_industry || null,
        linkedin_url: contact.linkedin_url || cand.linkedin_url || null,
        sector: cand.sector || null,
        sub_sector: cand.sub_sector || null,
        priority: cand.priority || contact.priority || 'warm',
      };
    }).filter(Boolean);
    totalNoEmail += batch.length - enriched.length;
    totalEnriched += enriched.length;

    process.stderr.write(`Batch ${b + 1}/${totalBatches}: ${enriched.length}/${batch.length} with email\n`);

    if (enriched.length && !DRY_RUN) {
      try {
        const r = await queueApi({ action: 'enrich-wave', contacts: enriched });
        totalPromoted += r.promoted || 0;
      } catch (err) {
        console.error(`Batch ${b + 1} enrich-wave failed: ${err.message}`);
      }
    }

    if (b < totalBatches - 1) await sleep(BATCH_PAUSE_MS);
  }

  console.log(JSON.stringify({ wave: WAVE, enriched: totalEnriched, promoted: totalPromoted, noEmail: totalNoEmail, includeEnqueued: INCLUDE_ENQUEUED, refreshMasked: REFRESH_MASKED, dryRun: DRY_RUN }, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
