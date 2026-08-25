/**
 * Pull enrich-ready candidates from Apollo (free People Search, no credits)
 * and bank them into the queue_candidates pool via the deployed API.
 *
 * No enrichment happens here. We only store the Apollo person id + light
 * context (name, title, company, sector) so nothing is lost. Enrichment
 * (email + phone, ~9 credits each) happens later, wave by wave.
 *
 * Usage:
 *   APOLLO_API_KEY=... QUEUE_AUTH=... \
 *   API_BASE=https://ghl-pillar.vercel.app node scripts/pull-candidates.mjs
 *
 * Optional: pass a sector name as arg to pull just one sector.
 */

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const QUEUE_AUTH = process.env.QUEUE_AUTH;
const API_BASE = process.env.API_BASE || 'https://ghl-pillar.vercel.app';
const APOLLO_URL = 'https://api.apollo.io/api/v1/mixed_people/api_search';

if (!APOLLO_API_KEY) { console.error('APOLLO_API_KEY missing'); process.exit(1); }
if (!QUEUE_AUTH) { console.error('QUEUE_AUTH missing'); process.exit(1); }

// Band is configurable so we can merge multiple filter bands into one pool.
// tier 1 = tighter best-fit band (worked first); tier 2 = wider backup band.
const TIER = Number.parseInt(process.env.BAND_TIER || '1', 10);
const EMP_RANGES = (process.env.BAND_EMP || '1,10').split(';');
const REV_MIN = Number.parseInt(process.env.BAND_REV_MIN || '100000', 10);
const REV_MAX = Number.parseInt(process.env.BAND_REV_MAX || '2000000', 10);
const ONLY_SUBSECTOR = process.env.ONLY_SUBSECTOR || null;
const MAX_CANDIDATES = Number.parseInt(process.env.MAX_CANDIDATES || '0', 10);
const REQUIRE_CONTACT_DATA = process.env.REQUIRE_CONTACT_DATA !== '0';

const BASE_FILTER = {
  person_seniorities: ['owner', 'founder', 'c_suite', 'partner', 'director', 'head'],
  organization_num_employees_ranges: EMP_RANGES,
  revenue_range: { min: REV_MIN, max: REV_MAX },
  person_locations: ['United Kingdom'],
};

const SECTORS = {
  'E-Commerce': {
    'Fashion & Apparel': ['fashion', 'apparel'],
    'Home Wear': ['homeware', 'home decor', 'home furnishings', 'interior accessories', 'furniture', 'gifts', 'housewares', 'kitchenware', 'interiors', 'decor', 'lighting', 'soft furnishings', 'bathroom', 'kitchen', 'retail', 'ecommerce'],
    'Luxury Accessories / Goods': ['luxury goods', 'luxury accessories'],
  },
  'Professional Services': {
    'Financial Advisers / Wealth Managers': ['financial advisers', 'wealth management'],
    'Family Law / Claims': ['family law', 'claims management'],
    'Consultancies': ['consulting', 'consultancy'],
    'Accountants / Firms': ['accounting', 'accountants'],
    'Architects': ['architecture', 'architects'],
  },
  'Security': {
    'Security Consultancy & Risk Management': ['security consulting', 'security consultancy', 'risk management'],
    'CCTV': ['cctv', 'video surveillance'],
  },
  'Healthcare': {
    'Private Dentists': ['dental', 'dentist'],
    'Cosmetic Clinics': ['cosmetic clinic', 'aesthetics', 'medical aesthetics'],
    'Physiotherapy': ['physiotherapy', 'physical therapy'],
    'Fertility Clinics': ['fertility', 'ivf'],
    'Hearing Care': ['hearing care', 'audiology', 'hearing aids'],
  },
  'Transport & Logistics': {
    'Removals': ['removals', 'moving company', 'house removals'],
    'Fleet Management': ['fleet management'],
    'Heavy Haulage': ['haulage', 'heavy haulage', 'freight'],
  },
};

function classifyPriority(title) {
  const t = String(title || '').toLowerCase();
  if (/vp|director|head|chief|founder|owner|president|partner|ceo|cto|cfo|cmo|managing/.test(t)) return 'hot';
  if (/manager|lead|principal|consultant/.test(t)) return 'warm';
  return 'cold';
}

async function apolloPage(tags, page) {
  const res = await fetch(APOLLO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
    body: JSON.stringify({ ...BASE_FILTER, q_organization_keyword_tags: tags, page, per_page: 100 }),
  });
  if (!res.ok) throw new Error(`Apollo HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

async function bank(candidates) {
  const res = await fetch(`${API_BASE}/api/apollo-sales-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-queue-auth': QUEUE_AUTH },
    body: JSON.stringify({ action: 'bank-candidates', candidates }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(`Bank failed HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.inserted || 0;
}

function toCandidate(p, sector, subSector) {
  const org = p.organization || {};
  const contact = p.contact || {};
  const cleanLast = typeof p.last_name === 'string' && !p.last_name.includes('*') ? p.last_name : null;
  return {
    apollo_id: p.id,
    first_name: p.first_name || null,
    last_name: cleanLast,
    name: [p.first_name, cleanLast].filter(Boolean).join(' ') || p.first_name || null,
    title: p.title || null,
    email: p.email || contact.email || null,
    phone: p.phone || p.phone_number || contact.phone || contact.phone_number || null,
    company_name: org.name || null,
    company_domain: org.primary_domain || null,
    company_website: org.website_url || null,
    sector,
    sub_sector: subSector,
    priority: classifyPriority(p.title),
    has_email: p.has_email === true,
    has_phone: p.has_direct_phone === 'Yes',
    tier: TIER,
  };
}

async function run() {
  const onlySector = process.argv[2] || null;
  const seen = new Set();
  let grandBanked = 0;
  const summary = {};

  for (const [sector, subs] of Object.entries(SECTORS)) {
    if (onlySector && sector !== onlySector) continue;
    summary[sector] = {};

    for (const [subSector, tags] of Object.entries(subs)) {
      if (ONLY_SUBSECTOR && subSector !== ONLY_SUBSECTOR) continue;
      if (MAX_CANDIDATES > 0 && grandBanked >= MAX_CANDIDATES) break;
      const first = await apolloPage(tags, 1);
      const total = first?.pagination?.total_entries ?? first?.total_entries ?? 0;
      const pages = Math.min(Math.max(1, Math.ceil(total / 100)), 500);
      let readyBatch = [];
      let subBanked = 0;

      const collect = (people) => {
        for (const p of people || []) {
          if (MAX_CANDIDATES > 0 && seen.size >= MAX_CANDIDATES) break;
          const hasContactData = p.has_email === true && p.has_direct_phone === 'Yes';
          if ((!REQUIRE_CONTACT_DATA || hasContactData) && p.id && !seen.has(p.id)) {
            seen.add(p.id);
            readyBatch.push(toCandidate(p, sector, subSector));
          }
        }
      };

      collect(first.people);
      for (let page = 2; page <= pages; page++) {
        if (MAX_CANDIDATES > 0 && seen.size >= MAX_CANDIDATES) break;
        if (readyBatch.length >= 100) {
          subBanked += await bank(readyBatch.splice(0, readyBatch.length));
        }
        const d = await apolloPage(tags, page);
        collect(d.people);
      }
      if (readyBatch.length) subBanked += await bank(readyBatch.splice(0, readyBatch.length));
      if (MAX_CANDIDATES > 0 && subBanked > MAX_CANDIDATES - grandBanked) {
        subBanked = MAX_CANDIDATES - grandBanked;
      }

      summary[sector][subSector] = subBanked;
      grandBanked += subBanked;
      process.stderr.write(`banked ${sector} :: ${subSector} = ${subBanked} (gross ${total})\n`);
    }
  }

  console.log(JSON.stringify({ grandBanked, summary }, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
