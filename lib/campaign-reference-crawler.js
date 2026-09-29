import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Agent, request } from 'undici';
import { parse } from 'parse5';

const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 750_000;
const MAX_IMAGE_BYTES = 500_000;
const MAX_IMAGES_TOTAL_BYTES = 1_500_000;
const MAX_IMAGES = 3;
const MAX_PAGES = 3;
const REQUEST_TIMEOUT = 6_000;
const CRAWL_TIMEOUT = 18_000;
const USER_AGENT = 'i3MEDIA-EmailReferenceBot/1.0 (+https://click.i3media.net)';
const BLOCKED_IMAGE_PATH = /(?:pixel|tracking|analytics|spacer|1x1|logo|favicon|avatar|badge)/i;
const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpeg'], ['image/png', 'png'], ['image/gif', 'gif'], ['image/webp', 'webp'],
]);

function parsePublicIp(value) {
  try {
    const parsed = ipaddr.process(String(value));
    return parsed.range() === 'unicast' ? { address: parsed.toString(), family: parsed.kind() === 'ipv4' ? 4 : 6 } : null;
  } catch {
    return null;
  }
}

export function validateReferenceUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('Reference URL is invalid'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS reference URLs are supported');
  if (url.username || url.password) throw new Error('Reference URLs cannot contain credentials');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Reference URLs cannot use a custom port');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Reference URL must use a public hostname');
  }
  if (ipaddr.isValid(hostname) && !parsePublicIp(hostname)) throw new Error('Reference URL must use a public IP address');
  url.hash = '';
  return { url, hostname };
}

async function resolvePublicAddress(hostname, deadline) {
  const literal = parsePublicIp(hostname);
  if (literal) return literal;
  let records;
  let timeout;
  try {
    records = await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Reference DNS lookup timed out')), Math.max(1, Math.min(REQUEST_TIMEOUT, deadline - Date.now()))); }),
    ]);
  }
  catch { throw new Error('Reference host could not be resolved'); }
  finally { clearTimeout(timeout); }
  if (!records.length) throw new Error('Reference host has no addresses');
  const safe = records.map((record) => parsePublicIp(record.address));
  if (safe.some((record) => !record)) throw new Error('Reference host resolves to a non-public address');
  return safe[0];
}

function pinnedAgent(hostname, pinned) {
  return new Agent({
    connect: {
      timeout: REQUEST_TIMEOUT,
      lookup(host, options, callback) {
        if (String(host).replace(/\.$/, '').toLowerCase() !== hostname) return callback(new Error('Unexpected reference host'));
        if (options?.all) return callback(null, [{ address: pinned.address, family: pinned.family }]);
        return callback(null, pinned.address, pinned.family);
      },
    },
  });
}

async function readBounded(body, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error('Reference response is too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

async function fetchPublic(value, { accept, maxBytes, deadline = Date.now() + REQUEST_TIMEOUT }) {
  let current = validateReferenceUrl(value).url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const remaining = Math.min(REQUEST_TIMEOUT, deadline - Date.now());
    if (remaining <= 0) throw new Error('Reference crawl timed out');
    const { hostname } = validateReferenceUrl(current.href);
    const pinned = await resolvePublicAddress(hostname, deadline);
    const agent = pinnedAgent(hostname, pinned);
    try {
      const response = await request(current, {
        method: 'GET', dispatcher: agent, maxRedirections: 0,
        headersTimeout: remaining, bodyTimeout: remaining, signal: AbortSignal.timeout(remaining),
        headers: { 'user-agent': USER_AGENT, accept, 'accept-encoding': 'identity' },
      });
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.body.destroy();
        if (!location || redirects === MAX_REDIRECTS) throw new Error('Reference page redirected too many times');
        current = new URL(location, current);
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.body.destroy();
        throw new Error(`Reference server returned HTTP ${response.statusCode}`);
      }
      const bytes = await readBounded(response.body, maxBytes);
      return { bytes, headers: response.headers, url: current.href };
    } finally {
      await agent.close().catch(() => {});
    }
  }
  throw new Error('Reference page redirected too many times');
}

function attr(node, name) {
  return node.attrs?.find((item) => item.name === name)?.value || '';
}

function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
  if (node.content) walk(node.content, visit);
}

function textContent(node) {
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map(textContent).join(' ');
}

export function parseReferenceHtml(html, pageUrl) {
  const document = parse(html);
  const meta = {};
  const headings = [];
  const paragraphs = [];
  const imageCandidates = [];
  const pageLinks = [];
  let title = '';
  walk(document, (node) => {
    if (node.tagName === 'title') title = textContent(node).trim();
    if (node.tagName === 'meta') {
      const key = (attr(node, 'property') || attr(node, 'name')).toLowerCase();
      if (['description', 'og:title', 'og:description', 'og:image', 'twitter:image'].includes(key)) meta[key] = attr(node, 'content');
    }
    if (/^h[1-3]$/.test(node.tagName || '')) {
      const value = textContent(node).replace(/\s+/g, ' ').trim();
      if (value) headings.push(value);
    }
    if (node.tagName === 'p' || node.tagName === 'li') {
      const value = textContent(node).replace(/\s+/g, ' ').trim();
      if (value.length > 35) paragraphs.push(value);
    }
    if (node.tagName === 'a') {
      const href = attr(node, 'href');
      const label = textContent(node).replace(/\s+/g, ' ').trim();
      if (href && label) pageLinks.push({ href, label: label.slice(0, 120) });
    }
    if (node.tagName === 'img') {
      const src = attr(node, 'src') || attr(node, 'data-src') || attr(node, 'data-lazy-src');
      const srcset = attr(node, 'srcset') || attr(node, 'data-srcset');
      const candidateSrc = src || srcset.split(',')[0]?.trim().split(/\s+/)[0] || '';
      const width = Number.parseInt(attr(node, 'width'), 10) || 0;
      const height = Number.parseInt(attr(node, 'height'), 10) || 0;
      const alt = attr(node, 'alt').replace(/\s+/g, ' ').trim().slice(0, 180);
      if (candidateSrc && !BLOCKED_IMAGE_PATH.test(candidateSrc) && (!width || width >= 120) && (!height || height >= 80)) {
        try { imageCandidates.push({ url: new URL(candidateSrc, pageUrl).href, alt, width, height }); } catch { /* ignore malformed image URLs */ }
      }
    }
  });
  const ogImage = meta['og:image'] || meta['twitter:image'];
  if (ogImage) {
    try { imageCandidates.unshift({ url: new URL(ogImage, pageUrl).href, alt: meta['og:title'] || title, width: 0, height: 0, featured: true }); } catch { /* ignore malformed metadata image */ }
  }
  return {
    title: (meta['og:title'] || title || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    description: (meta.description || meta['og:description'] || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    headings: [...new Set(headings)].slice(0, 20),
    text: [...new Set([...headings, ...paragraphs])].join('\n').slice(0, 5000),
    imageCandidates: [...new Map(imageCandidates.map((image) => [image.url, image])).values()].slice(0, 12),
    pageLinks,
  };
}

function discoverRelevantPages(sources, alreadyFetched, limit) {
  const candidates = [];
  const seen = new Set(alreadyFetched);
  const relevant = /service|solution|product|work|case-study|case_study|fundrais|about|approach|impact|sector|charit|what-we-do/i;
  const excluded = /login|logout|privacy|cookie|terms|search|cart|account|author|category|tag|jobs|careers|\/blog(?:\/|$)/i;
  for (const source of sources) {
    for (const link of source.pageLinks || []) {
      try {
        const url = new URL(link.href, source.url);
        if (url.origin !== new URL(source.url).origin || !['http:', 'https:'].includes(url.protocol)) continue;
        url.hash = '';
        url.search = '';
        if (excluded.test(url.pathname) || /\.(?:pdf|zip|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|svg|mp4|mp3)$/i.test(url.pathname)) continue;
        const key = url.href.replace(/\/$/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        const pathRelevant = relevant.test(url.pathname);
        const labelRelevant = relevant.test(link.label);
        candidates.push({ url: url.href, score: Number(pathRelevant) * 2 + Number(labelRelevant) });
      } catch { /* ignore malformed links */ }
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url)).slice(0, limit).map((item) => item.url);
}

function imageSignature(bytes, mediaType) {
  if (mediaType === 'jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mediaType === 'png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mediaType === 'gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString());
  if (mediaType === 'webp') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  return false;
}

async function fetchImage(candidate, fetcher, deadline) {
  const result = await fetcher(candidate.url, { accept: 'image/jpeg,image/png,image/webp,image/gif', maxBytes: MAX_IMAGE_BYTES, deadline });
  const contentType = String(result.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const mediaType = IMAGE_TYPES.get(contentType);
  if (!mediaType || !imageSignature(result.bytes, mediaType)) return null;
  return { url: result.url, alt: candidate.alt, mediaType: contentType, data: result.bytes.toString('base64'), bytes: result.bytes.length };
}

export async function crawlReferenceSites(referenceUrls = [], { fetcher = fetchPublic } = {}) {
  const urls = [...new Set(referenceUrls.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, MAX_PAGES);
  const deadline = Date.now() + CRAWL_TIMEOUT;
  const fetchPages = async (inputs) => Promise.all(inputs.map(async (input) => {
    try {
      const { bytes, headers, url } = await fetcher(input, { accept: 'text/html,application/xhtml+xml;q=0.9', maxBytes: MAX_HTML_BYTES, deadline });
      const contentType = String(headers['content-type'] || '').toLowerCase();
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error('Reference URL did not return an HTML page');
      return { input, source: { url, ...parseReferenceHtml(bytes.toString('utf8'), url), images: [] } };
    } catch (error) {
      return { input, error: String(error.message || 'Could not read reference').slice(0, 180) };
    }
  }));
  let pageResults = await fetchPages(urls);
  const fetchedUrls = pageResults.flatMap((result) => result.source ? [result.source.url.replace(/\/$/, '')] : []);
  const discovered = discoverRelevantPages(pageResults.flatMap((result) => result.source ? [result.source] : []), fetchedUrls, Math.max(0, MAX_PAGES - pageResults.length));
  if (discovered.length && Date.now() < deadline) pageResults = [...pageResults, ...await fetchPages(discovered)];
  const sources = pageResults.flatMap((result) => result.source ? [result.source] : []);
  const errors = [];
  pageResults.filter((result) => result.error).forEach(({ input, error }) => errors.push({ url: input, error }));
  const seen = new Set();
  const candidates = sources.flatMap((source, sourceIndex) => source.imageCandidates.map((image) => ({ ...image, sourceIndex })))
    .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || Number(Boolean(b.alt)) - Number(Boolean(a.alt)) || b.width * b.height - a.width * a.height);
  const selected = candidates.filter((candidate) => {
    if (seen.has(candidate.url) || seen.size >= MAX_IMAGES) return false;
    seen.add(candidate.url);
    return true;
  });
  const imageResults = await Promise.all(selected.map(async (candidate) => {
    try { return { candidate, image: await fetchImage(candidate, fetcher, deadline) }; }
    catch (error) { return { candidate, error: String(error.message || 'Could not fetch image').slice(0, 180) }; }
  }));
  for (const { candidate, image, error } of imageResults) {
    if (image) {
      image.sourceUrl = sources[candidate.sourceIndex].url;
      sources[candidate.sourceIndex].images.push(image);
    } else if (error) errors.push({ url: candidate.url, error });
  }
  return { sources, errors };
}

export const crawlerLimits = { pages: MAX_PAGES, discoveredPages: true, images: MAX_IMAGES, htmlBytes: MAX_HTML_BYTES, imageBytes: MAX_IMAGE_BYTES, totalImageBytes: MAX_IMAGES_TOTAL_BYTES, timeoutMs: CRAWL_TIMEOUT };
