/**
 * Trigger Apollo direct-dial reveal for all outbound leads.
 * Uses reveal_phone_number:true with our webhook URL so Apollo delivers
 * numbers async to /api/apollo-phones as it finds them.
 * Falls back to org phone if direct dial isn't in Apollo's database.
 *
 * Usage:
 *   APOLLO_API_KEY=... QUEUE_AUTH=... API_BASE=https://ghl-pillar.vercel.app \
 *   node scripts/reveal-phones.mjs
 */

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const QUEUE_AUTH = process.env.QUEUE_AUTH;
const API_BASE = process.env.API_BASE || 'https://ghl-pillar.vercel.app';
const WEBHOOK_URL = `${API_BASE}/api/apollo-phones`;
const CONCURRENCY = 5;
const BATCH_PAUSE_MS = 700;

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

async function revealPhone(apolloId) {
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
  const data = await res.json().catch(() => null);
  const p = data?.person;
  if (!p) return null;
  // Return synchronous phone if Apollo had it cached; otherwise webhook delivers it.
  return (
    p.sanitized_phone ||
    p.phone_numbers?.find((n) => n.type === 'work_direct')?.raw_number ||
    p.phone_numbers?.[0]?.raw_number ||
    null
  );
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run() {
  const data = await fetch(`${API_BASE}/api/apollo-sales-queue?source=outbound`, {
    headers: { 'x-queue-auth': QUEUE_AUTH },
  }).then((r) => r.json());

  // Process all leads with an apolloId — we want direct dial where possible.
  const leads = (data.contacts || []).filter((c) => c.apolloId);
  console.log(`Triggering direct-dial reveal for ${leads.length} leads`);
  console.log(`Webhook: ${WEBHOOK_URL}`);

  let triggered = 0;
  let syncPatched = 0;
  const totalBatches = Math.ceil(leads.length / CONCURRENCY);
  const syncUpdates = [];

  for (let b = 0; b < totalBatches; b++) {
    const batch = leads.slice(b * CONCURRENCY, (b + 1) * CONCURRENCY);

    const results = await Promise.all(batch.map(async (lead) => {
      try {
        const phone = await revealPhone(lead.apolloId);
        triggered++;
        return phone ? { id: lead.id, phone } : null;
      } catch (err) {
        if (err.message === 'RATE_LIMIT') {
          process.stderr.write('Rate limited — pausing 10s\n');
          await sleep(10000);
          try {
            const phone = await revealPhone(lead.apolloId);
            triggered++;
            return phone ? { id: lead.id, phone } : null;
          } catch { return null; }
        }
        return null;
      }
    }));

    const sync = results.filter(Boolean);
    syncUpdates.push(...sync);

    process.stderr.write(`Batch ${b + 1}/${totalBatches}: ${sync.length} sync, ${batch.length - sync.length} queued for webhook\n`);

    // Flush sync updates in batches of 50.
    if (syncUpdates.length >= 50) {
      const flush = syncUpdates.splice(0, syncUpdates.length);
      const r = await queueApi({ action: 'patch-lead-fields', updates: flush });
      syncPatched += r.patched || 0;
    }

    if (b < totalBatches - 1) await sleep(BATCH_PAUSE_MS);
  }

  // Final flush of any remaining sync results.
  if (syncUpdates.length) {
    const r = await queueApi({ action: 'patch-lead-fields', updates: syncUpdates });
    syncPatched += r.patched || 0;
  }

  console.log(JSON.stringify({ triggered, syncPatched, asyncViaWebhook: triggered - syncPatched }));
  console.log('Apollo will POST direct dials to', WEBHOOK_URL, 'as they are resolved.');
}

run().catch((e) => { console.error(e); process.exit(1); });
