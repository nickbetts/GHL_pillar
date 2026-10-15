/**
 * Contract platform API: library of contracts (draft plus immutable published versions),
 * linking to templates, reusable clauses, proposal sections and the services catalogue.
 * Everyone signed in can read; managers and admins edit legal text.
 */

import { getSql, ensureProposalTables } from './db.js';
import { resolveIdentity, hasMinRole } from './session.js';
import { sanitizeBlocks, tokenContext, variableDefaults } from '../lib/proposalBlocks.js';
import {
  renderContractDoc, sanitizeDoc, validateDoc, previewMatrix, diffDocs, countClauses, newId,
} from '../lib/contractEngine.js';

const clean = (v, n) => String(v ?? '').trim().slice(0, n);
const blankDoc = () => ({ sections: [{ id: newId(), title: 'Agreement', numbered: true, nodes: [{ id: newId(), kind: 'clause', text: '', children: [] }] }] });

function cleanVariableDefs(input) {
  return (Array.isArray(input) ? input : []).slice(0, 20)
    .filter((d) => d && /^[a-z_]{1,40}$/.test(String(d.key || '')))
    .map((d) => ({ key: d.key, label: clean(d.label, 80) || d.key, default: clean(d.default, 100) }));
}

const SAMPLE = {
  client_name: 'Alex Morgan',
  client_company: 'Northwind Engineering Ltd',
  client_email: 'alex.morgan@northwind-example.co.uk',
  owner_name: 'Your i3MEDIA contact',
  deal_type: 'Retainer',
  mrr_value: 250,
  one_off_value: 6000,
  expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
};

async function serviceKeys(sql) {
  return (await sql`SELECT key FROM contract_services ORDER BY sort, id`).map((r) => r.key);
}

async function usage(sql) {
  const templates = await sql`SELECT id, name, contract_id, contract_pin, services FROM proposal_templates`;
  const props = await sql`
    SELECT v.contract_id, v.version, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE p.contract_signed_at IS NOT NULL)::int AS signed
    FROM proposals p JOIN contract_versions v ON v.id = p.contract_version_id
    GROUP BY v.contract_id, v.version
  `;
  return { templates, props };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  let sql;
  try { sql = getSql(); await ensureProposalTables(sql); } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
  const identity = resolveIdentity(req);
  if (!identity) return res.status(401).json({ success: false, error: 'Sign in to Stream first' });
  const canEdit = hasMinRole(identity, 'manager');
  const body = req.body || {};
  const action = String(body.action || '');
  const deny = () => res.status(403).json({ success: false, error: 'Only managers and admins can change contracts' });
  const writes = ['create', 'save-draft', 'publish', 'restore', 'archive', 'unarchive', 'delete', 'link-template', 'clause-save', 'clause-delete', 'section-save', 'section-delete', 'service-save', 'service-delete'];
  if (writes.includes(action) && !canEdit) return deny();

  try {
    // ── Library ───────────────────────────────────────────────────────────
    if (action === 'list') {
      const rows = await sql`
        SELECT c.id, c.name, c.description, c.status, c.draft, c.draft_updated_at, c.draft_updated_by,
               (SELECT MAX(version) FROM contract_versions v WHERE v.contract_id = c.id) AS latest_version,
               (SELECT d.doc IS DISTINCT FROM c.draft FROM contract_versions d WHERE d.contract_id = c.id ORDER BY d.version DESC LIMIT 1) AS unpublished
        FROM contracts c ORDER BY c.status, c.name
      `;
      const { templates, props } = await usage(sql);
      const services = await sql`SELECT key, name, description FROM contract_services ORDER BY sort, id`;
      return res.status(200).json({
        success: true,
        canEdit,
        services,
        templates: templates.map((t) => ({ id: Number(t.id), name: t.name, contractId: t.contract_id == null ? null : Number(t.contract_id), pin: t.contract_pin })),
        contracts: rows.map((c) => ({
          id: Number(c.id),
          name: c.name,
          description: c.description || '',
          status: c.status,
          latestVersion: c.latest_version == null ? null : Number(c.latest_version),
          unpublished: c.latest_version == null ? true : !!c.unpublished,
          clauseCount: countClauses(c.draft),
          updatedAt: c.draft_updated_at,
          updatedBy: c.draft_updated_by,
          templates: templates.filter((t) => Number(t.contract_id) === Number(c.id)).map((t) => ({ id: Number(t.id), name: t.name, pin: t.contract_pin, services: Array.isArray(t.services) ? t.services : [] })),
          proposals: props.filter((p) => Number(p.contract_id) === Number(c.id)).reduce((a, p) => ({ total: a.total + p.total, signed: a.signed + p.signed }), { total: 0, signed: 0 }),
        })),
      });
    }

    if (action === 'get') {
      const id = Number(body.id);
      const rows = await sql`SELECT * FROM contracts WHERE id = ${id}`;
      if (!rows.length) return res.status(404).json({ success: false, error: 'Contract not found' });
      const c = rows[0];
      const versions = await sql`SELECT version, change_note, reviewed_by, reviewed_at, published_by, published_at FROM contract_versions WHERE contract_id = ${id} ORDER BY version DESC`;
      const { templates, props } = await usage(sql);
      const keys = await serviceKeys(sql);
      const services = await sql`SELECT key, name, description FROM contract_services ORDER BY sort, id`;
      const clauses = await sql`SELECT id, title, category, version FROM contract_clauses ORDER BY category, title`;
      return res.status(200).json({
        success: true,
        canEdit,
        contract: { id: Number(c.id), name: c.name, description: c.description || '', status: c.status, doc: c.draft, variables: c.variables || [], updatedAt: c.draft_updated_at, updatedBy: c.draft_updated_by },
        versions: versions.map((v) => ({ version: Number(v.version), changeNote: v.change_note, reviewedBy: v.reviewed_by, reviewedAt: v.reviewed_at, publishedBy: v.published_by, publishedAt: v.published_at })),
        templates: templates.filter((t) => Number(t.contract_id) === id).map((t) => ({ id: Number(t.id), name: t.name, pin: t.contract_pin, services: Array.isArray(t.services) ? t.services : [] })),
        proposals: props.filter((p) => Number(p.contract_id) === id).map((p) => ({ version: Number(p.version), total: p.total, signed: p.signed })),
        services,
        clauses: clauses.map((x) => ({ id: Number(x.id), title: x.title, category: x.category, version: Number(x.version) })),
        issues: validateDoc(c.draft, { serviceKeys: keys, variableKeys: (c.variables || []).map((v) => v.key) }),
      });
    }

    if (action === 'create') {
      const name = clean(body.name, 160);
      if (!name) return res.status(400).json({ success: false, error: 'Give the contract a name' });
      let doc = blankDoc();
      let variables = [];
      if (body.duplicateOf) {
        const src = await sql`SELECT draft, variables FROM contracts WHERE id = ${Number(body.duplicateOf)}`;
        if (src.length) { doc = src[0].draft; variables = src[0].variables || []; }
      }
      const rows = await sql`
        INSERT INTO contracts (name, description, draft, variables, created_by, draft_updated_by)
        VALUES (${name}, ${clean(body.description, 500)}, ${JSON.stringify(doc)}::jsonb, ${JSON.stringify(variables)}::jsonb, ${identity.email}, ${identity.email})
        RETURNING id
      `;
      return res.status(200).json({ success: true, id: Number(rows[0].id) });
    }

    if (action === 'save-draft') {
      const id = Number(body.id);
      const doc = sanitizeDoc(body.doc);
      const variables = cleanVariableDefs(body.variables);
      const name = clean(body.name, 160);
      const rows = await sql`
        UPDATE contracts SET draft = ${JSON.stringify(doc)}::jsonb, variables = ${JSON.stringify(variables)}::jsonb,
               name = COALESCE(NULLIF(${name}, ''), name), description = COALESCE(${body.description === undefined ? null : clean(body.description, 500)}, description),
               draft_updated_by = ${identity.email}, draft_updated_at = now()
        WHERE id = ${id} RETURNING id
      `;
      if (!rows.length) return res.status(404).json({ success: false, error: 'Contract not found' });
      const issues = validateDoc(doc, { serviceKeys: await serviceKeys(sql), variableKeys: variables.map((v) => v.key) });
      return res.status(200).json({ success: true, issues });
    }

    if (action === 'publish') {
      const id = Number(body.id);
      const rows = await sql`SELECT draft, variables FROM contracts WHERE id = ${id}`;
      if (!rows.length) return res.status(404).json({ success: false, error: 'Contract not found' });
      const issues = validateDoc(rows[0].draft, { serviceKeys: await serviceKeys(sql), variableKeys: (rows[0].variables || []).map((v) => v.key) });
      const errors = issues.filter((i) => i.level === 'error');
      if (errors.length) return res.status(400).json({ success: false, error: `Fix ${errors.length} error${errors.length === 1 ? '' : 's'} before publishing`, issues });
      if (!clean(body.changeNote, 400)) return res.status(400).json({ success: false, error: 'Add a short change note' });
      const next = Number((await sql`SELECT COALESCE(MAX(version), 0) + 1 AS n FROM contract_versions WHERE contract_id = ${id}`)[0].n);
      const reviewedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body.reviewedAt || '')) ? body.reviewedAt : null;
      await sql`
        INSERT INTO contract_versions (contract_id, version, doc, variables, change_note, reviewed_by, reviewed_at, published_by)
        VALUES (${id}, ${next}, ${JSON.stringify(rows[0].draft)}::jsonb, ${JSON.stringify(rows[0].variables || [])}::jsonb, ${clean(body.changeNote, 400)}, ${clean(body.reviewedBy, 160) || null}, ${reviewedAt}, ${identity.email})
      `;
      return res.status(200).json({ success: true, version: next, issues });
    }

    if (action === 'get-version') {
      const rows = await sql`SELECT * FROM contract_versions WHERE contract_id = ${Number(body.id)} AND version = ${Number(body.version)}`;
      if (!rows.length) return res.status(404).json({ success: false, error: 'Version not found' });
      return res.status(200).json({ success: true, doc: rows[0].doc, variables: rows[0].variables || [] });
    }

    if (action === 'restore') {
      const rows = await sql`SELECT doc, variables FROM contract_versions WHERE contract_id = ${Number(body.id)} AND version = ${Number(body.version)}`;
      if (!rows.length) return res.status(404).json({ success: false, error: 'Version not found' });
      await sql`UPDATE contracts SET draft = ${JSON.stringify(rows[0].doc)}::jsonb, variables = ${JSON.stringify(rows[0].variables || [])}::jsonb, draft_updated_by = ${identity.email}, draft_updated_at = now() WHERE id = ${Number(body.id)}`;
      return res.status(200).json({ success: true });
    }

    if (action === 'diff') {
      const load = async (which) => {
        if (which === 'draft') return (await sql`SELECT draft AS doc FROM contracts WHERE id = ${Number(body.id)}`)[0]?.doc;
        return (await sql`SELECT doc FROM contract_versions WHERE contract_id = ${Number(body.id)} AND version = ${Number(which)}`)[0]?.doc;
      };
      const [a, b] = await Promise.all([load(body.a), load(body.b)]);
      if (!a || !b) return res.status(404).json({ success: false, error: 'Version not found' });
      return res.status(200).json({ success: true, ...diffDocs(a, b) });
    }

    if (action === 'archive' || action === 'unarchive') {
      const id = Number(body.id);
      if (action === 'archive') {
        const linked = await sql`SELECT name FROM proposal_templates WHERE contract_id = ${id}`;
        if (linked.length) return res.status(400).json({ success: false, error: `Unlink it from ${linked.map((t) => t.name).join(', ')} first` });
      }
      await sql`UPDATE contracts SET status = ${action === 'archive' ? 'archived' : 'active'} WHERE id = ${id}`;
      return res.status(200).json({ success: true });
    }

    if (action === 'delete') {
      const id = Number(body.id);
      const linked = await sql`SELECT name FROM proposal_templates WHERE contract_id = ${id}`;
      if (linked.length) return res.status(400).json({ success: false, error: `Unlink it from ${linked.map((t) => t.name).join(', ')} first` });
      const used = await sql`SELECT COUNT(*)::int AS n FROM proposals p JOIN contract_versions v ON v.id = p.contract_version_id WHERE v.contract_id = ${id}`;
      if (used[0].n) return res.status(400).json({ success: false, error: 'Proposals use this contract, so it can only be archived' });
      await sql`DELETE FROM contract_versions WHERE contract_id = ${id}`;
      await sql`DELETE FROM contracts WHERE id = ${id}`;
      return res.status(200).json({ success: true });
    }

    // ── Linking templates ─────────────────────────────────────────────────
    if (action === 'link-template') {
      const templateId = Number(body.templateId);
      const keys = await serviceKeys(sql);
      const services = (Array.isArray(body.services) ? body.services : []).filter((k) => keys.includes(k));
      if (body.contractId) {
        const rows = await sql`SELECT c.status, (SELECT MAX(version) FROM contract_versions v WHERE v.contract_id = c.id) AS latest FROM contracts c WHERE c.id = ${Number(body.contractId)}`;
        if (!rows.length) return res.status(404).json({ success: false, error: 'Contract not found' });
        if (rows[0].status !== 'active') return res.status(400).json({ success: false, error: 'That contract is archived' });
        if (!rows[0].latest) return res.status(400).json({ success: false, error: 'Publish the contract before linking it to a template' });
        const pin = body.pin ? Number(body.pin) : null;
        if (pin && !(await sql`SELECT 1 FROM contract_versions WHERE contract_id = ${Number(body.contractId)} AND version = ${pin}`).length) {
          return res.status(400).json({ success: false, error: 'That version does not exist' });
        }
        await sql`UPDATE proposal_templates SET contract_id = ${Number(body.contractId)}, contract_pin = ${pin}, services = ${JSON.stringify(services)}::jsonb, updated_at = now() WHERE id = ${templateId}`;
      } else {
        await sql`UPDATE proposal_templates SET contract_id = NULL, contract_pin = NULL, services = ${JSON.stringify(services)}::jsonb, updated_at = now() WHERE id = ${templateId}`;
      }
      return res.status(200).json({ success: true });
    }

    // ── Live preview and health ───────────────────────────────────────────
    if (action === 'preview') {
      let doc = body.doc ? sanitizeDoc(body.doc) : null;
      let defs = cleanVariableDefs(body.variableDefs);
      if (!doc && body.id) {
        const rows = body.version
          ? await sql`SELECT doc, variables FROM contract_versions WHERE contract_id = ${Number(body.id)} AND version = ${Number(body.version)}`
          : await sql`SELECT draft AS doc, variables FROM contracts WHERE id = ${Number(body.id)}`;
        if (rows.length) { doc = rows[0].doc; defs = rows[0].variables || []; }
      }
      if (!doc) return res.status(404).json({ success: false, error: 'Nothing to preview' });
      const keys = await serviceKeys(sql);
      const services = Array.isArray(body.services) ? body.services.filter((k) => keys.includes(k)) : keys;
      const variables = { ...variableDefaults(defs), ...(body.variables && typeof body.variables === 'object' ? body.variables : {}) };
      const sample = { ...SAMPLE, client_company: clean(body.clientCompany, 120) || SAMPLE.client_company, variables };
      const tokens = { ...tokenContext(sample), proposal_title: 'Sample proposal', proposal_ref: 'PROP-SAMPLE', selection_summary: 'the selected services' };
      const out = renderContractDoc(doc, { services, variables, selection: '', tokens });
      const result = {
        success: true,
        blocks: [{ type: 'contractIntro', data: { title: 'Sample proposal', client: sample.client_company, ref: 'PROP-SAMPLE', date: tokens.date } }, ...out.blocks],
        numbers: out.numbers,
        issues: validateDoc(doc, { serviceKeys: keys, variableKeys: defs.map((d) => d.key) }),
      };
      if (body.matrix) {
        const names = Object.fromEntries((await sql`SELECT key, name FROM contract_services`).map((r) => [r.key, r.name]));
        const offered = (Array.isArray(body.matrixServices) ? body.matrixServices : keys).filter((k) => keys.includes(k)).slice(0, 8);
        result.matrix = previewMatrix(doc, { serviceKeys: offered, variables }).map((r) => ({ ...r, services: r.services.map((k) => names[k] || k) }));
      }
      return res.status(200).json(result);
    }

    // ── Clause library ────────────────────────────────────────────────────
    if (action === 'clauses-list') {
      const rows = await sql`SELECT id, title, category, section, version, updated_at FROM contract_clauses ORDER BY category, title`;
      const contracts = await sql`SELECT id, name, draft FROM contracts WHERE status = 'active'`;
      return res.status(200).json({
        success: true,
        canEdit,
        clauses: rows.map((r) => ({
          id: Number(r.id), title: r.title, category: r.category || '', section: r.section, version: Number(r.version), updatedAt: r.updated_at,
          usedBy: contracts.filter((c) => JSON.stringify(c.draft).includes(`"clauseId":${Number(r.id)}`)).map((c) => ({ id: Number(c.id), name: c.name })),
        })),
      });
    }

    if (action === 'clause-save') {
      const section = sanitizeDoc({ sections: [body.section] }).sections[0];
      if (!section) return res.status(400).json({ success: false, error: 'Nothing to save' });
      delete section.source;
      const title = clean(body.title, 160) || section.title || 'Untitled clause';
      if (body.id) {
        const rows = await sql`UPDATE contract_clauses SET title = ${title}, category = ${clean(body.category, 60)}, section = ${JSON.stringify(section)}::jsonb, version = version + 1, updated_by = ${identity.email}, updated_at = now() WHERE id = ${Number(body.id)} RETURNING id, version`;
        if (!rows.length) return res.status(404).json({ success: false, error: 'Clause not found' });
        return res.status(200).json({ success: true, id: Number(rows[0].id), version: Number(rows[0].version) });
      }
      const rows = await sql`INSERT INTO contract_clauses (title, category, section, updated_by) VALUES (${title}, ${clean(body.category, 60)}, ${JSON.stringify(section)}::jsonb, ${identity.email}) RETURNING id, version`;
      return res.status(200).json({ success: true, id: Number(rows[0].id), version: Number(rows[0].version) });
    }

    if (action === 'clause-delete') {
      await sql`DELETE FROM contract_clauses WHERE id = ${Number(body.id)}`;
      return res.status(200).json({ success: true });
    }

    // ── Proposal section library ──────────────────────────────────────────
    if (action === 'sections-list') {
      const rows = await sql`SELECT id, title, category, blocks, updated_at FROM proposal_sections ORDER BY category, title`;
      return res.status(200).json({ success: true, canEdit, sections: rows.map((r) => ({ id: Number(r.id), title: r.title, category: r.category || '', blocks: r.blocks, updatedAt: r.updated_at })) });
    }

    if (action === 'section-save') {
      const blocks = sanitizeBlocks(body.blocks);
      const title = clean(body.title, 160);
      if (!title || !blocks.length) return res.status(400).json({ success: false, error: 'A title and at least one block are needed' });
      if (body.id) {
        await sql`UPDATE proposal_sections SET title = ${title}, category = ${clean(body.category, 60)}, blocks = ${JSON.stringify(blocks)}::jsonb, updated_by = ${identity.email}, updated_at = now() WHERE id = ${Number(body.id)}`;
        return res.status(200).json({ success: true, id: Number(body.id) });
      }
      const rows = await sql`INSERT INTO proposal_sections (title, category, blocks, updated_by) VALUES (${title}, ${clean(body.category, 60)}, ${JSON.stringify(blocks)}::jsonb, ${identity.email}) RETURNING id`;
      return res.status(200).json({ success: true, id: Number(rows[0].id) });
    }

    if (action === 'section-delete') {
      await sql`DELETE FROM proposal_sections WHERE id = ${Number(body.id)}`;
      return res.status(200).json({ success: true });
    }

    // ── Services catalogue ────────────────────────────────────────────────
    if (action === 'services-list') {
      const rows = await sql`SELECT key, name, description FROM contract_services ORDER BY sort, id`;
      return res.status(200).json({ success: true, canEdit, services: rows });
    }

    if (action === 'service-save') {
      const key = clean(body.key, 40).toLowerCase();
      if (!/^[a-z_]{2,40}$/.test(key)) return res.status(400).json({ success: false, error: 'Key must be lowercase letters and underscores' });
      const name = clean(body.name, 80);
      if (!name) return res.status(400).json({ success: false, error: 'Give the service a name' });
      await sql`
        INSERT INTO contract_services (key, name, description, sort) VALUES (${key}, ${name}, ${clean(body.description, 200)}, (SELECT COALESCE(MAX(sort), 0) + 1 FROM contract_services))
        ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
      `;
      return res.status(200).json({ success: true });
    }

    if (action === 'service-delete') {
      const key = clean(body.key, 40);
      const usedByTemplate = (await sql`SELECT name FROM proposal_templates WHERE services::text LIKE ${`%"${key}"%`}`).map((t) => t.name);
      const usedByContract = (await sql`SELECT name FROM contracts WHERE draft::text LIKE ${`%${key}%`}`).map((c) => c.name);
      if (usedByTemplate.length || usedByContract.length) {
        return res.status(400).json({ success: false, error: `In use by ${[...usedByTemplate, ...usedByContract].join(', ')}` });
      }
      await sql`DELETE FROM contract_services WHERE key = ${key}`;
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
