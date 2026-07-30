#!/usr/bin/env node

/**
 * Wave preflight quality gate for outbound release/enrich operations.
 *
 * Usage:
 *   QUEUE_AUTH=... API_BASE=https://ghl-pillar.vercel.app npm run wave:preflight
 *
 * Optional thresholds:
 *   MAX_NO_NUMBER=0
 *   MAX_SPLIT_COMPANIES=0
 *   MAX_GHL_LINKED=0
 */

const QUEUE_AUTH = process.env.QUEUE_AUTH;
const API_BASE = (process.env.API_BASE || 'https://ghl-pillar.vercel.app').replace(/\/$/, '');

const MAX_NO_NUMBER = Number.parseInt(process.env.MAX_NO_NUMBER || '0', 10);
const MAX_SPLIT_COMPANIES = Number.parseInt(process.env.MAX_SPLIT_COMPANIES || '0', 10);
const MAX_GHL_LINKED = Number.parseInt(process.env.MAX_GHL_LINKED || '0', 10);

if (!QUEUE_AUTH) {
  console.error('Missing QUEUE_AUTH');
  process.exit(1);
}

const headers = {
  'x-queue-auth': QUEUE_AUTH,
  'Content-Type': 'application/json',
};

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}

function websiteHost(url) {
  if (!url) return '';
  try {
    const host = new URL(String(url)).hostname || '';
    return host.toLowerCase().replace(/^www\./, '').trim();
  } catch {
    return String(url)
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .trim();
  }
}

function normalizedCompanyName(value) {
  return String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function companyGroupKey(lead) {
  const phoneKey = normalizePhone(lead.phone || lead.directPhone);
  if (phoneKey) return `phone:${phoneKey}`;

  const domain = websiteHost(lead.companyWebsite);
  if (domain) return `domain:${domain}`;

  const name = normalizedCompanyName(lead.companyName);
  if (name) return `name:${name}`;

  return `lead:${lead.id}`;
}

function isNoNumber(lead) {
  return !String(lead.phone || '').trim() && !String(lead.directPhone || '').trim();
}

function isGhlLinkedOrQualified(lead) {
  if (lead.ghlContactId || lead.ghlOpportunityId) return true;
  return String(lead.status || '').toLowerCase() === 'qualified';
}

function isoOrEmpty(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

async function getOutboundContacts() {
  const res = await fetch(`${API_BASE}/api/apollo-sales-queue?source=outbound`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success || !Array.isArray(data.contacts)) {
    throw new Error(`Outbound fetch failed: HTTP ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.contacts;
}

async function postAction(payload) {
  const res = await fetch(`${API_BASE}/api/apollo-sales-queue`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && !!data.success, status: res.status, data };
}

function summarizeSplits(contacts) {
  const groups = new Map();
  for (const lead of contacts) {
    const key = companyGroupKey(lead);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lead);
  }

  const splitGroups = [];
  for (const [key, rows] of groups.entries()) {
    const ownerIds = Array.from(new Set(rows.map((r) => String(r.ownerId || '')).filter(Boolean)));
    if (ownerIds.length > 1) {
      splitGroups.push({
        key,
        owners: ownerIds,
        total: rows.length,
        callbacks: rows.filter((r) => !!r.callbackAt).length,
        sample: rows.slice(0, 3).map((r) => ({
          id: r.id,
          name: r.name,
          companyName: r.companyName,
          ownerId: r.ownerId,
          owner: r.owner,
          callbackAt: isoOrEmpty(r.callbackAt),
        })),
      });
    }
  }

  splitGroups.sort((a, b) => b.total - a.total);
  return splitGroups;
}

async function main() {
  const startedAt = new Date().toISOString();

  const contacts = await getOutboundContacts();

  const noNumber = contacts.filter(isNoNumber);
  const ghlLinked = contacts.filter(isGhlLinkedOrQualified);
  const splitGroups = summarizeSplits(contacts);

  const mergeDryRun = await postAction({ action: 'merge-company-owners', dryRun: true });
  const purgeDryRun = await postAction({ action: 'purge-no-phone', dryRun: true });

  const blockers = [];

  if (noNumber.length > MAX_NO_NUMBER) {
    blockers.push(`No-number contacts ${noNumber.length} exceeds MAX_NO_NUMBER ${MAX_NO_NUMBER}`);
  }
  if (splitGroups.length > MAX_SPLIT_COMPANIES) {
    blockers.push(`Split companies ${splitGroups.length} exceeds MAX_SPLIT_COMPANIES ${MAX_SPLIT_COMPANIES}`);
  }
  if (ghlLinked.length > MAX_GHL_LINKED) {
    blockers.push(`GHL-linked or qualified leakage ${ghlLinked.length} exceeds MAX_GHL_LINKED ${MAX_GHL_LINKED}`);
  }

  if (!mergeDryRun.ok) {
    blockers.push(`merge-company-owners action unavailable: HTTP ${mergeDryRun.status} ${JSON.stringify(mergeDryRun.data).slice(0, 200)}`);
  }
  if (!purgeDryRun.ok) {
    blockers.push(`purge-no-phone action unavailable: HTTP ${purgeDryRun.status} ${JSON.stringify(purgeDryRun.data).slice(0, 200)}`);
  }

  const summary = {
    success: blockers.length === 0,
    startedAt,
    apiBase: API_BASE,
    thresholds: {
      MAX_NO_NUMBER,
      MAX_SPLIT_COMPANIES,
      MAX_GHL_LINKED,
    },
    counts: {
      outboundTotal: contacts.length,
      noNumber: noNumber.length,
      splitCompanies: splitGroups.length,
      ghlLinkedOrQualified: ghlLinked.length,
    },
    actions: {
      mergeCompanyOwnersDryRun: mergeDryRun.ok
        ? {
            available: true,
            rowsToUpdate: mergeDryRun.data.rowsToUpdate ?? null,
            companiesSplit: mergeDryRun.data.companiesSplit ?? null,
          }
        : {
            available: false,
            status: mergeDryRun.status,
            error: mergeDryRun.data.error || 'Unknown error',
          },
      purgeNoPhoneDryRun: purgeDryRun.ok
        ? {
            available: true,
            found: purgeDryRun.data.found ?? null,
          }
        : {
            available: false,
            status: purgeDryRun.status,
            error: purgeDryRun.data.error || 'Unknown error',
          },
    },
    samples: {
      noNumber: noNumber.slice(0, 10).map((r) => ({
        id: r.id,
        name: r.name,
        companyName: r.companyName,
        ownerId: r.ownerId,
        owner: r.owner,
      })),
      splitCompanies: splitGroups.slice(0, 10),
      ghlLinkedOrQualified: ghlLinked.slice(0, 10).map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        ghlContactId: r.ghlContactId || null,
        ghlOpportunityId: r.ghlOpportunityId || null,
        companyName: r.companyName,
      })),
    },
    blockers,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (blockers.length > 0) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  process.exit(1);
});
