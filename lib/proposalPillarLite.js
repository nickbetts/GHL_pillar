// "Pillar | Lite": short Pillar charity platform pitch (platform overview, packages, startup offer, next steps).
// Client specifics from the original Join Hands PDF are merge fields ({{client_company}}, {{client_name}},
// {{client_story}}, {{rep_name}}).

export const PILLAR_LITE_TEMPLATE_NAME = 'Pillar | Lite';

const part = (title, items) => ({ type: 'callout', text: `${title} | ${items.map((i) => `• ${i}`).join('\n')}` });
const list = (items) => items.map((i) => `- ${i}`).join('\n');

export const PILLAR_LITE_BLOCKS = [
  { type: 'heading', text: 'Pillar, the all-in-one charity platform' },
  { type: 'text', text: "Your website, donor CRM and team, in one place. Charities reach goals faster with Pillar: it's now easier than ever to create campaigns, manage donations and engage with your audience." },
  {
    type: 'stats',
    text: [
      '15+ | Years building and refining Pillar',
      '60+ | Muslim charities already on the platform',
      '2-4 | Weeks from signing to taking donations, on a template',
      '24 | Month minimum term, flexible after that',
    ].join('\n'),
  },

  { type: 'heading', text: 'About {{client_company}}' },
  { type: 'text', text: 'After speaking with {{client_name}} and understanding your requirements, I am confident that the information below will provide you with the solution you need.\n\n{{client_story}}' },
  { type: 'statement', text: 'The starting line we set for every charity | Every gift should land on the donor’s record the moment it’s made, with the Gift Aid claimed and the thank-you sent.' },

  { type: 'heading', text: 'Not just a website. Join the Pillar ecosystem.' },
  { type: 'text', text: 'Pillar is the platform we’ve built and refined over more than 15 years, now running more than 60 Muslim charities. It brings together everything a charity needs to raise and grow its funds, so you’re not stitching together a website, a database, a support contract and a marketing agency.' },
  { type: 'callout', text: '01 Website | Where people find you, learn about you and give in a few taps.' },
  { type: 'callout', text: '02 CRM | Where every supporter is kept, with Gift Aid and reporting handled for you.' },
  { type: 'callout', text: '03 Hosting and support | Secure, fast, and looked after all year round, with a team on hand when you need us.' },
  { type: 'callout', text: '04 Marketing | Grow your reach and be found by people who want to support your cause.' },

  { type: 'heading', text: 'What each part does for you' },
  part('Website', [
    'A modern, mobile-friendly site your team can update',
    'Appeal pages for each project and country',
    'One-off and monthly giving, with Gift Aid built in',
    'Zakat, Sadaqah and seasonal appeals for Ramadan and Qurbani',
  ]),
  part('CRM', [
    'Every donor and donation in one place, linked to the site',
    'Gift Aid and GDPR tools as standard',
    'Donor history, receipts and reports for trustees',
    'Room for 10,000 supporters to start, more as you grow',
  ]),
  part('Hosting and support', [
    'Secure hosting, updates and monitoring handled',
    'Unlimited email support',
    'People who work with charities every day',
    'Extra cover available for Ramadan and Qurbani',
  ]),
  part('Marketing', [
    'Campaign planning for your key appeals',
    'Social media and digital advertising',
    'Email campaigns to your own supporters',
    'Clear reporting on what’s working',
    'This comes as an additional paid service',
  ]),

  { type: 'heading', text: 'How a gift moves through Pillar' },
  { type: 'text', text: 'Most of this happens on its own, so your trustees can spend their time on the work rather than the admin.' },
  {
    type: 'timeline',
    text: [
      'Donor finds an appeal | On Google, social media or a link you share',
      'Gives in a few taps | One-off or monthly, on any phone',
      'Gift Aid captured | With the right fund: Zakat, Sadaqah or general',
      'Saved to your CRM | Receipt and thank-you sent automatically',
      'Comes back again | Updates and appeals turn one gift into many',
    ].join('\n'),
  },

  { type: 'heading', text: 'We move you in, launch with you and stay on call' },
  { type: 'text', text: 'Support isn’t a ticket queue at the end. It’s part of how the platform gets set up and kept running.' },
  {
    type: 'steps',
    text: [
      'Move in | Everything set up before launch | Your site built in your branding; Donors brought across safely; Payments and Gift Aid tested',
      'Launch | Beside you on go-live and after | Training for your team; A checked, tested launch; Quick fixes in the first weeks',
      'Grow | Help with what comes next | Ongoing support from the team; Extra cover for Ramadan and Qurbani; New modules as you need them',
    ].join('\n'),
  },

  { type: 'heading', text: 'Charities already on Pillar' },
  { type: 'text', text: 'From charities just getting started to some of the UK’s best-known names.' },
  { type: 'text', text: 'Growing charities, set up on a Pillar template in their own branding. This is the same starting point as the startup package.' },
  {
    type: 'showcase',
    text: [
      'Human Aid Focus | humanaidfocus.org',
      'MAFT | maft.org.uk',
      'Giving Hand | givinghand.charity',
      'House of Giving | houseofgiving.co.uk',
      'Refugee Crisis Foundation | refugeecrisisfoundation.com',
    ].join('\n'),
  },
  { type: 'text', text: 'Larger charities, set up with a bespoke design.' },
  {
    type: 'showcase',
    text: [
      'Muslim Aid | muslimaid.org',
      'Al Mustafa Welfare Trust | almustafatrust.org',
      'Orphans in Need | orphansinneed.org.uk',
      'UK Islamic Mission | ukim.org',
      'KORT | kort.org.uk',
      'Indus Hospital UK | indushospital.org.uk',
    ].join('\n'),
  },

  { type: 'heading', text: 'Choose your starting point' },
  { type: 'text', text: 'One monthly subscription, plus a one-off fee to set up your website and CRM. For new and startup charities, the startup package puts everything into one price. Everyone else can start on a monthly plan and move up as they grow.' },
  {
    type: 'options',
    selectable: true,
    required: true,
    recommended: 'a',
    data: {
      a: {
        label: 'For new and startup charities',
        name: 'Startup package',
        price: '£4,999 + VAT',
        desc: `Year one, all in. Then £2,990 a year + VAT.\n${list([
          'Website, donor CRM, hosting and support',
          'Live in 2 to 4 weeks on a Pillar template',
          'Normally £6,588, so you save £1,589',
        ])}`,
      },
      b: {
        label: 'Best for small charities',
        name: 'Essentials',
        price: '£299 / month',
        desc: `Income under £250k a year. Plus the one-off setup fee below.\n${list([
          'Optimised donation website',
          'Single payment provider',
          'Gift Aid and GDPR tools',
          '10,000 contact records',
          'Up to 5 appeal pages',
          'Basic reports and secure hosting',
        ])}`,
      },
      c: {
        label: 'Best for most charities',
        name: 'Growth',
        price: '£499 / month',
        desc: `Income up to £1m a year. Plus the one-off setup fee below.\n${list([
          'Enhanced website options',
          'Apple Pay, Google Pay and PayPal',
          'Automated Gift Aid',
          'Unlimited appeal pages',
          '25,000 contact records',
          'Live dashboards and Mailchimp integration',
          'Telephone support',
        ])}`,
      },
    },
  },
  { type: 'callout', text: 'Raising £1m a year or more? | Enterprise is priced to your needs: bespoke design, automated Gift Aid, unlimited contacts, custom integrations, priority and out-of-hours support and enterprise-grade infrastructure. Ask us for a bespoke quote.' },

  { type: 'heading', text: 'Inside the startup package' },
  { type: 'text', text: 'For new and startup charities, we’ve put the essentials together in one simple package: a website that takes donations, a CRM behind it, and the hosting and support to keep it all running. One fee for the first year, then a lower price from year two.' },
  part('Your website', [
    'A fully optimised Islamic giving website',
    'Zakat calculator built in',
    'Cart-based checkout, so donors can give to several causes in one go',
    'Single and monthly donations',
    'Upsells at checkout to lift every gift',
    'Gift Aid captured on every eligible donation',
    'Stripe and PayPal supported',
  ]),
  part('Your donor CRM', [
    'Manage donors: every supporter and gift in one place',
    'Donor accounts: supporters manage their own giving',
    'Gift Aid made simple: matched to each gift, ready to claim',
    'Reporting: income, appeals and donors at a glance',
    'Appeal management: every project, Ramadan and Qurbani',
  ]),
  { type: 'callout', text: 'Live in 2 to 4 weeks | From signing to taking donations, on a proven Pillar template in your branding.' },
  { type: 'callout', text: 'Hosting and support included | Secure hosting, updates, onboarding, training and support.' },
  { type: 'investment', text: 'Year one, all in | £4,999 | + VAT. Website, CRM, hosting and support. Normally £6,588, so you save £1,589.' },
  { type: 'investment', text: 'Year two onwards | £2,990 a year | + VAT. Paid annually, which is 2 months free. Or £299 a month if you’d rather spread it.' },
  { type: 'text', text: 'For charities registered in the last 12 months or with an annual income of under £50,000. Limited number of places available for this package. All prices exclude VAT. Minimum term of 24 months. Marketing and extra modules are quoted separately.' },

  { type: 'heading', text: 'One-off setup for the monthly plans' },
  {
    type: 'comparison',
    text: [
      'Setup | Price (from) | What it is',
      'Template | £3,000 | A proven Pillar design in your branding. The quickest way to launch. Subscription based model.',
      'Tailored | £6,000 | A Pillar design adapted further around your charity and appeals.',
      'Bespoke | Quote | A fully custom design for larger or more complex charities.',
    ].join('\n'),
  },
  { type: 'text', text: 'All prices exclude VAT. Minimum term of 24 months, flexible after that. Extras such as offline payments and extended funds can be switched on when you need them. Marketing is quoted separately, around your appeals.' },

  { type: 'heading', text: 'A short call, then a clear proposal' },
  { type: 'text', text: 'The best next step is a 15-minute call where I walk you through Pillar and show you how your site could look. It would help to know:' },
  {
    type: 'comparison',
    text: [
      'Topic | Question',
      'Today | What do you use now for your website, donations and supporter records?',
      'Branding | Do you have a logo, colours or fonts in place?',
      'Appeals | Which projects or appeals would you like to launch with?',
      'Timeline | Roughly when would you like to go live?',
    ].join('\n'),
  },
  { type: 'text', text: 'With those, I’ll put together a clear proposal for you and your trustees. Just send me a couple of times that suit.\n\n{{rep_name}}\ni3MEDIA Ltd' },
];
