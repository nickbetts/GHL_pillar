// "Charity | Marketing Only": three-tier digital fundraising retainer for charities
// that only want marketing services. Wording follows the Al Hasanaat Foundation
// proposal, with client specifics replaced by merge fields ({{client_company}},
// {{client_story}}). The standard T&Cs live in the Contract terms editor, not here.

export const CHARITY_MARKETING_TEMPLATE_NAME = 'Charity | Marketing Only';

const tiers = 'Essentials | Growth | Partnership';
const group = (name, rows) => ({ type: 'comparison', text: [`${name} | ${tiers}`, ...rows].join('\n') });

export const CHARITY_MARKETING_BLOCKS = [
  { type: 'heading', text: 'Your fundraising team, on retainer' },
  { type: 'text', text: 'Three ways to work together, and one team behind every gift that helps {{client_company}} reach more people.' },

  { type: 'heading', text: 'Your work keeps giving. Our job is to make sure more people hear about it.' },
  { type: 'text', text: '{{client_story}}' },
  { type: 'text', text: "We've built this proposal around three tiers, so you can start at a level that suits your budget today and move up when the results justify it." },

  { type: 'heading', text: 'Why we work in cycles' },
  { type: 'text', text: "Muslim giving isn't spread evenly across the year. Ramadan, Dhul Hijjah and winter bring in most donations, and emergencies arrive without warning. So rather than doing the same thing every month, we plan in 90-day cycles and put the effort where the giving is." },
  { type: 'callout', text: "Giving isn't flat. Most marketing packages are. | A fixed package puts the same effort into a quiet August as into the last ten nights of Ramadan. We don't." },

  { type: 'heading', text: 'Start where it makes sense, and grow when it pays' },
  { type: 'text', text: 'Each tier is a complete service run by one team. The difference is how many channels are working for you at once, and how much creative and follow-up sits behind them. Prices are per month, plus VAT. Ad spend is paid directly to Meta and Google and is not included.' },
  {
    type: 'options',
    selectable: true,
    required: true,
    recommended: 'b',
    data: {
      a: {
        label: 'Tier 1 · Fixed',
        name: 'Essentials',
        price: '£1,750 / month + VAT',
        desc: 'Get found and get seen. Paid ads running properly, and your site protected in search.\n\nGoogle Ad Grants, Google paid search, Meta ads, light monthly creative, SEO for your site and off-peak season, a monthly snapshot report and a free fundraising check-up in month one. Over £3,000 of work if bought separately.',
      },
      b: {
        label: 'Tier 2 · Rotating',
        name: 'Growth',
        price: '£2,500 / month + VAT',
        desc: 'Four channels live at any time. Two always on, two chosen each quarter to fit the season.\n\nEverything in Essentials, plus two services rotating each quarter (SEO, email marketing and content), more creative every month, unfinished donation follow-up, a monthly guided report and planning session, an annual fundraising review, and Ramadan and Qurbani packs. Over £5,000 of work if bought separately.',
      },
      c: {
        label: 'Tier 3 · Always on',
        name: 'Partnership',
        price: '£4,000 / month + VAT',
        desc: 'Your full marketing team, running every channel through the whole giving year.\n\nEverything in Growth, always on, plus a full email and regular giving programme, AI search optimisation, organic social, a monthly strategy call, monthly workshops, staff upskilling and an annual trustee briefing. Over £7,000 of work if bought separately.',
      },
    },
  },

  { type: 'heading', text: 'Essentials: get found and get seen' },
  { type: 'text', text: 'This is the foundation. It puts your appeals in front of people who are already looking to give, and makes sure your website keeps and builds its place in Google.' },
  {
    type: 'bullets',
    text: [
      "Google Ad Grants. Google gives eligible charities up to $10,000 (around £7,500) of free search advertising every month. That's worth up to £90,000 a year. Most charities use a fraction of it. We'll build campaigns around your appeals, and keep the account compliant so the grant isn't suspended.",
      "Google paid search. Ad Grants can't compete for the most valuable searches, like \"pay Zakat online\". Paid search covers that gap, and scales up in Ramadan and the last ten nights.",
      "Meta ads. Facebook and Instagram are where most new donors will first meet {{client_company}}. We'll reach UK Muslim donors, lookalikes of your existing supporters, and people who've watched your videos or started a donation without finishing.",
      'Light creative. Two short videos and four graphics a month, made from your field footage, so the ads stay fresh.',
      "SEO for your website. We'll make sure your site keeps your existing Google rankings, with redirects, page structure and tracking in place whenever it changes, plus an off-peak season campaign.",
      "A monthly snapshot report. A short, clear update on what was spent, what it raised and what's next.",
      "A free fundraising check-up in month one. We'll review your donation journey, Gift Aid take-up and tracking, and give you a short written report with quick wins. This is included in every tier.",
    ].join('\n'),
  },

  { type: 'heading', text: 'Growth: four channels, always working' },
  { type: 'text', text: 'Growth keeps paid search, Ad Grants and Meta running all year, and adds two more channels from SEO, email and content. Every 90 days we sit down with your team and choose the two that fit the season best. You get four channels working at any time, without paying for all five every month.' },
  {
    type: 'comparison',
    text: [
      "Cycle | What's happening | Rotating channels",
      'Oct to Dec | Winter appeal, warming up audiences for Ramadan | Content and SEO',
      'Jan to Mar | Ramadan, the last ten nights, Zakat, Fitrana and Fidya | Email and content',
      'Apr to Jun | Dhul Hijjah, Qurbani and Sadaqah Jariyah | Email and SEO',
      'Jul to Sep | Back to school kits, Rabi al-Awwal, getting Ramadan pages ranking early | SEO and content',
    ].join('\n'),
  },
  { type: 'text', text: 'Growth also adds:' },
  {
    type: 'bullets',
    text: [
      'A Ramadan pack. A dedicated Ramadan landing page, a 30-day content calendar and a last ten nights campaign, ready before the month begins.',
      "More creative each month, and follow-up emails to people who started a donation but didn't finish.",
      'A monthly guided report and planning session. We walk your team through the results and agree the month ahead together.',
      'An annual fundraising review of what raised money and why.',
    ].join('\n'),
  },
  { type: 'callout', text: "Why we recommend Growth | It's the smallest step that turns advertising into a fundraising programme. Ads bring new donors in, and email and content give them a reason to give again. Rotating the extra channels keeps the cost down without leaving any of them idle for long." },

  { type: 'heading', text: 'Partnership: your full marketing team' },
  { type: 'text', text: 'Partnership runs every channel all year, and adds the work that turns one-off donors into long-term supporters.' },
  {
    type: 'bullets',
    text: [
      "A full email programme. A welcome journey for new donors, Ramadan and Dhul Hijjah campaigns, a monthly impact newsletter, and gentle emails to people who haven't given in a while.",
      'Regular giving. A journey that invites one-off donors to give monthly, plus updates for orphan and Hafiz sponsors so they can see what their monthly gift achieves.',
      'AI search optimisation. More people now ask ChatGPT or Google\'s AI "which charity should I give my Zakat to?". We\'ll make sure {{client_company}} is one of the names it gives.',
      'Organic social. A posting calendar, and social media posting to your organic channels.',
      'Donation page improvements. Regular testing of your donation pages, ask amounts and checkout, and last ten nights automated giving set up for Ramadan.',
      'A monthly strategy call to review results and set direction.',
      'Monthly workshops and staff upskilling. Hands-on sessions so your team grows in confidence with social media, content, email and reporting.',
      "An annual trustee briefing. We present the year's results and next year's plan directly to your trustees.",
      'Ramadan and Qurbani campaign packs. Full optimisation and setup of the Ramadan and Qurbani campaigns, ready well before the season starts.',
    ].join('\n'),
  },

  { type: 'heading', text: 'Every service, tier by tier' },
  { type: 'text', text: '✓ Included. Light means a lighter version of the service. Rotates means it is one of the channels we switch on in the right season. Add-on means priced separately. A cross means not included.' },
  group('Paid advertising', [
    'Google Ad Grants (free search ads for eligible charities) | ✓ | ✓ | ✓',
    'Google paid search | ✓ | ✓ | ✓',
    'Meta ads (Facebook and Instagram) | ✓ | ✓ | ✓',
    'Remarketing and display | Light | ✓ | ✓',
    'YouTube ads | — | + Add-on | ✓',
    'TikTok ads | — | + Add-on | ✓',
  ]),
  group('Creative and content', [
    'Reels and short videos | 2 a month | 3 a month | 4 a month',
    'Static, carousel and story graphics | 4 a month | 6 a month | 8 a month',
    'Ad copy and appeal messaging | ✓ | ✓ | ✓',
    'Shot list for your field teams | — | — | ✓',
    'Seasonal campaign concept | — | 2 per year | 2 per year',
    'Ramadan pack (landing page, 30-day calendar, last ten nights campaign) | Light | ✓ | ✓',
    'Blogs, guides and impact stories | — | Rotates | ✓',
    'Video shoot or field filming | + Add-on | + Add-on | + Add-on',
  ]),
  group('Organic social', [
    'Organic posting calendar | — | + Add-on | ✓',
    'Influencer marketing | + Add-on | + Add-on | + Add-on',
  ]),
  group('Search and visibility', [
    'SEO for website launches and changes | ✓ | ✓ | ✓',
    'Ongoing SEO | Off-peak campaign | Rotates | ✓',
    'Google Business Profile and charity directories | ✓ | ✓ | ✓',
    'AI search optimisation | — | — | ✓',
  ]),
  group('Email and supporter journeys', [
    'Ramadan and Dhul Hijjah email campaigns | — | Rotates | ✓',
    'New donor welcome journey | — | Rotates | ✓',
    'Monthly impact newsletter | — | Rotates | ✓',
    'Unfinished donation follow-up | — | Rotates | ✓',
    'One-off to monthly giving journey | — | — | ✓',
    'Orphan and Hafiz sponsor updates | — | — | ✓',
    'Lapsed donor win-back | — | — | ✓',
  ]),
  group('Donations and conversion', [
    'Donation page testing and improvement | — | Light | ✓',
    'Last ten nights automated giving | — | ✓ | ✓',
    'Gift Aid prompts on every donation | ✓ | ✓ | ✓',
  ]),
  group('Tracking and reporting', [
    'Free fundraising check-up in month one | ✓ | ✓ | ✓',
    'Tracking set-up (Google Analytics, Meta pixel) | ✓ | ✓ | ✓',
    'Live dashboard | ✓ | ✓ | ✓',
    'Monthly report | Snapshot | Guided | Strategy call',
    'Planning with your team | Quarterly | Monthly | Monthly',
    'Annual fundraising review | — | ✓ | ✓',
  ]),
  group('Training and governance', [
    'Monthly workshops | — | — | ✓',
    'Staff upskilling | — | — | ✓',
    'Annual trustee briefing | — | — | ✓',
  ]),

  { type: 'heading', text: 'Add-on services' },
  { type: 'text', text: 'These can be added to any tier for a single campaign or on a monthly basis.' },
  {
    type: 'addons',
    text: [
      'YouTube ads management | From £350 a month | Included in Partnership',
      'TikTok ads management | From £350 a month | Included in Partnership',
      'Video shoot or field filming | From £750 a day | Travel and expenses extra',
      'Influencer marketing | TBC | Talent fees paid separately',
    ].join('\n'),
  },

  { type: 'divider' },
  { type: 'heading', text: 'What it would cost to buy services separately' },
  { type: 'text', text: 'Each tier brings together work that would cost considerably more if bought service by service.' },
  {
    type: 'comparison',
    text: [
      `Service (monthly) | ${tiers}`,
      'Google Ad Grants management | £450 | £650 | £650',
      'Google paid search management | £750 | £1,000 | £1,000',
      'Meta ads management | £750 | £750 | £750',
      'Creative and content production | £600 | £900 | £1,250',
      'SEO | £400 | £1,000 | £1,000',
      'Email and supporter journeys | — | £750 | £1,000',
      'Reporting, planning and Ramadan pack | £150 | £400 | £400',
      'AI search, organic social and training | — | — | £1,500',
      'Value if bought separately | £3,100 | £5,450 | £7,550',
      'Your monthly retainer | £1,750 | £2,500 | £4,000',
    ].join('\n'),
  },

  { type: 'heading', text: 'A monthly rhythm, and a 90-day plan' },
  { type: 'text', text: "A retainer only works if you can see what's happening. So we keep to a simple, predictable rhythm on every tier." },
  {
    type: 'comparison',
    text: [
      'When | What happens',
      'Every day or week | Campaigns optimised, creative refreshed when it starts to tire, and a quick update on anything urgent.',
      "Every month | Report and call: what we spent, what it raised, what we learned and what we're changing. New creative batch delivered.",
      "Every 90 days | Strategy review with your team. We look at what raised money, agree the next cycle's campaigns and budget split, and on Growth choose the two rotating channels.",
      'Any time | A live dashboard showing spend, donations, cost per donor and return across every channel.',
    ].join('\n'),
  },
  { type: 'callout', text: "Push hard when giving peaks, build when it's quiet. | Paid search and social run at full power around Ramadan and the other peaks, and tick over in the quieter months, while SEO, content and website work build in between. Ramadan moves about 11 days earlier each year, so we redraw this calendar every year. Emergencies take priority whenever they happen." },

  { type: 'heading', text: 'Your first 90 days' },
  {
    type: 'timeline',
    text: [
      "Kick-off and audit. Review your ad accounts, footage and past results, and agree the tracking we'll build into your website | Weeks 1 to 2",
      'Build. Campaigns, audiences and the first creative batch, and the Ad Grants account in good standing | Weeks 3 to 4',
      'Test and learn. Go live, find the stories and asks that work, scale them, and build warm audiences ahead of Ramadan | Months 2 to 3',
      'Total | 90 days',
    ].join('\n'),
  },
  { type: 'text', text: 'The charities that do best in Ramadan are the ones that started in the autumn. We will line your start up with your next Ramadan, so you have as many months as possible to build momentum.' },

  { type: 'heading', text: 'Where your ad spend goes: an example' },
  { type: 'text', text: "Your ad spend is separate from the retainer and is paid straight to Meta and Google from your own accounts. Because one team runs every channel, we can move budget to wherever it's raising most, rather than locking it into one place." },
  {
    type: 'comparison',
    text: [
      'Channel | Year-round (per month) | Ramadan (per month) | Role',
      'Meta (Facebook and Instagram) | £400 to £800 | £2,000 to £3,000 | Finding new donors with video',
      'Google paid search | £300 to £2,000 | £5,000 upwards | Zakat and appeal searches',
      'Google Ad Grants | Up to $10,000 free | Up to $10,000 free | Awareness and cause searches',
    ].join('\n'),
  },
  { type: 'callout', text: "Ad Grants does the heavy lifting | For a charity of {{client_company}}'s size, Google Ad Grants is the most valuable thing we can set up. Run well, it brings in thousands of visitors a month at no cost, so your paid budget can focus on the searches and audiences most likely to give." },

  { type: 'heading', text: 'Your fundraising year' },
  {
    type: 'comparison',
    text: [
      'Period | Focus',
      'Oct to Dec | Winter appeal and emergency appeals. Warming up audiences for Ramadan.',
      'Jan to Mar | Ramadan: the biggest push of the year, with the last ten nights, Laylatul Qadr, Zakat, Fitrana and Fidya.',
      'Apr to Jun | Dhul Hijjah: the best ten days, water wells and Sadaqah Jariyah, and Qurbani if you choose to offer it.',
      'Jul to Sep | Back to school kits, Rabi al-Awwal, Hafiz and orphan sponsorship, and getting Ramadan pages ranking early.',
    ].join('\n'),
  },

  { type: 'heading', text: 'Your retainer terms' },
  {
    type: 'bullets',
    text: [
      'Minimum term. 12 to 24 months on every tier, long enough for campaigns to learn and to cover your next Ramadan.',
      'Changing tier. Move up a tier at any time. Moving down can be agreed at a quarterly review.',
      "After the minimum term. Rolling monthly, with 90 days' written notice.",
      'Setup. No setup fee on any tier.',
      'Ownership. All ad accounts, audiences, data and creative belong to {{client_company}}.',
      'Billing. Retainer invoiced monthly in advance. Ad spend is paid directly to Meta and Google.',
    ].join('\n'),
  },

  { type: 'heading', text: '15 years working with Muslim charities' },
  { type: 'text', text: "i3MEDIA has spent more than 15 years working almost entirely with charities, and today supports more than 60 charity clients. Our longest relationship, 14 years, is with Muslim Aid. We understand the Islamic giving calendar, the language of Zakat and Sadaqah, and the trust Muslim donors need before they give.\n\nWe also run Pillar, our own fundraising and CRM platform. So we understand what happens after the click: donation pages, Gift Aid, regular giving and supporter follow-up." },
  { type: 'heading', text: 'Examples of similar campaigns' },
  {
    type: 'comparison',
    text: [
      'Client | Campaign | Results',
      'Muslim Aid | Ramadan and Zakat paid search and social | Highest domain authority in the sector',
      'Indus Hospital | Year-round retainer across every channel | Strong results, including large growth in email fundraising',
      'Emaan Relief | Retainer and seasonal campaigns | Year-round growth in return on ad spend',
    ].join('\n'),
  },
  { type: 'heading', text: 'What results look like' },
  { type: 'text', text: "Return on ad spend varies by season and by how well known a charity already is. As a guide, we'd aim for paid campaigns to break even within the first quarter and target a return of 3:1 or more in Ramadan, with Gift Aid and regular givers adding long-term value on top. We'll agree targets with you at kick-off once we've seen your past data." },
  { type: 'callout', text: 'Next step | A 45-minute call to walk through the three tiers, choose the one that fits, and agree a start date that gives us a strong run into your next Ramadan.' },
  { type: 'callout', text: 'Confidentiality | This proposal and supporting materials contain confidential and proprietary business information of i3MEDIA LTD. These materials may be printed or photocopied for use in evaluating the proposed project but are not to be shared with other parties.' },
];
