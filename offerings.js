/* Offerings: the i3MEDIA sales menu. Three packages, one question, clear add-ons, plus a rep quote calculator.
   Static content; nothing here touches the API beyond SQ.init auth. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gbp = (n) => '£' + Math.round(Number(n) || 0).toLocaleString('en-GB');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const FEE_NOTE = 'Ad spend is paid direct to the platform. Management fee: 10% on spend above £5,000 up to £20,000, then 7.5% above, billed in arrears.';

  const REC = {
    question: 'If you could fix one thing about your marketing tomorrow, what would it be?',
    map: [
      { quote: '“We can’t be found online.”', pkg: 'Get Found', price: '£1,000', color: '#64748b' },
      { quote: '“We need more enquiries.”', pkg: 'Get Leads', price: '£1,750', color: '#2563eb', pop: true },
      { quote: '“We want to be number one.”', pkg: 'Dominate', price: '£2,995', color: '#7c3aed' },
    ],
    packages: [
      {
        id: 'gf', name: 'Get Found', price: '£1,000', monthly: 1000, color: '#64748b', term: '3-month minimum, then 90-day rolling',
        tag: 'For “we need to be found online”',
        items: ['Website care: hosting, security, updates and content updates', 'Technical SEO so Google can read the site', 'AI search setup (llms.txt, FAQ + schema, author blocks)', '2 authority articles a month', 'Monthly report'],
      },
      {
        id: 'gl', name: 'Get Leads', price: '£1,750', monthly: 1750, color: '#2563eb', term: '6-month minimum, then 90-day rolling', badge: 'Most choose this',
        tag: 'For “we need more enquiries”',
        items: ['<b>Everything in Get Found</b>', 'Google + Meta ads managed end-to-end', '2 landing pages built and hosted, free', 'Server-side conversion tracking', 'Fresh ad creatives every month', '2 authority articles a month', '4 social posts a month', 'Monthly 30-minute strategy call'],
      },
      {
        id: 'dom', name: 'Dominate', price: '£2,995', monthly: 2995, color: '#7c3aed', term: '6-month minimum, then 90-day rolling',
        tag: 'For “we want to be #1”',
        items: ['<b>Everything in Get Leads</b>', '3 landing pages built and hosted', '4 authority articles a month', '4 social posts a month', 'Click-fraud and invalid traffic protection (saves ~15% of ad spend)', 'Email + SMS follow-up built and managed', 'Fortnightly strategy calls'],
      },
    ],
    addOns: [
      {
        group: 'Websites & shops',
        items: [
          ['Static website design', 'From £1,000 one-off + £99–£300 / month', 'Bespoke static site, live in about 2 weeks depending on page count. Build is quoted on specs and the work required. Monthly care covers hosting, security, updates and content updates: £99/mo with no content updates, up to £300/mo depending on the work required, agreed with the client upfront.'],
          ['Bespoke WordPress website', 'From £5,000 one-off + £99–£300 / month', 'Custom WordPress design and build, fully in-house, typically 4–6 weeks. Build is quoted on specs and the work required. Same care plan. Transferable to the client.'],
          ['Headless ecommerce shop', 'From £5,000 one-off + £300–£500 / month', 'Build quoted on specs and the work required, then £300–£500/mo depending on requirements.'],
          ['WordPress ecommerce shop', 'From £12,500 one-off + £300–£500 / month', 'WooCommerce on a bespoke WordPress build, transferable to the client. Quoted on specs and the work required.'],
        ],
      },
      {
        group: 'Systems',
        items: [
          ['Bespoke CRM build', 'From £5,000 one-off + from £349 / month', 'A CRM built around their exact business processes: manages the leads we generate, the sales pipeline, customer communications and email marketing. Monthly covers hosting, support and ongoing tweaks.'],
          ['Tool integrations', 'Quoted per project', 'Connect the CRM or website to their existing tools (accounts, booking, stock, phones). Scoped and quoted once we know what they use.'],
        ],
      },
      {
        group: 'Extras',
        items: [
          ['Extra landing page', '£175 one-off + £20 / month', 'More pages for more campaigns.'],
          ['Extra authority article', '£150 each', 'More search topics and buyer questions answered.'],
        ],
      },
    ],
    phone: {
      script: 'Most businesses we help have one of two problems: they can\'t be found online, or they\'re not getting enough enquiries. Which one sounds like you? … Right, that\'s exactly what Get Leads fixes, and it\'s £1,750 a month. Want me to tell you what happens in the first 30 days?',
      hours: 'Roughly an hour of senior time for every £100 — so Get Leads is about 17 to 18 hours a month. But we work to the result, not the clock.',
      objection: ['That\'s more than we wanted to spend.', 'Totally fine. Get Found at £1,000 gets your website and search right first, and everything carries into Get Leads when you\'re ready. Or if you just need a proper website, a new static site starts from £1,000 one-off plus £99 a month.'],
    },
    value: [
      ['“What\'s a new customer worth to you?”', '£3,000'],
      ['“So 3 extra customers a month is…”', '£9,000 a month ≈ £108,000 a year'],
      ['“Our fee is £1,750 a month, about…”', '£21,000 for a £108,000 return = 5×'],
      ['“If we only got you 1 extra customer, you\'d still be up.”', 'Break-even at < 1 new customer'],
    ],
    rules: [
      'Ad spend is paid direct to the platform. On Get Leads and Dominate, management fee is 10% on spend above £5,000 up to £20,000, then 7.5% above that, billed in arrears.',
      'Three packages only. If a client wants something different, it\'s an add-on or a custom quote, never a fourth package.',
      'Every client gets a 60-day review where we show results and agree the next step.',
      'Get Found and Dominate cover the edges. Get Leads is the one we steer most businesses to.',
      'Get Found: 3-month minimum, then 90-day rolling. Get Leads and Dominate: 6-month minimum, then 90-day rolling.',
      'Pay quarterly: 5% off. Pay yearly in advance: 10% off. Discounts apply to the package fee only, never ad spend, add-ons or the management fee.',
      'Website builds are a one-off cost plus a care plan from £99/mo (no content updates) up to £300/mo depending on the work required, agreed with the client upfront.',
    ],
  };

  const { FC, simulate } = window.ForecastModel;

  const Q_PKG = [
    { id: 'gf', name: 'Get Found', monthly: 1000, term: '3-month minimum, then 90-day rolling', color: '#64748b', inc: ['Website care: hosting, security, updates and content updates', 'Technical SEO so Google can read the site', 'AI search setup (llms.txt, FAQ + schema, author blocks)', '2 authority articles a month', 'Monthly report'] },
    { id: 'gl', name: 'Get Leads', monthly: 1750, term: '6-month minimum, then 90-day rolling', color: '#2563eb', fee: true, inc: ['Website care: hosting, security, updates and content updates', 'Technical SEO so Google can read the site', 'AI search setup (llms.txt, FAQ + schema, author blocks)', '2 authority articles a month', 'Monthly report', 'Google + Meta ads managed end-to-end', '2 landing pages built and hosted, free', 'Server-side conversion tracking', 'Fresh ad creatives every month', '4 social posts a month', 'Monthly 30-minute strategy call'] },
    { id: 'dom', name: 'Dominate', monthly: 2995, term: '6-month minimum, then 90-day rolling', color: '#7c3aed', fee: true, inc: ['Website care: hosting, security, updates and content updates', 'Technical SEO so Google can read the site', 'AI search setup (llms.txt, FAQ + schema, author blocks)', '4 authority articles a month', 'Monthly report', 'Google + Meta ads managed end-to-end', '3 landing pages built and hosted', 'Server-side conversion tracking', 'Fresh ad creatives every month', '4 social posts a month', 'Click-fraud and invalid traffic protection (saves ~15% of ad spend)', 'Email + SMS follow-up built and managed', 'Fortnightly strategy calls'] },
    { id: 'none', name: 'No retainer', monthly: 0, term: '', color: '#94a3b8' },
  ];
  const Q_BILL = [
    { id: 'monthly', label: 'Monthly', off: 0, months: 1, unit: 'month' },
    { id: 'quarterly', label: 'Quarterly', off: 0.05, months: 3, unit: 'quarter', hint: '5% off' },
    { id: 'yearly', label: 'Yearly', off: 0.1, months: 12, unit: 'year', hint: '10% off' },
  ];
  const Q_ADD = [
    { id: 'static', group: 'Websites & shops', name: 'Static website', blurb: 'Live in about 2 weeks', build: { label: 'Build price (£)', min: 1000, def: 1000, from: true, hint: 'from £1,000, quoted on spec' }, care: { label: 'Monthly care (£)', min: 99, max: 300, def: 99, hint: '£99 with no content updates, up to £300' }, inc: ['Bespoke static website, live in about 2 weeks', 'Care plan: hosting, security, updates and content updates'] },
    { id: 'wp', group: 'Websites & shops', name: 'Bespoke WordPress website', blurb: '4–6 weeks, transferable', build: { label: 'Build price (£)', min: 5000, def: 5000, from: true, hint: 'from £5,000, quoted on spec' }, care: { label: 'Monthly care (£)', min: 99, max: 300, def: 99, hint: '£99 with no content updates, up to £300' }, inc: ['Custom WordPress design and build, fully in-house (4–6 weeks)', 'Care plan: hosting, security, updates and content updates', 'Transferable to the client'] },
    { id: 'ecom', group: 'Websites & shops', name: 'Headless ecommerce shop', blurb: 'Quoted on demand', build: { label: 'Build price (£)', min: 5000, def: 5000, from: true, hint: 'from £5,000, quoted on spec' }, care: { label: 'Monthly support (£)', min: 300, max: 500, def: 300, hint: '£300 to £500 by requirements' }, inc: ['Headless ecommerce shop built to their specs', 'Monthly support, set by their requirements'] },
    { id: 'wpecom', group: 'Websites & shops', name: 'WordPress ecommerce shop', blurb: 'WooCommerce on a bespoke WordPress build', build: { label: 'Build price (£)', min: 12500, def: 12500, from: true, hint: 'from £12,500, quoted on spec' }, care: { label: 'Monthly support (£)', min: 300, max: 500, def: 300, hint: '£300 to £500 by requirements' }, inc: ['WooCommerce shop on a bespoke WordPress build', 'Transferable to the client', 'Monthly support, set by their requirements'] },
    { id: 'crm', group: 'Systems', name: 'Bespoke CRM', blurb: 'Built around their exact process', build: { label: 'Build price (£)', min: 5000, def: 5000, from: true, hint: 'from £5,000' }, care: { label: 'Monthly (£)', min: 349, max: 5000, def: 349, from: true, hint: 'from £349' }, inc: ['CRM built around their exact business processes', 'Manages the leads we generate, the sales pipeline, customer communications and email marketing', 'Monthly covers hosting, support and ongoing tweaks'] },
    { id: 'integ', group: 'Systems', name: 'Tool integrations', blurb: 'Quoted after discovery', quoted: true, inc: ['Connects the CRM or website to their existing tools (accounts, booking, stock, phones)', 'Scoped and quoted once we know what they use'] },
    { id: 'lp', group: 'Extras', name: 'Extra landing pages', blurb: '£175 each + £20 / month each', count: true, oneOff: 175, monthly: 20, inc: ['Extra landing pages for more campaigns, built and hosted'] },
    { id: 'art', group: 'Extras', name: 'Extra authority articles', blurb: '£150 each', count: true, oneOff: 150, monthly: 0, inc: ['Extra authority articles answering more search topics and buyer questions'] },
  ];

  const quote = { pkg: 'gl', bill: 'monthly', add: {} };
  function resetQuote(pkg) {
    quote.pkg = pkg || 'gl';
    quote.bill = 'monthly';
    quote.add = {};
    Q_ADD.forEach((a) => { quote.add[a.id] = { on: false, n: 0, build: a.build && a.build.def ? a.build.def : '', care: a.care ? a.care.def : 0 }; });
  }

  function computeQuote() {
    const p = Q_PKG.find((x) => x.id === quote.pkg);
    const b = Q_BILL.find((x) => x.id === quote.bill);
    const pkgDisc = p.monthly * b.off;
    const pkgNet = p.monthly - pkgDisc;
    const rows = [];
    let addMonthly = 0;
    let oneOff = 0;
    const tbc = [];
    const from = [];
    for (const a of Q_ADD) {
      const s = quote.add[a.id];
      if (a.count) {
        if (s.n < 1) continue;
        const one = s.n * a.oneOff;
        const mo = s.n * a.monthly;
        oneOff += one; addMonthly += mo;
        rows.push({ name: `${s.n} × ${a.name.replace(/^Extra /, 'extra ')}`, one, mo, inc: a.inc });
        continue;
      }
      if (!s.on) continue;
      if (a.quoted) { tbc.push('Tool integrations (quoted after discovery)'); rows.push({ name: a.name, note: 'Quoted after discovery', inc: a.inc }); continue; }
      const buildVal = Number(s.build) || 0;
      const care = clamp(Number(s.care) || a.care.def, a.care.min, a.care.max);
      if (buildVal > 0) oneOff += buildVal; else tbc.push(`${a.name} build price`);
      addMonthly += care;
      if (a.build.from) from.push(a.name);
      rows.push({ name: a.name, one: buildVal > 0 ? buildVal : null, mo: care, from: !!a.build.from, inc: a.inc });
    }
    const yearOne = pkgNet * 12 + addMonthly * 12 + oneOff;
    return { p, b, pkgDisc, pkgNet, rows, addMonthly, oneOff, tbc, from, monthlyTotal: pkgNet + addMonthly, yearOne };
  }

  function includedGroups(c) {
    const groups = [];
    if (c.p.inc && c.p.inc.length) groups.push({ title: `${c.p.name} includes`, items: c.p.inc });
    c.rows.forEach((r) => { if (r.inc && r.inc.length) groups.push({ title: r.name, items: r.inc }); });
    return groups;
  }

  function includesHtml(c) {
    const groups = includedGroups(c);
    if (!groups.length) return '';
    return `<div class="off-qs-inc"><h5>What they get</h5>${groups.map((g) => `<div class="off-qs-inc-g"><b>${esc(g.title)}</b><ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}</div>`;
  }

  function summaryHtml() {
    const c = computeQuote();
    const empty = c.p.monthly === 0 && !c.rows.length;
    const lines = [];
    if (c.p.monthly) lines.push(`<div class="off-qs-row"><span>${esc(c.p.name)}</span><b>${gbp(c.p.monthly)}/mo</b></div>`);
    if (c.pkgDisc) lines.push(`<div class="off-qs-row disc"><span>${esc(c.b.label)} discount (${Math.round(c.b.off * 100)}%)</span><b>−${gbp(c.pkgDisc)}/mo</b></div>`);
    c.rows.forEach((r) => {
      const price = [r.one != null ? `${r.from ? 'from ' : ''}${gbp(r.one)} once` : '', r.mo ? `${r.from ? 'from ' : ''}${gbp(r.mo)}/mo` : '', r.note || ''].filter(Boolean).join(' + ');
      lines.push(`<div class="off-qs-row"><span>${esc(r.name)}</span><b>${esc(price)}</b></div>`);
    });
    const billLine = c.p.monthly && c.b.months > 1
      ? `<p class="off-qs-note">Retainer paid ${c.b.unit === 'year' ? 'yearly' : 'quarterly'} in advance: <b>${gbp(c.pkgNet * c.b.months)}</b> per ${c.b.unit}. Add-on fees are billed monthly.</p>` : '';
    return `
      <h4>Rough quote</h4>
      ${empty ? '<p class="off-qs-empty">Pick a package or tick an add-on to build the price.</p>' : `<div class="off-qs-rows">${lines.join('')}</div>`}
      <div class="off-qs-total">
        <div><span>Monthly</span><b>${gbp(c.monthlyTotal)}</b><small>/ month${c.from.length ? ' from' : ''}</small></div>
        <div><span>One-off</span><b>${gbp(c.oneOff)}</b><small>${c.tbc.length || c.from.length ? 'so far' : 'to start'}</small></div>
      </div>
      <div class="off-qs-year"><span>First 12 months</span><b>${gbp(c.yearOne)}</b></div>
      ${billLine}
      ${includesHtml(c)}
      <ul class="off-qs-notes">
        ${c.p.term ? `<li>${esc(c.p.term)}.</li>` : ''}
        ${c.p.fee ? `<li>${FEE_NOTE}</li>` : ''}
        ${c.tbc.length ? `<li class="warn">Still to quote: ${c.tbc.map(esc).join('; ')}.</li>` : ''}
        ${c.from.length ? `<li>“From” prices are a starting point; the final figure depends on their requirements.</li>` : ''}
        <li>A rough guide only. We confirm the final price in the meeting.</li>
      </ul>
      <button type="button" class="off-qs-copy" data-copy>Copy summary</button>${proposeHtml(c)}`;
  }

  // Beta: turn the quote into a fixed-price proposal in Proposal Hub.
  const PROP = { open: false, company: '', name: '', email: '', leadId: '', busy: false, error: '', result: null, opps: null };
  function resetProp() { Object.assign(PROP, { open: false, company: '', name: '', email: '', leadId: '', busy: false, error: '', result: null }); }

  function proposeHtml(c) {
    const ready = c.monthlyTotal > 0 || c.oneOff > 0;
    const btn = `<button type="button" class="off-qs-prop" data-propose ${ready ? '' : 'disabled'}>Create a proposal <span class="off-beta">Beta</span></button>`;
    if (!PROP.open) return btn;
    if (PROP.result) {
      const link = `${location.origin}/proposal?p=${PROP.result.token}`;
      return `<div class="off-prop"><b>Proposal created</b><p>The client opens it with a 6-digit code sent to <b>${esc(PROP.email)}</b>. Nothing has been emailed yet.</p>
        <input type="text" readonly value="${esc(link)}" aria-label="Client link" onfocus="this.select()" />
        <div class="off-prop-row"><button type="button" data-prop-copy="${esc(link)}">Copy client link</button><a class="btn ghost" href="/proposal-hub">Open Proposal Hub</a></div></div>`;
    }
    const opps = (PROP.opps || []).map((o) => `<option value="${o.id}" ${String(o.id) === String(PROP.leadId) ? 'selected' : ''}>${esc(o.company || o.name || 'Opportunity')}${o.name && o.company ? ` (${esc(o.name)})` : ''}</option>`).join('');
    return `<div class="off-prop"><b>Create a proposal <span class="off-beta">Beta</span></b>
      <p>Builds a fixed-price proposal from this quote. Check it in Proposal Hub before sending the link.</p>
      <label>Link to an opportunity (optional)<select data-prop-field="leadId"><option value="">None</option>${opps}</select></label>
      <label>Company<input type="text" data-prop-field="company" value="${esc(PROP.company)}" maxlength="200" /></label>
      <label>Contact name<input type="text" data-prop-field="name" value="${esc(PROP.name)}" maxlength="200" /></label>
      <label>Approved client email<input type="email" data-prop-field="email" value="${esc(PROP.email)}" maxlength="320" placeholder="client@company.com" /></label>
      ${PROP.error ? `<p class="off-prop-err">${esc(PROP.error)}</p>` : ''}
      <button type="button" data-prop-create ${PROP.busy ? 'disabled' : ''}>${PROP.busy ? 'Creating…' : 'Create proposal'}</button></div>`;
  }

  async function loadOpps() {
    if (PROP.opps) return;
    try {
      const res = await fetch('/api/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'list-opps' }) });
      const data = await res.json();
      PROP.opps = data.success ? data.opportunities : [];
    } catch { PROP.opps = []; }
    if (PROP.open && qRoot && !qRoot.hidden) $('offQmSum').innerHTML = summaryHtml();
  }

  async function createProposal() {
    PROP.error = '';
    if (!PROP.company.trim()) PROP.error = 'Add the company name.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(PROP.email.trim())) PROP.error = 'Add a valid client email.';
    if (PROP.error) { $('offQmSum').innerHTML = summaryHtml(); return; }
    PROP.busy = true; $('offQmSum').innerHTML = summaryHtml();
    let data;
    try {
      const res = await fetch('/api/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'create-from-quote', quote, clientCompany: PROP.company.trim(), clientName: PROP.name.trim(), clientEmail: PROP.email.trim(), leadId: PROP.leadId || null }) });
      data = await res.json();
    } catch { data = { success: false, error: 'Network error. Try again.' }; }
    PROP.busy = false;
    if (data.success) PROP.result = { id: data.id, token: data.token }; else PROP.error = data.error || 'Could not create the proposal.';
    $('offQmSum').innerHTML = summaryHtml();
  }

  function summaryText() {
    const c = computeQuote();
    const out = ['i3MEDIA rough quote'];
    if (c.p.monthly) out.push(`${c.p.name}: ${gbp(c.p.monthly)}/mo${c.pkgDisc ? ` (${Math.round(c.b.off * 100)}% ${c.b.label.toLowerCase()} discount, ${gbp(c.pkgNet)}/mo)` : ''}, ${c.p.term}`);
    c.rows.forEach((r) => {
      const bits = [r.one != null ? `${r.from ? 'from ' : ''}${gbp(r.one)} one-off` : '', r.mo ? `${r.from ? 'from ' : ''}${gbp(r.mo)}/mo` : '', r.note || ''].filter(Boolean).join(' + ');
      out.push(`${r.name}: ${bits}`);
    });
    includedGroups(c).forEach((g) => { out.push('', `${g.title}:`, ...g.items.map((i) => `- ${i}`)); });
    out.push('');
    out.push(`Monthly: ${gbp(c.monthlyTotal)}${c.from.length ? ' (from)' : ''}`, `One-off: ${gbp(c.oneOff)}`, `First 12 months: ${gbp(c.yearOne)}`);
    if (c.tbc.length) out.push(`Still to quote: ${c.tbc.join('; ')}`);
    if (c.p.fee) out.push('Ad spend extra, paid direct to the platform. Management fee 10% above £5k up to £20k, then 7.5%.');
    out.push('Rough guide only, confirmed in the meeting.');
    return out.join('\n');
  }

  function quoteShellHtml() {
    const pkgs = Q_PKG.map((p) => `
      <label class="off-opt" style="--tc:${p.color}">
        <input type="radio" name="offQPkg" value="${p.id}" />
        <span><b>${esc(p.name)}</b><small>${p.monthly ? `${gbp(p.monthly)} / month` : 'Website or add-ons only'}</small></span>
      </label>`).join('');
    const bills = Q_BILL.map((b) => `
      <label class="off-seg">
        <input type="radio" name="offQBill" value="${b.id}" />
        <span>${esc(b.label)}${b.hint ? `<small>${esc(b.hint)}</small>` : ''}</span>
      </label>`).join('');
    const groups = ['Websites & shops', 'Systems', 'Extras'].map((g) => `
      <div class="off-qg"><div class="off-qg-t">${esc(g)}</div>${Q_ADD.filter((a) => a.group === g).map(addCardHtml).join('')}</div>`).join('');
    return `
      <div class="off-qm-back" data-close></div>
      <section class="off-qm-box" role="dialog" aria-modal="true" aria-labelledby="offQmTitle">
        <header class="off-qm-head">
          <div><h3 id="offQmTitle">Quote calculator</h3><p>Rough cost for the phone. Pick a package and add-ons, then book the meeting.</p></div>
          <button type="button" class="ghost off-qm-x" data-close aria-label="Close quote calculator">Close</button>
        </header>
        <div class="off-qm-body">
          <div class="off-qm-main">
            <div class="off-qsec"><div class="off-qsec-t"><span>1</span>Package</div><div class="off-opts">${pkgs}</div></div>
            <div class="off-qsec"><div class="off-qsec-t"><span>2</span>How they pay</div><div class="off-segs">${bills}</div></div>
            <div class="off-qsec"><div class="off-qsec-t"><span>3</span>Add-ons</div>${groups}</div>
          </div>
          <aside class="off-qm-sum" id="offQmSum" aria-live="polite"></aside>
        </div>
      </section>`;
  }

  function addCardHtml(a) {
    if (a.count) {
      return `<div class="off-add" data-add-card="${a.id}">
        <div class="off-add-h"><span class="off-add-n"><b>${esc(a.name)}</b><small>${esc(a.blurb)}</small></span>
          <span class="off-stepper">
            <button type="button" class="off-step" data-step="${a.id}" data-d="-1" aria-label="Fewer ${esc(a.name)}">−</button>
            <output data-out="${a.id}">0</output>
            <button type="button" class="off-step" data-step="${a.id}" data-d="1" aria-label="More ${esc(a.name)}">+</button>
          </span></div></div>`;
    }
    const fields = a.quoted ? '' : `
      <div class="off-add-f" data-fields="${a.id}" hidden>
        <label>${esc(a.build.label)}<small>${esc(a.build.hint)}</small><input type="number" inputmode="numeric" data-field="build" data-id="${a.id}" min="${a.build.min || 0}" step="50" placeholder="TBC" ${a.build.def ? `value="${a.build.def}"` : ''} /></label>
        <label>${esc(a.care.label)}<small>${esc(a.care.hint)}</small><input type="number" inputmode="numeric" data-field="care" data-id="${a.id}" min="${a.care.min}" max="${a.care.max}" step="1" value="${a.care.def}" /></label>
      </div>`;
    return `<div class="off-add" data-add-card="${a.id}">
      <label class="off-add-h"><input type="checkbox" data-add="${a.id}" /><span class="off-add-n"><b>${esc(a.name)}</b><small>${esc(a.blurb)}</small></span></label>${fields}</div>`;
  }

  // ── Quote popout controller ─────────────────────────────────────────────
  let qRoot = null;
  let qOpener = null;

  function syncQuoteUi() {
    qRoot.querySelectorAll('input[name="offQPkg"]').forEach((i) => { i.checked = i.value === quote.pkg; i.closest('.off-opt').classList.toggle('on', i.checked); });
    qRoot.querySelectorAll('input[name="offQBill"]').forEach((i) => { i.checked = i.value === quote.bill; i.closest('.off-seg').classList.toggle('on', i.checked); });
    Q_ADD.forEach((a) => {
      const s = quote.add[a.id];
      const card = qRoot.querySelector(`[data-add-card="${a.id}"]`);
      if (!card) return;
      if (a.count) {
        card.querySelector(`[data-out="${a.id}"]`).textContent = s.n;
        card.classList.toggle('on', s.n > 0);
        return;
      }
      const box = card.querySelector('input[type="checkbox"]');
      box.checked = s.on;
      card.classList.toggle('on', s.on);
      const f = card.querySelector('[data-fields]');
      if (f) f.hidden = !s.on;
    });
    $('offQmSum').innerHTML = summaryHtml();
  }

  function openQuote(pkg, opener) {
    if (!qRoot) return;
    resetQuote(pkg);
    resetProp();
    qOpener = opener || null;
    qRoot.hidden = false;
    document.body.classList.add('off-noscroll');
    syncQuoteUi();
    const x = qRoot.querySelector('.off-qm-x');
    if (x) x.focus();
  }

  function closeQuote() {
    if (!qRoot || qRoot.hidden) return;
    qRoot.hidden = true;
    document.body.classList.remove('off-noscroll');
    if (qOpener && qOpener.focus) qOpener.focus();
  }

  function bindQuote() {
    qRoot = $('offQmRoot');
    qRoot.innerHTML = quoteShellHtml();
    resetQuote('gl');
    qRoot.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return closeQuote();
      if (e.target.closest('[data-propose]')) { PROP.open = !PROP.open; $('offQmSum').innerHTML = summaryHtml(); if (PROP.open) loadOpps(); return; }
      if (e.target.closest('[data-prop-create]')) return createProposal();
      const propCopy = e.target.closest('[data-prop-copy]');
      if (propCopy) {
        const done = () => { propCopy.textContent = 'Copied'; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(propCopy.dataset.propCopy).then(done, () => { propCopy.textContent = 'Copy failed'; });
        return;
      }
      const step = e.target.closest('[data-step]');
      if (step) {
        const s = quote.add[step.dataset.step];
        s.n = clamp(s.n + Number(step.dataset.d), 0, 20);
        return syncQuoteUi();
      }
      if (e.target.closest('[data-copy]')) {
        const btn = e.target.closest('[data-copy]');
        const done = () => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy summary'; }, 1600); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(summaryText()).then(done, () => { btn.textContent = 'Copy failed'; });
        else btn.textContent = 'Copy not supported';
      }
    });
    qRoot.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.propField === 'leadId') {
        PROP.leadId = t.value;
        const o = (PROP.opps || []).find((x) => String(x.id) === String(t.value));
        if (o) { if (!PROP.company) PROP.company = o.company || ''; if (!PROP.name) PROP.name = o.name || ''; if (!PROP.email) PROP.email = o.email || ''; $('offQmSum').innerHTML = summaryHtml(); }
        return;
      }
      if (t.name === 'offQPkg') { quote.pkg = t.value; return syncQuoteUi(); }
      if (t.name === 'offQBill') { quote.bill = t.value; return syncQuoteUi(); }
      if (t.dataset.add) { quote.add[t.dataset.add].on = t.checked; return syncQuoteUi(); }
      if (t.dataset.field) {
        const a = Q_ADD.find((x) => x.id === t.dataset.id);
        const cfg = a[t.dataset.field];
        if (t.dataset.field === 'care') { t.value = clamp(Number(t.value) || cfg.def, cfg.min, cfg.max); }
        else if (t.value !== '') { t.value = Math.max(Number(t.value) || 0, cfg.min || 0); }
        quote.add[t.dataset.id][t.dataset.field] = t.value;
        $('offQmSum').innerHTML = summaryHtml();
      }
    });
    qRoot.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.propField) { PROP[t.dataset.propField] = t.value; return; }
      if (!t.dataset.field) return;
      quote.add[t.dataset.id][t.dataset.field] = t.value;
      $('offQmSum').innerHTML = summaryHtml();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeQuote(); });
    const headerBtn = $('offQuoteBtn');
    if (headerBtn) headerBtn.addEventListener('click', () => openQuote('gl', headerBtn));
    $('offBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-quote]');
      if (b) openQuote(b.dataset.quote, b);
    });
  }

  // ── Page ────────────────────────────────────────────────────────────────
  const list = (items, cls = 'dot') => `<ul class="off-list ${cls}">${items.map((t) => `<li>${t}</li>`).join('')}</ul>`;
  const say = (label, text, cls = '') => `<p class="off-say ${cls}"><span class="off-say-label">${esc(label)}</span>${esc(text)}</p>`;

  function pkgCard(p) {
    return `<article class="off-pkg${p.badge ? ' pop' : ''}" style="--tc:${p.color}">
      <div class="off-pkg-head"><h4>${esc(p.name)}</h4>${p.badge ? `<span class="off-pkg-badge">${esc(p.badge)}</span>` : ''}</div>
      <div class="off-price">${esc(p.price)} <small>/ month</small></div>
      <div class="off-pkg-note">${esc(p.tag)}</div>
      <div class="off-pkg-term">${esc(p.term)}</div>
      ${list(p.items, 'pro')}
      <button type="button" class="ghost off-pkg-quote" data-quote="${p.id}">Quote this package</button>
    </article>`;
  }

  function render() {
    const r = REC;
    const qmap = r.map.map((m) => `
      <div class="off-q${m.pop ? ' pop' : ''}" style="--qc:${m.color}">
        <p class="off-q-quote">${esc(m.quote)}</p>
        <div class="off-q-pkg">${esc(m.pkg)}<span>${esc(m.price)} / month</span></div>
      </div>`).join('');
    const addOns = r.addOns.map((g) => `
      <div class="off-bg">
        <div class="off-bg-t">${esc(g.group)}</div>
        <div class="off-bolts">${g.items.map(([n, p, d]) => `
          <article class="off-bolt">
            <h4>${esc(n)}</h4>
            <div class="off-bolt-price">${esc(p)}</div>
            <p>${esc(d)}</p>
          </article>`).join('')}</div>
      </div>`).join('');
    const valueRows = r.value.map(([a, b]) => `<div class="off-meta-row"><span>${a}</span><b>${b}</b></div>`).join('');
    const billRows = r.packages.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${gbp(p.monthly)} / month</td><td class="num">${gbp(p.monthly * 0.95 * 3)} / quarter</td><td class="num">${gbp(p.monthly * 0.9 * 12)} / year</td></tr>`).join('');

    $('offBody').innerHTML = `<div class="off-view">

      <div class="off-co-row">
        <div class="off-co-card on"><b>i3MEDIA</b><span>Live</span></div>
        <div class="off-co-card soon"><b>Pillar</b><span>Coming soon</span></div>
        <div class="off-co-card soon"><b>Siteminders</b><span>Coming soon</span></div>
      </div>

      <section class="panel off-hero">
        <div class="off-kicker">i3MEDIA · The sales menu</div>
        <h2 class="off-title">Ask one question. Match the package. Done.</h2>
        <p class="off-lead">Three packages named after the client's problem. You ask one question, hand over the matching package, and justify the price with their own numbers. Nothing else to learn.</p>
        <div class="off-stats">
          <div class="off-stat"><span>Packages</span><b>3</b></div>
          <div class="off-stat"><span>Prices</span><b>£1,000 · £1,750 · £2,995</b></div>
          <div class="off-stat"><span>Steer most to</span><b>Get Leads</b></div>
          <div class="off-stat"><span>If asked about hours</span><b>~1 hr per £100</b></div>
        </div>
      </section>

      <h3 class="off-h">The one question</h3>
      <section class="panel off-heroq">
        <p class="off-bigq">${esc(r.question)}</p>
        <div class="off-qmap">${qmap}</div>
      </section>

      <h3 class="off-h">The three packages</h3>
      <p class="off-note">Each one includes the one below it. Show all three, always steer to the middle.</p>
      <div class="off-pkgs">${r.packages.map(pkgCard).join('')}</div>

      <h3 class="off-h">Pay upfront, pay less</h3>
      <p class="off-note">Quarterly in advance: 5% off. Yearly in advance: 10% off. Package fee only, never ad spend or add-ons.</p>
      <div class="off-table-wrap"><table class="off-table">
        <thead><tr><th>Package</th><th>Pay monthly</th><th>Pay quarterly (−5%)</th><th>Pay yearly (−10%)</th></tr></thead>
        <tbody>${billRows}</tbody>
      </table></div>

      <h3 class="off-h">Add-ons</h3>
      <p class="off-note">The only extras. Websites are quoted on spec, from £1,000 (static) or £5,000 (WordPress, shop), plus a £99–£300/mo care plan; everything else is a custom quote.</p>
      ${addOns}

      <h3 class="off-h">Say it on the phone</h3>
      <section class="panel"><div class="off-script">
        ${say('30-second pitch', r.phone.script)}
        ${say('If they ask about hours', r.phone.hours, 'obj')}
        ${say(`Objection: "${r.phone.objection[0]}"`, r.phone.objection[1], 'obj')}
      </div></section>

      <h3 class="off-h">Prove the value</h3>
      <p class="off-note">Don't recalculate a price per client. Ask about their numbers, then show why £1,750 is small next to the result. The maths you do out loud on the call:</p>
      <section class="panel"><div class="off-meta-wide">${valueRows}</div></section>

      <h3 class="off-h">Year-one forecast</h3>
      <p class="off-note">Type how many new clients we sign each month. Everything else is pre-filled from industry benchmarks: clients churn, get stickier as they move up and add services, and some buy a website, shop or CRM on top.</p>
      <section class="panel">
        <div class="off-fc-top">
          <label>New clients a month<input type="number" id="fcNew" value="2" min="0" max="60" step="1" /></label>
          <p>Clients start on the package they match, can move up after 3 and 6 months, and leave at the benchmark rates below. One-off builds are counted in the month they are sold.</p>
        </div>
        <div class="off-fc-kpis" id="fcKpis"></div>
        <div class="off-fc-chart" id="fcChart"></div>
        <div class="off-fc-x">${Array.from({ length: 12 }, (_, i) => `<span>M${i + 1}</span>`).join('')}</div>
        <div class="off-fc-legend"><span><i class="g"></i>Get Found</span><span><i class="l"></i>Get Leads</span><span><i class="d"></i>Dominate</span><span><i class="c"></i>Website / shop / CRM monthly fees</span><span><i class="o"></i>One-off builds</span></div>
        <details class="collapse" open>
          <summary>Assumptions and sources</summary>
          <div class="collapse-body">
            <div class="off-table-wrap"><table class="off-table off-assump">
              <thead><tr><th>Assumption</th><th>Value</th><th>Basis</th></tr></thead>
              <tbody>${assumptionRows()}</tbody>
            </table></div>
            <p class="off-assump-note">These are agency-wide benchmarks, not promises. Clients won by outbound calling stay about 1.9× shorter than referral clients (Promethean Research), so read the churn rates as the optimistic end. Website and CRM prices are market ranges, not our own averages.</p>
          </div>
        </details>
      </section>

      <h3 class="off-h">The rules</h3>
      <section class="panel">${list(r.rules)}</section>

    </div>`;
  }

  // ── Year-one forecast ───────────────────────────────────────────────────
  const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

  function assumptionRows() {
    const p = FC.p;
    const row = (a, v, b) => `<tr><td>${a}</td><td class="num">${v}</td><td>${b}</td></tr>`;
    return [
      row('Mix of new clients', `${pct(FC.mix.gf)} Found · ${pct(FC.mix.gl)} Leads · ${pct(FC.mix.dom)} Dominate`, 'Our sales steer, not a benchmark.'),
      row('Yearly churn: Get Found', pct(FC.churnYr.gf), 'SEO-led services churn about 38% a year (Focus Digital, 2026).'),
      row('Yearly churn: Get Leads', pct(FC.churnYr.gl), 'Full-service digital marketing churns about 25% a year (Focus Digital, 2026).'),
      row('Yearly churn: Dominate', pct(FC.churnYr.dom), 'Typical retainer agency, about 18% a year, 56-month client life (Focus Digital, 2026).'),
      row('Stickier with services', `${pct(1 - FC.sticky)} less churn`, 'Clients with a site, shop or CRM from us leave less. Our assumption, based on the high switching costs full-service agencies see.'),
      row('Found → Leads', `${pct(FC.up.gfGl.p)} after month ${FC.up.gfGl.age}`, 'Average upsell take-up is 27.6–29.4% for SaaS and financial services (Focus Digital via Prospeo).'),
      row('Leads → Dominate', `${pct(FC.up.glDom.p)} after month ${FC.up.glDom.age}`, 'Lowest industry average (18.7%), as it is the biggest price jump.'),
      row('New website at sign-up', `${pct(p.static + p.wp)} (${pct(p.static)} static, ${pct(p.wp)} WordPress)`, `A site needs a rebuild about every ${FC.siteLifeYrs} years (Orbit Media), so about ${pct(1 / FC.siteLifeYrs)} are due each year, times a ${pct(FC.take)} take-up. Split 60 / 40 is our assumption.`),
      row('Headless ecommerce shop', pct(p.ecom), `${pct(FC.sellOnline)} of UK SMEs sell online (Small Business Survey 2023) × due a rebuild × ${pct(FC.take)} take-up.`),
      row('Bespoke CRM', `${pct(p.crm)} of Leads / Dominate clients without a site, at month 6`, `${pct(1 - FC.hasCrm)} of SMEs have no CRM (Small Business Survey 2023: 30% of SMEs using web software have one) × ${pct(FC.lowTake)} lowest upsell take-up × a one-third haircut for a £5,000+ purchase (our assumption).`),
      row('Build prices (one-off)', `£${FC.item.static.build.toLocaleString('en-GB')} static · £${FC.item.wp.build.toLocaleString('en-GB')} WordPress · £${FC.item.ecom.build.toLocaleString('en-GB')} shop · £${FC.item.crm.build.toLocaleString('en-GB')} CRM`, 'Our from-prices. Every job is quoted on specs and the work required, so real builds can come in higher.'),
      row('Monthly care (recurring)', `£${FC.item.static.care} site · £${FC.item.ecom.care} shop · £${FC.item.crm.care} CRM`, 'Our care plan range (£99–£300 sites, £300–£500 ecommerce, from £349 CRM), mid-points.'),
    ].join('');
  }

  function runForecast() {
    const kpiEl = $('fcKpis');
    const chartEl = $('fcChart');
    if (!kpiEl || !chartEl) return;
    const n = Math.max(0, Number($('fcNew').value) || 0);
    const months = simulate(n, true);
    const noChurn = simulate(n, false);
    const total = (arr) => arr.reduce((s, x) => s + x.rev.gf + x.rev.gl + x.rev.dom + x.rev.care + x.rev.one, 0);
    const year = total(months);
    const oneOff = months.reduce((s, x) => s + x.rev.one, 0);
    const last = months[months.length - 1];
    const mrr = last.rev.gf + last.rev.gl + last.rev.dom + last.rev.care;
    const active = last.count.gf + last.count.gl + last.count.dom;
    const signed = n * 12;
    kpiEl.innerHTML = `
      <div class="off-kpi"><span>Year-1 revenue</span><b>${gbp(year)}</b><small>${gbp(year - oneOff)} recurring + ${gbp(oneOff)} one-off builds</small></div>
      <div class="off-kpi"><span>Monthly recurring at M12</span><b>${gbp(mrr)}</b><small>run-rate going into year 2</small></div>
      <div class="off-kpi"><span>Clients at M12</span><b>${Math.round(active)} of ${Math.round(signed)}</b><small>${Math.round(last.count.gf)} Found · ${Math.round(last.count.gl)} Leads · ${Math.round(last.count.dom)} Dominate</small></div>
      <div class="off-kpi"><span>Churn costs us</span><b>${gbp(total(noChurn) - year)}</b><small>of year-1 revenue (${year ? Math.round(((total(noChurn) - year) / total(noChurn)) * 100) : 0}%)</small></div>`;
    const sum = (x) => x.rev.gf + x.rev.gl + x.rev.dom + x.rev.care + x.rev.one;
    const max = Math.max(...months.map(sum), 1);
    const H = 150;
    const h = (v) => Math.max(0, Math.round((v / max) * H));
    chartEl.innerHTML = months.map((x) => `
      <div class="off-fc-bar" title="Month ${x.m}: ${gbp(sum(x))} (${gbp(x.rev.one)} one-off)"><i class="g" style="height:${h(x.rev.gf)}px"></i><i class="l" style="height:${h(x.rev.gl)}px"></i><i class="d" style="height:${h(x.rev.dom)}px"></i><i class="c" style="height:${h(x.rev.care)}px"></i><i class="o" style="height:${h(x.rev.one)}px"></i></div>`).join('');
  }

  window.addEventListener('DOMContentLoaded', () => {
    SQ.init(() => {
      render();
      bindQuote();
      $('offBody').addEventListener('input', (e) => { if ((e.target.id || '').startsWith('fc')) runForecast(); });
      runForecast();
    });
  });
})();
