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
const QUEUE_AUTH = process.env.QUEUE_AUTH || process.env.QUEUE_PASSWORD;
const API_BASE = process.env.API_BASE || 'https://ghl-pillar.vercel.app';
const DRY_RUN = process.env.DRY_RUN === '1';
const PER_PAGE = 100;
const PUSH_CHUNK = 200;

const APOLLO_CONTACTS_SEARCH = 'https://api.apollo.io/api/v1/contacts/search';

if (!APOLLO_API_KEY) { console.error('APOLLO_API_KEY missing'); process.exit(1); }
if (!DRY_RUN && !QUEUE_AUTH) { console.error('QUEUE_AUTH / QUEUE_PASSWORD missing (or set DRY_RUN=1)'); process.exit(1); }

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

// Official NAICS 2-digit sector titles (industry classification, zero credits).
const NAICS_SECTOR = {
  '11': 'Agriculture, Forestry, Fishing & Hunting',
  '21': 'Mining, Quarrying & Oil/Gas Extraction',
  '22': 'Utilities',
  '23': 'Construction',
  '31': 'Manufacturing', '32': 'Manufacturing', '33': 'Manufacturing',
  '42': 'Wholesale Trade',
  '44': 'Retail Trade', '45': 'Retail Trade',
  '48': 'Transportation & Warehousing', '49': 'Transportation & Warehousing',
  '51': 'Information',
  '52': 'Finance & Insurance',
  '53': 'Real Estate & Rental/Leasing',
  '54': 'Professional, Scientific & Technical Services',
  '55': 'Management of Companies & Enterprises',
  '56': 'Administrative, Support & Waste Services',
  '61': 'Educational Services',
  '62': 'Health Care & Social Assistance',
  '71': 'Arts, Entertainment & Recreation',
  '72': 'Accommodation & Food Services',
  '81': 'Other Services',
  '92': 'Public Administration',
};

// Compact NAICS 3-digit subsector titles for the codes common to these lists;
// falls back to the 2-digit sector name when a code is not listed.
const NAICS_SUBSECTOR = {
  '236': 'Construction of Buildings', '237': 'Heavy & Civil Engineering Construction', '238': 'Specialty Trade Contractors',
  '311': 'Food Manufacturing', '313': 'Textile Mills', '314': 'Textile Product Mills', '315': 'Apparel Manufacturing',
  '321': 'Wood Product Manufacturing', '323': 'Printing & Related Support', '325': 'Chemical Manufacturing',
  '327': 'Nonmetallic Mineral Product Mfg', '332': 'Fabricated Metal Product Mfg', '333': 'Machinery Manufacturing',
  '335': 'Electrical Equipment Mfg', '337': 'Furniture & Related Product Mfg', '339': 'Miscellaneous Manufacturing',
  '423': 'Merchant Wholesalers, Durable Goods', '424': 'Merchant Wholesalers, Nondurable Goods', '425': 'Wholesale Electronic Markets',
  '441': 'Motor Vehicle & Parts Dealers', '444': 'Building Material & Garden Dealers', '445': 'Food & Beverage Retailers',
  '448': 'Clothing & Accessories Retailers', '451': 'Sporting Goods & Hobby Retailers', '452': 'General Merchandise Retailers',
  '453': 'Miscellaneous Retailers', '454': 'Nonstore (Online) Retailers',
  '484': 'Truck Transportation', '488': 'Support Activities for Transportation', '492': 'Couriers & Messengers', '493': 'Warehousing & Storage',
  '511': 'Publishing Industries', '518': 'Data Processing & Hosting', '519': 'Other Information Services',
  '522': 'Credit Intermediation', '523': 'Securities & Investments', '524': 'Insurance Carriers',
  '531': 'Real Estate', '532': 'Rental & Leasing Services',
  '541': 'Professional, Scientific & Technical Services',
  '561': 'Administrative & Support Services', '562': 'Waste Management & Remediation',
  '611': 'Educational Services',
  '621': 'Ambulatory Health Care Services', '622': 'Hospitals', '623': 'Nursing & Residential Care', '624': 'Social Assistance',
  '711': 'Performing Arts & Spectator Sports', '713': 'Amusement, Gambling & Recreation',
  '721': 'Accommodation', '722': 'Food Services & Drinking Places',
  '811': 'Repair & Maintenance', '812': 'Personal & Laundry Services', '813': 'Membership Organizations',
};

function primaryNaics(codes) {
  if (!Array.isArray(codes)) return null;
  const first = codes.map((c) => String(c || '').replace(/\D/g, '')).find((c) => c.length >= 2);
  return first || null;
}

function naicsSector(codes) {
  const n = primaryNaics(codes);
  if (!n) return null;
  return NAICS_SECTOR[n.slice(0, 2)] || null;
}

function naicsSubsector(codes) {
  const n = primaryNaics(codes);
  if (!n) return null;
  return NAICS_SUBSECTOR[n.slice(0, 3)] || NAICS_SECTOR[n.slice(0, 2)] || null;
}

// Shape a saved contact into the minimal payload normalizeContact() understands.
// Company data lives under `account`/`organization`; expose it as `organization`
// for the office phone/website, and derive industry+sector from NAICS (no credits).
function toQueuePayload(c) {
  const account = c.account || {};
  const org = c.organization || {};
  const naics = (account.naics_codes && account.naics_codes.length ? account.naics_codes : org.naics_codes) || [];
  const sector = naicsSector(naics);
  const subSector = naicsSubsector(naics);
  return {
    id: c.id,
    first_name: c.first_name || null,
    last_name: c.last_name || null,
    name: c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
    title: c.title || null,
    email: c.email || null,
    linkedin_url: c.linkedin_url || null,
    sector,
    sub_sector: subSector,
    organization: {
      name: account.name || org.name || c.organization_name || null,
      phone: account.phone || account.primary_phone?.number || org.phone || org.primary_phone?.number || null,
      primary_phone: account.primary_phone || org.primary_phone || null,
      website_url: account.website_url || org.website_url || null,
      primary_domain: account.primary_domain || account.domain || org.primary_domain || org.domain || null,
      domain: account.domain || org.domain || null,
      estimated_num_employees: account.estimated_num_employees ?? org.estimated_num_employees ?? null,
      annual_revenue: account.annual_revenue ?? org.annual_revenue ?? null,
      industry: sector,
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

    const payloads = withEmail.map(toQueuePayload);

    const sectorCounts = {};
    for (const p of payloads) {
      const s = p.sector || 'Unknown';
      sectorCounts[s] = (sectorCounts[s] || 0) + 1;
    }
    const sectorSummary = Object.entries(sectorCounts).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}: ${n}`).join(', ');
    console.log(`  sectors → ${sectorSummary}`);

    if (DRY_RUN) continue;
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
