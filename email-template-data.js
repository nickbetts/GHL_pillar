export const TEMPLATE_VARIABLES = [
  'FIRST_NAME',
  'COMPANY_NAME',
  'SENDER_NAME',
  'SENDER_TITLE',
  'SENDER_EMAIL',
  'BOOKING_URL',
  'SIGNATURE',
];

export const VARIANTS = [
  { key: 'requested', label: 'Requested email', description: 'Send straight after a call when the lead asks for details.' },
  { key: 'follow-up', label: 'Gentle follow-up', description: 'A short, useful chase when the first email gets buried.' },
  { key: 'website', label: 'Website & CRO', description: 'Focus on trust, user journeys and converting more visits.' },
  { key: 'seo', label: 'SEO & AI search', description: 'Focus on discoverability in search engines and AI answers.' },
  { key: 'paid', label: 'Paid media', description: 'Focus on efficient acquisition, lead quality and measurement.' },
  { key: 'integrated', label: 'Joined-up growth', description: 'Position one accountable team across web, search and paid.' },
];

const SOURCES = {
  fca: { title: 'Consumer Duty', publisher: 'Financial Conduct Authority', url: 'https://www.fca.org.uk/firms/consumer-duty', checked: '2026-07-31' },
  sra: { title: 'Claims management activity', publisher: 'Solicitors Regulation Authority', url: 'https://www.sra.org.uk/solicitors/guidance/claims-management-activity/', checked: '2026-07-31' },
  ncsc: { title: 'Cyber Security Toolkit for Boards', publisher: 'National Cyber Security Centre', url: 'https://www.ncsc.gov.uk/collection/board-toolkit', checked: '2026-07-31' },
  ico: { title: 'CCTV and video surveillance', publisher: "Information Commissioner's Office", url: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/cctv-and-video-surveillance/', checked: '2026-07-31' },
  asa: { title: 'Cosmetic surgery', publisher: 'Advertising Standards Authority / CAP', url: 'https://www.asa.org.uk/advice-online/cosmetic-surgery.html', checked: '2026-07-31' },
  hfea: { title: 'Choose a fertility clinic', publisher: 'Human Fertilisation and Embryology Authority', url: 'https://www.hfea.gov.uk/choose-a-clinic/', checked: '2026-07-31' },
  hcpc: { title: 'Standards of conduct, performance and ethics', publisher: 'Health and Care Professions Council', url: 'https://www.hcpc-uk.org/standards/standards-of-conduct-performance-and-ethics/', checked: '2026-07-31' },
  bar: { title: 'Why use a BAR member for your move?', publisher: 'British Association of Removers', url: 'https://bar.co.uk/why-use-a-bar-member-for-your-move/', checked: '2026-07-31' },
  logistics: { title: 'Logistics industry information and policy', publisher: 'Logistics UK', url: 'https://logistics.org.uk/', checked: '2026-07-31' },
  hmrc: { title: 'Making Tax Digital for Income Tax', publisher: 'HM Revenue & Customs', url: 'https://www.gov.uk/government/collections/making-tax-digital-for-income-tax', checked: '2026-07-31' },
  gdc: { title: 'Guidance for the dental team', publisher: 'General Dental Council', url: 'https://www.gdc-uk.org/standards-guidance/standards-and-guidance', checked: '2026-07-31' },
};

function profile(sector, label, audience, observation, opportunity, proof, caution, sources = []) {
  return { sector, label, audience, observation, opportunity, proof, caution, sources };
}

export const SUBSECTORS = [
  profile('General', 'All sectors', 'ambitious businesses across sectors', 'A strong service can still lose opportunities when the website, search visibility and campaigns are not working together.', 'clarify the message, make the business easier to find and create a clearer route from first visit to enquiry', 'A clear value proposition, useful customer journeys, credible proof and reporting connected to meaningful outcomes.', 'Keep recommendations practical and avoid making sector-specific claims without first understanding the business.'),
  profile('Professional Services', 'Financial Advisers / Wealth Managers', 'regulated advice firms', 'Prospective clients often judge trust, clarity and credibility online before they are ready to speak to an adviser.', 'Make regulatory status, specialist expertise, fees and next steps easier to understand while capturing high-intent local and niche searches.', 'Adviser profiles, clear service pages, independently verifiable credentials and compliant client stories.', 'Do not imply FCA endorsement, guaranteed investment outcomes or compliance advice from i3MEDIA.', [SOURCES.fca]),
  profile('Professional Services', 'Family Law / Claims', 'family law and claims firms', 'People looking for legal help are often under pressure and need a clear, reassuring route from first question to initial conversation.', 'Use plain-language service journeys, transparent process information and high-intent local search pages to build confidence.', 'Accurate pricing information, complaints process, accreditations and carefully approved client feedback.', 'Publicity must be accurate and not misleading. Claims work has specific restrictions around unsolicited approaches and success statements.', [SOURCES.sra]),
  profile('Professional Services', 'Consultancies', 'specialist consultancies', 'Specialist firms can have deep expertise but still lose visibility to larger competitors with stronger publishing and search footprints.', 'Turn practical expertise into focused service pages, useful insight and outcome-led case studies that buyers can find and assess.', 'Named expertise, specific case studies and verifiable commercial outcomes.', 'Do not invent benchmarks or claim superiority over larger firms without evidence.'),
  profile('Professional Services', 'Accountants / Firms', 'accountancy firms', 'Tax digitisation and changing reporting requirements create a steady need for clear, timely guidance from trusted advisers.', 'Build searchable niche guidance and clearer advisory service journeys around the questions clients are already asking.', 'Qualified team profiles, HMRC-linked guidance, specialist sector pages and approved client examples.', 'Do not present i3MEDIA as a tax adviser or make unverified compliance claims.', [SOURCES.hmrc]),
  profile('Professional Services', 'Architects', 'architecture practices', 'Clients need to understand design quality, relevant project experience and how a practice handles the route from brief to delivery.', 'Make the portfolio easier to explore and create search journeys around location, building type and project need.', 'High-quality project photography, project constraints, team roles and substantiated credentials.', 'Avoid unsupported sustainability, planning-success or performance claims.'),
  profile('E-Commerce', 'Fashion & Apparel', 'fashion and apparel brands', 'Fashion teams have to balance product discovery, fast-changing ranges and acquisition costs while protecting margin.', 'Improve product findability, merchandising journeys, mobile conversion and the link between paid acquisition and repeat purchase.', 'Attributed revenue, product-level search data, customer retention and properly contextualised CRO tests.', 'Avoid unsupported uplift percentages and account for seasonality when presenting results.'),
  profile('E-Commerce', 'Home Wear', 'homeware retailers', 'Homeware customers need confidence in product detail, dimensions, stock, delivery and returns before they buy.', 'Make category discovery and product information work harder while reducing friction between inspiration and checkout.', 'Accurate product data, delivery clarity, authentic reviews and evidenced material or sustainability information.', 'Avoid broad environmental claims without specific evidence.'),
  profile('E-Commerce', 'Luxury Accessories / Goods', 'luxury and premium brands', 'Premium brands need digital reach without making the experience feel discount-led or interchangeable with mass-market retail.', 'Build digital authority, premium product journeys and controlled acquisition that protects the brand while growing an owned audience.', 'Editorial-quality assets, provenance, craftsmanship, service standards and first-party engagement.', 'Avoid price-led urgency, mass-market comparisons and vague claims of exclusivity.'),
  profile('Security', 'Security Consultancy & Risk Management', 'security and risk consultancies', 'Boards are expected to understand cyber and operational risk, but technical detail often fails to translate into a clear business decision.', 'Turn specialist expertise into board-level guidance, authority content and focused enquiry journeys for priority sectors.', 'Recognised qualifications, clear methodologies, board-ready resources and verifiable project outcomes.', 'Use preparedness and risk reduction rather than fear, and never promise complete protection.', [SOURCES.ncsc]),
  profile('Security', 'CCTV', 'commercial CCTV installers', 'Commercial buyers need to assess coverage, installation quality, support and privacy responsibilities before requesting a survey.', 'Combine strong local search pages with sector-specific examples, maintenance information and privacy-aware guidance.', 'Manufacturer approvals, installation examples, support terms and verified customer reviews.', 'Do not provide legal data-protection advice or claim a system is compliant without a proper assessment.', [SOURCES.ico]),
  profile('Transport & Logistics', 'Removals', 'removal companies', 'Moving decisions are time-sensitive and trust-led, so slow quote journeys or weak local proof can lose an enquiry quickly.', 'Strengthen local visibility, reviews, service-area pages and rapid quote follow-up around real moving needs.', 'Current accreditations, verified reviews, insurance details and response-time data.', 'Only mention BAR or other credentials when current and verifiable.', [SOURCES.bar]),
  profile('Transport & Logistics', 'Fleet Management', 'fleet management providers', 'Fleet buyers research cost, electrification, support and operational fit long before they submit a formal enquiry.', 'Use practical TCO content, calculators, case studies and longer-cycle nurture to turn research into qualified pipeline.', 'Transparent assumptions, customer fleet profiles, service levels and measured operational outcomes.', 'Disclose calculator assumptions and avoid promising immediate conversion or universal savings.', [SOURCES.logistics]),
  profile('Transport & Logistics', 'Heavy Haulage', 'heavy haulage operators', 'Procurement teams shortlist specialist operators on capability, safety, planning and evidence of comparable moves.', 'Make specialist equipment, route-planning expertise and project evidence visible to buyers before an RFQ.', 'Current certifications, project photography, load details and verifiable safety or delivery records.', 'Only use certifications, incident records and performance claims that can be evidenced.', [SOURCES.logistics]),
  profile('Healthcare', 'Private Dentists', 'private dental practices', 'Patients compare local practices on trust, treatment information, price clarity and ease of booking before making contact.', 'Improve local treatment discovery and create a calm, transparent journey from question to consultation.', 'Registered clinicians, transparent prices, genuine patient feedback and approved treatment information.', 'Do not guarantee outcomes, use unsupported “best” claims or make misleading NHS comparisons.', [SOURCES.gdc]),
  profile('Healthcare', 'Cosmetic Clinics', 'cosmetic clinics', 'Prospective patients need credible practitioner information, realistic expectations and space to make an informed decision.', 'Build a trust-first journey around consultation, credentials, aftercare and carefully substantiated treatment information.', 'Verifiable qualifications, consultation process, aftercare standards and appropriately consented evidence.', 'Never describe procedures as safe, easy or risk-free; avoid guaranteed results, urgency offers and unsubstantiated before/after claims.', [SOURCES.asa]),
  profile('Healthcare', 'Physiotherapy', 'physiotherapy practices', 'People often search by condition, location and availability, then assess whether a practice feels credible and easy to access.', 'Create useful condition-led content, strong local discovery and a simpler route to an appropriate first appointment.', 'HCPC registration, clinician expertise, accessible booking and appropriately framed outcome measures.', 'Do not promise a cure or guaranteed recovery, and keep clinical claims within approved evidence.', [SOURCES.hcpc]),
  profile('Healthcare', 'Fertility Clinics', 'fertility clinics', 'People choosing fertility care need empathy, transparent costs and context because headline success rates cannot predict an individual outcome.', 'Create a supportive decision journey around treatment, counselling, administration, pricing and the questions patients actually ask.', 'HFEA information, clear pricing, patient experience, counselling provision and contextualised clinic data.', 'Never imply individual success or use “best” or “highest success” claims without full, approved context.', [SOURCES.hfea]),
  profile('Healthcare', 'Hearing Care', 'hearing care providers', 'People can delay hearing support and may be unsure about the difference between devices, assessment and ongoing professional care.', 'Improve local hearing-test discovery and explain the value of regulated assessment, fitting and aftercare in accessible language.', 'HCPC registration, accessible content, transparent aftercare and genuine patient experience.', 'Do not promise a cure, guaranteed efficacy or an unsupported “best device” claim.', [SOURCES.hcpc]),
];

export const SECTORS = [...new Set(SUBSECTORS.map((item) => item.sector))];

const SUBSECTOR_KEYWORDS = [
  ['Financial Advisers / Wealth Managers', ['financial adviser', 'financial advisors', 'wealth manager', 'wealth managers', 'adviser', 'advisor', 'financial planning']],
  ['Family Law / Claims', ['family law', 'claim', 'claims', 'claim management', 'personal injury', 'legal claims']],
  ['Consultancies', ['consultancy', 'consulting', 'consultancies', 'management consulting', 'strategy consulting']],
  ['Accountants / Firms', ['accountant', 'accountancy', 'accountants', 'tax', 'bookkeeping', 'audit']],
  ['Architects', ['architect', 'architecture', 'architects']],
  ['Fashion & Apparel', ['fashion', 'apparel', 'clothing', 'wear']],
  ['Home Wear', ['homeware', 'home wear', 'homewares', 'home decor', 'interior']],
  ['Luxury Accessories / Goods', ['luxury', 'accessories', 'jewellery', 'jewelry', 'premium goods', 'premium']],
  ['Security Consultancy & Risk Management', ['security consultancy', 'risk management', 'cyber security', 'security risk', 'security services']],
  ['CCTV', ['cctv', 'video surveillance', 'surveillance', 'security systems']],
  ['Removals', ['removal', 'removals', 'moving', 'movers', 'relocation']],
  ['Fleet Management', ['fleet', 'fleet management', 'vehicle management', 'transport fleet']],
  ['Heavy Haulage', ['heavy haulage', 'haulage', 'haulier', 'heavy transport']],
  ['Private Dentists', ['dentist', 'dental', 'private dentist', 'dental practice']],
  ['Cosmetic Clinics', ['cosmetic', 'aesthetic', 'cosmetic clinic', 'clinic']],
  ['Physiotherapy', ['physio', 'physiotherapy', 'therapy', 'rehab']],
  ['Fertility Clinics', ['fertility', 'ivf', 'fertility clinic']],
  ['Hearing Care', ['hearing', 'hearing care', 'audiology', 'audiologist']],
];

export const SUBSECTOR_ALIASES = {
  'Financial Advisers/Wealth Managers': 'Financial Advisers / Wealth Managers',
  'Family Law/Claims': 'Family Law / Claims',
  'Accountants/Firms': 'Accountants / Firms',
  'Luxury Accessories/Goods': 'Luxury Accessories / Goods',
  'Security Consultancy & Risk': 'Security Consultancy & Risk Management',
  'Homeware': 'Home Wear',
};

const SERVICE_COPY = {
  website: {
    subject: 'A clearer enquiry journey for {{COMPANY_NAME}}',
    value: 'We help teams sharpen the message, remove friction from key journeys and make the website easier to measure and improve.',
    question: 'Would a short review of the main enquiry journey be useful?',
  },
  seo: {
    subject: 'Helping more of the right people find {{COMPANY_NAME}}',
    value: 'We bring technical SEO, useful content and AI-answer visibility together, so the site is easier to find wherever buyers begin their research.',
    question: 'Would it help if I mapped a few search opportunities around your priority services?',
  },
  paid: {
    subject: 'A more accountable route to new enquiries',
    value: 'We connect paid search and social to the landing experience and reporting, so lead quality and commercial outcomes guide the spend.',
    question: 'Would a quick look at the current acquisition journey be useful?',
  },
  integrated: {
    subject: 'Joining up web, search and paid for {{COMPANY_NAME}}',
    value: 'i3MEDIA puts strategy, design, build, SEO and paid media in one team, with one view of what is creating enquiries and where to improve next.',
    question: 'Would it be useful to compare that joined-up model with your current setup?',
  },
};

const AGENCY_LINE = 'For more than 20 years, i3MEDIA has helped organisations diagnose, build, launch, measure and optimise their digital activity with one accountable team.';

function buildSignature(values = {}) {
  const name = String(values.SENDER_NAME || '').trim();
  const title = String(values.SENDER_TITLE || '').trim();
  const email = String(values.SENDER_EMAIL || '').trim();
  const lines = ['Best,'];
  if (name) lines.push(name);
  if (title) lines.push(title);
  if (email) lines.push(email);
  return lines.join('\n');
}

export function normalizeSubsector(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const canonical = SUBSECTOR_ALIASES[raw] || raw;
  return SUBSECTORS.some((item) => item.label === canonical) ? canonical : '';
}

export function getSubsector(value) {
  const canonical = normalizeSubsector(value);
  return SUBSECTORS.find((item) => item.label === canonical) || null;
}

export function inferSubsector(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const [label, terms] of SUBSECTOR_KEYWORDS) {
    if (terms.some((term) => normalized.includes(term))) {
      return normalizeSubsector(label) || label;
    }
  }
  return '';
}

export function composeTemplate(subsectorValue, variantKey) {
  const item = getSubsector(subsectorValue);
  const variant = VARIANTS.find((entry) => entry.key === variantKey);
  if (!item || !variant) return null;

  let subject;
  let body;
  if (variantKey === 'requested') {
    subject = 'As promised - a few ideas for {{COMPANY_NAME}}';
    body = item.label === 'All sectors'
      ? `Hi {{FIRST_NAME}},\n\nGood speaking earlier. As promised, I wanted to send a little more detail.\n\nAt i3MEDIA, we help businesses turn their digital presence into a more reliable source of enquiries. That usually means making the website clearer and more useful, improving visibility in search, putting paid media behind the right opportunities and helping the different parts work together.\n\nThe aim is simple: make it easier for the right people to find {{COMPANY_NAME}}, understand what you offer and feel ready to get in touch. We bring strategy, web, SEO, paid media, AI search visibility and reporting together through one in-house team.\n\n${AGENCY_LINE}\n\nIf useful, I would be happy to look at the current setup and share two or three practical opportunities. You can reply here or choose a time that suits you: {{BOOKING_URL}}\n\n{{SIGNATURE}}`
      : `Hi {{FIRST_NAME}},\n\nGood speaking earlier. As promised, I wanted to send a little more detail.\n\nOne thing we often see with ${item.audience} is this: ${item.observation}\n\nFor {{COMPANY_NAME}}, a useful starting point could be to ${lowerFirst(item.opportunity)}\n\n${AGENCY_LINE}\n\nIf useful, I would be happy to look at the current setup and share two or three practical opportunities. You can reply here or choose a time that suits you: {{BOOKING_URL}}\n\n{{SIGNATURE}}`;
  } else if (variantKey === 'follow-up') {
    subject = 'Re: ideas for {{COMPANY_NAME}}';
    body = `Hi {{FIRST_NAME}},\n\nJust following up in case my earlier note got buried.\n\nThe opportunity I mentioned was to ${lowerFirst(item.opportunity)}\n\nNo long presentation needed. I can share a few practical observations based on the current site and leave you with the useful bits.\n\nWould that be worth 15 minutes? {{BOOKING_URL}}\n\n{{SIGNATURE}}`;
  } else {
    const service = SERVICE_COPY[variantKey];
    subject = service.subject;
    body = `Hi {{FIRST_NAME}},\n\nI wanted to follow up with one idea that feels particularly relevant to {{COMPANY_NAME}}.\n\nFor ${item.audience}, ${lowerFirst(item.observation)}\n\n${service.value} In your sector, that could mean ${lowerFirst(item.opportunity)}\n\n${AGENCY_LINE}\n\n${service.question} You can reply here or choose a time: {{BOOKING_URL}}\n\n{{SIGNATURE}}`;
  }

  return { subject, body, variant, subsector: item };
}

export function resolveTemplate(text, values = {}) {
  const lookup = Object.fromEntries(TEMPLATE_VARIABLES.map((key) => [key, String(values[key] || '').trim()]));
  lookup.SIGNATURE = lookup.SIGNATURE || buildSignature(lookup);
  // Render missing known variables as empty strings to avoid leaking raw placeholders into final copy.
  return String(text || '').replace(/\{\{([A-Z_]+)\}\}/g, (_token, key) => (key in lookup ? lookup[key] : ''));
}

export function unresolvedVariables(text) {
  return [...new Set([...String(text || '').matchAll(/\{\{([A-Z_]+)\}\}/g)].map((match) => match[1]))];
}

export function composeResolvedTemplate(subsectorValue, variantKey, values = {}) {
  const template = composeTemplate(subsectorValue, variantKey);
  if (!template) return null;
  const subject = resolveTemplate(template.subject, values);
  const body = resolveTemplate(template.body, { ...values, SIGNATURE: buildSignature(values) });
  return { ...template, subject, body, unresolved: unresolvedVariables(`${subject}\n${body}`) };
}

function lowerFirst(value) {
  const text = String(value || '');
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}