/**
 * One-shot: moves UK mobile numbers from phone→direct_phone in the DB,
 * then re-fetches the org/office phone for those contacts from Apollo.
 */
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const QUEUE_AUTH = process.env.QUEUE_AUTH;
const API_BASE = process.env.API_BASE || 'https://ghl-pillar.vercel.app';

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
  if (!res.ok) return null;
  const d = await res.json().catch(() => null);
  return d?.person || null;
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run() {
  // Step 1: Move mobiles to direct_phone in DB.
  const moved = await queueApi({ action: 'fix-mobile-phones' });
  console.log(`Moved ${moved.moved} mobile numbers to direct_phone:`, moved.leads);

  if (!moved.moved) { console.log('Nothing to fix.'); return; }

  // Step 2: Fetch all leads that now have no office phone (were set to NULL).
  const data = await fetch(`${API_BASE}/api/apollo-sales-queue?source=outbound`, {
    headers: { 'x-queue-auth': QUEUE_AUTH },
  }).then((r) => r.json());

  const needOrgPhone = (data.contacts || []).filter((c) => c.apolloId && !c.phone && c.directPhone);
  console.log(`${needOrgPhone.length} leads need org phone re-fetched`);

  const updates = [];
  for (const lead of needOrgPhone) {
    const p = await apolloMatch(lead.apolloId);
    const orgPhone = p?.organization?.phone || p?.organization?.primary_phone?.number || null;
    if (orgPhone) updates.push({ id: lead.id, phone: orgPhone });
    await sleep(300);
  }

  if (updates.length) {
    const r = await queueApi({ action: 'patch-phones-force', updates });
    console.log(`Restored org phone for ${r.patched} leads`);
  }

  console.log('Done. Sample check:');
  const check = await fetch(`${API_BASE}/api/apollo-sales-queue?source=outbound`, {
    headers: { 'x-queue-auth': QUEUE_AUTH },
  }).then((r) => r.json());
  const withBoth = (check.contacts || []).filter((c) => c.phone && c.directPhone);
  console.log(`Leads with BOTH phones: ${withBoth.length}`);
  console.log(JSON.stringify(withBoth.slice(0, 3).map((c) => ({ name: c.name, direct: c.directPhone, office: c.phone })), null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
