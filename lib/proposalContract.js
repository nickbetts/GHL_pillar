import { tokenContext, sanitizeBlocks, variableDefaults } from './proposalBlocks.js';
import { renderContractDoc } from './contractEngine.js';

// The version a template currently points at: its pinned version, else the latest published one.
export async function resolveTemplateVersion(sql, contractId, pin) {
  if (!contractId) return null;
  const rows = pin
    ? await sql`SELECT * FROM contract_versions WHERE contract_id = ${contractId} AND version = ${pin}`
    : await sql`SELECT * FROM contract_versions WHERE contract_id = ${contractId} ORDER BY version DESC LIMIT 1`;
  return rows[0] || null;
}

// Terms for templates that have no linked contract yet.
export async function loadLegacyTerms(sql, templateId) {
  if (templateId) {
    const rows = await sql`SELECT contract_terms FROM proposal_templates WHERE id = ${templateId}`;
    if (Array.isArray(rows[0]?.contract_terms) && rows[0].contract_terms.length) return rows[0].contract_terms;
  }
  const shared = await sql`SELECT blocks FROM proposal_contract_terms WHERE id = 1`;
  return Array.isArray(shared[0]?.blocks) ? shared[0].blocks : [];
}

// The contract version a proposal is frozen to; proposals made before versioning follow their template.
export async function versionForProposal(sql, proposal, tpl) {
  if (proposal.contract_version_id) {
    const rows = await sql`SELECT * FROM contract_versions WHERE id = ${proposal.contract_version_id}`;
    if (rows[0]) return rows[0];
  }
  return resolveTemplateVersion(sql, tpl?.contract_id, tpl?.contract_pin);
}

export async function buildContractBlocks(sql, proposal, selectionSummary) {
  const tplRows = proposal.template_id
    ? await sql`SELECT variables, services, contract_id, contract_pin FROM proposal_templates WHERE id = ${proposal.template_id}`
    : [];
  const tpl = tplRows[0] || null;
  const variables = { ...variableDefaults(tpl?.variables), ...(proposal.variables || {}) };
  const ctx = {
    ...tokenContext({ ...proposal, variables }),
    proposal_title: proposal.title,
    proposal_ref: `PROP-${proposal.id}`,
    selection_summary: selectionSummary || 'the selected option in the proposal',
  };
  const intro = { type: 'contractIntro', data: { title: proposal.title, client: proposal.client_company || proposal.client_name, ref: `PROP-${proposal.id}`, date: ctx.date } };

  const version = await versionForProposal(sql, proposal, tpl);
  if (version) {
    const services = Array.isArray(proposal.selected_services) ? proposal.selected_services : (Array.isArray(tpl?.services) ? tpl.services : []);
    const { blocks } = renderContractDoc(version.doc, { services, variables, selection: selectionSummary, tokens: ctx });
    return [intro, ...blocks];
  }
  return [intro, ...sanitizeBlocks(await loadLegacyTerms(sql, proposal.template_id), ctx)];
}
