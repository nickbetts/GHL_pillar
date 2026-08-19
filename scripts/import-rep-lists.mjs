/**
 * Import three Apollo "v3" contact lists into the sales-queue board, each list
 * pinned to a single rep via forced_owner_id (no round-robin, no company match).
 *
 * Reads SAVED contacts from Apollo by list id — this does NOT spend enrichment
 * credits and does NOT call people/match. Only the company office number
 * (account.phone) is used, matching the office-only policy elsewhere.
 *
 * Contacts without an email are skipped (email is the queue's unique key).
 *
 * Usage:
 *   APOLLO_API_KEY=... QUEUE_AUTH=... \
 *   API_BASE=https://ghl-pillar.vercel.app node scripts/import-rep-lists.mjs
 *
 * Set DRY_RUN=1 to pull + count only (no enqueue push).
 */

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const QUEUE_AUTH = process.env.QUEUE_AUTH;
const API_BASE = process.env.API_BASE || 'https://ghl-pillar.vercel.app';
const DRY_RUN = process.env.DRY_RUN === '1';
const PER_PAGE = 100;
const PUSH_CHUNK = 200;

const APOLLO_CONTACTS_SEARCH = 'https://api.apollo.io/api/v1/contacts/search';

if (!APOLLO_API_KEY) { console.error('APOLLO_API_KEY missing'); process.exit(1); }
if (!DRY_RUN && !QUEUE_AUTH) { console.error('QUEUE_AUTH missing (or set DRY_RUN=1)'); process.exit(1); }

// list id -> { rep name, GHL owner id } (owner ids from ROUND_ROBIN in api/apollo-sales-queue.js)
const LISTS = [
  { name: 'Brendon v3', listId: '6a85641923d6980018324055', ownerId: '6FX5X4kH2JFJc6u9zhSC', ownerName: 'Brendon Mwatsenekenyi' },
  { name: 'Amir v3',    listId: '6a856473eabfa6000c48aa95', ownerId: 's7OG2BM94q7uNRsHLqM7', ownerName: 'Amir Ward' },
  { name: 'Zain v3',    listId: '6a85658ed5b7ec001b223a3e', ownerId: 'XbyxbOK1Q1raRCjjGx4O', ownerName: 'Zain Safir-Sheikh' },
];

async function apolloContactsPage(listId, page) {
  const res = await fetch(APOLLO_CONTACTS_SEARCH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
    body: JSON.stringify({ label_ids: [listId], page, per_page: PER_PAGE }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Apollo contacts/search HTTP ${res.status} – ${body.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => ({}));
  const contacts = data?.contacts ?? [];
  const pagination = data?.pagination ?? {};
  return { contacts, totalPages: pagination.total_pages ?? 1 };
}

async function pullList(listId) {
  const all = [];
  let page = 1;
  let totalPages = 1;
  do {
    const { contacts, totalPages: tp } = await apolloContactsPage(listId, page);
    totalPages = tp;
    all.push(...contacts);
    page += 1;
  } while (page <= totalPages);
  return all;
}

// Shape a saved contact into the minimal payload normalizeContact() understands.
// Company data lives under `account`; expose it as `organization` for the office phone/website.
function toQueuePayload(c) {
  const account = c.account || {};
  return {
    id: c.id,
    first_name: c.first_name || null,
    last_name: c.last_name || null,
    name: c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
    title: c.title || null,
    email: c.email || null,
    linkedin_url: c.linkedin_url || null,
    organization: {
      name: account.name || c.organization_name || null,
      phone: account.phone || account.primary_phone?.number || null,
      primary_phone: account.primary_phone || null,
      website_url: account.website_url || null,
      primary_domain: account.primary_domain || account.domain || null,
      domain: account.domain || null,
      estimated_num_employees: account.estimated_num_employees ?? null,
      annual_revenue: account.annual_revenue ?? null,
      industry: account.industry || null,
    },
  };
}

async function enqueueChunk(contacts, ownerId) {
  const res = await fetch(`${API_BASE}/api/apollo-sales-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-queue-auth': QUEUE_AUTH },
    body: JSON.stringify({ action: 'enqueue', forced_owner_id: ownerId, contacts }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(`enqueue HTTP ${res.status} – ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.inserted || 0;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  console.log(`API_BASE = ${API_BASE}${DRY_RUN ? '  (DRY RUN)' : ''}\n`);
  let grandInserted = 0;
  let grandNoEmail = 0;

  for (const list of LISTS) {
    process.stdout.write(`▶ ${list.name} → ${list.ownerName} … pulling`);
    const raw = await pullList(list.listId);
    const withEmail = raw.filter((c) => c.email);
    const noEmail = raw.length - withEmail.length;
    grandNoEmail += noEmail;
    console.log(` ${raw.length} contacts (${withEmail.length} with email, ${noEmail} skipped no-email)`);

    if (DRY_RUN) continue;

    const payloads = withEmail.map(toQueuePayload);
    let inserted = 0;
    for (const part of chunk(payloads, PUSH_CHUNK)) {
      inserted += await enqueueChunk(part, list.ownerId);
    }
    grandInserted += inserted;
    console.log(`  ✔ enqueued ${inserted} to ${list.ownerName}\n`);
  }

  console.log('──────────────────────────────────────────');
  console.log(`Total enqueued: ${grandInserted}`);
  console.log(`Skipped (no email): ${grandNoEmail}`);
}

main().catch((err) => { console.error('\nImport failed:', err.message); process.exit(1); });
