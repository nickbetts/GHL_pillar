/**
 * Definitive phone pass for all outbound leads. Per contact, one Apollo call:
 *   - reveal_phone_number:true + webhook → Apollo async-delivers the sanitized
 *     DIRECT DIAL to /api/apollo-phones (written to direct_phone).
 *   - organization.primary_phone.number (sync) → written to phone (office line).
 * De-dupes so we never show the same number twice.
 *
 * Usage:
 *   APOLLO_API_KEY=... QUEUE_AUTH=... API_BASE=https://ghl-pillar.vercel.app \
 *   node scripts/phones-final.mjs
 */
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const QUEUE_AUTH = process.env.QUEUE_AUTH;
const API_BASE = process.env.API_BASE || 'https://ghl-pillar.vercel.app';
const WEBHOOK_URL = `${API_BASE}/api/apollo-phones`;
const CONCURRENCY = 6;
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

async function apolloReveal(apolloId) {
  const res = await fetch('https://api.apollo.io/api/v1/people/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
    body: JSON.stringify({
      id: apolloId,
      reveal_personal_emails: false,
      reveal_phone_number: true,
      webhook_url: WEBHOOK_URL,
    }),
  });
  if (res.status === 429) throw new Error('RATE_LIMIT');
  if (!res.ok) return null;
  const d = await res.json().catch(() => null);
  return d?.person || null;
}

const digits = (n) => (n || '').replace(/\D/g, '');
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run() {
  const data = await fetch(`${API_BASE}/api/apollo-sales-queue?source=outbound`, {
    headers: { 'x-queue-auth': QUEUE_AUTH },
  }).then((r) => r.json());

  const leads = (data.contacts || []).filter((c) => c.apolloId);
  console.log(`Processing ${leads.length} leads (org phone sync + direct dial via webhook)`);

  let officeSet = 0;
  let directSyncHits = 0;
  const totalBatches = Math.ceil(leads.length / CONCURRENCY);

  for (let b = 0; b < totalBatches; b++) {
    const batch = leads.slice(b * CONCURRENCY, (b + 1) * CONCURRENCY);

    const results = await Promise.all(batch.map(async (lead) => {
      let p;
      try {
        p = await apolloReveal(lead.apolloId);
      } catch (err) {
        if (err.message === 'RATE_LIMIT') { await sleep(10000); try { p = await apolloReveal(lead.apolloId); } catch { return null; } }
        else return null;
      }
      if (!p) return null;
      const orgPhone = p.organization?.primary_phone?.number || p.organization?.phone || null;
      const directSync = p.sanitized_phone || null; // usually null; webhook delivers async
      if (directSync) directSyncHits++;
      // Office phone only if it differs from any direct dial we have.
      const office = (orgPhone && digits(orgPhone) !== digits(directSync) && digits(orgPhone) !== digits(lead.directPhone)) ? orgPhone : null;
      return { id: lead.id, phone: office, direct_phone: directSync || undefined };
    }));

    const updates = results.filter((r) => r && (r.phone || r.direct_phone));
    if (updates.length) {
      // Use patch-phones-force so we fill without wiping existing direct dials.
      const r = await queueApi({ action: 'patch-phones-force', updates });
      officeSet += r.patched || 0;
    }

    process.stderr.write(`Batch ${b + 1}/${totalBatches} done\n`);
    if (b < totalBatches - 1) await sleep(BATCH_PAUSE_MS);
  }

  // Final dedupe pass.
  const dd = await queueApi({ action: 'dedupe-phones' });

  const check = await fetch(`${API_BASE}/api/apollo-sales-queue?source=outbound`, {
    headers: { 'x-queue-auth': QUEUE_AUTH },
  }).then((r) => r.json());
  const withDirect = (check.contacts || []).filter((c) => c.directPhone).length;
  const withOffice = (check.contacts || []).filter((c) => c.phone).length;

  console.log(JSON.stringify({ directSyncHits, deduped: dd.deduped, withDirect, withOffice, total: check.contacts.length }, null, 2));
  console.log('Direct dials also arrive async via webhook over the next few minutes.');
}

run().catch((e) => { console.error(e); process.exit(1); });
