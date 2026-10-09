/** Default proposal templates. Block text uses {{merge_fields}} resolved when a proposal is created. */

export const WEBSITE_TEMPLATE_NAME = 'Website proposal';

export const WEBSITE_TEMPLATE_BLOCKS = [
  { type: 'heading', text: 'Executive summary' },
  { type: 'text', text: 'In short.\n{{client_company}} needs a website that does the heavy lifting your sales team cannot always do: answering questions before they’re asked, qualifying leads before they reach you, and giving prospects confidence in your business before the first call.\n\nToday, prospects research and validate suppliers online before making contact. If your website doesn’t establish credibility quickly, the enquiry never comes. The opportunity is not to refresh how the site looks. It is to turn it into a commercial asset that earns trust and generates qualified conversations.' },
  { type: 'callout', text: 'What we found | Before writing this proposal we reviewed your current website. You already have genuine proof of your work and your clients, the kind of evidence a procurement manager wants to see before calling a supplier they don’t know. The opportunity is to organise that proof so it builds trust quickly, make it effortless to call or enquire, and tell your projects as stories rather than a gallery: what the work involved, for whom, and what the client got out of it.\n\nNone of that is a criticism. It is what happens when a site is built without clear growth plans. The fix is not a redesign for its own sake. It is making the site do the selling your track record has already earned.' },
  { type: 'text', text: 'This proposal sets out two ways to get there, depending on how far you want the website to support business growth. You choose your option and any add-ons before signing.' },
  {
    type: 'options',
    selectable: true,
    required: true,
    recommended: 'b',
    data: {
      a: { label: 'Option 1', name: 'Website Refresh', price: '£8,000', desc: 'A modern, credible website that solves the pain of an outdated presence, without rebuilding your brand identity.' },
      b: { label: 'Option 2', name: 'Brand Uplift', price: '£12,000', desc: 'A bespoke website, logo refresh, social media assets and email design, built around your commercial goals.' },
    },
  },
  { type: 'callout', text: 'What you’ll have when we’re done | Option 1: a credible, modern website your team can manage in-house, launched in around 10 weeks. Search-ready, mobile-friendly and a clear step up from where you are today.\n\nOption 2: a website with a refreshed brand behind it, including an updated logo, social assets and optimised contact forms that don’t just email you but store every lead in the CMS.' },
  { type: 'text', text: 'Our recommendation is Option 2. For your ambitions of growth it is the stronger fit, though we understand the branding piece may not be on your list at this stage, and Option 1 is a solid foundation to build from.' },

  { type: 'heading', text: 'Option 1: Website Refresh' },
  { type: 'text', text: 'A clean, modern redesign that solves the pain of an outdated website without rebuilding your entire digital strategy. Built on WordPress, mobile responsive and easy for your team to manage in-house. The right choice if you want a credible, professional website now, with the option to expand later.' },
  { type: 'bullets', text: 'Light bespoke design, modern layouts and strong typography\nWordPress CMS, easy in-house updates\nMobile responsive across all devices\nTemplate page designs\nStandard contact and enquiry forms\nNews / blog functionality\nBasic SEO setup: meta data, sitemap and redirects\nGoogle Analytics 4 integration\nContent migration from your existing site\nQA testing across browsers and devices\nCMS training for your team\n30 days post-launch support' },
  { type: 'timeline', text: 'Discovery | ~1 week\nDesign | ~3 weeks\nBuild | ~4 weeks\nLaunch | ~1 week + QA\nTotal | ~10 weeks' },
  { type: 'investment', text: 'Your investment in Option 1 | £8,000 | + VAT' },

  { type: 'heading', text: 'Option 2: Brand Uplift (recommended)' },
  { type: 'text', text: 'A fully bespoke website engineered to generate enquiries, not just receive them. Logo redesign as well as an asset refresh, built around your commercial goals with conversion infrastructure and lead capture at its core. The right choice when your website is a primary growth channel.' },
  { type: 'callout', text: 'What you’ll have | A rebuilt website and a refreshed brand working as one. Your logo modernised, a consistent colour and type system applied across the site, branded email signatures and templates, and a set of social media assets, so every touchpoint from your homepage to your inbox to your feed looks like the same considered business.' },
  { type: 'bullets', text: 'Fully bespoke, ground-up design with no templates\nInteractive elements, scroll-triggered animations and dynamic visuals\nMobile-first UX designed for how your customers browse\nStrategic enquiry pathways across the whole site\nDynamic forms with conditional logic\nLeads stored and managed in WordPress, CRM-ready\nFull on-page SEO optimisation of every launched page\nKeyword research, schema markup, Core Web Vitals and redirects\nGA4, conversion tracking and a reporting dashboard\nModular content blocks and campaign templates\nLogo redesign with a colour and type system\nBranded email signatures and templates, plus a social media asset set\n30 days post-launch support and optimisation' },
  { type: 'timeline', text: 'Discovery | ~2 weeks\nDesign | ~5 weeks\nBuild | ~6 weeks\nLaunch | ~2 weeks + QA\nTotal | 12–14 weeks' },
  { type: 'investment', text: 'Your investment in Option 2 | £12,000 | + VAT' },

  { type: 'heading', text: 'Side by side' },
  { type: 'text', text: 'A clear, line-by-line view of what’s included in each option, so the decision is straightforward.' },
  { type: 'comparison', text: 'Feature | Option 1: Refresh | Option 2: Brand Uplift\nWordPress CMS | ✓ | ✓\nDesign | Tailored | Fully bespoke\nInteractive elements & animations | ✗ | ✓\nMobile experience | Responsive | Mobile-first\nStandard contact forms | ✓ | ✓\nDynamic multi-step forms | ✗ | ✓\nConditional form logic | ✗ | ✓\nLeads stored in WordPress | ✗ | ✓\nCRM data exports | ✗ | ✓\nOn-page SEO | Basic | Full optimisation at launch\nKeyword research & mapping | ✗ | ✓\nSchema markup | ✗ | ✓\nCore Web Vitals | Standard | Engineered\nGA4 + conversion tracking | Installed | Optimised\nCampaign / landing page templates | ✗ | ✓\nLogo, social & email assets | ✗ | ✓\nPost-launch support | 30 days | 30 days\nDelivery timeline | ~10 weeks | 12–14 weeks\nInvestment (excl. VAT) | £8,000 | £12,000' },

  { type: 'heading', text: 'Recent work' },
  { type: 'text', text: 'A selection of recent projects across professional services, education and the not-for-profit sector, each built on the same foundations we’d apply for your project.' },
  { type: 'callout', text: 'Roadphone NRB: specialist services | One site, two businesses, and a client list that includes the BBC and Creamfields. We built Roadphone and its hire division, NRB, as a single WordPress platform: permanent radio infrastructure on one side, hire-anything-from-2-to-2,000-units on the other, each with its own enquiry path so a festival organiser and a construction firm never land on the wrong form.\n\nroadphone.co.uk' },
  { type: 'callout', text: 'Inspire Education Group: education | A multi-site platform serving Inspire Education Trust and University Centre Peterborough: 700+ students across 50+ courses. A modular architecture lets each campus keep distinct branding while sharing a unified back end. Outcome: a streamlined enrolment journey, faster updates across sites, and a platform that scales with the group’s growth.\n\nieg.ac.uk' },
  { type: 'callout', text: 'Novus Environmental: waste management | Everything from clinical waste to confidential documents, handled for NHS trusts, universities and councils who can’t afford to get compliance wrong. We built the site around a quote-first path, backed by an eleven-category solutions menu, accreditations front and centre, and a fleet page that proves the Euro 6 and electric vehicles are real.\n\nnovus-environmental.co.uk' },
  { type: 'text', text: 'Other recent builds include eCommerce stores, bespoke platforms, and charity and software solutions. Live links and full case studies are available on request, or visit i3media.net.' },

  { type: 'heading', text: 'After launch: keep it performing' },
  { type: 'text', text: 'Whichever option you choose, your website will need ongoing care to stay secure, fast and commercially effective. One essential layer is included with every build, and one optional add-on is yours to pick.' },
  { type: 'addons', text: '!Hosting, security & warranty | £250 / month | Included with every build. Fully managed Google Cloud hosting, monthly security updates, software licensing, performance monitoring, automated backups & SSL and technical support. We host 99% of the clients we build for because it is the most reliable way to protect the investment.' },
  { type: 'text', text: 'Optional add-on: a support retainer. A monthly block of pre-purchased hours for ongoing improvements such as new pages, design refinements, content updates, technical work or campaign builds. Most clients take this on after launch to protect and build on the investment.' },
  {
    type: 'options',
    selectable: true,
    required: false,
    recommended: 'b',
    data: {
      a: { label: 'Optional add-on', name: 'Support retainer: 3 hours / month', price: '£360 / mo', desc: 'Ideal for steady improvements and light updates.' },
      b: { label: 'Optional add-on', name: 'Support retainer: 5 hours / month', price: '£550 / mo', desc: 'For more engaged support. Our most popular choice.' },
    },
  },
  { type: 'text', text: 'Every retainer includes priority updates, design and content refinements, a dedicated account manager, 25% rollover of unused hours, and priority turnaround.' },

  { type: 'heading', text: 'About i3MEDIA' },
  { type: 'text', text: 'For over two decades, i3MEDIA has supported organisations serious about growth, delivering structured, commercially focused digital solutions under one roof. We bring strategy, design, development and marketing together so every project is built with intent. 60+ in-house specialists, 20+ years of experience, based in Peterborough and working with clients across the UK and beyond.' },
  { type: 'callout', text: 'Built around growth | Marketing-led thinking, conversion-focused structure, built for long-term scalability. Platforms designed to drive measurable performance.' },
  { type: 'callout', text: 'Engineered for control | Custom WordPress builds with clean, maintainable frameworks and no platform lock-in. You retain full ownership and long-term flexibility.' },
  { type: 'callout', text: 'Delivered with structure | Defined scope and milestones, dedicated account managers and clear communication throughout. Experience shows in the way we run projects.' },
  { type: 'callout', text: 'Priced with transparency | Clear deliverables, no hidden extras and a long-term partnership mindset. Upfront investment, clear expectations, no surprises.' },

  { type: 'heading', text: 'Ready to begin' },
  { type: 'text', text: 'Choose your option and any add-ons above, then accept and sign below. We will schedule your kick-off call within days, and discovery typically begins 1–2 weeks after sign-off.\n\nBy signing you confirm acceptance of your selected option and add-ons, and agree to begin discovery within 14 days of sign-off. This proposal is valid until {{expiry_date}}.' },
  { type: 'text', text: 'Questions before signing? {{rep_name}} is your point of contact and is happy to talk anything through.' },
];
