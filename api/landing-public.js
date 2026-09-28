import { getSql } from './db.js';
import { latestRevision, pageFor, sourceHtml } from '../lib/landing-pages.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end('Method not allowed');
  const slug = String(req.query?.slug || '');
  if (!pageFor(slug)) return res.status(404).end('Page not found');

  try {
    let html;
    try {
      html = (await latestRevision(getSql(), slug))?.html;
    } catch (error) {
      console.error('Using source landing page while revisions are unavailable', slug, error);
      res.setHeader('X-Landing-Fallback', 'source');
    }
    html ||= await sourceHtml(slug);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(html);
  } catch (error) {
    console.error('Landing page unavailable', slug, error);
    return res.status(503).end('Page temporarily unavailable');
  }
}