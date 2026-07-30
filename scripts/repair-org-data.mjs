/**
 * Back-fill org data (website, employees, revenue, linkedin, phone) for all
 * outbound leads that are missing any of these fields. One people/match call
 * per lead — no additional credit cost over what was already spent.
 *
 * Usage:
 *   APOLLO_API_KEY=... QUEUE_AUTH=... API_BASE=https://ghl-pillar.vercel.app \
 *   node scripts/repair-org-data.mjs
 */

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const QUEUE_AUTH = process.env.QUEUE_AUTH;
const API_BASE = process.env.API_BASE || 'https://ghl-pillar.vercel.app';
const CONCURRENCY = 8;
const BATCH_PAUSE_MS = 600;

if (!APOLLO_API_KEY) { console.error('APOLLO_API_KEY missing'); process.exit(1); }
if (!QUEUE_AUTH) { console.error('QUEUE_AUTH missing'); process.exit(1); }

async function queueApi(payload) {
  const res = await fetch(`${API_BASE}/api/apollo-sales-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-queue-auth': QUEUE_AUTH },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(`Queue ${payload.action}: HTTP ${res.status} – ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function apolloMatch(apolloId) {
  const res = await fetch('https://api.apollo.io/api/v1/people/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
    body: JSON.stringify({ id: apolloId, reveal_personal_emails: false }),
  });
  if (res.status === 429) throw new Error('RATE_LIMIT');
  if (!res.ok) return null;
  const d = await res.json().catch(() => null);
  return d?.person || null;
}

function extractOrgFields(p) {
  if (!p) return null;
  const org = p.organization || {};
  const phone =
    p.sanitized_phone || p.direct_dial_phone ||
    p.phone_numbers?.find((n) => n.type === 'work_direct')?.raw_number ||
    p.phone_numbers?.[0]?.raw_number ||
    (typeof p.phone_numbers?.[0] === 'string' ? p.phone_numbers[0] : null) ||
    org.phone || org.primary_phone?.number || null;
  const revenue = org.annual_revenue != null ? String(Math.round(org.annual_revenue)) : null;
  return {
    phone,
    company_website: org.website_url || null,
    company_employees: org.estimated_num_employees || null,
    company_revenue: revenue,
    linkedin_url: p.linkedin_url || null,
  };
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run() {
  const data = await fetch(`${API_BASE}/api/apollo-sales-queue?source=outbound`, {
    headers: { 'x-queue-auth': QUEUE_AUTH },
  }).then((r) => r.json());

  const needs = (data.contacts || []).filter(
    (c) => c.apolloId && (!c.companyWebsite || !c.companyEmployees || !c.companyRevenue)
  );
  console.log(`${needs.length} leads need org data`);
  if (!needs.length) { console.log('Nothing to do.'); return; }

  let patched = 0;
  let noData = 0;
  const totalBatches = Math.ceil(needs.length / CONCURRENCY);

  for (let b = 0; b < totalBatches; b++) {
    const batch = needs.slice(b * CONCURRENCY, (b + 1) * CONCURRENCY);

    const results = await Promise.all(batch.map(async (lead) => {
      try {
        const p = await apolloMatch(lead.apolloId);
        const fields = extractOrgFields(p);
        return fields ? { id: lead.id, ...fields } : null;
      } catch (err) {
        if (err.message === 'RATE_LIMIT') {
          process.stderr.write('Rate limited — pausing 10s\n');
          await sleep(10000);
          try {
            const p = await apolloMatch(lead.apolloId);
            const fields = extractOrgFields(p);
            return fields ? { id: lead.id, ...fields } : null;
          } catch { return null; }
        }
        return null;
      }
    }));

    const updates = results.filter(Boolean);
    noData += batch.length - updates.length;
    process.stderr.write(`Batch ${b + 1}/${totalBatches}: ${updates.length}/${batch.length} enriched\n`);

    if (updates.length) {
      const r = await queueApi({ action: 'patch-lead-fields', updates });
      patched += r.patched || 0;
    }

    if (b < totalBatches - 1) await sleep(BATCH_PAUSE_MS);
  }

  console.log(JSON.stringify({ patched, noData }));
}

run().catch((e) => { console.error(e); process.exit(1); });
