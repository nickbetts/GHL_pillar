import { tokenContext, sanitizeBlocks, variableDefaults } from './proposalBlocks.js';

// A proposal's contract uses its template's own terms when it has them, else the shared terms.
export async function loadTermsBlocks(sql, templateId) {
  if (templateId) {
    const rows = await sql`SELECT contract_terms FROM proposal_templates WHERE id = ${templateId}`;
    if (Array.isArray(rows[0]?.contract_terms) && rows[0].contract_terms.length) return rows[0].contract_terms;
  }
  const shared = await sql`SELECT blocks FROM proposal_contract_terms WHERE id = 1`;
  return Array.isArray(shared[0]?.blocks) ? shared[0].blocks : [];
}

export async function buildContractBlocks(sql, proposal, selectionSummary) {
  const tplRows = proposal.template_id ? await sql`SELECT variables FROM proposal_templates WHERE id = ${proposal.template_id}` : [];
  const variables = { ...variableDefaults(tplRows[0]?.variables), ...(proposal.variables || {}) };
  const ctx = {
    ...tokenContext({ ...proposal, variables }),
    proposal_title: proposal.title,
    proposal_ref: `PROP-${proposal.id}`,
    selection_summary: selectionSummary || 'the selected option in the proposal',
  };
  const terms = await loadTermsBlocks(sql, proposal.template_id);
  return [
    { type: 'contractIntro', data: { title: proposal.title, client: proposal.client_company || proposal.client_name, ref: `PROP-${proposal.id}`, date: ctx.date } },
    ...sanitizeBlocks(terms, ctx),
  ];
}
