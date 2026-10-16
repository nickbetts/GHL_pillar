/** Server-side quote model for "quote to proposal". Mirrors the calculator on the Offerings page; a test keeps the prices in sync. */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const gbp = (n) => {
  const v = Number(n) || 0;
  return `£${v.toLocaleString('en-GB', Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const Q_PKG = {
  gf: { id: 'gf', name: 'Get Found', monthly: 795, term: '6-month minimum', items: ['Website care: hosting, security, updates and content updates', 'Technical SEO so Google can read the site', 'AI search setup (llms.txt, FAQ and schema, author blocks)', '2 authority articles a month', '8 social posts a month', 'Monthly report'] },
  gl: { id: 'gl', name: 'Get Leads', monthly: 1750, term: '12-month minimum', fee: true, items: ['Everything in Get Found', 'Google and Meta ads managed end to end', '2 landing pages built and hosted, free', 'Server-side conversion tracking', 'Fresh ad creatives every month', 'Monthly 30-minute strategy call'] },
  dom: { id: 'dom', name: 'Dominate', monthly: 3500, term: '12-month minimum', fee: true, items: ['Everything in Get Leads', '3 landing pages built and hosted', '4 authority articles a month', 'Click-fraud and invalid traffic protection', 'Email and SMS follow-up built and managed', 'Fortnightly strategy calls'] },
  none: { id: 'none', name: 'No retainer', monthly: 0, term: '', items: [] },
};
export const Q_BILL = {
  monthly: { id: 'monthly', label: 'Monthly', off: 0, months: 1, unit: 'month' },
  quarterly: { id: 'quarterly', label: 'Quarterly', off: 0.05, months: 3, unit: 'quarter' },
  yearly: { id: 'yearly', label: 'Yearly', off: 0.1, months: 12, unit: 'year' },
};
export const Q_ADD = [
  { id: 'static', name: 'Static website', blurb: 'Bespoke static site, live in about 2 weeks', build: { min: 1000, def: 1000 }, care: { min: 99, max: 300, def: 99 } },
  { id: 'wp', name: 'Bespoke WordPress website', blurb: 'Custom WordPress design and build in 4 to 6 weeks, transferable to you', build: { min: 5000, def: 5000 }, care: { min: 99, max: 300, def: 99 } },
  { id: 'ecom', name: 'Headless ecommerce shop', blurb: 'Fast, custom online shop built on your requirements', build: { min: 5000, def: 5000 }, care: { min: 300, max: 500, def: 300 } },
  { id: 'crm', name: 'Bespoke CRM', blurb: 'A CRM built around your exact business process', build: { min: 5000, def: 5000 }, care: { min: 349, max: 5000, def: 349 } },
  { id: 'integ', name: 'Tool integrations', blurb: 'Connecting your existing tools, quoted after discovery', quoted: true },
  { id: 'lp', name: 'Extra landing pages', blurb: 'More pages for more campaigns', count: true, oneOff: 175, monthly: 20 },
  { id: 'art', name: 'Extra authority articles', blurb: 'More search topics answered', count: true, oneOff: 150, monthly: 0 },
];
export const FEE_NOTE = 'Ad spend is paid direct to the platform. Management fee: 10% on spend above £5,000 up to £20,000, then 7.5% above, billed in arrears.';

/** Recomputes the quote from a rep's selection, so the server never trusts client-side prices. */
export function computeQuote(input) {
  const sel = input && typeof input === 'object' ? input : {};
  const pkg = Q_PKG[sel.pkg] || Q_PKG.none;
  const bill = Q_BILL[sel.bill] || Q_BILL.monthly;
  const pkgNet = Math.round(pkg.monthly * (1 - bill.off) * 100) / 100;
  const rows = [];
  const quoted = [];
  let addMonthly = 0;
  let oneOff = 0;
  for (const a of Q_ADD) {
    const s = sel.add?.[a.id] || {};
    if (a.count) {
      const n = clamp(Number.parseInt(s.n, 10) || 0, 0, 20);
      if (!n) continue;
      rows.push({ id: a.id, name: `${n} × ${a.name.replace(/^Extra /, 'extra ')}`, one: n * a.oneOff, mo: n * a.monthly, blurb: a.blurb });
      oneOff += n * a.oneOff; addMonthly += n * a.monthly;
      continue;
    }
    if (!s.on) continue;
    if (a.quoted) { quoted.push(a.name); continue; }
    const build = Math.max(Number(s.build) || 0, a.build.min);
    const care = clamp(Number(s.care) || a.care.def, a.care.min, a.care.max);
    rows.push({ id: a.id, name: a.name, one: build, mo: care, blurb: a.blurb });
    oneOff += build; addMonthly += care;
  }
  return { pkg, bill, pkgNet, rows, quoted, addMonthly, oneOff, monthlyTotal: pkgNet + addMonthly, yearOne: pkgNet * 12 + addMonthly * 12 + oneOff };
}

/** One-line description used as the proposal's selection summary (read into the contract). */
export function quoteSummary(c) {
  const parts = [];
  if (c.pkg.monthly) parts.push(`${c.pkg.name} at ${gbp(c.pkgNet)} a month`);
  for (const r of c.rows) parts.push(r.name);
  return parts.join(', ').slice(0, 580) || 'the services in this proposal';
}

export function quoteToBlocks(c, { company = '' } = {}) {
  const blocks = [
    { type: 'heading', text: 'Your proposal' },
    { type: 'text', text: `Thanks for speaking with us${company ? `, ${company}` : ''}. This is a summary of what we covered and the investment involved.` },
  ];
  const included = [];
  if (c.pkg.monthly) included.push(`${c.pkg.name} (${c.pkg.term})`, ...c.pkg.items);
  for (const r of c.rows) included.push(`${r.name}: ${r.blurb}`);
  for (const name of c.quoted) included.push(`${name}: scoped and quoted after discovery`);
  if (included.length) blocks.push({ type: 'heading', text: 'What is included' }, { type: 'bullets', text: included.join('\n') });

  const lines = [];
  if (c.pkg.monthly) {
    const billing = c.bill.months > 1 ? `${c.bill.label.toLowerCase()}, ${Math.round(c.bill.off * 100)}% off` : 'monthly';
    lines.push(`${c.pkg.name} retainer (${billing}) | ${gbp(c.pkgNet)} / month | ${c.pkg.term}`);
  }
  for (const r of c.rows) {
    if (r.one) lines.push(`${r.name} (one-off) | ${gbp(r.one)} | one-off`);
    if (r.mo) lines.push(`${r.name} (monthly care) | ${gbp(r.mo)} / month | monthly`);
  }
  if (lines.length) blocks.push({ type: 'heading', text: 'Your investment' }, ...lines.map((text) => ({ type: 'investment', text })));

  const notes = [];
  if (c.bill.months > 1 && c.pkg.monthly) notes.push(`The retainer is paid ${c.bill.unit === 'year' ? 'yearly' : 'quarterly'} in advance: ${gbp(c.pkgNet * c.bill.months)} per ${c.bill.unit}. Add-on fees are billed monthly.`);
  if (c.pkg.fee) notes.push(FEE_NOTE);
  if (c.quoted.length) notes.push(`${c.quoted.join(', ')} will be quoted once we understand what you use.`);
  if (notes.length) blocks.push({ type: 'callout', text: `Good to know | ${notes.join('\n\n')}` });
  blocks.push({ type: 'heading', text: 'Ready to begin' }, { type: 'text', text: 'Accept and sign below and we will schedule your kick-off call within days. This proposal is valid until {{expiry_date}}. Questions before signing? {{rep_name}} is your point of contact.' });
  return blocks;
}
