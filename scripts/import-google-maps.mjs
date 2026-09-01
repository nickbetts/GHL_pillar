/**
 * Import Google Maps leads from a JSON file into the sales queue.
 *
 * Usage:
 *   DATABASE_URL="..." node scripts/import-google-maps.mjs leads.json
 *   DATABASE_URL="..." node scripts/import-google-maps.mjs leads.json --import
 *   DATABASE_URL="..." node scripts/import-google-maps.mjs leads.json --import --sector="Healthcare" --sub-sector="Private Dentists"
 *
 * Flags:
 *   (no flag)       Dry run — shows what would be imported, nothing is written
 *   --import        Write to the database
 *   --sector=X      Tag all imported leads with this sector
 *   --sub-sector=X  Tag all imported leads with this sub-sector
 *
 * Accepted JSON field names (first match wins, case-insensitive):
 *   Company name  → name | title | business_name | company_name | company
 *   Phone         → phone | phone_number | phoneNumber | formatted_phone_number | telephone
 *   Website       → website | url | site | websiteUrl | web
 *
 * Leads without a phone AND without a website are skipped (no dedup key).
 * A lead is also skipped if its phone/domain already exists in queue_leads.
 * Email is not required and is left NULL (Google Maps does not supply emails).
 *
 * Get DATABASE_URL:
 *   npx vercel env pull .env.local   (then read DATABASE_URL from .env.local)
 */

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

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
  { name: 'Amir Ward',             id: 's7OG2BM94q7uNRsHLqM7' },
];

const args      = process.argv.slice(2);
const filePath  = args.find((a) => !a.startsWith('--'));
const doImport  = args.includes('--import');
const sector    = (args.find((a) => a.startsWith('--sector=')) ?? '').replace('--sector=', '').trim() || null;
const subSector = (args.find((a) => a.startsWith('--sub-sector=')) ?? '').replace('--sub-sector=', '').trim() || null;

if (!filePath) {
  console.error('\nUsage: node scripts/import-google-maps.mjs <file.json> [--import] [--sector=X] [--sub-sector=X]\n');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick(obj, ...keys) {
  for (const key of keys) {
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === key.toLowerCase() && obj[k] != null && String(obj[k]).trim()) {
        return String(obj[k]).trim();
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

// ── Parse input ───────────────────────────────────────────────────────────────

let raw;
try {
  raw = JSON.parse(readFileSync(filePath, 'utf8'));
} catch (err) {
  console.error(`\nCould not read / parse ${filePath}: ${err.message}\n`);
  process.exit(1);
}

const rows = Array.isArray(raw) ? raw : (raw.results ?? raw.data ?? raw.places ?? Object.values(raw));
if (!rows.length) { console.error('\nNo records found in the JSON file.\n'); process.exit(1); }

// Detect field names from the first record and print them so the user can verify
console.log(`\nDetected fields in first record: ${Object.keys(rows[0]).join(', ')}\n`);

const leads = rows.map((row) => ({
  company_name:     pick(row, 'name', 'title', 'business_name', 'company_name', 'company'),
  phone:            pick(row, 'phone', 'phone_number', 'phoneNumber', 'formatted_phone_number', 'telephone'),
  company_website:  pick(row, 'website', 'url', 'site', 'websiteUrl', 'web'),
  raw:              row,
})).filter((l) => l.company_name);

// ── Dedup against existing DB ─────────────────────────────────────────────────

const sql = neon(DATABASE_URL);

console.log(`Records in file:   ${rows.length}`);
console.log(`With company name: ${leads.length}`);
if (sector)    console.log(`Sector:            ${sector}`);
if (subSector) console.log(`Sub-sector:        ${subSector}`);
console.log(`Mode:              ${doImport ? '⚠️  IMPORT (writing to DB)' : 'DRY RUN (no writes)'}\n`);

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
  toInsert.push({ ...lead, _normPhone: normPhone, _domain: domain });
}

// ── Preview ───────────────────────────────────────────────────────────────────

console.log(`Will insert: ${toInsert.length}   Skipped: ${skipped.length}\n`);

if (toInsert.length) {
  const colW = [40, 20, 35, 8];
  const head = ['Company', 'Phone', 'Website', 'Rep'].map((h, i) => h.padEnd(colW[i])).join('  ');
  console.log(head);
  console.log('─'.repeat(head.length));
  toInsert.forEach((l, idx) => {
    const rep = ROUND_ROBIN[idx % ROUND_ROBIN.length];
    const cols = [
      (l.company_name ?? '').slice(0, 38).padEnd(colW[0]),
      (l.phone ?? '—').slice(0, 18).padEnd(colW[1]),
      (l.company_website ?? '—').slice(0, 33).padEnd(colW[2]),
      rep.name.split(' ')[0].padEnd(colW[3]),
    ];
    console.log(cols.join('  '));
  });
}

if (skipped.length) {
  console.log(`\nSkipped (${skipped.length}):`);
  skipped.forEach((l) => console.log(`  ✗ ${l.company_name ?? '(no name)'}  — ${l.reason}`));
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

console.log(`\nInserting ${toInsert.length} leads…`);
let inserted = 0;
let failed   = 0;

for (let i = 0; i < toInsert.length; i++) {
  const lead = toInsert[i];
  const rep  = ROUND_ROBIN[i % ROUND_ROBIN.length];
  try {
    await sql`
      INSERT INTO queue_leads (
        company_name, phone, company_website,
        source, status, priority,
        owner, owner_id, sector, sub_sector,
        raw, last_touch_at
      ) VALUES (
        ${lead.company_name},
        ${lead.phone ?? null},
        ${normalizeWebsite(lead.company_website)},
        ${'google_maps'},
        ${'to_contact'},
        ${'cold'},
        ${rep.name},
        ${rep.id},
        ${sector},
        ${subSector},
        ${JSON.stringify(lead.raw)},
        ${new Date().toISOString()}
      )
    `;
    inserted++;
  } catch (err) {
    console.error(`  ✗ Failed: ${lead.company_name} — ${err.message}`);
    failed++;
  }
}

console.log(`\n✓ Done. Inserted: ${inserted}  Failed: ${failed}\n`);
