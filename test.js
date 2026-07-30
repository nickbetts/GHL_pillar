import assert from 'node:assert/strict';

function normalizePhone9(value) {
  return String(value || '').replace(/\D+/g, '').slice(-9);
}

function websiteHost(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return String(new URL(raw).hostname || '').toLowerCase().replace(/^www\./, '').trim();
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
  }
}

function normalizedCompanyName(value) {
  return String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function companyKey(lead) {
  const p = normalizePhone9(lead.phone || '');
  if (p) return `phone:${p}`;
  const d = websiteHost(lead.companyWebsite || '');
  if (d) return `domain:${d}`;
  const n = normalizedCompanyName(lead.companyName || '');
  if (n) return `name:${n}`;
  return `lead:${lead.id}`;
}

function isCovered(lead) {
  const d = String(lead.disposition || '').toLowerCase();
  return d.includes('covered by colleague') || d.includes('already worked this company');
}

function rankPriority(priority) {
  const order = { hot: 0, warm: 1, cold: 2 };
  return Number.isFinite(order[priority]) ? order[priority] : 9;
}

function callSort(a, b) {
  const p = rankPriority(a.priority) - rankPriority(b.priority);
  if (p) return p;
  return String(a.id).localeCompare(String(b.id));
}

function buildTargetMap(leads) {
  const groups = new Map();
  for (const lead of leads) {
    const key = companyKey(lead);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lead);
  }

  const out = new Map();
  for (const [key, members] of groups.entries()) {
    const explicit = members.find((m) => !!m.companyTarget);
    if (explicit) {
      out.set(key, String(explicit.id));
      continue;
    }
    const ranked = members.filter((m) => !isCovered(m)).sort(callSort);
    out.set(key, String((ranked[0] || members[0]).id));
  }
  return out;
}

function mergeKey(lead) {
  const number = normalizePhone9(lead.phone || lead.directPhone || '');
  return number ? `${companyKey(lead)}|${number}` : `lead:${lead.id}`;
}

function uniqueByMerge(leads) {
  const seen = new Set();
  return leads.filter((lead) => {
    const key = mergeKey(lead);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isActiveTarget(lead, targets) {
  return String(targets.get(companyKey(lead)) || '') === String(lead.id);
}

function futureScheduledCount(leads, now = new Date('2026-07-30T10:00:00Z')) {
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  const targets = buildTargetMap(leads);
  const future = leads
    .filter((l) => l.callbackAt)
    .filter((l) => new Date(l.callbackAt).getTime() > end.getTime())
    .filter((l) => isActiveTarget(l, targets));
  return uniqueByMerge(future).length;
}

(function run() {
  const sample = [
    {
      id: '1',
      phone: '+44 7700 123456',
      companyName: 'Acme Ltd',
      callbackAt: '2026-08-02T10:00:00Z',
      priority: 'hot',
      companyTarget: false,
      disposition: '',
    },
    {
      id: '2',
      phone: '07700123456',
      companyName: 'Acme Ltd',
      callbackAt: '2026-08-02T11:00:00Z',
      priority: 'warm',
      companyTarget: false,
      disposition: '',
    },
    {
      id: '3',
      phone: '+44 7700 777888',
      companyName: 'Beta CIC',
      callbackAt: '2026-08-03T10:00:00Z',
      priority: 'cold',
      companyTarget: true,
      disposition: '',
    },
    {
      id: '4',
      phone: '+44 7700 777999',
      companyName: 'Beta CIC',
      callbackAt: '2026-08-03T09:00:00Z',
      priority: 'hot',
      companyTarget: false,
      disposition: '',
    },
    {
      id: '5',
      phone: '+44 7700 888000',
      companyName: 'Gamma Org',
      callbackAt: '2026-07-30T09:00:00Z',
      priority: 'hot',
      companyTarget: false,
      disposition: '',
    },
    {
      id: '6',
      phone: '+44 7700 999000',
      companyName: 'Delta Org',
      callbackAt: '2026-08-04T10:00:00Z',
      priority: 'hot',
      companyTarget: false,
      disposition: 'Covered by colleague',
    },
  ];

  assert.equal(futureScheduledCount(sample), 4, 'future callbacks should dedupe by merge key and honor active company targets');
  console.log('All tests passed');
})();
