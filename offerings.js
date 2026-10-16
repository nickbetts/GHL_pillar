/* Offerings: the i3MEDIA sales menu. Three packages, one question, clear add-ons.
   Static content; nothing here touches the API beyond SQ.init auth. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gbp = (n) => '£' + Math.round(Number(n) || 0).toLocaleString('en-GB');

  const REC = {
    question: 'If you could fix one thing about your marketing tomorrow, what would it be?',
    map: [
      { quote: '“We can’t be found online.”', pkg: 'Get Found', price: '£795', color: '#64748b' },
      { quote: '“We need more enquiries.”', pkg: 'Get Leads', price: '£1,750', color: '#2563eb', pop: true },
      { quote: '“We want to be number one.”', pkg: 'Dominate', price: '£3,500', color: '#7c3aed' },
    ],
    packages: [
      {
        name: 'Get Found', price: '£795', monthly: 795, color: '#64748b', term: '6-month minimum',
        tag: 'For “we need to be found online”',
        items: ['Website care: hosting, security, updates and content updates', 'Technical SEO so Google can read the site', 'AI search setup (llms.txt, FAQ + schema, author blocks)', '2 authority articles a month', '8 social posts a month', 'Monthly report'],
      },
      {
        name: 'Get Leads', price: '£1,750', monthly: 1750, color: '#2563eb', term: '12-month minimum', badge: 'Most choose this',
        tag: 'For “we need more enquiries”',
        items: ['<b>Everything in Get Found</b>', 'Google + Meta ads managed end-to-end', '2 landing pages built and hosted, free', 'Server-side conversion tracking', 'Fresh ad creatives every month', 'Monthly 30-minute strategy call'],
      },
      {
        name: 'Dominate', price: '£3,500', monthly: 3500, color: '#7c3aed', term: '12-month minimum',
        tag: 'For “we want to be #1”',
        items: ['<b>Everything in Get Leads</b>', '3 landing pages built and hosted', '4 authority articles a month', 'Click-fraud and invalid traffic protection', 'Email + SMS follow-up built and managed', 'Fortnightly strategy calls'],
      },
    ],
    boltOns: [
      ['Static website design', 'One-off build + £99–£300 / month', 'Bespoke static site, live in about 2 weeks depending on page count. Monthly care covers hosting, security, updates and content updates — £99/mo with no content updates, up to £300/mo depending on the work required, agreed with the client upfront.'],
      ['Bespoke WordPress website', 'One-off build + £99–£300 / month', 'Custom WordPress design and build, fully in-house, typically 4–6 weeks. Same care plan. Transferable to the client.'],
      ['Headless ecommerce shop', 'Quoted build + £300–£500 / month', 'Build quoted per project on demand, then £300–£500/mo depending on requirements.'],
      ['Bespoke CRM build', 'From £5,000 one-off + from £349 / month', 'A CRM built around their exact business processes: manages the leads we generate, the sales pipeline, customer communications and email marketing. Monthly covers hosting, support and ongoing tweaks.'],
      ['Tool integrations', 'Quoted per project', 'Connect the CRM or website to their existing tools (accounts, booking, stock, phones). Scoped and quoted once we know what they use.'],
      ['Extra landing page', '£175 one-off + £20 / month', 'More pages for more campaigns.'],
      ['Extra authority article', '£150 each', 'More search topics and buyer questions answered.'],
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
      'Three packages only. If a client wants something different, it\'s a bolt-on or a custom quote, never a fourth package.',
      'Every client gets a 60-day review where we show results and agree the next step.',
      'Get Found and Dominate cover the edges. Get Leads is the one we steer most businesses to.',
      'Pay quarterly: 5% off. Pay yearly in advance: 10% off. Discounts apply to the package fee only, never ad spend or the management fee.',
      'Website builds are a one-off cost plus a care plan from £99/mo (no content updates) up to £300/mo depending on the work required, agreed with the client upfront.',
    ],
  };

  const list = (items, cls = 'dot') => `<ul class="off-list ${cls}">${items.map((t) => `<li>${t}</li>`).join('')}</ul>`;
  const say = (label, text, cls = '') => `<p class="off-say ${cls}"><span class="off-say-label">${esc(label)}</span>${esc(text)}</p>`;

  function pkgCard(p) {
    return `<article class="off-pkg${p.badge ? ' pop' : ''}" style="--tc:${p.color}">
      ${p.badge ? `<span class="off-pkg-badge">${esc(p.badge)}</span>` : ''}
      <h4>${esc(p.name)}</h4>
      <div class="off-price">${esc(p.price)} <small>/ month</small></div>
      <div class="off-pkg-note">${esc(p.tag)} · ${esc(p.term)}</div>
      ${list(p.items, 'pro')}
    </article>`;
  }

  function render() {
    const r = REC;
    const qmap = r.map.map((m) => `
      <div class="off-q${m.pop ? ' pop' : ''}" style="--qc:${m.color}">
        <p class="off-q-quote">${esc(m.quote)}</p>
        <div class="off-q-arrow" aria-hidden="true">↓</div>
        <div class="off-q-pkg">${esc(m.pkg)}<span>${esc(m.price)} / month</span></div>
      </div>`).join('');
    const bolts = r.boltOns.map(([n, p, d]) => `
      <article class="off-bolt">
        <div class="off-bolt-head"><h4>${esc(n)}</h4><span>${esc(p)}</span></div>
        <p>${esc(d)}</p>
      </article>`).join('');
    const valueRows = r.value.map(([a, b]) => `<div class="off-meta-row"><span>${a}</span><b>${b}</b></div>`).join('');
    const billRows = r.packages.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${gbp(p.monthly)} / month</td><td class="num">${gbp(p.monthly * 0.95 * 3)} / quarter</td><td class="num">${gbp(p.monthly * 0.9 * 12)} / year</td></tr>`).join('');

    $('offBody').innerHTML = `<div class="off-view">

      <section class="panel off-hero">
        <div class="off-kicker">i3MEDIA · The sales menu</div>
        <h2 class="off-title">Ask one question.<br />Match the package. Done.</h2>
        <p class="off-lead">Three packages named after the client's problem. You ask one question, hand over the matching package, and justify the price with their own numbers. Nothing else to learn.</p>
        <div class="off-meta">
          <div class="off-meta-row"><span>Packages</span><b>3</b></div>
          <div class="off-meta-row"><span>Prices</span><b>£795 · £1,750 · £3,500</b></div>
          <div class="off-meta-row"><span>Steer most to</span><b>Get Leads</b></div>
          <div class="off-meta-row"><span>If asked about hours</span><b>~1 hr per £100</b></div>
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

      <h3 class="off-h">Say it on the phone</h3>
      <section class="panel"><div class="off-script">
        ${say('30-second pitch', r.phone.script)}
        ${say('If they ask about hours', r.phone.hours, 'obj')}
        ${say(`Objection: "${r.phone.objection[0]}"`, r.phone.objection[1], 'obj')}
      </div></section>

      <h3 class="off-h">Prove the value</h3>
      <p class="off-note">Don't recalculate a price per client. Ask about their numbers, then show why £1,750 is small next to the result. The maths you do out loud on the call:</p>
      <section class="panel"><div class="off-meta off-meta-wide">${valueRows}</div></section>

      <h3 class="off-h">Pay upfront, pay less</h3>
      <p class="off-note">Quarterly in advance: 5% off. Yearly in advance: 10% off. Package fee only, never ad spend.</p>
      <div class="off-table-wrap"><table class="off-table">
        <thead><tr><th>Package</th><th>Pay monthly</th><th>Pay quarterly (−5%)</th><th>Pay yearly (−10%)</th></tr></thead>
        <tbody>${billRows}</tbody>
      </table></div>

      <h3 class="off-h">Add-ons</h3>
      <p class="off-note">The only extras. Websites are a one-off build plus a £99–£300/mo care plan; everything else is a custom quote.</p>
      <div class="off-bolts">${bolts}</div>

      <h3 class="off-h">The rules</h3>
      <section class="panel">${list(r.rules)}</section>

    </div>`;
  }

  window.addEventListener('DOMContentLoaded', () => SQ.init(render));
})();
