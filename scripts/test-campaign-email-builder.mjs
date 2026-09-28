import assert from 'node:assert/strict';
import { generateSequenceFromBrief, sanitizeHtmlFragment } from '../lib/campaign-email-builder.js';

const generated = generateSequenceFromBrief({
  brief: 'We help charities improve fundraising and lead generation with conversion-focused web design and SEO.',
  referenceUrls: ['https://example.com', 'https://example.com/services'],
  stepCount: 3,
  tone: 'confident',
  campaignName: 'Charity growth sequence',
});

assert.ok(Array.isArray(generated.steps), 'Expected a sequence array');
assert.equal(generated.steps.length, 3, 'Expected three generated steps');
assert.ok(generated.steps.every((step) => step.subjectTemplate && step.bodyTemplate), 'Each step should have subject and body content');
assert.ok(generated.steps[0].bodyTemplate.includes('<') || generated.steps[0].bodyTemplate.includes('Hi'), 'Generated copy should be usable in email templates');

const cleaned = sanitizeHtmlFragment('<script>alert("x")</script><p>Hello <a href="javascript:alert(1)" onclick="evil()">link</a></p>');
assert.ok(!cleaned.includes('<script'), 'Unsafe script tags should be stripped');
assert.ok(!cleaned.includes('javascript:'), 'Unsafe javascript URLs should be stripped');
assert.ok(cleaned.includes('<p>Hello'), 'Safe paragraph content should remain');

console.log(`campaign builder ok: ${generated.steps.length} steps generated`);
