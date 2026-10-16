/* Offerings: current runbook plus alternative packaging models for the sales team.
   All content is static draft data; nothing here touches the API beyond SQ.init auth. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gbp = (n) => '£' + Math.round(Number(n) || 0).toLocaleString('en-GB');
  const roundTo = (n, step) => Math.round(n / step) * step;

  const SCALE_FEE = 'Ad spend paid direct to the platform. Management fee of 10% on spend above £5,000 up to £20,000, then 7.5% above £20,000, billed in arrears.';
  // Effective hourly rate of the current runbook tiers; value prices never go below it.
  const HOURLY_FLOOR = 85;

  // ── Current runbook (mirrors i3pricing/i3.html) ─────────────────────────
  const RUNBOOK = {
    summary: [
      ['Contract structure', 'Core Marketing Setup and Lead-Gen Fast-Track run on a 3-month minimum, then rolling monthly. Active Acquisition Suite and Total Growth Solution are sold on 6 or 12-month agreements.'],
      ['Rolling cancellation', '30 days written notice.'],
      ['Ad spend handling', 'Always paid directly by the client to the platform.'],
      ['Scaling management fee', '10% on ad spend above £5,000 up to £20,000, then 7.5% on the portion above £20,000, per client, billed in arrears from actual platform invoices.'],
      ['Ownership', 'Client owns accounts, data and creative. i3MEDIA-hosted landing pages, Performance Sites and Headless Shopify builds are not transferred on exit. In-house WordPress websites are transferable.'],
      ['Landing pages', '£150 to £200 one-off design plus mandatory £20 per month for hosting, security, uptime monitoring and minor edits.'],
      ['Performance Sites', '£300 per month, no setup fee, static sites only, no ecommerce.'],
      ['Ecommerce offer', 'Headless Shopify build at £1,000 one-off plus £100 per month support.'],
      ['AIO and GEO baseline', 'Foundation rollout includes llms.txt, llms-full.txt, author and bio blocks, FAQ schema and advanced schema matched to service pages.'],
    ],
    tiers: [
      {
        name: 'Core Marketing Setup', price: '£1,000', color: '#64748b', hours: '10 to 12 hours', segment: 'Foundational / early stage brands', term: '3-month minimum',
        intro: 'The foundation tier. Sets up the core website, content and campaign support needed to grow safely.',
        delivers: [
          ['Website and indexing checks', 'Resolve crawl and indexing issues across key pages.'],
          ['Core on-page improvements', 'Improve titles, page structure and service page clarity.'],
          ['Content foundation', 'Publish useful expert-led content to build authority in your niche.'],
          ['Social consistency', 'Up to 8 branded social assets per month to keep channels active.'],
          ['AIO and GEO foundations', 'llms.txt, llms-full.txt, author and bio blocks, FAQ schema and advanced schema on core pages.'],
        ],
        limits: [['Website management', 'Up to 5 core service pages maintained.'], ['Content delivery', '1 authority article per month.'], ['Social output', 'Up to 8 social assets per month.'], ['Review cadence', 'Monthly written reporting only.']],
        excluded: ['Ad spend, platform charges and third-party software licence fees.', 'Full website redesigns and custom integrations outside agreed scope.', 'Legal, tax or regulatory advisory services.'],
        script: 'Most entry packages are just light admin support. Our Core Marketing Setup gives clients a proper foundation. We sort out indexing issues, tighten page structure, and publish content that supports long-term visibility. It gives the business a clean base to scale from.',
      },
      {
        name: 'Lead-Gen Fast-Track', price: '£1,475', color: '#3b82f6', hours: '14 to 16 hours', segment: 'High velocity acquisition brands', term: '3-month minimum',
        intro: 'Everything in Core Marketing Setup plus a stronger paid lead generation engine for businesses that need consistent enquiry volume.',
        delivers: [
          ['Google and Meta management', 'Active campaign setup, monitoring and optimisation.'],
          ['Creative testing', 'Multiple ad angles and formats tested each month.'],
          ['Lead-focused landing support', 'Fast pages aligned to campaign intent.'],
          ['Monthly reporting', 'Clear updates on spend, lead quality and next actions.'],
        ],
        limits: [['Paid channels', 'Up to 2 paid platforms actively managed.'], ['Creative output', 'Up to 6 new paid creatives per month.'], ['Reporting cadence', 'Monthly paid performance summary only.'], ['Spend handling', SCALE_FEE], ['AIO and GEO upkeep', 'Monthly refresh of llms files, author coverage, FAQ and advanced schema on priority revenue pages.']],
        excluded: ['Ad spend and third-party tool fees.', 'Additional channels beyond agreed limits unless scoped as bolt-ons.', 'Custom development outside retainer scope.'],
        script: 'This is for businesses that need a steady flow of leads. We keep the Core setup in place and add active paid campaign management across Google and Meta. We test creative properly, improve landing performance, and report clearly so clients can see what is working.',
      },
      {
        name: 'Active Acquisition Suite', price: '£2,000 – £2,500', color: '#10b981', hours: '20 to 25 hours', segment: 'Scaling mid-market operations', term: '6 or 12 months',
        intro: 'Everything in Core Marketing Setup and Lead-Gen Fast-Track plus stronger protection, deeper optimisation and broader channel delivery.',
        delivers: [
          ['Traffic quality controls', 'Reduce invalid clicks and protect paid spend.'],
          ['Multi-channel planning', 'Stronger alignment across paid search, paid social and remarketing.'],
          ['Authority expansion', 'Additional content and outreach to improve trust and visibility.'],
          ['Conversion improvements', 'Ongoing page and funnel updates based on live performance data.'],
        ],
        limits: [['Conversion work', 'Up to 2 landing page optimisation cycles per month.'], ['Planning cadence', '1 strategy call per month.'], ['Channel coverage', 'Multi-channel optimisation within approved platform set.'], ['Spend handling', SCALE_FEE], ['AIO and GEO expansion', 'Advanced schema rollouts, answer block optimisation and author trust enhancements on high-priority pages.']],
        excluded: ['Ad spend and third-party platform fees.', 'Net-new platform rollouts outside agreed channel plan.', 'Complex engineering or system integrations unless separately scoped.'],
        script: 'This tier is built for growing brands that need better control as spend increases. We keep all lower-tier delivery in place and add tighter traffic quality controls, broader channel planning, and deeper conversion work. It protects budget and improves lead quality.',
      },
      {
        name: 'Total Growth Solution', price: '£3,000 – £4,000', color: '#8b5cf6', hours: '35 to 45 hours', segment: 'Enterprise market dominance', term: '6 or 12 months',
        intro: 'Everything in the three tiers below plus full-scale strategic support for businesses pushing for market leadership.',
        delivers: [
          ['Full-funnel strategy', 'Joined-up planning from traffic generation through to sales outcomes.'],
          ['Advanced reporting', 'Deeper business reporting tied to margin and revenue priorities.'],
          ['Leadership support', 'Monthly strategic planning sessions with clear commercial priorities.'],
          ['Priority implementation', 'Faster delivery on agreed campaign, website and conversion actions.'],
        ],
        limits: [['Priority queue', 'Priority response window for agreed high-impact actions.'], ['Leadership cadence', '1 monthly leadership strategy session.'], ['Implementation capacity', 'Up to 4 priority implementation items per month.'], ['Spend handling', SCALE_FEE], ['AIO and GEO governance', 'Priority implementation of llms files, FAQ and advanced schema maintenance, continual authority signal improvements.']],
        excluded: ['Ad spend and external tool costs.', 'Out-of-scope builds not listed in the agreed monthly priorities.', 'Legal, regulatory or financial advisory work.'],
        script: 'This is our top tier for brands that want full growth support. It includes all work from the lower tiers and adds senior strategic input, deeper reporting, and priority implementation. It is built for businesses that want to scale quickly with clear commercial control.',
      },
    ],
    terms: [
      ['Retainer term', 'Core and Lead-Gen have a 3-month minimum, then rolling monthly. Active Acquisition and Total Growth are sold on 6 or 12-month contracts.'],
      ['Rolling cancellation', '30 days written notice.'],
      ['Billing', 'Retainers billed monthly in advance. Ad spend management fee billed in arrears from actual platform invoices. Delivery may pause if invoices remain overdue.'],
      ['Ad spend', 'Always paid directly by the client to platforms.'],
      ['Scaling fee', 'Per client, 10% on ad spend above £5,000 up to £20,000, then 7.5% on the portion above £20,000.'],
      ['Prepay discount', 'Discounted prepay available on 12-month agreements only.'],
      ['Annual uplift', 'Annual pricing updates follow CPI only.'],
      ['Minimum fee floor', 'Set at quote stage.'],
      ['Overage billing', 'Out-of-scope overage billed in 1-hour increments.'],
      ['Ownership', 'Client owns account access, history and performance data. i3MEDIA-hosted landing pages, Performance Sites and Headless Shopify builds are not transferred on exit. In-house WordPress websites are transferable.'],
      ['Scope control', 'Work outside listed deliverables moves to bolt-on pricing or a separate scoped quote.'],
    ],
    boltOns: [
      ['Custom Landing Pages', '£150 – £200 one-off + £20 / month', 'One-off landing page design and build with mandatory hosting and upkeep (hosting, security, uptime monitoring, minor monthly edits).', 'We do not send paid traffic to generic service pages. This gives the client a dedicated landing page built for conversion. Design is a one-off fee, then hosting is £20 per month. Hosted pages are not transferred on exit.'],
      ['Email Campaign Frameworks', '£450 / month', 'Lifecycle planning, list cleanup and automated email sequences designed for stronger open and response rates.', 'Paid traffic brings people in. Email turns interest into repeat sales. This gives the client a proper follow-up engine so leads do not go cold.'],
      ['SMS Campaign Engines', '£250 / month', 'SMS campaign setup with automated triggers for offers, reminders and appointment actions.', 'If a client needs fast responses, text is one of the quickest channels. We set up targeted SMS campaigns for short-window offers and urgent booking gaps.'],
      ['Single Channel Bolt-on', '£650 / month', 'Expand the main channel strategy into one additional channel with managed setup, creative and budget controls.', 'Once the main channel performs well, this opens a second channel using the same proven offer and message. It grows reach without changing the core plan.'],
      ['AIO and GEO Optimisation Setup', '£450 / month', 'Ongoing AIO and GEO implementation: llms.txt, llms-full.txt, author and bio blocks, FAQ schema and advanced schema with monthly upkeep.', 'People now expect direct answers in search engines and AI answer surfaces. This gives the client the right technical and content structure so services are easier to surface and trust.'],
      ['Additional Blog Posts', '£150 each', 'Topic planning, copywriting and publishing support for additional authority articles.', 'Extra articles help a client cover more search topics and answer common buyer questions. A practical way to build visibility over time.'],
      ['Social Sharing Booster', '£200 / month', 'Up to 8 additional social assets per month with scheduling and brand-aligned copy.', 'Consistency matters on social channels. This keeps feeds active and professional with additional monthly output.'],
      ['Five-Hour Resource Block', '£450 / month', 'A flexible five-hour monthly block for urgent design, website or campaign tasks.', 'Guaranteed monthly support time for quick changes, urgent launches and priority fixes without delay.'],
      ['In-House WordPress Website', 'Custom quote', 'Custom WordPress design and build delivered fully in-house, scoped and quoted per project. Transferable to the client.', 'If a client needs a full rebuild in WordPress, we handle design and build in-house. The quote is tailored to page count, functionality and timeline.'],
      ['Performance Sites', '£300 / month, no setup fee', 'Fully managed high-performance static site, up to 10 pages, with AIO and GEO foundations built in. No ecommerce. Not transferred on exit.', 'For clients who want a fast modern site without a large upfront cost. Ideal for brochure and lead generation sites up to 10 pages.'],
      ['Headless Shopify Ecommerce', '£1,000 one-off + £100 / month', 'Headless Shopify build for a faster storefront and custom front-end control, with monthly support including AIO and GEO maintenance. Non-transferable.', 'If a client needs ecommerce and wants speed plus flexibility, this is the right fit. High-performance and non-transferable, in line with our hosted site model.'],
      ['Contextual Guest Post Outreach', '£450 – £600 / month', 'Targeted domain outreach and guest article placements focused on relevance and quality.', 'Cheap backlink packs can damage a site. This focuses on relevant placements and quality articles to build authority safely over time.'],
    ],
    matrix: [
      ['Analytics & signals', 'Browser-only tracking that is often blocked, leaving gaps in lead and sales reporting.', 'Server-side tracking through the client domain for more reliable conversion reporting.'],
      ['Bidding efficiency', 'Campaigns optimised only for top-line revenue.', 'Campaigns optimised for profit signals so spend favours better-margin outcomes.'],
      ['Conversion loops', 'Slow form-first journeys that lose mobile users before contact is made.', 'Faster enquiry routes with clear calls to action and cleaner mobile handover.'],
      ['Data compliance', 'Manual list uploads with weak governance and unclear handling standards.', 'Structured first-party data processes with privacy controls and clear audit trail.'],
      ['Creative performance', 'One-size-fits-all ad creative with very little variation.', 'Purpose-built creative sets tested by channel, audience and offer angle.'],
      ['Web speed', 'Heavy website builds that load slowly on mobile devices.', 'Lean front-end delivery and speed-first pages designed to convert paid traffic.'],
      ['Portals & upgrades', 'Single-stack systems that are hard to update and easy to bottleneck.', 'Decoupled delivery with cleaner pathways for updates, dashboards and client portals.'],
      ['Human form checks', 'Intrusive form checks that add friction and reduce completions.', 'Low-friction form protection that preserves user experience.'],
      ['Paid traffic defence', 'Fraud checks only after spend has already been lost.', 'Edge-level controls that reduce invalid traffic before it wastes budget.'],
      ['Search & social structure', 'Fragmented campaign structures with poor data flow.', 'Unified campaign structure with clear testing, budgeting and reporting standards.'],
      ['Authority building', 'Low-quality outreach and content with weak relevance.', 'Topical outreach and expert-led content that supports long-term rankings.'],
      ['Consent & privacy', 'Cookie and consent tools that are poorly configured and hard to maintain.', 'Consent and privacy controls configured properly with lightweight implementation.'],
    ],
  };

  // ── Alternative packaging models ────────────────────────────────────────
  const MIX = {
    foundation: { name: 'Foundation', price: 395, desc: 'Server-side tracking, website care (5 pages), AIO/GEO baseline, monthly report, account manager.' },
    modules: [
      { id: 'seo', name: 'SEO & content', price: 450, desc: 'Technical and on-page SEO, 1 authority article a month.' },
      { id: 'google', name: 'Google Ads', price: 550, desc: 'Search and Performance Max managed, 3 creatives a month.' },
      { id: 'meta', name: 'Meta Ads', price: 550, desc: 'Facebook and Instagram managed, 3 creatives a month.' },
      { id: 'social', name: 'Social content', price: 300, desc: '8 branded posts a month, scheduled.' },
      { id: 'lp', name: 'Landing pages & CRO', price: 400, desc: '1 new landing page (hosted) or 1 CRO cycle a month.' },
      { id: 'email', name: 'Email automation', price: 450, desc: 'Nurture sequences, list cleanup, monthly campaign.' },
      { id: 'sms', name: 'SMS engine', price: 250, desc: 'Reminders, offers and missed-call text back.' },
      { id: 'outreach', name: 'Authority outreach', price: 500, desc: '2 relevant guest placements a month.' },
      { id: 'fraud', name: 'Click-fraud protection', price: 150, desc: 'Edge-level invalid traffic filtering on paid spend.' },
      { id: 'site', name: 'Performance Site', price: 300, desc: 'Managed static site up to 10 pages, no setup fee.' },
      { id: 'strategy', name: 'Monthly strategy call', price: 150, desc: '60-minute planning session with a senior strategist.' },
    ],
    discounts: [[5, 0.15], [3, 0.10]],
  };

  const CREDIT_PLANS = [
    { name: 'Starter', credits: 10, price: 950 },
    { name: 'Growth', credits: 20, price: 1800 },
    { name: 'Scale', credits: 35, price: 2950 },
    { name: 'Enterprise', credits: 50, price: 3950 },
  ];
  const CREDIT_TOPUP = 100;
  const CREDIT_MENU = [
    { id: 'gads', name: 'Google Ads managed (month)', c: 6 },
    { id: 'mads', name: 'Meta Ads managed (month)', c: 6 },
    { id: 'article', name: 'Authority article', c: 2 },
    { id: 'social', name: '8 social posts', c: 3 },
    { id: 'lp', name: 'Landing page built + hosted', c: 4 },
    { id: 'cro', name: 'CRO cycle', c: 3 },
    { id: 'email', name: 'Email sequence or campaign', c: 3 },
    { id: 'sms', name: 'SMS campaign', c: 2 },
    { id: 'seo', name: 'Technical SEO sprint', c: 4 },
    { id: 'aio', name: 'AIO/GEO refresh', c: 2 },
    { id: 'outreach', name: 'Outreach placement', c: 3 },
    { id: 'call', name: 'Strategy call', c: 1 },
    { id: 'hour', name: 'Ad-hoc hour', c: 1 },
  ];

  const OPTIONS = [
    {
      id: 'set', short: 'Set packages', name: 'Three set packages',
      tagline: 'Three fixed-price packages with one obvious middle choice. No price ranges and no maths on the call.',
      bestFor: 'Fast phone closes, new reps, and SMEs who want to be told what they need.',
      typical: '£1,750 / month', term: '3, 6 or 12 months',
      scores: { phone: 5, flex: 2, deal: 3, run: 5 },
      pkgTitle: 'The packages',
      packages: [
        { name: 'Launch', price: '£995', unit: '/ month', note: '3-month minimum, then rolling', items: ['Website care for up to 5 core pages', 'Technical SEO and indexing fixes', 'AIO/GEO foundations (llms.txt, FAQ + advanced schema, author blocks)', '1 authority article a month', '8 social posts a month', 'Monthly written report'] },
        { name: 'Grow', price: '£1,750', unit: '/ month', note: '6-month minimum', badge: 'Most popular', items: ['<b>Everything in Launch</b>', 'Google + Meta ads managed', '6 new ad creatives a month', '1 landing page built and hosted', 'Server-side conversion tracking', 'Monthly 30-minute strategy call'] },
        { name: 'Scale', price: '£2,950', unit: '/ month', note: '12-month minimum', items: ['<b>Everything in Grow</b>', 'Click-fraud and invalid traffic protection', '2 CRO / landing page cycles a month', 'Email nurture sequence built and managed', '2 outreach placements a month', 'Priority queue + fortnightly calls', 'Profit-led reporting tied to margin'] },
      ],
      boltOns: [['Extra landing page', '£175 one-off + £20 / month'], ['Extra authority article', '£150 each'], ['SMS engine', '£250 / month'], ['Five-hour resource block', '£450 / month'], ['Performance Site', '£300 / month'], ['Headless Shopify build', '£1,000 + £100 / month']],
      rules: [SCALE_FEE + ' Applies to Grow and Scale.', 'No custom discounts. The only lever is term: 12 months prepaid gets 1 month free.', 'Bolt-on list is capped at six items so reps can remember it.', 'Websites are always a separate line (Performance Site, Shopify or WordPress quote).'],
      pros: ['Reps can learn it in an afternoon.', 'The middle option anchors the call. Most people buy Grow.', 'Predictable delivery hours and margin.', 'Fits on a one-page leave-behind.'],
      cons: ['Clients who need one thing feel they are overpaying.', 'Pushes anything bespoke into bolt-ons or quotes.', 'Only one step down if price is the objection.'],
      discovery: 'Are you mainly after more visibility, more enquiries, or both? And are you running any ads at the moment?',
      script: 'We keep it simple: we have three packages. Launch gets your website and search visibility sorted, Grow adds managed Google and Meta ads to bring in enquiries, and Scale is for businesses pushing hard with more channels and conversion work. Most businesses your size go with Grow at £1,750 a month. Shall I talk you through what you would get in the first 90 days?',
      objection: ['That is more than we wanted to spend.', 'No problem. Launch at £995 gets the foundations right first, and we switch on ads when you are ready. Nothing is wasted, it all carries into Grow.'],
    },
    {
      id: 'mix', short: 'Pick & mix', name: 'Foundation + pick & mix modules',
      tagline: 'A small mandatory foundation, then clients pick the modules they want. Bundle discounts reward picking more.',
      bestFor: 'Clients who already have some marketing in place, or who know exactly what they want.',
      typical: '£1,300 – £2,200 / month', term: '3-month minimum per module',
      scores: { phone: 3, flex: 5, deal: 4, run: 3 },
      calc: 'mix',
      rules: ['Foundation is mandatory and never discounted. It is what makes everything measurable.', 'Pick 3–4 modules: 10% off modules. Pick 5 or more: 15% off modules.', 'Modules can be added any time. Removing one needs 30 days notice after its 3-month minimum.', SCALE_FEE],
      pros: ['The client feels in control of what they pay for.', 'Easy upsell: one more module at a time.', 'Fits clients part-way through with another agency or in-house team.'],
      cons: ['Longer calls and decision paralysis.', 'Clients cherry-pick the cheapest modules.', 'Delivery is harder to standardise across accounts.'],
      discovery: 'What are you already doing yourselves or with someone else, and what is not working?',
      script: 'Every client starts with our £395 foundation: tracking, website care, AI search setup and reporting, so we can actually measure what is working. On top of that you choose what you need: Google Ads, Meta, SEO, email, whatever fits. Pick three or more and you get 10% off the modules. What is the one thing you would want sorted first?',
      objection: ['Can we just have the Google Ads module?', 'You can. It is foundation plus Google Ads, £945 a month. The foundation is what makes the ads measurable, so it is the only thing that is not optional.'],
    },
    {
      id: 'problem', short: 'Problem-led', name: 'Problem-led bundles',
      tagline: 'Package by the problem the client says out loud on the call: not found, not enough leads, leads not converting, or no online shop.',
      bestFor: 'Cold outbound calls. The names map straight onto the discovery question.',
      typical: '£1,295 / month', term: '6 months',
      scores: { phone: 5, flex: 3, deal: 4, run: 4 },
      pkgTitle: 'The bundles',
      pkgNote: 'Any two bundles together: 15% off. All three core bundles as "Full Engine": £2,450 / month (saves £535).',
      packages: [
        { name: 'Get Found', price: '£895', unit: '/ month', note: '"Nobody can find us online."', items: ['Technical SEO and indexing', 'AIO/GEO setup (llms.txt, FAQ + advanced schema, author blocks)', '2 authority articles a month', 'Google Business Profile optimisation', 'Monthly ranking and AI visibility report'] },
        { name: 'Get Leads', price: '£1,295', unit: '/ month', note: '"We need more enquiries."', badge: 'Most asked for', items: ['Google + Meta ads managed', '1 landing page built and hosted', 'Server-side conversion tracking', '6 creatives a month', 'Click-fraud protection', 'Monthly lead quality report'] },
        { name: 'Get Converted', price: '£795', unit: '/ month', note: '"We get leads but they go nowhere."', items: ['Email nurture sequences', 'SMS follow-up and reminders', '1 landing page CRO cycle a month', 'Speed-to-lead: instant reply and missed-call text back', 'Monthly funnel report'] },
        { name: 'Sell Online', price: '£595', unit: '/ month', extra: '+ £1,000 one-off build', note: '"We want to sell online."', items: ['Headless Shopify build', 'Shopping and Performance Max ads managed', 'Abandoned basket email flows', 'AIO/GEO product schema', 'Monthly sales report'] },
      ],
      boltOns: [['Full Engine (Found + Leads + Converted)', '£2,450 / month'], ['Any two bundles', '15% off both'], ['Extra authority article', '£150 each'], ['Performance Site', '£300 / month']],
      rules: ['Each bundle has a hard scope line written into the proposal so bundles do not overlap.', 'Reps lead with the discovery question, never with a price list.', SCALE_FEE],
      pros: ['The discovery question leads straight into the right bundle.', 'The client hears their own problem in the product name.', 'Natural next sale: "now let\u2019s fix conversion".'],
      cons: ['Some overlap between bundles to police.', 'Bundles need firm scope lines.', 'Does not suit "do everything" clients, so Full Engine covers them.'],
      discovery: 'If you could fix one thing in your marketing tomorrow, what would it be?',
      script: 'Most businesses we speak to have one of three problems: people cannot find them, they are not getting enough enquiries, or the enquiries they get do not turn into customers. Which one sounds most like you? … Right, that is exactly what our Get Leads bundle fixes. It is £1,295 a month, and here is what happens in the first 30 days.',
      objection: ['We have all three problems.', 'Most do. Full Engine covers all three for £2,450 a month, about £535 less than buying them separately.'],
    },
    {
      id: 'ladder', short: 'Land & expand', name: 'Land & expand ladder',
      tagline: 'Get a small yes on the first call, then climb a clear upgrade ladder once results show.',
      bestFor: 'Price-sensitive small businesses, sole traders, and cold leads who have never used an agency.',
      typical: '£300 → £1,400 / month', term: 'Rolling (step 1), 3 months (steps 2+)',
      scores: { phone: 5, flex: 3, deal: 2, run: 4 },
      pkgTitle: 'The ladder',
      pkgNote: 'Prices are cumulative. Clients can join at any step. The ladder is just the default path.',
      packages: [
        { name: 'Step 1 · Website', price: '£300', unit: '/ month', extra: 'No setup fee', note: 'Or Shopify: £1,000 + £100 / month', items: ['Performance Site, up to 10 pages', 'Hosting, security and minor edits', 'AIO/GEO foundations built in', 'Live in 14 days'] },
        { name: 'Step 2 · Visible', price: '£750', unit: '/ month', extra: '+£450 on step 1', items: ['Technical and local SEO', '1 authority article a month', 'Google Business Profile', 'Monthly visibility report'] },
        { name: 'Step 3 · Leads', price: '£1,400', unit: '/ month', extra: '+£650 on step 2', badge: 'Target step', items: ['One ad platform managed (Google or Meta)', 'Landing page built and hosted', 'Conversion tracking', 'Monthly strategy call'] },
        { name: 'Step 4 · Growth', price: '£2,300', unit: '/ month', extra: '+£900 on step 3', items: ['Second ad channel', 'Email and SMS follow-up', 'CRO cycles', 'Click-fraud protection', 'Fortnightly calls'] },
      ],
      rules: ['An upgrade review is booked at day 60 on every account.', 'Reps earn commission on upgrades, not just new logos.', 'Sites on step 1 follow the runbook ownership rule: not transferred on exit.', SCALE_FEE + ' Applies from step 3.'],
      pros: ['Easiest yes on a cold call: £300 a month is a low-risk decision.', 'Fast to close, lots of logos quickly.', 'Every client has an obvious next step.'],
      cons: ['Low starting revenue per client.', 'Relies on account managers actually upselling.', 'Lots of small accounts means more admin.'],
      discovery: 'When was your website last rebuilt, and does it actually bring you enquiries?',
      script: 'Rather than ask you to commit to a big retainer, most clients start with a new high-speed website for £300 a month. No setup fee, live in two weeks, and built to show up in Google and AI search. Once it is live and you are happy, we look at switching on leads. Want me to show you a couple we have done?',
      objection: ['We already have a website.', 'Great, then you start at step two: we make it visible for £450 a month. Same ladder, you just skip a rung.'],
    },
    {
      id: 'credits', short: 'Growth credits', name: 'Growth credits subscription',
      tagline: 'One simple monthly plan buys a pot of credits. Clients spend them on whatever they need that month.',
      bestFor: 'Clients with changing priorities, seasonal businesses, and anyone who hates fixed scope.',
      typical: '£1,800 / month', term: '6 months',
      scores: { phone: 3, flex: 5, deal: 4, run: 2 },
      calc: 'credits',
      rules: ['Every plan includes reporting, website care and tracking at no credit cost.', 'Credits are planned on the monthly call and locked by the 5th.', 'Unused credits roll over one month, then expire.', `Top-ups are £${CREDIT_TOPUP} per credit. 1 credit is roughly 1 hour of senior time.`, SCALE_FEE],
      pros: ['One price to say on the phone, flexible behind it.', 'Clients never feel they pay for things they do not use.', 'Out-of-scope requests become top-ups, not arguments.'],
      cons: ['Needs a credit tracker in the client portal.', 'Harder to explain than a fixed list.', 'Delivery capacity is harder to forecast.'],
      discovery: 'Do your priorities change much through the year: busy seasons, launches, quiet months?',
      script: 'Instead of a fixed list, you get a monthly plan with credits. Growth is 20 credits for £1,800. Each month we agree how to spend them: ads, articles, landing pages, email, whatever will move the needle. Busy season, push it into ads. Quiet month, build content. You are never paying for things you do not need.',
      objection: ['How do I know what a credit is worth?', 'About an hour of senior time. An article is 2 credits, a landing page is 4, a month of Google Ads is 6. It is all on the menu, nothing hidden.'],
    },
    {
      id: 'value', short: 'Value-based', name: 'Value-based pricing', alt: true,
      tagline: 'Price on what the work is worth to the client, not the hours it takes. Anchor every number to their business, not our rate card.',
      bestFor: 'High customer value sectors (financial advisers, law firms, clinics, B2B services) where one extra customer pays for a month.',
      typical: '10–20% of value created', term: '12 months, reviewed quarterly',
      scores: { phone: 3, flex: 4, deal: 5, run: 3 },
      calc: 'value',
      steps: [
        '<b>Ask the five value questions</b> before any price is mentioned.',
        '<b>Work out the gap:</b> extra customers a month × what a customer is worth × 12.',
        '<b>Price at 10–20% of the first-year value created</b>, so the client still sees a 5–10× return.',
        '<b>Never go below the delivery floor:</b> hours needed × £85, our current runbook rate.',
        '<b>Present three outcome options</b> (conservative, target, stretch) and recommend the middle one.',
      ],
      questions: [
        'What is a new customer worth to you on average over the first year?',
        'How many new enquiries do you get in a typical month?',
        'Out of every 10 enquiries, how many become customers?',
        'How many more customers a month could you actually handle?',
        'What would that extra growth mean for the business this year?',
      ],
      rules: [
        '<b>Optional performance structure:</b> base fee at 70% of the value price, plus a bonus per qualified lead above an agreed baseline, capped at 150% of the full fee.',
        'Never pure commission. There is always a base fee that covers delivery.',
        'Baseline (leads, close rate) is measured over the first 60 days and agreed in writing.',
        'Tracking must be live before any performance element starts.',
        'Value is reviewed quarterly. If we are off target, we change the plan or step down a tier.',
        'Low-value sectors (customers worth under £500) go on set packages instead.',
      ],
      pros: ['Price stops being compared to other agencies\u2019 hourly rates.', 'Higher average deal value in high-value sectors.', 'The call is about their growth, not our hours, so it feels consultative.', 'Aligns us with results the client cares about.'],
      cons: ['Needs a proper discovery call, so reps need training.', 'Needs reliable tracking to prove the value.', 'Does not work for low-value customers (e.g. £50 orders).'],
      discovery: 'Before I talk price, can I ask a couple of quick questions about your numbers?',
      script: 'So if a new client is worth around £3,000 to you and we help you win three more a month, that is over £100,000 extra this year. Our fee for that is £1,350 a month, roughly a 6 to 1 return. Does that sort of maths make sense for you?',
      objection: ['What if it does not work?', 'That is why we agree a baseline and review every quarter. If we are not on track, we change the plan or step down a tier. You are never paying for growth you are not getting.'],
    },
  ];

  const VIEWS = [
    { id: 'runbook', label: 'Current runbook' },
    ...OPTIONS.map((o, i) => ({ id: o.id, label: o.short, n: i + 1, alt: o.alt })),
    { id: 'compare', label: 'Compare' },
  ];

  const state = {
    view: 'runbook',
    mix: new Set(['seo', 'google', 'lp']),
    credits: { gads: 1, article: 2, social: 1, lp: 1, call: 1 },
    value: { customerValue: 3000, enquiries: 20, closeRate: 25, extra: 3, share: 15, hours: 14 },
  };

  // ── Shared bits ─────────────────────────────────────────────────────────
  const dots = (n) => `<span class="off-dots" aria-label="${n} out of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'f' : ''}"></i>`).join('')}</span>`;
  const list = (items, cls = 'dot') => `<ul class="off-list ${cls}">${items.map((t) => `<li>${t}</li>`).join('')}</ul>`;
  const say = (label, text, cls = '') => `<p class="off-say ${cls}"><span class="off-say-label">${esc(label)}</span>${esc(text)}</p>`;

  function pkgCard(p) {
    return `<article class="off-pkg${p.badge ? ' pop' : ''}">
      ${p.badge ? `<span class="off-pkg-badge">${esc(p.badge)}</span>` : ''}
      <h4>${esc(p.name)}</h4>
      <div class="off-price">${esc(p.price)} <small>${esc(p.unit || '')}</small></div>
      ${p.extra ? `<div class="off-price-extra">${esc(p.extra)}</div>` : ''}
      ${p.note ? `<div class="off-pkg-note">${esc(p.note)}</div>` : ''}
      ${list(p.items, 'pro')}
    </article>`;
  }

  // ── Runbook view ────────────────────────────────────────────────────────
  function renderRunbook() {
    const r = RUNBOOK;
    const tiers = r.tiers.map((t) => `
      <article class="off-tier" style="--tc:${t.color}">
        <div class="off-tier-head"><h4>${esc(t.name)}</h4><div class="off-price">${esc(t.price)} <small>/ month</small></div></div>
        <div class="off-tier-meta"><span class="chip">${esc(t.hours)}</span><span class="chip">${esc(t.term)}</span><span class="chip info">${esc(t.segment)}</span></div>
        <p>${esc(t.intro)}</p>
        ${list(t.delivers.map(([b, d]) => `<b>${esc(b)}:</b> ${esc(d)}`), 'pro')}
        ${say('Pitch script', t.script)}
        <details class="off-more"><summary>Monthly limits and exclusions</summary>
          <div class="off-sub">Included monthly limits</div>
          ${list(t.limits.map(([b, d]) => `<b>${esc(b)}:</b> ${esc(d)}`))}
          <div class="off-sub">Not included</div>
          ${list(t.excluded.map(esc), 'con')}
        </details>
      </article>`).join('');
    const bolts = r.boltOns.map(([name, price, def, script]) => `
      <article class="off-bolt">
        <div class="off-bolt-head"><h4>${esc(name)}</h4><span>${esc(price)}</span></div>
        <p>${esc(def)}</p>
        ${say('Cross-sell', script, 'obj')}
      </article>`).join('');
    const matrix = r.matrix.map(([layer, typical, ours]) => `<tr><td>${esc(layer)}</td><td class="bad">${esc(typical)}</td><td class="good">${esc(ours)}</td></tr>`).join('');
    return `
      <section class="panel off-hero">
        <div>
          <div class="off-kicker">Current draft · 2026 commercial runbook</div>
          <h2 class="off-title">Growth Strategy and Commercial Playbook</h2>
          <p class="off-lead">The packages as they stand today: four cumulative retainer tiers plus modular bolt-ons. Use the toggles above to see five other ways to package the same services, plus a value-based model.</p>
        </div>
        <div class="off-meta">
          <div class="off-meta-row"><span>Tiers</span><b>4, cumulative</b></div>
          <div class="off-meta-row"><span>Price range</span><b>£1,000 – £4,000 / month</b></div>
          <div class="off-meta-row"><span>Bolt-ons</span><b>${r.boltOns.length}</b></div>
          <div class="off-meta-row"><span>Effective rate</span><b>~£85 – £100 / hour</b></div>
        </div>
      </section>
      <h3 class="off-h">Sales quick summary</h3>
      <section class="panel"><ul class="off-facts">${r.summary.map(([b, t]) => `<li><b>${esc(b)}</b><span>${esc(t)}</span></li>`).join('')}</ul></section>
      <h3 class="off-h">Retainer packages</h3>
      <p class="off-note">Each tier is cumulative: every higher tier includes the work from the tiers before it.</p>
      <div class="off-tiers">${tiers}</div>
      <h3 class="off-h">Commercial terms and delivery rules</h3>
      <section class="panel"><ul class="off-facts">${r.terms.map(([b, t]) => `<li><b>${esc(b)}</b><span>${esc(t)}</span></li>`).join('')}</ul></section>
      <h3 class="off-h">Modular bolt-ons</h3>
      <p class="off-note">Standard exclusions for all bolt-ons: ad spend, third-party licence fees, and major redesign or build requests outside agreed bolt-on scope.</p>
      <div class="off-bolts">${bolts}</div>
      <h3 class="off-h">How we compare</h3>
      <div class="off-table-wrap"><table class="off-table"><thead><tr><th>Operational layer</th><th>Typical agency</th><th>i3MEDIA standard</th></tr></thead><tbody>${matrix}</tbody></table></div>`;
  }

  // ── Option view ─────────────────────────────────────────────────────────
  function renderOption(o) {
    const n = OPTIONS.indexOf(o) + 1;
    const parts = [];
    parts.push(`
      <section class="panel off-hero">
        <div>
          <div class="off-kicker">${o.alt ? 'Idea 6 · pricing approach' : `Packaging idea ${n} of 5`}</div>
          <h2 class="off-title">${esc(o.name)}</h2>
          <p class="off-lead">${esc(o.tagline)}</p>
          <p class="off-best"><b>Best for:</b> ${esc(o.bestFor)}</p>
        </div>
        <div class="off-meta">
          <div class="off-meta-row"><span>Typical deal</span><b>${esc(o.typical)}</b></div>
          <div class="off-meta-row"><span>Minimum term</span><b>${esc(o.term)}</b></div>
          <div class="off-meta-row"><span>Easy to sell on the phone</span>${dots(o.scores.phone)}</div>
          <div class="off-meta-row"><span>Flexibility for client</span>${dots(o.scores.flex)}</div>
          <div class="off-meta-row"><span>Deal size</span>${dots(o.scores.deal)}</div>
          <div class="off-meta-row"><span>Easy for us to run</span>${dots(o.scores.run)}</div>
        </div>
      </section>`);
    if (o.steps) parts.push(`<section class="panel"><h3>How it works</h3><ol class="off-steps">${o.steps.map((s) => `<li>${s}</li>`).join('')}</ol></section>`);
    if (o.questions) parts.push(`<section class="panel"><h3>The five value questions</h3><ol class="off-steps">${o.questions.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></section>`);
    if (o.packages) {
      parts.push(`<h3 class="off-h">${esc(o.pkgTitle || 'Packages')}</h3>`);
      if (o.pkgNote) parts.push(`<p class="off-note">${esc(o.pkgNote)}</p>`);
      parts.push(`<div class="off-pkgs">${o.packages.map(pkgCard).join('')}</div>`);
    }
    if (o.calc === 'mix') parts.push(renderMixCalc());
    if (o.calc === 'credits') parts.push(renderCreditsCalc());
    if (o.calc === 'value') parts.push(renderValueCalc());
    parts.push(`
      <section class="panel"><h3>On the phone</h3><div class="off-script">
        ${say('Discovery question', o.discovery, 'q')}
        ${say('30-second pitch', o.script)}
        ${say(`Objection: "${o.objection[0]}"`, o.objection[1], 'obj')}
      </div></section>`);
    parts.push(`<div class="off-grid2">
      <section class="panel"><h3>Why it works</h3>${list(o.pros.map(esc), 'pro')}</section>
      <section class="panel"><h3>Watch out for</h3>${list(o.cons.map(esc), 'con')}</section>
    </div>`);
    if (o.boltOns) {
      parts.push(`<h3 class="off-h">Bolt-ons</h3><div class="off-table-wrap"><table class="off-table"><thead><tr><th>Add-on</th><th>Price</th></tr></thead><tbody>${o.boltOns.map(([a, p]) => `<tr><td>${esc(a)}</td><td class="num">${esc(p)}</td></tr>`).join('')}</tbody></table></div>`);
    }
    parts.push(`<section class="panel"><h3>${o.alt ? 'Guardrails' : 'Rules'}</h3>${list(o.rules)}</section>`);
    return parts.join('');
  }

  // ── Pick & mix calculator ───────────────────────────────────────────────
  function renderMixCalc() {
    const f = MIX.foundation;
    const mods = MIX.modules.map((m) => `
      <label class="${state.mix.has(m.id) ? 'on' : ''}">
        <input type="checkbox" data-mix="${m.id}"${state.mix.has(m.id) ? ' checked' : ''} />
        <span><b>${esc(m.name)}</b><small>${esc(m.desc)}</small></span>
        <span class="p">${gbp(m.price)}</span>
      </label>`).join('');
    return `
      <h3 class="off-h">Build a package</h3>
      <p class="off-note">Tick modules to see what the client would pay. This is the exact screen a rep could share on a call.</p>
      <div class="off-calc">
        <div class="off-pick">
          <label class="locked on"><input type="checkbox" checked disabled /><span><b>${esc(f.name)} (required)</b><small>${esc(f.desc)}</small></span><span class="p">${gbp(f.price)}</span></label>
          ${mods}
        </div>
        <aside class="off-total" id="offMixTotal">${mixTotalHtml()}</aside>
      </div>`;
  }

  function mixTotalHtml() {
    const picked = MIX.modules.filter((m) => state.mix.has(m.id));
    const modules = picked.reduce((s, m) => s + m.price, 0);
    const tier = MIX.discounts.find(([min]) => picked.length >= min);
    const rate = tier ? tier[1] : 0;
    const discount = Math.round(modules * rate);
    const monthly = MIX.foundation.price + modules - discount;
    const next = MIX.discounts.slice().reverse().find(([min]) => picked.length < min);
    return `
      <h4>Monthly price</h4>
      <div class="off-total-row"><span>Foundation</span><span>${gbp(MIX.foundation.price)}</span></div>
      <div class="off-total-row"><span>${picked.length} module${picked.length === 1 ? '' : 's'}</span><span>${gbp(modules)}</span></div>
      ${discount ? `<div class="off-total-row disc"><span>Bundle discount (${Math.round(rate * 100)}%)</span><span>−${gbp(discount)}</span></div>` : ''}
      <div class="off-total-row big"><span>${gbp(monthly)}</span><small>/ month</small></div>
      <div class="muted">First 12 months: ${gbp(monthly * 12)}. Ad spend extra, paid direct.</div>
      ${next ? `<div class="muted">Add ${next[0] - picked.length} more module${next[0] - picked.length === 1 ? '' : 's'} to unlock ${Math.round(next[1] * 100)}% off.</div>` : ''}`;
  }

  // ── Credits planner ─────────────────────────────────────────────────────
  function creditsUsed() { return CREDIT_MENU.reduce((s, m) => s + (state.credits[m.id] || 0) * m.c, 0); }

  function renderCreditsCalc() {
    const plans = CREDIT_PLANS.map((p) => pkgCard({
      name: p.name, price: gbp(p.price), unit: '/ month', badge: p.name === 'Growth' ? 'Most popular' : '',
      note: `${p.credits} credits · ${gbp(p.price / p.credits)} per credit`,
      items: ['Reporting, website care and tracking included', 'Credits roll over one month', `Top-ups at £${CREDIT_TOPUP} a credit`],
    })).join('');
    const rows = CREDIT_MENU.map((m) => `
      <div class="off-credit">
        <span>${esc(m.name)}</span>
        <span class="c">${m.c} credit${m.c === 1 ? '' : 's'}</span>
        <span class="off-stepper">
          <button type="button" class="off-step" data-credit="${m.id}" data-d="-1" aria-label="Remove ${esc(m.name)}">−</button>
          <output id="offCr-${m.id}">${state.credits[m.id] || 0}</output>
          <button type="button" class="off-step" data-credit="${m.id}" data-d="1" aria-label="Add ${esc(m.name)}">+</button>
        </span>
      </div>`).join('');
    return `
      <h3 class="off-h">Plans</h3>
      <div class="off-pkgs">${plans}</div>
      <h3 class="off-h">Plan a month</h3>
      <p class="off-note">Add what the client wants this month and the planner picks the right plan.</p>
      <div class="off-calc">
        <div class="off-credits">${rows}</div>
        <aside class="off-total" id="offCreditTotal">${creditTotalHtml()}</aside>
      </div>`;
  }

  function creditTotalHtml() {
    const used = creditsUsed();
    const plan = CREDIT_PLANS.find((p) => p.credits >= used) || CREDIT_PLANS[CREDIT_PLANS.length - 1];
    const topUp = Math.max(used - plan.credits, 0);
    const monthly = plan.price + topUp * CREDIT_TOPUP;
    const spare = Math.max(plan.credits - used, 0);
    return `
      <h4>Recommended plan</h4>
      <div class="off-total-row"><span>Credits needed</span><span>${used}</span></div>
      <div class="off-total-row"><span>${esc(plan.name)} plan (${plan.credits} credits)</span><span>${gbp(plan.price)}</span></div>
      ${topUp ? `<div class="off-total-row"><span>Top-up (${topUp} credits)</span><span>${gbp(topUp * CREDIT_TOPUP)}</span></div>` : ''}
      <div class="off-total-row big"><span>${gbp(monthly)}</span><small>/ month</small></div>
      <div class="muted">${spare ? `${spare} spare credit${spare === 1 ? '' : 's'} roll over to next month.` : 'Plan fully used.'}</div>`;
  }

  // ── Value calculator ────────────────────────────────────────────────────
  function renderValueCalc() {
    const v = state.value;
    const field = (key, label, hint, attrs) => `<label>${esc(label)} <small>${esc(hint)}</small><input type="number" data-value="${key}" value="${v[key]}" ${attrs} /></label>`;
    return `
      <h3 class="off-h">Value calculator</h3>
      <p class="off-note">Fill this in live on the call with the client's own numbers. It gives three outcome-based prices.</p>
      <section class="panel">
        <div class="off-inputs">
          ${field('customerValue', 'Customer value (£)', 'first-year, average', 'min="0" step="100"')}
          ${field('enquiries', 'Enquiries now', 'per month', 'min="0" step="1"')}
          ${field('closeRate', 'Close rate (%)', 'enquiries → customers', 'min="1" max="100" step="1"')}
          ${field('extra', 'Extra customers wanted', 'per month, target', 'min="0" step="1"')}
          ${field('share', 'Our share of value (%)', '10–20% recommended', 'min="5" max="30" step="1"')}
          ${field('hours', 'Delivery hours', 'per month, for the floor', 'min="0" step="1"')}
        </div>
        <div id="offValueOut">${valueOutHtml()}</div>
      </section>`;
  }

  function valueOutHtml() {
    const v = state.value;
    const close = Math.max(Number(v.closeRate) || 0, 1) / 100;
    const floor = roundTo((Number(v.hours) || 0) * HOURLY_FLOOR, 50);
    const tier = (label, mult, pop) => {
      const extra = (Number(v.extra) || 0) * mult;
      const annual = extra * (Number(v.customerValue) || 0) * 12;
      const valuePrice = roundTo((annual * (Number(v.share) || 0) / 100) / 12, 50);
      const price = Math.max(valuePrice, floor);
      const roi = price > 0 ? annual / (price * 12) : 0;
      const enquiriesNeeded = Math.ceil(extra / close);
      const atFloor = valuePrice < floor;
      return `<div class="off-out${pop ? ' pop' : ''}">
        <h5>${esc(label)}</h5>
        <div class="off-price">${gbp(price)} <small>/ month</small></div>
        <p>+${extra % 1 ? extra.toFixed(1) : extra} customers a month (≈${enquiriesNeeded} extra enquiries)</p>
        <p>Value created: <b>${gbp(annual)}</b> a year</p>
        <p>Client return: <b>${roi.toFixed(1)}×</b></p>
        ${atFloor ? '<p class="floor">Priced at delivery floor. Value too low for this share, so consider set packages.</p>' : ''}
      </div>`;
    };
    const now = (Number(v.enquiries) || 0) * close;
    return `
      <div class="off-tiers-out">
        ${tier('Conservative', 0.5, false)}
        ${tier('Target', 1, true)}
        ${tier('Stretch', 1.5, false)}
      </div>
      <p class="muted" style="margin:12px 0 0">Today: about ${now.toFixed(1)} customers a month from ${Number(v.enquiries) || 0} enquiries. Delivery floor: ${gbp(floor)} / month (${Number(v.hours) || 0} hrs × £${HOURLY_FLOOR}).</p>`;
  }

  // ── Compare view ────────────────────────────────────────────────────────
  function renderCompare() {
    const head = OPTIONS.map((o, i) => `<th>${o.alt ? '6' : i + 1}. ${esc(o.short)}</th>`).join('');
    const row = (label, fn) => `<tr><td>${esc(label)}</td>${OPTIONS.map((o) => `<td>${fn(o)}</td>`).join('')}</tr>`;
    return `
      <section class="panel off-hero">
        <div>
          <div class="off-kicker">Decide</div>
          <h2 class="off-title">Side by side</h2>
          <p class="off-lead">All six ideas on one screen. Scores are out of 5. Higher is better on every row.</p>
        </div>
      </section>
      <div class="off-table-wrap"><table class="off-table off-compare">
        <thead><tr><th></th>${head}</tr></thead>
        <tbody>
          ${row('Easy to sell on the phone', (o) => dots(o.scores.phone))}
          ${row('Flexibility for client', (o) => dots(o.scores.flex))}
          ${row('Deal size', (o) => dots(o.scores.deal))}
          ${row('Easy for us to run', (o) => dots(o.scores.run))}
          ${row('Typical deal', (o) => esc(o.typical))}
          ${row('Minimum term', (o) => esc(o.term))}
          ${row('Best for', (o) => esc(o.bestFor))}
          ${row('Opening question', (o) => `<i>${esc(o.discovery)}</i>`)}
        </tbody>
      </table></div>
      <section class="panel off-pick-panel">
        <h3>Suggested starting point</h3>
        <p><b>Sell set packages (1) on the phone, using problem-led names (3).</b> Three fixed prices are the easiest thing for reps to say and remember, and naming them after the client's problem makes the discovery question do the selling.</p>
        <p><b>Use the value questions (6) to justify the price, not to calculate a new one.</b> Reps ask the five questions, then show the return on the middle package. For high-value sectors, managers can quote a value price above the list.</p>
        <p><b>Keep the £300 Performance Site (4) as the fallback</b> when price is the blocker, with a day-60 upgrade review booked on every account.</p>
        <p>Pick & mix (2) and credits (5) are better as account management tools once a client is signed than as a first-call offer.</p>
      </section>`;
  }

  // ── View switching ──────────────────────────────────────────────────────
  function renderTabs() {
    $('offTabs').innerHTML = VIEWS.map((v) => `
      <button type="button" class="off-tab${v.id === state.view ? ' on' : ''}${v.alt ? ' alt' : ''}" data-view="${v.id}" role="tab" aria-selected="${v.id === state.view}">
        ${v.n ? `<span class="n">${v.alt ? '£' : v.n}</span>` : ''}${esc(v.label)}
      </button>`).join('');
  }

  function render() {
    renderTabs();
    const opt = OPTIONS.find((o) => o.id === state.view);
    const html = state.view === 'compare' ? renderCompare() : opt ? renderOption(opt) : renderRunbook();
    $('offBody').innerHTML = `<div class="off-view">${html}</div>`;
    const active = $('offTabs').querySelector('.off-tab.on');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function show(id, push) {
    state.view = VIEWS.some((v) => v.id === id) ? id : 'runbook';
    if (push) history.replaceState(null, '', '#' + state.view);
    render();
    window.scrollTo({ top: 0 });
  }

  function bind() {
    $('offTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view]');
      if (btn) show(btn.dataset.view, true);
    });
    $('offBody').addEventListener('change', (e) => {
      const id = e.target.dataset && e.target.dataset.mix;
      if (!id) return;
      if (e.target.checked) state.mix.add(id); else state.mix.delete(id);
      e.target.closest('label').classList.toggle('on', e.target.checked);
      $('offMixTotal').innerHTML = mixTotalHtml();
    });
    $('offBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-credit]');
      if (!btn) return;
      const id = btn.dataset.credit;
      state.credits[id] = Math.max(0, Math.min(20, (state.credits[id] || 0) + Number(btn.dataset.d)));
      $('offCr-' + id).textContent = state.credits[id];
      $('offCreditTotal').innerHTML = creditTotalHtml();
    });
    $('offBody').addEventListener('input', (e) => {
      const key = e.target.dataset && e.target.dataset.value;
      if (!key) return;
      state.value[key] = Math.max(0, Number(e.target.value) || 0);
      $('offValueOut').innerHTML = valueOutHtml();
    });
    window.addEventListener('hashchange', () => show(location.hash.slice(1), false));
  }

  window.addEventListener('DOMContentLoaded', () => {
    SQ.init(() => {
      bind();
      show(location.hash.slice(1), false);
    });
  });
})();
