import { readFile } from 'node:fs/promises';
import { parse } from 'parse5';

export const LANDING_PAGES = Object.freeze({
  home: { name: 'Home', route: '/', file: 'index.html' },
  growth: { name: 'Growth', route: '/growth', file: 'growth.html' },
  'charity-marketing': { name: 'Charity marketing', route: '/charity-marketing', file: 'charity-marketing.html' },
  'financial-advisers': { name: 'Financial advisers', route: '/financial-advisers', file: 'financial-advisers.html' },
  'industrial-engineering': { name: 'Industrial engineering', route: '/industrial-engineering', file: 'industrial-engineering.html' },
});

export function pageFor(slug) {
  return Object.hasOwn(LANDING_PAGES, slug) ? LANDING_PAGES[slug] : null;
}

export async function sourceHtml(slug) {
  const page = pageFor(slug);
  if (!page) throw new Error('Unknown landing page');
  return readFile(new URL(`../click-pages/${page.file}`, import.meta.url), 'utf8');
}

export function validatePageHtml(html, slug) {
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > 150_000 || html.length < 100) {
    throw new Error('HTML must be between 100 characters and 150 KB');
  }
  const errors = [];
  const document = parse(html, { onParseError: (error) => errors.push(error.code) });
  const elements = (node, tag) => {
    const found = [];
    if (node.tagName === tag) found.push(node);
    for (const child of node.childNodes || []) found.push(...elements(child, tag));
    return found;
  };
  if (errors.length || !/^\s*<!doctype html/i.test(html) || !elements(document, 'title').length || !elements(document, 'body').length) {
    throw new Error('HTML must be a complete, valid document with a title');
  }
  if (slug === 'growth') {
    const forms = elements(document, 'form');
    const scripts = elements(document, 'script');
    if (!forms.some((form) => form.attrs.some((attr) => attr.name === 'data-landing-form')) ||
        !scripts.some((script) => script.attrs.some((attr) => attr.name === 'src' && attr.value.startsWith('/click-pages/landing.js')))) {
      throw new Error('The Growth page must retain its lead form and landing.js integration');
    }
  }
  return html;
}

export async function initLandingPages(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS landing_page_revisions (
      slug TEXT NOT NULL,
      version INTEGER NOT NULL,
      html TEXT NOT NULL,
      published_by TEXT NOT NULL,
      published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (slug, version)
    )
  `;
}

export async function latestRevision(sql, slug) {
  const rows = await sql`
    SELECT version, html, published_by, published_at
    FROM landing_page_revisions WHERE slug = ${slug}
    ORDER BY version DESC LIMIT 1
  `;
  return rows[0] || null;
}