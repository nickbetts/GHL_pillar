/**
 * Pitch Sites (signed-in reps, managers, admins).
 *   GET  ?action=list | get&id= | render&id=&page=&gated= | leads&q= | settings | reps
 *   POST { action: create | audit | update-brand | build | run-step | retry-step | edit | add-section | remove-section | move-section
 *                  | restore | share | update-share | email | archive | link-lead | settings-save }
 */
import crypto from 'crypto';
import { waitUntil } from '@vercel/functions';
import { getSql, initAuthTables, initQueueTable, isEmailSuppressed, writeAudit } from './db.js';
import { hasMinRole, resolveIdentity, scopedHmac } from './session.js';
import { sendViaMailgun } from './email-send.js';
import { addLeadNote, ensurePitchTables, loadSiteById, logPitchEvent, saveAsset } from '../lib/pitch-db.js';
import { crawlSite } from '../lib/pitch-crawl.js';
import { runAudit } from '../lib/pitch-audit.js';
import { buildSection, designSystem, editPart, researchBrief } from '../lib/pitch-ai.js';
import { editableParts, renderPage } from '../lib/pitch-render.js';
import { loadPitchConfig, savePitchConfig } from '../lib/pitch-config.js';

const MAX_ATTEMPTS = 3;
const STALE_SECONDS = 330;

function slugFor(name) {
  const base = String(name || 'site').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'site';
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

const canSeeAll = (identity) => hasMinRole(identity, 'manager');
function canAccess(identity, site) {
  if (!site) return false;
  if (canSeeAll(identity)) return true;
  return (identity.ghlOwnerId && site.owner_id === identity.ghlOwnerId) || site.created_by_email === identity.email;
}

function publicBase(req) {
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host || '';
  const proto = req.headers?.['x-forwarded-proto'] || (/^localhost|^127\./.test(host) ? 'http' : 'https');
  return host ? `${proto}://${host}` : (process.env.APP_URL || 'https://ghl-pillar.vercel.app');
}

function progressOf(steps) {
  const live = steps.filter((s) => s.status !== 'superseded');
  return { total: live.length, done: live.filter((s) => s.status === 'done').length, failed: live.filter((s) => s.status === 'failed').length, running: live.filter((s) => s.status === 'running').length };
}

async function loadSteps(sql, siteId) {
  return sql`SELECT id, seq, key, kind, page, section_key, label, status, attempts, error, started_at, finished_at FROM pitch_site_steps WHERE site_id = ${siteId} AND status <> 'superseded' ORDER BY seq, id`;
}

function stepOut(s) {
  return { id: s.id, kind: s.kind, page: s.page, sectionKey: s.section_key, label: s.label, status: s.status, attempts: s.attempts, error: s.error, startedAt: s.started_at, finishedAt: s.finished_at };
}

function siteSummary(site, extra = {}) {
  return {
    id: site.id, slug: site.slug, clientName: site.client_name, sourceUrl: site.source_url, status: site.status, ownerId: site.owner_id, ownerName: site.owner_name,
    leadId: site.lead_id, logo: site.brand?.logo || null, colors: site.brand?.colors || [], viewCount: site.view_count, firstViewedAt: site.first_viewed_at,
    lastViewedAt: site.last_viewed_at, sharedAt: site.shared_at, expiresAt: site.expires_at, unlockedAt: site.unlocked_at, builtAt: site.built_at,
    createdAt: site.created_at, version: site.version, error: site.error, ...extra,
  };
}

async function snapshot(sql, site, note, by) {
  const version = Number(site.version || 0) + 1;
  await sql`INSERT INTO pitch_site_versions (site_id, version, note, design, pages, created_by) VALUES (${site.id}, ${version}, ${note}, ${JSON.stringify(site.design || null)}, ${JSON.stringify(site.pages || {})}, ${by || null})`;
  await sql`UPDATE pitch_sites SET version = ${version}, updated_at = now() WHERE id = ${site.id}`;
  return version;
}

/** Makes sure a section's root carries id + data-section so the renderer, gate and editor can find it. */
export function normalizeSectionHtml(html, key) {
  let out = String(html || '').trim().replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
  if (!/^<section\b/i.test(out)) out = `<section>${out}</section>`;
  out = out.replace(/^<section\b([^>]*)>/i, (m, attrs) => {
    let a = attrs.replace(/\sdata-section\s*=\s*(["'])[^"']*\1/i, '').replace(/\sid\s*=\s*(["'])[^"']*\1/i, '');
    a = ` id="${key}" data-section="${key}"${a}`;
    return `<section${a}>`;
  });
  return out;
}

// ── Build pipeline ──────────────────────────────────────────────────────────

async function claimStep(sql, siteId) {
  const rows = await sql`
    UPDATE pitch_site_steps SET status = 'running', started_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT s.id FROM pitch_site_steps s
      WHERE s.site_id = ${siteId}
        AND (s.status = 'pending' OR (s.status = 'running' AND s.started_at < now() - make_interval(secs => ${STALE_SECONDS})))
        AND NOT EXISTS (SELECT 1 FROM pitch_site_steps d WHERE d.site_id = s.site_id AND d.seq < s.seq AND d.status NOT IN ('done', 'superseded', 'failed'))
      ORDER BY s.seq, s.id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, seq, key, kind, page, section_key, label, status, attempts`;
  return rows[0] || null;
}

async function executeStep(sql, site, step, config) {
  const housePrompt = config.housePrompt;
  if (step.kind === 'research') {
    const brief = await researchBrief({ brand: site.brand, audit: site.audit, housePrompt, notes: site.brand?.notes, secondaryUrl: site.brand?.secondaryUrl });
    const secondarySource = (site.brand?.pages || []).find((p) => p.url === site.brand?.secondaryUrl) || site.brand?.pages?.[1] || null;
    const pages = {
      home: { title: brief.homepage.title, sections: brief.homepage.sections, html: {} },
      secondary: { title: brief.secondary.title, navLabel: brief.secondary.navLabel, sourceUrl: secondarySource?.url || null, sections: brief.secondary.sections, html: {} },
    };
    await sql`UPDATE pitch_sites SET brief = ${JSON.stringify(brief)}, pages = ${JSON.stringify(pages)}, updated_at = now() WHERE id = ${site.id}`;
    await sql`UPDATE pitch_site_steps SET status = 'superseded' WHERE site_id = ${site.id} AND kind IN ('design', 'section') AND status <> 'superseded'`;
    await sql`INSERT INTO pitch_site_steps (site_id, seq, key, kind, label) VALUES (${site.id}, 2, 'design', 'design', 'Designing the look: fonts, colours, header and footer')`;
    for (const [page, plan] of [['home', pages.home], ['secondary', pages.secondary]]) {
      for (const s of plan.sections) {
        await sql`INSERT INTO pitch_site_steps (site_id, seq, key, kind, page, section_key, label)
          VALUES (${site.id}, 3, ${`${page}:${s.key}`}, 'section', ${page}, ${s.key}, ${`${page === 'home' ? 'Homepage' : plan.title}: ${s.name}`})`;
      }
    }
    return;
  }
  if (step.kind === 'design') {
    const design = await designSystem({ brand: site.brand, brief: site.brief, housePrompt });
    await sql`UPDATE pitch_sites SET design = ${JSON.stringify(design)}, updated_at = now() WHERE id = ${site.id}`;
    return;
  }
  if (step.kind === 'section') {
    const plan = site.pages?.[step.page];
    const section = plan?.sections?.find((s) => s.key === step.section_key);
    if (!section) return;
    const { html } = await buildSection({ brand: site.brand, brief: site.brief, design: site.design, page: step.page, section, housePrompt });
    const clean = normalizeSectionHtml(html, section.key);
    await sql`UPDATE pitch_sites SET pages = jsonb_set(pages, ${[step.page, 'html', section.key]}::text[], to_jsonb(${clean}::text), true), updated_at = now() WHERE id = ${site.id}`;
  }
}

async function finalizeIfDone(sql, siteId, actorEmail) {
  const rows = await sql`
    UPDATE pitch_sites SET status = 'ready', built_at = now(), error = NULL, updated_at = now()
    WHERE id = ${siteId} AND status = 'building'
      AND NOT EXISTS (SELECT 1 FROM pitch_site_steps WHERE site_id = ${siteId} AND status IN ('pending', 'running'))
      AND NOT EXISTS (SELECT 1 FROM pitch_site_steps WHERE site_id = ${siteId} AND kind IN ('research', 'design') AND status = 'failed')
    RETURNING id`;
  if (!rows[0]) return false;
  const site = await loadSiteById(sql, siteId);
  await snapshot(sql, site, 'First build', actorEmail);
  await logPitchEvent(sql, { siteId, kind: 'built', actorEmail });
  await addLeadNote(sql, site, `✨ Pitch site built for ${site.client_name}. Share it from Pitch Sites.`);
  return true;
}

async function runOneStep(sql, siteId, identity, config) {
  const step = await claimStep(sql, siteId);
  if (!step) {
    await finalizeIfDone(sql, siteId, identity.email);
    return { ran: null };
  }
  if (step.attempts > MAX_ATTEMPTS) {
    await sql`UPDATE pitch_site_steps SET status = 'failed', finished_at = now(), error = COALESCE(error, 'Timed out too many times') WHERE id = ${step.id}`;
    return { ran: step.key, failed: true };
  }
  const site = await loadSiteById(sql, siteId);
  try {
    await executeStep(sql, site, step, config);
    await sql`UPDATE pitch_site_steps SET status = 'done', finished_at = now(), error = NULL WHERE id = ${step.id}`;
  } catch (error) {
    const message = String(error?.message || error).slice(0, 400);
    const final = step.attempts >= MAX_ATTEMPTS || error?.status === 401 || /not configured/i.test(message);
    await sql`UPDATE pitch_site_steps SET status = ${final ? 'failed' : 'pending'}, error = ${message}, finished_at = ${final ? new Date().toISOString() : null}::timestamptz WHERE id = ${step.id}`;
    if (final && (step.kind === 'research' || step.kind === 'design')) {
      await sql`UPDATE pitch_sites SET status = 'failed', error = ${`${step.label}: ${message}`}, updated_at = now() WHERE id = ${siteId}`;
    }
    return { ran: step.key, error: message, final };
  }
  await finalizeIfDone(sql, siteId, identity.email);
  return { ran: step.key };
}

// ── Server-side workers: each finished step starts the next, so builds finish with the tab closed ──

const workerSig = (id) => scopedHmac('pitch-worker', String(id));
function validWorkerSig(id, sig) {
  const want = Buffer.from(workerSig(id));
  const got = Buffer.from(String(sig || ''));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** Fire-and-forget calls to our own worker endpoint. We only wait long enough for the requests to go out. */
function kickWorkers(req, siteId, count = 1) {
  if (process.env.PITCH_SITES_NO_WORKERS === '1') return;
  const url = `${publicBase(req)}/api/pitch-sites`;
  for (let i = 0; i < count; i += 1) {
    const sent = fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'worker', id: siteId, sig: workerSig(siteId) }) }).catch(() => {});
    try { waitUntil(Promise.race([sent, new Promise((r) => setTimeout(r, 2500))])); } catch { /* not on Vercel */ }
  }
}

async function workerHandler(req, res, body) {
  const siteId = Number.parseInt(body.id, 10) || 0;
  if (!siteId || !validWorkerSig(siteId, body.sig)) return res.status(403).json({ success: false });
  const sql = getSql();
  await ensurePitchTables(sql);
  const site = await loadSiteById(sql, siteId);
  if (!site || site.status !== 'building') return res.status(200).json({ success: true, idle: true });
  const config = await loadPitchConfig(sql);
  const result = await runOneStep(sql, siteId, { email: 'pitch-worker' }, config);
  if (result.ran) {
    const next = result.ran === 'design' && !result.error ? 3 : 1;
    kickWorkers(req, siteId, next);
  }
  return res.status(200).json({ success: true, ...result });
}

// ── Handler ─────────────────────────────────────────────────────────────────

function cleanColors(list) {
  return (Array.isArray(list) ? list : []).map((c) => String(c || '').trim().toLowerCase()).filter((c) => /^#[0-9a-f]{6}$/.test(c)).slice(0, 8);
}

export default async function handler(req, res) {
  if (req.method === 'POST' && req.body?.action === 'worker') {
    try { return await workerHandler(req, res, req.body); } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
  }
  const identity = resolveIdentity(req);
  if (!identity || identity.via !== 'session') return res.status(401).json({ success: false, error: 'Sign in required' });
  if (!hasMinRole(identity, 'rep')) return res.status(403).json({ success: false, error: 'Not allowed' });
  const sql = getSql();
  try {
    await ensurePitchTables(sql);
    const body = req.method === 'POST' ? (req.body || {}) : {};
    const action = String(req.method === 'GET' ? req.query?.action || 'list' : body.action || '');
    const config = await loadPitchConfig(sql);

    const loadAllowed = async (id) => {
      const site = await loadSiteById(sql, Number.parseInt(id, 10) || 0);
      if (!site || !canAccess(identity, site)) { const e = new Error('Pitch site not found'); e.status = 404; throw e; }
      return site;
    };

    if (req.method === 'GET') {
      if (action === 'list') {
        const all = canSeeAll(identity);
        const rows = await sql`
          SELECT s.id, s.slug, s.owner_id, s.owner_name, s.created_by_email, s.lead_id, s.client_name, s.source_url, s.status, s.brand, s.version, s.error, s.unlocked_at,
                 s.expires_at, s.shared_at, s.first_viewed_at, s.last_viewed_at, s.view_count, s.built_at, s.created_at,
                 (SELECT COUNT(*)::int FROM pitch_site_steps t WHERE t.site_id = s.id AND t.status <> 'superseded') AS steps_total,
                 (SELECT COUNT(*)::int FROM pitch_site_steps t WHERE t.site_id = s.id AND t.status = 'done') AS steps_done,
                 (SELECT COUNT(*)::int FROM pitch_site_events e WHERE e.site_id = s.id AND e.kind = 'booked') AS booked,
                 (SELECT COUNT(*)::int FROM pitch_site_events e WHERE e.site_id = s.id AND e.kind = 'signup') AS signups
          FROM pitch_sites s
          WHERE s.archived_at IS NULL AND (${all} OR s.owner_id = ${identity.ghlOwnerId || ''} OR s.created_by_email = ${identity.email})
          ORDER BY s.created_at DESC LIMIT 200`;
        return res.status(200).json({
          success: true, canSeeAll: all, isAdmin: hasMinRole(identity, 'admin'),
          sites: rows.map((r) => siteSummary(r, { progress: { total: r.steps_total, done: r.steps_done }, booked: r.booked, signups: r.signups })),
        });
      }
      if (action === 'get') {
        const site = await loadAllowed(req.query?.id);
        const [steps, versions, visits, events, lead] = await Promise.all([
          loadSteps(sql, site.id),
          sql`SELECT version, note, created_by, created_at FROM pitch_site_versions WHERE site_id = ${site.id} ORDER BY version DESC LIMIT 30`,
          sql`SELECT visitor, started_at, last_seen_at, seconds, max_depth, pages, device FROM pitch_site_visits WHERE site_id = ${site.id} ORDER BY started_at DESC LIMIT 50`,
          sql`SELECT kind, visitor, actor_email, meta, created_at FROM pitch_site_events WHERE site_id = ${site.id} ORDER BY created_at DESC LIMIT 80`,
          site.lead_id ? sql`SELECT id, name, company_name, email, phone FROM queue_leads WHERE id = ${site.lead_id}` : [],
        ]);
        const hasBefore = (await sql`SELECT 1 FROM pitch_site_assets WHERE site_id = ${site.id} AND key = 'before' LIMIT 1`).length > 0;
        return res.status(200).json({
          success: true,
          site: {
            ...siteSummary(site), brand: site.brand, brief: site.brief, audit: site.audit, share: site.share || {},
            pages: Object.fromEntries(Object.entries(site.pages || {}).map(([k, p]) => [k, { title: p.title, navLabel: p.navLabel, sourceUrl: p.sourceUrl, sections: p.sections, built: Object.keys(p.html || {}) }])),
            parts: { home: editableParts(site, 'home'), secondary: editableParts(site, 'secondary') },
            hasDesign: !!site.design, hasBefore,
          },
          lead: lead[0] || null,
          steps: steps.map(stepOut), progress: progressOf(steps), versions, visits, events,
          publicUrl: `${publicBase(req)}/p/${site.slug}`, gate: config.gate, expiryDays: config.expiryDays,
        });
      }
      if (action === 'progress') {
        const site = await loadAllowed(req.query?.id);
        const steps = await loadSteps(sql, site.id);
        return res.status(200).json({ success: true, status: site.status, error: site.error, steps: steps.map(stepOut), progress: progressOf(steps), updatedAt: site.updated_at });
      }
      if (action === 'render') {
        const site = await loadAllowed(req.query?.id);
        const page = req.query?.page === 'secondary' ? 'secondary' : 'home';
        const steps = site.status === 'building' ? await loadSteps(sql, site.id) : [];
        const gated = req.query?.gated === '1';
        const hasSections = Object.values(site.pages || {}).some((p) => p?.sections?.length);
        const html = site.design || (site.status === 'building' && hasSections)
          ? renderPage({ site, page, mode: gated ? 'client' : 'studio', gated, gate: config.gate, repName: (site.owner_name || '').split(' ')[0], steps })
          : '';
        return res.status(200).json({ success: true, html, status: site.status });
      }
      if (action === 'leads') {
        const q = String(req.query?.q || '').trim().slice(0, 80);
        if (q.length < 2) return res.status(200).json({ success: true, leads: [] });
        const like = `%${q}%`;
        const all = canSeeAll(identity);
        const rows = await sql`
          SELECT id, name, company_name, email, company_website, owner FROM queue_leads
          WHERE archived_at IS NULL AND (${all} OR owner_id = ${identity.ghlOwnerId || ''})
            AND (company_name ILIKE ${like} OR name ILIKE ${like} OR email ILIKE ${like} OR company_website ILIKE ${like})
          ORDER BY updated_at DESC LIMIT 10`;
        return res.status(200).json({ success: true, leads: rows });
      }
      if (action === 'reps') {
        const rows = await sql`SELECT name, ghl_owner_id FROM app_users WHERE active = TRUE AND ghl_owner_id IS NOT NULL AND ghl_owner_id <> '' ORDER BY name`;
        return res.status(200).json({ success: true, reps: rows.map((r) => ({ ownerId: r.ghl_owner_id, name: r.name })) });
      }
      if (action === 'settings') {
        if (!hasMinRole(identity, 'admin')) return res.status(403).json({ success: false, error: 'Admins only' });
        return res.status(200).json({ success: true, config });
      }
      return res.status(400).json({ success: false, error: 'Unknown action' });
    }

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    if (action === 'create') {
      let ownerId = identity.ghlOwnerId || null;
      let ownerName = identity.name || null;
      if (body.ownerId && hasMinRole(identity, 'manager')) {
        const rep = (await sql`SELECT name, ghl_owner_id FROM app_users WHERE ghl_owner_id = ${String(body.ownerId)} AND active = TRUE LIMIT 1`)[0];
        if (rep) { ownerId = rep.ghl_owner_id; ownerName = rep.name; }
      }
      let brand;
      try { brand = await crawlSite(body.url); } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
      brand.secondaryUrl = brand.pages[1]?.url || null;
      brand.notes = String(body.notes || '').slice(0, 1500);
      const clientName = String(body.clientName || '').trim().slice(0, 120) || brand.name;
      brand.name = clientName;
      await initQueueTable();
      let leadId = Number.parseInt(body.leadId, 10) || null;
      if (!leadId) {
        const host = brand.host;
        const match = await sql`
          SELECT id FROM queue_leads
          WHERE archived_at IS NULL AND company_website ILIKE ${`%${host}%`} AND (${canSeeAll(identity)} OR owner_id = ${identity.ghlOwnerId || ''})
          ORDER BY (owner_id = ${ownerId || ''}) DESC, updated_at DESC LIMIT 1`;
        leadId = match[0]?.id || null;
      }
      const rows = await sql`
        INSERT INTO pitch_sites (slug, owner_id, owner_name, created_by_email, lead_id, client_name, source_url, status, brand, share)
        VALUES (${slugFor(clientName)}, ${ownerId}, ${ownerName}, ${identity.email}, ${leadId}, ${clientName}, ${brand.url}, 'crawled', ${JSON.stringify(brand)}, ${JSON.stringify({ expiresDays: config.expiryDays })})
        RETURNING id`;
      await logPitchEvent(sql, { siteId: rows[0].id, kind: 'created', actorEmail: identity.email, meta: { url: brand.url, pages: brand.pages.length } });
      await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'pitch_site_created', target: String(rows[0].id), meta: { url: brand.url } }).catch(() => {});
      return res.status(200).json({ success: true, id: rows[0].id });
    }

    if (action === 'audit') {
      const site = await loadAllowed(body.id);
      const { screenshot, audit } = await runAudit(site.source_url);
      if (screenshot) await saveAsset(sql, site.id, 'before', screenshot.mime, screenshot.bytes);
      await sql`UPDATE pitch_sites SET audit = ${JSON.stringify({ ...audit, hasBefore: !!screenshot })}, updated_at = now() WHERE id = ${site.id}`;
      return res.status(200).json({ success: true, audit, hasBefore: !!screenshot });
    }

    if (action === 'update-brand') {
      const site = await loadAllowed(body.id);
      const b = { ...(site.brand || {}) };
      const patch = body.brand || {};
      if (typeof patch.name === 'string' && patch.name.trim()) b.name = patch.name.trim().slice(0, 120);
      if (patch.logoUrl !== undefined) b.logo = /^https?:\/\//i.test(String(patch.logoUrl || '')) ? { url: String(patch.logoUrl).slice(0, 1000) } : (patch.logoUrl === '' ? null : b.logo);
      if (patch.logoSvgIndex !== undefined) { const c = (b.logoCandidates || [])[Number(patch.logoSvgIndex)]; if (c) b.logo = c; }
      if (Array.isArray(patch.colors)) { const cols = cleanColors(patch.colors); if (cols.length) b.colors = cols; }
      if (typeof patch.secondaryUrl === 'string') b.secondaryUrl = (b.pages || []).some((p) => p.url === patch.secondaryUrl) ? patch.secondaryUrl : b.secondaryUrl;
      if (typeof patch.notes === 'string') b.notes = patch.notes.slice(0, 1500);
      if (Array.isArray(patch.excludedImages)) b.excludedImages = patch.excludedImages.map(String).slice(0, 60);
      await sql`UPDATE pitch_sites SET brand = ${JSON.stringify(b)}, client_name = ${b.name || site.client_name}, updated_at = now() WHERE id = ${site.id}`;
      return res.status(200).json({ success: true });
    }

    if (action === 'build') {
      const site = await loadAllowed(body.id);
      if (site.status === 'building') return res.status(200).json({ success: true, already: true });
      if (site.design) await snapshot(sql, site, 'Before rebuild', identity.email);
      await sql`UPDATE pitch_site_steps SET status = 'superseded' WHERE site_id = ${site.id} AND status <> 'superseded'`;
      await sql`INSERT INTO pitch_site_steps (site_id, seq, key, kind, label) VALUES (${site.id}, 1, 'research', 'research', 'Researching the sector and planning the pages')`;
      await sql`UPDATE pitch_sites SET status = 'building', error = NULL, build_started_at = now(), design = NULL, pages = '{}'::jsonb, updated_at = now() WHERE id = ${site.id}`;
      await logPitchEvent(sql, { siteId: site.id, kind: 'build_started', actorEmail: identity.email });
      kickWorkers(req, site.id, 1);
      return res.status(200).json({ success: true });
    }

    if (action === 'run-step') {
      const site = await loadAllowed(body.id);
      let result = { ran: null };
      if (site.status === 'building') {
        result = await runOneStep(sql, site.id, identity, config);
        if (result.ran) kickWorkers(req, site.id, result.ran === 'design' ? 3 : 1);
      }
      const fresh = await loadSiteById(sql, site.id);
      const steps = await loadSteps(sql, site.id);
      return res.status(200).json({ success: true, ...result, status: fresh.status, error: fresh.error, steps: steps.map(stepOut), progress: progressOf(steps) });
    }

    if (action === 'retry-step') {
      const site = await loadAllowed(body.id);
      const stepId = Number.parseInt(body.stepId, 10);
      const rows = await sql`UPDATE pitch_site_steps SET status = 'pending', attempts = 0, error = NULL, finished_at = NULL WHERE id = ${stepId} AND site_id = ${site.id} AND status = 'failed' RETURNING kind`;
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Nothing to retry' });
      await sql`UPDATE pitch_sites SET status = 'building', error = NULL, updated_at = now() WHERE id = ${site.id}`;
      kickWorkers(req, site.id, 1);
      return res.status(200).json({ success: true });
    }

    if (action === 'edit' || action === 'add-section') {
      const site = await loadAllowed(body.id);
      if (!site.design || site.status === 'building') return res.status(409).json({ success: false, error: 'Wait for the build to finish first' });
      const page = body.page === 'secondary' ? 'secondary' : 'home';
      const instruction = String(body.instruction || '').trim().slice(0, 2000);
      if (!instruction) return res.status(400).json({ success: false, error: 'Say what you want changed' });
      const plan = site.pages?.[page];
      if (!plan) return res.status(400).json({ success: false, error: 'Unknown page' });
      const pages = structuredClone(site.pages);
      const design = structuredClone(site.design);
      let summary;
      let part;
      if (action === 'add-section') {
        const after = String(body.after || '');
        let key = instruction.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 3).join('-') || 'new-section';
        while (pages[page].sections.some((s) => s.key === key)) key = `${key}-2`;
        const result = await editPart({ brand: site.brand, brief: site.brief, design, page, part: key, currentHtml: '', instruction, housePrompt: config.housePrompt, mode: 'new' });
        const idx = pages[page].sections.findIndex((s) => s.key === after);
        const entry = { key, name: instruction.slice(0, 40), brief: instruction };
        pages[page].sections.splice(idx >= 0 ? idx + 1 : pages[page].sections.length, 0, entry);
        pages[page].html[key] = normalizeSectionHtml(result.html, key);
        summary = result.summary;
        part = key;
      } else {
        part = String(body.part || '');
        const history = (site.share?.editHistory?.[`${page}:${part}`] || []);
        let current;
        if (part === 'header') current = design.headerHtml;
        else if (part === 'footer') current = design.footerHtml;
        else if (part === 'styles') current = design.css;
        else current = plan.html?.[part];
        if (current == null) return res.status(400).json({ success: false, error: 'Pick the part of the page to change' });
        const result = await editPart({ brand: site.brand, brief: site.brief, design, page, part, currentHtml: current, instruction, history, housePrompt: config.housePrompt });
        if (part === 'header') design.headerHtml = result.html;
        else if (part === 'footer') design.footerHtml = result.html;
        else if (part === 'styles') design.css = result.html.replace(/<\/?style[^>]*>/gi, '');
        else pages[page].html[part] = normalizeSectionHtml(result.html, part);
        summary = result.summary;
      }
      await snapshot(sql, site, `Before: ${instruction.slice(0, 80)}`, identity.email);
      const share = { ...(site.share || {}) };
      share.editHistory = { ...(share.editHistory || {}) };
      const hk = `${page}:${part}`;
      share.editHistory[hk] = [...(share.editHistory[hk] || []), instruction].slice(-6);
      await sql`UPDATE pitch_sites SET pages = ${JSON.stringify(pages)}, design = ${JSON.stringify(design)}, share = ${JSON.stringify(share)}, updated_at = now() WHERE id = ${site.id}`;
      await logPitchEvent(sql, { siteId: site.id, kind: 'edited', actorEmail: identity.email, meta: { page, part, instruction: instruction.slice(0, 200) } });
      return res.status(200).json({ success: true, summary, part });
    }

    if (action === 'remove-section' || action === 'move-section') {
      const site = await loadAllowed(body.id);
      const page = body.page === 'secondary' ? 'secondary' : 'home';
      const pages = structuredClone(site.pages || {});
      const list = pages[page]?.sections || [];
      const idx = list.findIndex((s) => s.key === body.key);
      if (idx < 0) return res.status(404).json({ success: false, error: 'Section not found' });
      await snapshot(sql, site, action === 'remove-section' ? `Before removing ${list[idx].name}` : `Before moving ${list[idx].name}`, identity.email);
      if (action === 'remove-section') list.splice(idx, 1);
      else {
        const to = idx + (body.dir === 'up' ? -1 : 1);
        if (to >= 0 && to < list.length) [list[idx], list[to]] = [list[to], list[idx]];
      }
      await sql`UPDATE pitch_sites SET pages = ${JSON.stringify(pages)}, updated_at = now() WHERE id = ${site.id}`;
      return res.status(200).json({ success: true });
    }

    if (action === 'restore') {
      const site = await loadAllowed(body.id);
      const v = (await sql`SELECT design, pages FROM pitch_site_versions WHERE site_id = ${site.id} AND version = ${Number.parseInt(body.version, 10) || 0} LIMIT 1`)[0];
      if (!v || !v.design) return res.status(404).json({ success: false, error: 'Version not found' });
      await snapshot(sql, site, `Before restoring v${body.version}`, identity.email);
      await sql`UPDATE pitch_sites SET design = ${JSON.stringify(v.design)}, pages = ${JSON.stringify(v.pages)}, status = 'ready', updated_at = now() WHERE id = ${site.id}`;
      return res.status(200).json({ success: true });
    }

    if (action === 'share') {
      const site = await loadAllowed(body.id);
      const days = Number(site.share?.expiresDays ?? config.expiryDays);
      await sql`
        UPDATE pitch_sites SET shared_at = COALESCE(shared_at, now()),
          expires_at = CASE WHEN expires_at IS NULL AND ${days} > 0 THEN now() + make_interval(days => ${days}) ELSE expires_at END,
          updated_at = now()
        WHERE id = ${site.id}`;
      await logPitchEvent(sql, { siteId: site.id, kind: 'shared', actorEmail: identity.email, meta: { channel: String(body.channel || 'copy').slice(0, 20) } });
      if (!site.shared_at) await addLeadNote(sql, site, `🔗 Pitch site link shared with ${site.client_name}.`);
      return res.status(200).json({ success: true });
    }

    if (action === 'update-share') {
      const site = await loadAllowed(body.id);
      const share = { ...(site.share || {}) };
      if (body.repPhone !== undefined) share.repPhone = String(body.repPhone || '').replace(/[^\d+ ()-]/g, '').slice(0, 30);
      let expiresAt = site.expires_at;
      if (body.expiresDays !== undefined) {
        const d = Number.parseInt(body.expiresDays, 10);
        share.expiresDays = Number.isFinite(d) && d > 0 ? Math.min(d, 365) : 0;
        expiresAt = share.expiresDays ? new Date(Date.now() + share.expiresDays * 86400000).toISOString() : null;
      }
      const unlocked = body.unlocked === undefined ? site.unlocked_at : (body.unlocked ? (site.unlocked_at || new Date().toISOString()) : null);
      await sql`UPDATE pitch_sites SET share = ${JSON.stringify(share)}, expires_at = ${expiresAt}::timestamptz, unlocked_at = ${unlocked}::timestamptz, updated_at = now() WHERE id = ${site.id}`;
      return res.status(200).json({ success: true });
    }

    if (action === 'email') {
      const site = await loadAllowed(body.id);
      await initAuthTables();
      const to = String(body.to || '').trim().toLowerCase();
      const subject = String(body.subject || '').trim().slice(0, 200);
      const text = String(body.body || '').trim().slice(0, 8000);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ success: false, error: 'Enter a valid email address' });
      if (!subject || !text) return res.status(400).json({ success: false, error: 'Add a subject and message' });
      if (await isEmailSuppressed(sql, to)) return res.status(400).json({ success: false, error: 'That address has unsubscribed or bounced, so we can\u2019t email it' });
      const sender = (await sql`SELECT id, email, name, sender_email, sender_signature FROM app_users WHERE lower(email) = ${identity.email.toLowerCase()} AND active = TRUE LIMIT 1`)[0];
      if (!sender) return res.status(403).json({ success: false, error: 'Your account can\u2019t send email' });
      const fromEmail = sender.email;
      const link = `${publicBase(req)}/p/${site.slug}`;
      const finalText = text.includes(link) ? text : `${text}\n\n${link}`;
      const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">${escHtml(finalText).replace(new RegExp(escHtml(link).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), `<a href="${link}" style="color:#4f46e5;font-weight:600">${escHtml(link)}</a>`).replace(/\n/g, '<br>')}</div>`;
      let response;
      try {
        response = await sendViaMailgun({ from: `${sender.name || fromEmail} <${fromEmail}>`, to, subject, text: finalText, html, replyTo: fromEmail });
      } catch (error) {
        return res.status(502).json({ success: false, error: `Email failed: ${error.message}` });
      }
      await sql`
        INSERT INTO email_send_logs (batch_key, lead_id, sender_user_id, sender_email, sender_name, recipient_email, lead_owner_id, template_key, subject_template, body_template, rendered_subject, rendered_body, provider_message_id, status, sent_at)
        VALUES (${crypto.randomUUID()}, ${site.lead_id}, ${sender.id}, ${fromEmail}, ${sender.name || null}, ${to}, ${site.owner_id}, 'pitch_site', ${subject}, ${text}, ${subject}, ${finalText}, ${response?.id || null}, 'sent', now())`.catch(() => {});
      const days = Number(site.share?.expiresDays ?? config.expiryDays);
      await sql`UPDATE pitch_sites SET shared_at = COALESCE(shared_at, now()), expires_at = CASE WHEN expires_at IS NULL AND ${days} > 0 THEN now() + make_interval(days => ${days}) ELSE expires_at END, updated_at = now() WHERE id = ${site.id}`;
      await logPitchEvent(sql, { siteId: site.id, kind: 'shared', actorEmail: identity.email, meta: { channel: 'email', to } });
      await addLeadNote(sql, site, `✉️ Pitch site emailed to ${to}: "${subject}"`);
      return res.status(200).json({ success: true });
    }

    if (action === 'link-lead') {
      const site = await loadAllowed(body.id);
      const leadId = Number.parseInt(body.leadId, 10) || null;
      if (leadId) {
        const lead = (await sql`SELECT id, owner_id FROM queue_leads WHERE id = ${leadId} LIMIT 1`)[0];
        if (!lead || (!canSeeAll(identity) && lead.owner_id !== identity.ghlOwnerId)) return res.status(404).json({ success: false, error: 'Lead not found' });
      }
      await sql`UPDATE pitch_sites SET lead_id = ${leadId}, updated_at = now() WHERE id = ${site.id}`;
      return res.status(200).json({ success: true });
    }

    if (action === 'archive') {
      const site = await loadAllowed(body.id);
      await sql`UPDATE pitch_sites SET archived_at = now(), updated_at = now() WHERE id = ${site.id}`;
      await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'pitch_site_archived', target: String(site.id) }).catch(() => {});
      return res.status(200).json({ success: true });
    }

    if (action === 'settings-save') {
      if (!hasMinRole(identity, 'admin')) return res.status(403).json({ success: false, error: 'Admins only' });
      const saved = await savePitchConfig(sql, body.config || {});
      await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'pitch_sites_settings', target: 'pitch_sites' }).catch(() => {});
      return res.status(200).json({ success: true, config: saved });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.message || 'Something went wrong' });
  }
}
