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
      { quote: '“We can’t be found online.”', pkg: 'Get Found', price: '£795', color: '#64748b' },
      { quote: '“We need more enquiries.”', pkg: 'Get Leads', price: '£1,750', color: '#2563eb', pop: true },
      { quote: '“We want to be number one.”', pkg: 'Dominate', price: '£3,500', color: '#7c3aed' },
    ],
    packages: [
      {
        id: 'gf', name: 'Get Found', price: '£795', monthly: 795, color: '#64748b', term: '6-month minimum',
        tag: 'For “we need to be found online”',
        items: ['Website care: hosting, security, updates and content updates', 'Technical SEO so Google can read the site', 'AI search setup (llms.txt, FAQ + schema, author blocks)', '2 authority articles a month', '8 social posts a month', 'Monthly report'],
      },
      {
        id: 'gl', name: 'Get Leads', price: '£1,750', monthly: 1750, color: '#2563eb', term: '12-month minimum', badge: 'Most choose this',
        tag: 'For “we need more enquiries”',
        items: ['<b>Everything in Get Found</b>', 'Google + Meta ads managed end-to-end', '2 landing pages built and hosted, free', 'Server-side conversion tracking', 'Fresh ad creatives every month', 'Monthly 30-minute strategy call'],
      },
      {
        id: 'dom', name: 'Dominate', price: '£3,500', monthly: 3500, color: '#7c3aed', term: '12-month minimum',
        tag: 'For “we want to be #1”',
        items: ['<b>Everything in Get Leads</b>', '3 landing pages built and hosted', '4 authority articles a month', 'Click-fraud and invalid traffic protection', 'Email + SMS follow-up built and managed', 'Fortnightly strategy calls'],
      },
    ],
    addOns: [
      {
        group: 'Websites & shops',
        items: [
          ['Static website design', 'One-off build + £99–£300 / month', 'Bespoke static site, live in about 2 weeks depending on page count. Monthly care covers hosting, security, updates and content updates: £99/mo with no content updates, up to £300/mo depending on the work required, agreed with the client upfront.'],
          ['Bespoke WordPress website', 'One-off build + £99–£300 / month', 'Custom WordPress design and build, fully in-house, typically 4–6 weeks. Same care plan. Transferable to the client.'],
          ['Headless ecommerce shop', 'Quoted build + £300–£500 / month', 'Build quoted per project on demand, then £300–£500/mo depending on requirements.'],
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
      objection: ['That\'s more than we wanted to spend.', 'Totally fine. Get Found at £795 gets your website and search right first, and everything carries into Get Leads when you\'re ready. Or if you just need a proper website, a new static site is a one-off build plus £99 a month.'],
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
      'Pay quarterly: 5% off. Pay yearly in advance: 10% off. Discounts apply to the package fee only, never ad spend, add-ons or the management fee.',
      'Website builds are a one-off cost plus a care plan from £99/mo (no content updates) up to £300/mo depending on the work required, agreed with the client upfront.',
    ],
  };

  // ── Quote calculator model ──────────────────────────────────────────────
  const Q_PKG = [
    { id: 'gf', name: 'Get Found', monthly: 795, term: '6-month minimum', color: '#64748b' },
    { id: 'gl', name: 'Get Leads', monthly: 1750, term: '12-month minimum', color: '#2563eb', fee: true },
    { id: 'dom', name: 'Dominate', monthly: 3500, term: '12-month minimum', color: '#7c3aed', fee: true },
    { id: 'none', name: 'No retainer', monthly: 0, term: '', color: '#94a3b8' },
  ];
  const Q_BILL = [
    { id: 'monthly', label: 'Monthly', off: 0, months: 1, unit: 'month' },
    { id: 'quarterly', label: 'Quarterly', off: 0.05, months: 3, unit: 'quarter', hint: '5% off' },
    { id: 'yearly', label: 'Yearly', off: 0.1, months: 12, unit: 'year', hint: '10% off' },
  ];
  const Q_ADD = [
    { id: 'static', group: 'Websites & shops', name: 'Static website', blurb: 'Live in about 2 weeks', build: { label: 'Build price (£)', hint: 'quote it per page count' }, care: { label: 'Monthly care (£)', min: 99, max: 300, def: 99, hint: '£99 with no content updates, up to £300' } },
    { id: 'wp', group: 'Websites & shops', name: 'Bespoke WordPress website', blurb: '4–6 weeks, transferable', build: { label: 'Build price (£)', hint: 'quote it per project' }, care: { label: 'Monthly care (£)', min: 99, max: 300, def: 99, hint: '£99 with no content updates, up to £300' } },
    { id: 'ecom', group: 'Websites & shops', name: 'Headless ecommerce shop', blurb: 'Quoted on demand', build: { label: 'Build price (£)', hint: 'quote it per project' }, care: { label: 'Monthly support (£)', min: 300, max: 500, def: 300, hint: '£300 to £500 by requirements' } },
    { id: 'crm', group: 'Systems', name: 'Bespoke CRM', blurb: 'Built around their exact process', build: { label: 'Build price (£)', min: 5000, def: 5000, from: true, hint: 'from £5,000' }, care: { label: 'Monthly (£)', min: 349, max: 5000, def: 349, from: true, hint: 'from £349' } },
    { id: 'integ', group: 'Systems', name: 'Tool integrations', blurb: 'Quoted after discovery', quoted: true },
    { id: 'lp', group: 'Extras', name: 'Extra landing pages', blurb: '£175 each + £20 / month each', count: true, oneOff: 175, monthly: 20 },
    { id: 'art', group: 'Extras', name: 'Extra authority articles', blurb: '£150 each', count: true, oneOff: 150, monthly: 0 },
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
        rows.push({ name: `${s.n} × ${a.name.replace(/^Extra /, 'extra ')}`, one, mo });
        continue;
      }
      if (!s.on) continue;
      if (a.quoted) { tbc.push('Tool integrations (quoted after discovery)'); rows.push({ name: a.name, note: 'Quoted after discovery' }); continue; }
      const buildVal = Number(s.build) || 0;
      const care = clamp(Number(s.care) || a.care.def, a.care.min, a.care.max);
      if (buildVal > 0) oneOff += buildVal; else tbc.push(`${a.name} build price`);
      addMonthly += care;
      if (a.build.from) from.push(a.name);
      rows.push({ name: a.name, one: buildVal > 0 ? buildVal : null, mo: care, from: !!a.build.from });
    }
    const yearOne = pkgNet * 12 + addMonthly * 12 + oneOff;
    return { p, b, pkgDisc, pkgNet, rows, addMonthly, oneOff, tbc, from, monthlyTotal: pkgNet + addMonthly, yearOne };
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
      <ul class="off-qs-notes">
        ${c.p.term ? `<li>${esc(c.p.term)}.</li>` : ''}
        ${c.p.fee ? `<li>${FEE_NOTE}</li>` : ''}
        ${c.tbc.length ? `<li class="warn">Still to quote: ${c.tbc.map(esc).join('; ')}.</li>` : ''}
        ${c.from.length ? `<li>“From” prices are a starting point; the final figure depends on their requirements.</li>` : ''}
        <li>A rough guide only. We confirm the final price in the meeting.</li>
      </ul>
      <button type="button" class="off-qs-copy" data-copy>Copy summary</button>`;
  }

  function summaryText() {
    const c = computeQuote();
    const out = ['i3MEDIA rough quote'];
    if (c.p.monthly) out.push(`${c.p.name}: ${gbp(c.p.monthly)}/mo${c.pkgDisc ? ` (${Math.round(c.b.off * 100)}% ${c.b.label.toLowerCase()} discount, ${gbp(c.pkgNet)}/mo)` : ''}, ${c.p.term}`);
    c.rows.forEach((r) => {
      const bits = [r.one != null ? `${r.from ? 'from ' : ''}${gbp(r.one)} one-off` : '', r.mo ? `${r.from ? 'from ' : ''}${gbp(r.mo)}/mo` : '', r.note || ''].filter(Boolean).join(' + ');
      out.push(`${r.name}: ${bits}`);
    });
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
          <div class="off-stat"><span>Prices</span><b>£795 · £1,750 · £3,500</b></div>
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
      <p class="off-note">The only extras. Websites are a one-off build plus a £99–£300/mo care plan; everything else is a custom quote.</p>
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
      <p class="off-note">Play with the numbers: how many new clients sign each month, where they start, and how many scale up once we've proved it. Clients move up at month 4 and month 7. No churn, no discounts, the simple case.</p>
      <section class="panel">
        <div class="off-fc-in">
          <label>New clients a month<input type="number" id="fcNew" value="2" min="0" max="60" /></label>
          <label>Start on Get Found %<input type="number" id="fcGf" value="50" min="0" max="100" /></label>
          <label>Start on Get Leads %<input type="number" id="fcGl" value="40" min="0" max="100" /></label>
          <label>Start on Dominate %<input type="number" id="fcDom" value="10" min="0" max="100" /></label>
          <label>Found → Leads upgrade %<small>scales up at month 4</small><input type="number" id="fcUp1" value="50" min="0" max="100" /></label>
          <label>Leads → Dominate upgrade %<small>scales up at month 7</small><input type="number" id="fcUp2" value="25" min="0" max="100" /></label>
        </div>
        <div class="off-fc-kpis" id="fcKpis"></div>
        <div class="off-fc-chart" id="fcChart"></div>
        <div class="off-fc-x">${Array.from({ length: 12 }, (_, i) => `<span>M${i + 1}</span>`).join('')}</div>
        <div class="off-fc-legend"><span><i class="g"></i>Get Found · £795</span><span><i class="l"></i>Get Leads · £1,750</span><span><i class="d"></i>Dominate · £3,500</span></div>
      </section>

      <h3 class="off-h">The rules</h3>
      <section class="panel">${list(r.rules)}</section>

    </div>`;
  }

  // ── Year-one forecast ───────────────────────────────────────────────────
  function fcVal(id) { return Math.max(0, Number($(id).value) || 0); }

  function runForecast() {
    const kpiEl = $('fcKpis');
    const chartEl = $('fcChart');
    if (!kpiEl || !chartEl) return;
    const n = fcVal('fcNew');
    let g = fcVal('fcGf'), l = fcVal('fcGl'), d = fcVal('fcDom');
    const s = g + l + d || 1; g /= s; l /= s; d /= s;
    const up1 = Math.min(fcVal('fcUp1'), 100) / 100, up2 = Math.min(fcVal('fcUp2'), 100) / 100;
    const PRICE = { gf: 795, gl: 1750, dom: 3500 };
    const cohorts = [];
    const bars = [];
    let year = 0;
    for (let m = 1; m <= 12; m++) {
      cohorts.push({ m, gf: n * g, gl: n * l, dom: n * d, u1: false, u2: false });
      for (const co of cohorts) {
        if (!co.u1 && m >= co.m + 3) { const mv = co.gf * up1; co.gf -= mv; co.gl += mv; co.u1 = true; }
        if (!co.u2 && m >= co.m + 6) { const mv = co.gl * up2; co.gl -= mv; co.dom += mv; co.u2 = true; }
      }
      let gf = 0, gl = 0, dom = 0;
      for (const co of cohorts) { gf += co.gf; gl += co.gl; dom += co.dom; }
      const mrr = gf * PRICE.gf + gl * PRICE.gl + dom * PRICE.dom;
      year += mrr;
      bars.push({ m, gf, gl, dom, mrr });
    }
    const last = bars[bars.length - 1];
    const clients = last.gf + last.gl + last.dom;
    kpiEl.innerHTML = `
      <div class="off-kpi"><span>Year-1 revenue</span><b>${gbp(year)}</b><small>12 months of fees</small></div>
      <div class="off-kpi"><span>Monthly revenue at M12</span><b>${gbp(last.mrr)}</b><small>run-rate going into year 2</small></div>
      <div class="off-kpi"><span>Clients at M12</span><b>${Math.round(clients)}</b><small>${Math.round(last.gf)} Found · ${Math.round(last.gl)} Leads · ${Math.round(last.dom)} Dominate</small></div>
      <div class="off-kpi"><span>Avg fee per client</span><b>${clients ? gbp(last.mrr / clients) : '£0'}</b><small>upgrades lift it over time</small></div>`;
    const max = Math.max(...bars.map((b) => b.mrr), 1);
    const H = 150;
    const h = (v) => Math.max(0, Math.round((v / max) * H));
    chartEl.innerHTML = bars.map((b) => `
      <div class="off-fc-bar" title="Month ${b.m}: ${gbp(b.mrr)} / month — ${b.gf.toFixed(1)} Found, ${b.gl.toFixed(1)} Leads, ${b.dom.toFixed(1)} Dominate"><i class="g" style="height:${h(b.gf * PRICE.gf)}px"></i><i class="l" style="height:${h(b.gl * PRICE.gl)}px"></i><i class="d" style="height:${h(b.dom * PRICE.dom)}px"></i></div>`).join('');
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
