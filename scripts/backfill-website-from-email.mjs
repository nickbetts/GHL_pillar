/**
 * Backfill queue_leads.company_website for HS/PD (and any active lead with no
 * website but a corporate email). Skips personal / free-mail / ISP mailboxes
 * so we don't stamp @gmail.com or @btinternet.com onto a company card.
 *
 * Only touches rows where company_website IS NULL and archived_at IS NULL.
 * By default limits to source='hs_pd'; pass --all to hit every active source.
 *
 * Usage:
 *   DATABASE_URL="..." node scripts/backfill-website-from-email.mjs             # dry-run HS/PD only
 *   DATABASE_URL="..." node scripts/backfill-website-from-email.mjs --apply     # writes
 *   DATABASE_URL="..." node scripts/backfill-website-from-email.mjs --all       # dry-run every source
 *   DATABASE_URL="..." node scripts/backfill-website-from-email.mjs --all --apply
 */

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set.'); process.exit(1); }
const apply = process.argv.includes('--apply');
const scopeAll = process.argv.includes('--all');
const sql = neon(DATABASE_URL);

// Personal / free / ISP mailboxes — a domain here is NEVER the company's website.
const PERSONAL_DOMAINS = new Set([
  'gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','ymail.com','rocketmail.com',
  'hotmail.com','hotmail.co.uk','outlook.com','live.com','live.co.uk','msn.com',
  'aol.com','aol.co.uk','icloud.com','me.com','mac.com',
  'btinternet.com','btconnect.com','btopenworld.com','sky.com','virginmedia.com','virgin.net',
  'talktalk.net','tiscali.co.uk','ntlworld.com','blueyonder.co.uk','o2.co.uk',
  'protonmail.com','proton.me','tutamail.com','tutanota.com','fastmail.com',
  'gmx.com','gmx.co.uk','gmx.de','mail.com','email.com','inbox.com',
  'nhs.net','nhs.uk',
]);

function normalizeDomain(raw) {
  if (!raw) return null;
  const d = String(raw).toLowerCase().trim();
  if (!d.includes('.')) return null;
  return d;
}

const scopeLabel = scopeAll ? 'ALL sources' : "source='hs_pd'";
console.log(`Scope: ${scopeLabel}`);
console.log(`Mode:  ${apply ? '⚠️  APPLY (writing company_website)' : 'DRY RUN'}\n`);

const rows = scopeAll
  ? await sql`
      SELECT id, email
      FROM queue_leads
      WHERE archived_at IS NULL
        AND (company_website IS NULL OR company_website = '')
        AND email IS NOT NULL
    `
  : await sql`
      SELECT id, email
      FROM queue_leads
      WHERE archived_at IS NULL
        AND source = 'hs_pd'
        AND (company_website IS NULL OR company_website = '')
        AND email IS NOT NULL
    `;

const updates = [];
const skipped = { personal: 0, malformed: 0 };
for (const row of rows) {
  const at = String(row.email || '').indexOf('@');
  if (at < 0) { skipped.malformed++; continue; }
  const domain = normalizeDomain(String(row.email).slice(at + 1));
  if (!domain) { skipped.malformed++; continue; }
  if (PERSONAL_DOMAINS.has(domain)) { skipped.personal++; continue; }
  updates.push({ id: row.id, website: `https://${domain}` });
}

console.log(`Candidates: ${rows.length}`);
console.log(`  Will backfill:  ${updates.length}`);
console.log(`  Skip (personal): ${skipped.personal}`);
console.log(`  Skip (malformed): ${skipped.malformed}\n`);

if (!apply) {
  console.log('Sample of first 5 planned updates:');
  for (const u of updates.slice(0, 5)) console.log(`  id=${u.id}  →  ${u.website}`);
  console.log('\n── Dry run only. Re-run with --apply to write. ──');
  process.exit(0);
}

let done = 0;
for (const u of updates) {
  await sql`UPDATE queue_leads SET company_website = ${u.website} WHERE id = ${u.id} AND (company_website IS NULL OR company_website = '')`;
  done++;
  if (done % 500 === 0) console.log(`  … ${done}/${updates.length}`);
}
console.log(`\n✓ Backfilled ${done} rows.`);
