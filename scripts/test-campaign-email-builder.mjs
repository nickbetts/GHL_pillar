import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateHtmlSequenceWithClaude, generateSequenceFromBrief, htmlToPlainText, isHtmlEmailBody, renderHtmlTemplate, sanitizeHtmlFragment } from '../lib/campaign-email-builder.js';
import { crawlReferenceSites, crawlerLimits, parseReferenceHtml, validateReferenceUrl } from '../lib/campaign-reference-crawler.js';

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

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.ANTHROPIC_API_KEY;
process.env.ANTHROPIC_API_KEY = 'test-key';
globalThis.fetch = async (_url, options) => {
  const request = JSON.parse(options.body);
  assert.equal(request.model, 'claude-opus-5-5');
  assert.ok(request.messages[0].content.some((block) => block.type === 'image' && block.source.data === 'iVBORw0KGgo='), 'Fetched image data should be sent for visual inspection');
  assert.ok(request.messages[0].content[0].text.includes('Visible offer copy from reference site'));
  return {
    ok: true,
    json: async () => ({ model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'create_email_sequence', input: { steps: [{
      stepName: 'Email 1', subjectTemplate: 'A useful idea for {{COMPANY_NAME}}',
      bodyTemplate: '<table width="600"><tr><td style="padding:24px"><h1>Hello {{FIRST_NAME}}</h1><p>A clear offer can help.</p><img src="https://example.com/hero.png" alt="Reference hero" width="600"><img src="https://unfetched.example/bad.png" alt="Unfetched"><a href="{{BOOKING_URL}}" style="background-color:#123456;padding:12px;border-radius:4px">Book a call</a>{{SIGNATURE_HTML}}<script>bad()</script></td></tr></table>',
      waitDays: 0,
    }] } }] }),
  };
};
try {
  const ai = await generateHtmlSequenceWithClaude({
    brief: 'Help charities raise more', referenceUrls: ['https://example.com'], stepCount: 1, campaignName: 'Charity growth',
    crawler: async () => ({ sources: [{ url:'https://example.com', title:'Example charity', description:'Visible offer copy from reference site', headings:['Raise more'], text:'Visible offer copy from reference site', images:[{ url:'https://example.com/hero.png', alt:'Reference hero', mediaType:'image/png', data:'iVBORw0KGgo=', bytes:8 }] }], errors:[] }),
  });
  const html = ai.steps[0].bodyTemplate;
  assert.equal(ai.model, 'claude-opus-5-5');
  assert.ok(isHtmlEmailBody(html), 'Claude output should remain HTML');
  assert.ok(html.includes('<table') && html.includes('{{FIRST_NAME}}'), 'Generated email should retain email-safe layout and personalization');
  assert.ok(html.includes('https://example.com/hero.png'), 'Generated email should be able to use an inspected image URL');
  assert.ok(!html.includes('unfetched.example'), 'Generated HTML must not use an image URL that the crawler did not fetch');
  assert.ok(html.includes('background-color:#123456') && html.includes('border-radius:4px'), 'Email-safe inline CTA styles should survive sanitization');
  assert.deepEqual(ai.research.pages[0].images.map((image) => image.url), ['https://example.com/hero.png']);
  assert.ok(!html.includes('<script'), 'Generated HTML should be sanitized');
  const rendered = renderHtmlTemplate(html, { FIRST_NAME: '<img src=x onerror=bad()>', COMPANY_NAME: 'Acme & Co', BOOKING_URL: 'https://example.com/book', SIGNATURE_HTML: '<p>Best</p><script>bad()</script>' });
  assert.ok(!rendered.includes('<script') && !rendered.includes('<img src=x'), 'Rendered values must not inject markup');
  assert.ok(rendered.includes('&lt;img') && rendered.includes('onerror'), 'Personalization values should remain escaped text in HTML');
  assert.ok(htmlToPlainText(rendered).includes('Hello &lt;img src=x onerror=bad()&gt;'), 'Plain-text alternative should be generated with escaped input preserved as text');
  assert.ok(renderHtmlTemplate('<p>Hello {{FIRST_NAME}}</p>', { FIRST_NAME: 'Alex', SIGNATURE_HTML: '<p>Best</p>' }).includes('<p>Best</p>'), 'A signature should be appended when absent');
} finally {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalApiKey;
}

assert.throws(() => validateReferenceUrl('http://127.0.0.1/admin'), /public IP/);
assert.throws(() => validateReferenceUrl('file:///etc/passwd'), /HTTP and HTTPS/);
assert.throws(() => validateReferenceUrl('https://example.com:8443/'), /custom port/);
const parsedReference = parseReferenceHtml('<html><head><title>Studio</title><meta name="description" content="Useful description"></head><body><h1>Grow donations</h1><p>A real paragraph with enough useful detail about the offer and services.</p><img src="/hero.png" alt="Hero image" width="600" height="400"><img src="/tracking-pixel.gif" width="1" height="1"></body></html>', 'https://example.com/page');
assert.equal(parsedReference.title, 'Studio');
assert.ok(parsedReference.text.includes('Grow donations'));
assert.equal(parsedReference.imageCandidates.length, 1, 'Tracking pixels should not be offered as images');
const fetchCalls = [];
const fakeCrawler = await crawlReferenceSites(['https://example.com/page'], { fetcher: async (url, options) => {
  fetchCalls.push({ url, accept: options.accept });
  if (options.accept.startsWith('text/html') && url.includes('/services')) return { url, headers:{ 'content-type':'text/html; charset=utf-8' }, bytes:Buffer.from('<title>Services</title><h1>Our services</h1><p>Detailed service copy with enough context for a campaign email.</p>') };
  if (options.accept.startsWith('text/html')) return { url, headers:{ 'content-type':'text/html; charset=utf-8' }, bytes:Buffer.from('<title>Test site</title><h1>Useful offer</h1><p>Detailed public copy about our service and its value for customers.</p><a href="/services">Our services</a><a href="https://other.example/private">Other site</a><meta property="og:image" content="https://example.com/hero.png">') };
  return { url, headers:{ 'content-type':'image/png' }, bytes:Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) };
} });
assert.equal(fakeCrawler.sources.length, 2, 'Crawler should follow relevant same-site links within its page cap');
assert.equal(fakeCrawler.sources[0].images.length, 1);
assert.ok(fetchCalls.some((call) => call.url === 'https://example.com/services'));
assert.ok(!fetchCalls.some((call) => call.url.includes('other.example')));
assert.equal(fetchCalls.length, 3, 'Crawler should fetch the root, relevant internal page, and referenced image');
assert.equal(crawlerLimits.pages, 3);

const campaignEditor = readFileSync(new URL('../campaigns-app.js', import.meta.url), 'utf8');
const campaignsApi = readFileSync(new URL('../api/campaigns.js', import.meta.url), 'utf8');
const testSendApi = readFileSync(new URL('../api/email-send.js', import.meta.url), 'utf8');
const scheduledSendApi = readFileSync(new URL('../api/cron-send-campaign-steps.js', import.meta.url), 'utf8');
assert.ok(campaignEditor.includes('data-body-mode="visual"') && campaignEditor.includes('data-body-mode="source"'), 'Campaign editor should expose Visual and HTML source modes');
assert.ok(campaignEditor.includes('contenteditable='), 'Campaign editor should provide a WYSIWYG surface');
assert.ok(campaignEditor.includes('up to 3 public pages') && campaignEditor.includes('images inspected'), 'AI builder should describe crawling and report fetched assets');
assert.ok(campaignsApi.includes('generateHtmlSequenceWithClaude'), 'AI generation should use the configured Claude API');
assert.ok(campaignsApi.includes('sanitizeHtmlFragment(rawBody)'), 'Saved HTML should be sanitized');
assert.ok(testSendApi.includes('renderHtmlTemplate') && scheduledSendApi.includes('renderHtmlTemplate'), 'Test and scheduled sends should both preserve HTML');

console.log(`campaign builder ok: ${generated.steps.length} steps generated`);
