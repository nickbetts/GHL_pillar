import sanitizeHtml from 'sanitize-html';

const DEFAULT_TOPICS = ['offer', 'pain points', 'proof', 'CTA'];

function toText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clampStepCount(value, fallback = 3) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(6, Math.max(1, num));
}

function normalizeTone(value) {
  const tone = toText(value).toLowerCase();
  if (['confident', 'direct', 'warm', 'playful', 'premium'].includes(tone)) return tone;
  return 'confident';
}

function summarizeReferenceUrls(referenceUrls) {
  if (!Array.isArray(referenceUrls)) return '';
  const urls = referenceUrls
    .map((entry) => toText(entry))
    .filter(Boolean)
    .slice(0, 5);
  if (!urls.length) return '';
  return urls.map((url) => {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }).join(', ');
}

function extractKeywords(brief, referenceUrls) {
  const source = `${brief || ''} ${referenceUrls?.join(' ') || ''}`;
  const words = toText(source)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3 && !['with', 'from', 'that', 'this', 'into', 'your', 'they', 'have', 'help', 'about', 'will', 'want', 'their', 'make', 'more', 'need', 'just', 'site', 'pages', 'page', 'https', 'www'].includes(word));
  const seen = new Set();
  const result = [];
  for (const word of words) {
    if (!seen.has(word)) {
      seen.add(word);
      result.push(word);
    }
    if (result.length >= 7) break;
  }
  return result;
}

function subjectFor(stepIndex, brief, tone, campaignName) {
  const keywords = extractKeywords(brief, []);
  const focus = keywords[stepIndex % keywords.length] || 'growth';
  const toneMap = {
    confident: ['A smarter way to', 'Quick idea for', 'How to improve', 'A better route to'],
    direct: ['Simple idea for', 'A fast win for', 'Need this?', 'Worth a look'],
    warm: ['Thought this might help', 'A quick idea for', 'I wanted to share', 'A few ideas for'],
    playful: ['A tiny win for', 'This is worth a look', 'Quick note for', 'Worth testing'],
    premium: ['A sharper way to', 'A more efficient route to', 'A better fit for', 'A premium angle for'],
  };
  const intro = (toneMap[tone] || toneMap.confident)[stepIndex % (toneMap[tone] || toneMap.confident).length];
  const label = toText(campaignName || 'Campaign');
  const subject = `${intro} ${focus}`;
  return subject.length > 60 ? `${intro} ${label}` : subject;
}

function buildBody(stepIndex, brief, tone, keywords, referenceSummary) {
  const leadIn = [
    'Hi {{FIRST_NAME}},',
    'Hi {{FIRST_NAME}},',
    'Hey {{FIRST_NAME}},',
  ][stepIndex % 3];
  const hook = keywords.length
    ? `I was looking at ${keywords.slice(0, 3).join(', ')} and it reminded me that the biggest opportunity is to make the offer easier to understand and easier to act on.`
    : 'I wanted to share a simple idea that could help you make the offer feel clearer and more compelling.';
  const benefits = [
    'The goal is to sharpen the positioning, make the value obvious, and give people a simple next step.',
    'It helps people quickly understand the value, trust the offer, and decide without friction.',
    'It makes the message more relevant, more memorable, and easier to respond to.',
  ][stepIndex % 3];
  const proofLine = referenceSummary
    ? `From what I’ve seen on ${referenceSummary}, the strongest offers are the ones that feel specific, useful and easy to test.`
    : 'The strongest offers tend to be specific, useful and easy to understand.';
  const cta = 'If it’s useful, I’d be happy to share a few practical ideas or a quick recommendation on the best next step.';
  const close = 'If this is relevant, I’m happy to send over a quick example or take a look at your current setup.';
  return [
    leadIn,
    '',
    `${hook}`,
    '',
    `${benefits}`,
    '',
    `${proofLine}`,
    '',
    `${cta}`,
    '',
    `You can take a look here: [Book a quick call]({{BOOKING_URL}})`,
    '',
    `${close}`,
    '',
    '{{SIGNATURE}}',
  ].join('\n');
}

export function sanitizeHtmlFragment(html) {
  const source = String(html || '');
  if (!source) return '';
  const cleaned = sanitizeHtml(source, {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'a', 'span', 'div', 'h1', 'h2', 'h3'],
    allowedAttributes: { a: ['href', 'target', 'rel'], span: ['style'] },
    allowedStyles: { '*': { color: [/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, /^rgb\(/] } },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          href: attribs.href || '#',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    },
  });
  return cleaned.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/javascript:/gi, '').trim();
}

export function generateSequenceFromBrief({ brief, referenceUrls, stepCount, tone, campaignName } = {}) {
  const cleanBrief = toText(brief) || 'We help businesses improve conversion and sales outcomes with clearer positioning and a stronger offer.';
  const sequenceCount = clampStepCount(stepCount, 3);
  const toneName = normalizeTone(tone);
  const keywords = extractKeywords(cleanBrief, referenceUrls);
  const referenceSummary = summarizeReferenceUrls(referenceUrls);
  const steps = Array.from({ length: sequenceCount }, (_, index) => {
    const stepName = `Email ${index + 1}`;
    const subjectTemplate = subjectFor(index, cleanBrief, toneName, campaignName);
    const bodyTemplate = sanitizeHtmlFragment(buildBody(index, cleanBrief, toneName, keywords, referenceSummary));
    return {
      stepName,
      stepOrder: index + 1,
      subjectTemplate,
      bodyTemplate,
      waitDays: index === 0 ? 0 : index === 1 ? 2 : 3,
      sendHour: 9,
      sendMinute: 0,
      sendTimezone: 'Europe/London',
      active: true,
    };
  });

  return {
    campaignName: toText(campaignName) || 'Growth campaign',
    stepCount: steps.length,
    tone: toneName,
    referenceSummary,
    steps,
  };
}

export default {
  generateSequenceFromBrief,
  sanitizeHtmlFragment,
};