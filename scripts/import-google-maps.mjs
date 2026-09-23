/**
 * Import Google Maps leads from a CSV or JSON file into the sales queue.
 *
 * Usage:
 *   DATABASE_URL="..." node scripts/import-google-maps.mjs leads.csv
 *   DATABASE_URL="..." node scripts/import-google-maps.mjs leads.csv --import
 *   DATABASE_URL="..." node scripts/import-google-maps.mjs leads.json --import --sector="Healthcare" --sub-sector="Private Dentists"
 *
 * Flags:
 *   (no flag)       Dry run — shows what would be imported, nothing is written
 *   --import        Write to the database
 *   --sector=X      Tag all imported leads with this sector
 *   --sub-sector=X  Tag all imported leads with this sub-sector
 *
 * Accepted CSV/JSON field names (first match wins, case-insensitive):
 *   Company name  → name | title | business_name | company_name | company
 *   Phone         → phone | phone_number | phoneNumber | formatted_phone_number | telephone
 *   Website       → website | url | site | websiteUrl | web
 *   Sector        → category | sector (unless overridden by --sector)
 *
 * Leads without a phone AND without a website are skipped (no dedup key).
 * A lead is also skipped if its phone/domain already exists in queue_leads.
 * Email is not required and is left NULL (Google Maps does not supply emails).
 *
 * Get DATABASE_URL:
 *   npx vercel env pull .env.local   (then read DATABASE_URL from .env.local)
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { randomInt } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { parse } from 'csv-parse/sync';

// ── Config ────────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('\nDATABASE_URL is not set.');
  console.error('Run:  npx vercel env pull .env.local  then re-run with  DATABASE_URL=$(grep DATABASE_URL .env.local | cut -d= -f2-) node scripts/import-google-maps.mjs ...\n');
  process.exit(1);
}

const ROUND_ROBIN = [
  { name: 'Brendon Mwatsenekenyi', id: '6FX5X4kH2JFJc6u9zhSC' },
  { name: 'Zain Safir-Sheikh',     id: 'XbyxbOK1Q1raRCjjGx4O' },
];
const BATCH_SIZE = 500;
const PREVIEW_LIMIT = 20;

const args      = process.argv.slice(2);
const filePath  = args.find((a) => !a.startsWith('--'));
const doImport  = args.includes('--import');
const sector    = (args.find((a) => a.startsWith('--sector=')) ?? '').replace('--sector=', '').trim() || null;
const subSector = (args.find((a) => a.startsWith('--sub-sector=')) ?? '').replace('--sub-sector=', '').trim() || null;

if (!filePath) {
  console.error('\nUsage: node scripts/import-google-maps.mjs <file.csv|file.json> [--import] [--sector=X] [--sub-sector=X]\n');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick(obj, ...keys) {
  for (const key of keys) {
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === key.toLowerCase() && obj[k] != null) {
        const val = String(obj[k]).trim();
        // Google Maps exports use the literal string "null" for missing values.
        if (val && val.toLowerCase() !== 'null') return val;
      }
    }
  }
  return null;
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-9) : null;
}

function websiteDomain(raw) {
  if (!raw) return null;
  try {
    const host = new URL(String(raw).includes('://') ? raw : `https://${raw}`).hostname;
    return host.toLowerCase().replace(/^www\./, '').trim() || null;
  } catch {
    return String(raw).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim() || null;
  }
}

function normalizeWebsite(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.startsWith('http') ? s : `https://${s}`;
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// ── Parse input ───────────────────────────────────────────────────────────────

let rows;
try {
  const input = readFileSync(filePath, 'utf8');
  if (extname(filePath).toLowerCase() === '.csv') {
    rows = parse(input, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });
  } else {
    const raw = JSON.parse(input);
    rows = Array.isArray(raw) ? raw : (raw.results ?? raw.data ?? raw.places ?? Object.values(raw));
  }
} catch (err) {
  console.error(`\nCould not read / parse ${filePath}: ${err.message}\n`);
  process.exit(1);
}

if (!rows.length) { console.error('\nNo records found in the input file.\n'); process.exit(1); }

// Detect field names from the first record and print them so the user can verify
console.log(`\nDetected fields in first record: ${Object.keys(rows[0]).join(', ')}\n`);

const leads = rows.map((row) => ({
  company_name:     pick(row, 'name', 'title', 'business_name', 'company_name', 'company'),
  phone:            pick(row, 'phone', 'phone_number', 'phoneNumber', 'formatted_phone_number', 'telephone'),
  company_website:  pick(row, 'website', 'url', 'site', 'websiteUrl', 'web'),
  sector:            sector || pick(row, 'category', 'sector') || 'Uncategorised',
  sub_sector:        subSector,
  raw:              row,
})).filter((l) => l.company_name);

// ── Dedup against existing DB ─────────────────────────────────────────────────

const sql = neon(DATABASE_URL);

console.log(`Records in file:   ${rows.length}`);
console.log(`With company name: ${leads.length}`);
if (sector)    console.log(`Sector override:   ${sector}`);
if (subSector) console.log(`Sub-sector:        ${subSector}`);
console.log(`Mode:              ${doImport ? 'IMPORT (writing to DB)' : 'DRY RUN (no writes)'}\n`);

// Fetch existing phone last-9 digits and domains so we can dedup in-memory
const existingPhones = new Set(
  (await sql`SELECT RIGHT(regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g'), 9) AS p FROM queue_leads WHERE archived_at IS NULL AND phone IS NOT NULL`)
    .map((r) => r.p).filter(Boolean)
);
const existingDomains = new Set(
  (await sql`SELECT LOWER(regexp_replace(COALESCE(company_website,''), '^https?://(www\\.)?', '')) AS d FROM queue_leads WHERE archived_at IS NULL AND company_website IS NOT NULL`)
    .map((r) => r.d.split('/')[0]).filter(Boolean)
);

// ── Plan: categorise each lead ────────────────────────────────────────────────

const toInsert = [];
const skipped  = [];
const batchPhones  = new Set();
const batchDomains = new Set();

for (const lead of leads) {
  const normPhone  = normalizePhone(lead.phone);
  const domain     = websiteDomain(lead.company_website);

  if (!normPhone && !domain) {
    skipped.push({ ...lead, reason: 'no phone or website (no dedup key)' });
    continue;
  }
  if (normPhone && existingPhones.has(normPhone)) {
    skipped.push({ ...lead, reason: `phone ${normPhone} already in queue` });
    continue;
  }
  if (domain && existingDomains.has(domain)) {
    skipped.push({ ...lead, reason: `domain ${domain} already in queue` });
    continue;
  }
  if (normPhone && batchPhones.has(normPhone)) {
    skipped.push({ ...lead, reason: `duplicate phone ${normPhone} within file` });
    continue;
  }
  if (domain && batchDomains.has(domain)) {
    skipped.push({ ...lead, reason: `duplicate domain ${domain} within file` });
    continue;
  }
  if (normPhone) batchPhones.add(normPhone);
  if (domain) batchDomains.add(domain);
  toInsert.push({ ...lead, _normPhone: normPhone, _domain: domain });
}

shuffle(toInsert);
const assignmentOffset = randomInt(ROUND_ROBIN.length);
const assignedRep = (index) => ROUND_ROBIN[(index + assignmentOffset) % ROUND_ROBIN.length];

// ── Preview ───────────────────────────────────────────────────────────────────

console.log(`Will insert: ${toInsert.length}   Skipped: ${skipped.length}\n`);

const missingSectorCount = toInsert.filter((lead) => !lead.sector).length;
const sectorCounts = new Map();
for (const lead of toInsert) {
  const key = lead.sector || 'Uncategorised';
  sectorCounts.set(key, (sectorCounts.get(key) || 0) + 1);
}
const assignmentCounts = Object.fromEntries(ROUND_ROBIN.map((rep) => [rep.name, 0]));
toInsert.forEach((_lead, index) => { assignmentCounts[assignedRep(index).name] += 1; });
console.log(`Sector categories: ${sectorCounts.size}   Missing sector: ${missingSectorCount}`);
for (const [name, count] of Object.entries(assignmentCounts)) console.log(`Assigned to ${name}: ${count}`);
console.log('');

if (toInsert.length) {
  const colW = [40, 20, 35, 8];
  const head = ['Company', 'Phone', 'Website', 'Rep'].map((h, i) => h.padEnd(colW[i])).join('  ');
  console.log(head);
  console.log('─'.repeat(head.length));
  toInsert.slice(0, PREVIEW_LIMIT).forEach((l, idx) => {
    const rep = assignedRep(idx);
    const cols = [
      (l.company_name ?? '').slice(0, 38).padEnd(colW[0]),
      (l.phone ?? '—').slice(0, 18).padEnd(colW[1]),
      (l.company_website ?? '—').slice(0, 33).padEnd(colW[2]),
      rep.name.split(' ')[0].padEnd(colW[3]),
    ];
    console.log(cols.join('  '));
  });
  if (toInsert.length > PREVIEW_LIMIT) console.log(`… ${toInsert.length - PREVIEW_LIMIT} more leads not shown`);
}

if (skipped.length) {
  const skippedByReason = new Map();
  for (const lead of skipped) {
    const reason = String(lead.reason || 'unknown').replace(/ (\d{7,}|[^ ]+\.[a-z]{2,}) .*/, ' duplicate already in queue');
    skippedByReason.set(reason, (skippedByReason.get(reason) || 0) + 1);
  }
  console.log(`\nSkipped (${skipped.length}) by reason:`);
  for (const [reason, count] of skippedByReason) console.log(`  ${count} — ${reason}`);
}

// ── Insert ────────────────────────────────────────────────────────────────────

if (!doImport) {
  console.log('\n── Dry run complete. Pass --import to write to the database. ──\n');
  process.exit(0);
}

if (!toInsert.length) {
  console.log('\nNothing new to import.\n');
  process.exit(0);
}

console.log(`\nInserting ${toInsert.length} leads in batches of ${BATCH_SIZE}…`);
let inserted = 0;
let failed   = 0;

for (let offset = 0; offset < toInsert.length; offset += BATCH_SIZE) {
  const batch = toInsert.slice(offset, offset + BATCH_SIZE).map((lead, batchIndex) => {
    const rep = assignedRep(offset + batchIndex);
    return {
      company_name: lead.company_name,
      phone: lead.phone ?? null,
      company_website: normalizeWebsite(lead.company_website),
      owner: rep.name,
      owner_id: rep.id,
      sector: lead.sector,
      sub_sector: lead.sub_sector,
      raw: lead.raw,
      sort_seed: randomInt(2_000_000_000),
    };
  });
  try {
    await sql`
      INSERT INTO queue_leads (
        company_name, phone, company_website,
        source, status, priority,
        owner, owner_id, sector, sub_sector,
        raw, last_touch_at, sort_seed
      )
      SELECT
        payload.company_name,
        payload.phone,
        payload.company_website,
        'google_maps',
        'to_contact',
        'cold',
        payload.owner,
        payload.owner_id,
        payload.sector,
        payload.sub_sector,
        payload.raw,
        now(),
        payload.sort_seed
      FROM json_to_recordset(${JSON.stringify(batch)}::json) AS payload(
        company_name text,
        phone text,
        company_website text,
        owner text,
        owner_id text,
        sector text,
        sub_sector text,
        raw jsonb,
        sort_seed integer
      )
    `;
    inserted += batch.length;
    console.log(`  Inserted ${inserted}/${toInsert.length}`);
  } catch (err) {
    console.error(`  Batch ${Math.floor(offset / BATCH_SIZE) + 1} failed (${batch.length} leads): ${err.message}`);
    failed += batch.length;
  }
}

console.log(`\nDone. Inserted: ${inserted}  Failed: ${failed}\n`);
