/**
 * Import legacy CRM (HS/PD re-engagement) contacts into the sales-queue board.
 *
 * Assignment rules (per Nick, 2026-09):
 *   - Rows where CSV Owner == "Zain Sheikh" → Zain (owner_id XbyxbOK1Q1raRCjjGx4O)
 *   - Rows where CSV Owner == "Brendon Mwatsenekenyi" → Brendon (owner_id 6FX5X4kH2JFJc6u9zhSC)
 *   - Everything else (blank, deactivated users, other names) → distributed across all 3 reps
 *     so the FINAL totals per rep are as equal as possible.
 *
 * All inserts are tagged:
 *   source = 'hs_pd'  (drives the "HS/PD" badge on the queue card)
 *   tags   = ['CRM Imports', 'HS/PD']
 *   status = 'to_contact'
 *   priority = 'cold'
 *
 * Card field mapping (so the queue card shows every detail we have):
 *   Name          → name / first_name / last_name (card headline)
 *   Job Title     → title (card sub-line)
 *   Company       → company_name (card sub-line) + company_website when the
 *                    Company cell is a URL. If Company is blank we fall back to
 *                    the email domain so the card still shows something usable.
 *   Phone         → direct_phone when it's a UK mobile (07…), else phone
 *                    (office). Drives the green Call / blue Office button.
 *   Email         → email (enables the "Email lead" action)
 *
 * Dedup (skip, do NOT overwrite) — includes archived rows so we don't hit the
 * queue_leads.email UNIQUE constraint on rows we archived earlier:
 *   - email already in queue_leads.email (case-insensitive, any archived state)
 *   - phone or direct_phone last-9 digits already in queue_leads
 *   - within-batch duplicates on email or phone
 *
 * Usage:
 *   DATABASE_URL="..." node scripts/import-crm-hspd.mjs "legacy crm imports/master_reengagement_enriched.csv"
 *   DATABASE_URL="..." node scripts/import-crm-hspd.mjs "legacy crm imports/master_reengagement_enriched.csv" --import
 *
 * Get DATABASE_URL:
 *   npx vercel env pull .env.local
 *   DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') node scripts/import-crm-hspd.mjs ...
 */

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('\nDATABASE_URL is not set.');
  console.error('Run:  npx vercel env pull .env.local  then re-run with  DATABASE_URL=$(grep DATABASE_URL .env.local | cut -d= -f2-) node scripts/import-crm-hspd.mjs ...\n');
  process.exit(1);
}

const REPS = {
  brendon: { name: 'Brendon Mwatsenekenyi', id: '6FX5X4kH2JFJc6u9zhSC' },
  zain:    { name: 'Zain Safir-Sheikh',     id: 'XbyxbOK1Q1raRCjjGx4O' },
  amir:    { name: 'Amir Ward',             id: 's7OG2BM94q7uNRsHLqM7' },
};

const SOURCE_SLUG = 'hs_pd';
const TAGS = ['CRM Imports', 'HS/PD'];

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith('--'));
const doImport = args.includes('--import');

if (!filePath) {
  console.error('\nUsage: node scripts/import-crm-hspd.mjs <file.csv> [--import]\n');
  process.exit(1);
}

// ── CSV parsing (RFC-4180, handles quoted fields with commas + escaped quotes) ─
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip */ }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c && c.trim())).map((r) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    return obj;
  });
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-9) : null;
}

// UK mobile detection — Apollo/legacy exports store numbers as +44 7…, 07…, or 447…
function isUkMobile(raw) {
  if (!raw) return false;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return false;
  if (digits.startsWith('447')) return true;
  if (digits.startsWith('44') && digits.length >= 12 && digits[2] === '7') return true;
  if (digits.startsWith('07')) return true;
  return false;
}

function splitName(fullName) {
  const cleaned = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return { name: null, firstName: null, lastName: null };
  const lc = cleaned.toLowerCase();
  if (lc === 'na' || lc === 'n/a' || lc === '.' || lc === '?') {
    return { name: null, firstName: null, lastName: null };
  }
  const parts = cleaned.split(' ');
  return {
    name: cleaned,
    firstName: parts[0] || null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

function normalizeWebsite(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (!s.includes('.') && !s.includes('/')) return null;
    return `https://${s.replace(/^\/+/, '')}`;
  }
  return s;
}

// Pull a bare hostname from any URL-ish string (for company_name fallback).
function hostOf(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    return (u.hostname || '').toLowerCase().replace(/^www\./, '') || null;
  } catch { return null; }
}

function cleanEmail(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

function classifyCsvOwner(rawOwner) {
  const raw = String(rawOwner || '').trim();
  if (/^Zain Sheikh$/i.test(raw)) return 'zain';
  if (/^Brendon Mwatsenekenyi$/i.test(raw)) return 'brendon';
  return 'other';
}

// ── Load + parse the CSV ─────────────────────────────────────────────────────
let text;
try { text = readFileSync(filePath, 'utf8'); }
catch (err) { console.error(`\nCould not read ${filePath}: ${err.message}\n`); process.exit(1); }

const rawRows = parseCsv(text);
if (!rawRows.length) { console.error('\nNo records found in the CSV.\n'); process.exit(1); }

console.log(`\nDetected columns: ${Object.keys(rawRows[0]).join(', ')}\n`);

// Bucket by owner classification and expose everything needed for insert.
const byBucket = { zain: [], brendon: [], other: [] };
for (const row of rawRows) {
  const bucket = classifyCsvOwner(row.Owner);
  const nameParts = splitName(row.Name);
  const emailLower = cleanEmail(row.Email);

  const rawPhone = (row.Phone || '').trim() || null;
  const phoneNorm = normalizePhone(rawPhone);
  const isMobile = isUkMobile(rawPhone);
  const directPhone = isMobile ? rawPhone : null;
  const officePhone = isMobile ? null : rawPhone;

  // "Company" cell is either a plain name or a URL — split them so the card
  // gets a real company name AND a usable website button.
  const rawCompany = (row.Company || '').trim() || null;
  const cellIsUrl = rawCompany && /^https?:\/\//i.test(rawCompany);
  const website = cellIsUrl ? normalizeWebsite(rawCompany) : null;
  let companyName = cellIsUrl ? null : rawCompany;
  if (!companyName) {
    const host = hostOf(rawCompany) || (emailLower ? emailLower.split('@')[1] : null);
    if (host) companyName = host.replace(/\.(co\.uk|com|net|org|io|uk)$/i, '');
  }

  byBucket[bucket].push({
    bucket,
    csvOwner: (row.Owner || '').trim() || null,
    name: nameParts.name,
    firstName: nameParts.firstName,
    lastName: nameParts.lastName,
    title: (row['Job Title'] || '').trim() || null,
    email: emailLower,
    emailLower,
    phone: officePhone,
    directPhone,
    phoneNorm,
    companyName,
    companyWebsite: website,
    raw: row,
  });
}

const totals = {
  total: rawRows.length,
  zain: byBucket.zain.length,
  brendon: byBucket.brendon.length,
  other: byBucket.other.length,
};

console.log(`Rows in file:                  ${totals.total}`);
console.log(`  Zain Sheikh (auto-assign):   ${totals.zain}`);
console.log(`  Brendon (auto-assign):       ${totals.brendon}`);
console.log(`  Others (split across reps):  ${totals.other}`);
console.log(`Mode:                          ${doImport ? '⚠️  IMPORT (writing to DB)' : 'DRY RUN (no writes)'}\n`);

// ── Dedup against DB + within-batch ──────────────────────────────────────────
const sql = neon(DATABASE_URL);

console.log('Fetching existing dedup keys from queue_leads…');
// Include archived rows: queue_leads.email is UNIQUE across the whole table,
// so re-inserting an archived email still throws.
const existingEmails = new Set(
  (await sql`SELECT LOWER(email) AS e FROM queue_leads WHERE email IS NOT NULL`)
    .map((r) => r.e).filter(Boolean)
);
const existingPhones = new Set([
  ...(await sql`SELECT RIGHT(regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g'), 9) AS p FROM queue_leads WHERE phone IS NOT NULL AND archived_at IS NULL`).map((r) => r.p),
  ...(await sql`SELECT RIGHT(regexp_replace(COALESCE(direct_phone,''), '[^0-9]', '', 'g'), 9) AS p FROM queue_leads WHERE direct_phone IS NOT NULL AND archived_at IS NULL`).map((r) => r.p),
].filter(Boolean));
console.log(`  ${existingEmails.size} unique existing emails (incl. archived)`);
console.log(`  ${existingPhones.size} unique existing phones (office + direct, last 9)\n`);

const batchEmails = new Set();
const batchPhones = new Set();

function filterBucket(rows) {
  const kept = [];
  const skipped = { email_db: 0, phone_db: 0, email_batch: 0, phone_batch: 0, no_key: 0 };
  for (const r of rows) {
    if (!r.emailLower && !r.phoneNorm) { skipped.no_key++; continue; }
    if (r.emailLower && existingEmails.has(r.emailLower)) { skipped.email_db++; continue; }
    if (r.phoneNorm && existingPhones.has(r.phoneNorm))   { skipped.phone_db++; continue; }
    if (r.emailLower && batchEmails.has(r.emailLower))    { skipped.email_batch++; continue; }
    if (r.phoneNorm && batchPhones.has(r.phoneNorm))      { skipped.phone_batch++; continue; }
    if (r.emailLower) batchEmails.add(r.emailLower);
    if (r.phoneNorm) batchPhones.add(r.phoneNorm);
    kept.push(r);
  }
  return { kept, skipped };
}

const zainFiltered = filterBucket(byBucket.zain);
const brendonFiltered = filterBucket(byBucket.brendon);
const otherFiltered = filterBucket(byBucket.other);

function fmtSkip(s) {
  return `email_dup(db):${s.email_db}  phone_dup(db):${s.phone_db}  email_dup(batch):${s.email_batch}  phone_dup(batch):${s.phone_batch}  no_key:${s.no_key}`;
}
console.log('Dedup results:');
console.log(`  Zain    kept ${zainFiltered.kept.length} / ${byBucket.zain.length}    (${fmtSkip(zainFiltered.skipped)})`);
console.log(`  Brendon kept ${brendonFiltered.kept.length} / ${byBucket.brendon.length}    (${fmtSkip(brendonFiltered.skipped)})`);
console.log(`  Other   kept ${otherFiltered.kept.length} / ${byBucket.other.length}    (${fmtSkip(otherFiltered.skipped)})\n`);

// ── Compute the "others" split so final totals equalise ──────────────────────
const zainOwn = zainFiltered.kept.length;
const brendonOwn = brendonFiltered.kept.length;
const othersPool = otherFiltered.kept.length;
const grandTotal = zainOwn + brendonOwn + othersPool;
const target = Math.floor(grandTotal / 3);
const overflow = grandTotal - target * 3; // 0, 1, or 2

// Give overflow to reps with the smallest "own" bucket first so nobody undershoots by 2.
const initialQuotas = [
  { key: 'amir',    own: 0,          gets: Math.max(0, target - 0) },
  { key: 'brendon', own: brendonOwn, gets: Math.max(0, target - brendonOwn) },
  { key: 'zain',    own: zainOwn,    gets: Math.max(0, target - zainOwn) },
];
// If any rep is already OVER the target (unlikely here — Zain has 1,433 which is < 3,210), they get 0 extra.
let quotaSum = initialQuotas.reduce((s, q) => s + q.gets, 0);
let leftover = othersPool - quotaSum;
// Distribute leftover (from overflow and from any rep whose own > target) round-robin, Amir first.
const distributionOrder = ['amir', 'brendon', 'zain'];
let dIdx = 0;
while (leftover > 0) {
  initialQuotas.find((q) => q.key === distributionOrder[dIdx % 3]).gets += 1;
  leftover--; dIdx++;
}

const otherQuota = Object.fromEntries(initialQuotas.map((q) => [q.key, q.gets]));

console.log('Planned final totals (post-dedup):');
console.log(`  Amir:    ${otherQuota.amir} from others                = ${otherQuota.amir}`);
console.log(`  Brendon: ${brendonOwn} own + ${otherQuota.brendon} others    = ${brendonOwn + otherQuota.brendon}`);
console.log(`  Zain:    ${zainOwn} own + ${otherQuota.zain} others = ${zainOwn + otherQuota.zain}`);
console.log(`  TOTAL to insert: ${grandTotal}\n`);

// Deterministic order for the "others" pool (stable across dry-run + import).
const otherOrdered = otherFiltered.kept.slice();
const assigned = [];
for (const row of zainFiltered.kept)    assigned.push({ ...row, rep: REPS.zain });
for (const row of brendonFiltered.kept) assigned.push({ ...row, rep: REPS.brendon });

let cursor = 0;
for (const key of ['amir', 'brendon', 'zain']) {
  const rep = REPS[key];
  const take = otherOrdered.slice(cursor, cursor + otherQuota[key]);
  cursor += otherQuota[key];
  for (const row of take) assigned.push({ ...row, rep });
}

// ── Preview first / last 5 per rep ───────────────────────────────────────────
function sample(rep) {
  const list = assigned.filter((a) => a.rep.id === rep.id);
  console.log(`  ${rep.name} (${list.length}): first 3 → ${list.slice(0, 3).map((r) => r.name || r.companyName || r.email || '(?)').join(' | ') || '—'}`);
}
console.log('Sample assignments:');
sample(REPS.zain);
sample(REPS.brendon);
sample(REPS.amir);
console.log('');

if (!doImport) {
  console.log('── Dry run complete. Pass --import to write to the database. ──\n');
  process.exit(0);
}

// ── Insert ───────────────────────────────────────────────────────────────────
console.log(`Inserting ${assigned.length} leads…`);
const nowIso = new Date().toISOString();
let inserted = 0;
let failed = 0;
const errors = [];

for (let i = 0; i < assigned.length; i++) {
  const lead = assigned[i];
  try {
    await sql`
      INSERT INTO queue_leads (
        first_name, last_name, name, title,
        email, phone, direct_phone, company_name, company_website,
        source, tags, status, priority,
        owner, owner_id,
        raw, last_touch_at
      ) VALUES (
        ${lead.firstName},
        ${lead.lastName},
        ${lead.name},
        ${lead.title},
        ${lead.email},
        ${lead.phone},
        ${lead.directPhone},
        ${lead.companyName},
        ${lead.companyWebsite},
        ${SOURCE_SLUG},
        ${TAGS},
        ${'to_contact'},
        ${'cold'},
        ${lead.rep.name},
        ${lead.rep.id},
        ${JSON.stringify({ csv_owner: lead.csvOwner, csv_row: lead.raw, import: 'crm-hspd-2026-09' })},
        ${nowIso}
      )
    `;
    inserted++;
    if (inserted % 500 === 0) console.log(`  … ${inserted}/${assigned.length}`);
  } catch (err) {
    failed++;
    if (errors.length < 20) errors.push(`${lead.email || lead.phone || lead.companyName}: ${err.message}`);
  }
}

console.log(`\n✓ Done. Inserted: ${inserted}   Failed: ${failed}`);
if (errors.length) {
  console.log('\nFirst errors:');
  for (const e of errors) console.log(`  ${e}`);
}
console.log('');
