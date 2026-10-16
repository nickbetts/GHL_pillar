/** What i3MEDIA sells, as plain text for the AI call prep. Mirrors the Offerings page (offerings.js); a test keeps the prices in sync. */

export const OFFERINGS_BRIEF = `
i3MEDIA is a UK marketing and software agency. Three retainer packages only. Anything else is an add-on or a custom quote, never a fourth package.

PACKAGES
- Get Found, £795/month, 6-month minimum. For "we can't be found online". Website care (hosting, security, updates, content updates), technical SEO, AI search setup, 2 authority articles a month, 8 social posts a month, monthly report.
- Get Leads, £1,750/month, 12-month minimum. The one we steer most businesses to. For "we need more enquiries". Everything in Get Found plus Google and Meta ads managed end to end, 2 landing pages built and hosted free, server-side conversion tracking, fresh ad creatives monthly, monthly 30-minute strategy call.
- Dominate, £3,500/month, 12-month minimum. For "we want to be number one". Everything in Get Leads plus 3 landing pages, 4 authority articles a month, click-fraud protection, email and SMS follow-up built and managed, fortnightly strategy calls.
- Ad spend is paid direct to the platform. On Get Leads and Dominate the management fee is 10% on spend above £5,000 up to £20,000, then 7.5% above, billed in arrears.

ADD-ONS (build is quoted on specs and the work required)
- Static website: from £1,000 one-off plus £99 to £300/month care. Live in about 2 weeks.
- Bespoke WordPress website: from £5,000 one-off plus £99 to £300/month care. 4 to 6 weeks, transferable to the client.
- Headless ecommerce shop: from £5,000 one-off plus £300 to £500/month.
- Bespoke CRM: from £5,000 one-off plus from £349/month. Built around their exact process.
- Tool integrations: quoted per project after discovery.
- Extra landing page £175 one-off plus £20/month. Extra authority article £150.

THE ONE QUESTION
"If you could fix one thing about your marketing tomorrow, what would it be?"
"We can't be found online" points to Get Found. "We need more enquiries" points to Get Leads. "We want to be number one" points to Dominate.

PHONE SCRIPT
"Most businesses we help have one of two problems: they can't be found online, or they're not getting enough enquiries. Which one sounds like you? ... That's exactly what Get Leads fixes, and it's £1,750 a month. Want me to tell you what happens in the first 30 days?"

VALUE MATHS
Ask what a new customer is worth (for example £3,000). Three extra customers a month is £9,000 a month, about £108,000 a year, against a Get Leads fee of about £21,000 a year: roughly 5x. One extra customer and they are still up.

OBJECTION: "That's more than we wanted to spend."
Reply: Get Found at £795 gets the website and search right first and everything carries into Get Leads later. If they only need a proper website, a static site starts from £1,000 one-off plus £99 a month.

RULES
- Every client gets a 60-day review.
- Pay quarterly: 5% off. Pay yearly in advance: 10% off. Discounts apply to the package fee only.
- Never invent prices, packages, results or client names that are not listed here.
`.trim();

/** Every price the brief quotes, so a test can confirm the Offerings page still shows the same ones. */
export const BRIEF_PRICES = ['£795', '£1,750', '£3,500', '£1,000', '£5,000', '£349', '£175', '£150'];
