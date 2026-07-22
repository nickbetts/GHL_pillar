#!/usr/bin/env node
import { setupContactFields, setupOpportunityFields } from './setup/i3-fields.js';
import { primeTags } from './setup/i3-tags.js';
import { checkPipelines } from './setup/i3-pipelines.js';
import { setupWebhooks } from './setup/i3-webhooks.js';
import { setupLeadScoring } from './setup/i3-lead-scoring.js';
import { setupSmartTagging } from './setup/i3-smart-tagging.js';
import { setupAutoAssignment } from './setup/i3-auto-assignment.js';

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

const ok   = (msg) => console.log(`  ${GREEN}✅${RESET} ${msg}`);
const skip = (msg) => console.log(`  ${YELLOW}⏭️ ${RESET} ${msg}`);
const fail = (msg) => console.log(`  ${RED}❌${RESET} ${msg}`);
const info = (msg) => console.log(`  ${CYAN}ℹ️ ${RESET} ${msg}`);
const sep  = ()    => console.log(`\n${BOLD}${'─'.repeat(60)}${RESET}`);

async function run() {
  console.log(`\n${BOLD}${CYAN}i3MEDIA CRM Setup — GoHighLevel API v3${RESET}`);
  console.log(`Running at ${new Date().toISOString()}\n`);

  const summary = { created: 0, skipped: 0, failed: 0 };

  // ── 1. Contact custom fields ──────────────────────────────────────────────
  sep();
  console.log(`\n${BOLD}1. Contact Custom Fields${RESET}\n`);

  const contactResult = await setupContactFields();
  for (const name of contactResult.created) { ok(`Created: ${name}`); summary.created++; }
  for (const name of contactResult.skipped)  { skip(`Already exists: ${name}`); summary.skipped++; }
  for (const { name, error } of contactResult.failed) { fail(`${name}: ${error}`); summary.failed++; }

  // ── 2. Opportunity custom fields ──────────────────────────────────────────
  sep();
  console.log(`\n${BOLD}2. Opportunity Custom Fields${RESET}\n`);

  const oppResult = await setupOpportunityFields();
  for (const name of oppResult.created) { ok(`Created: ${name}`); summary.created++; }
  for (const name of oppResult.skipped)  { skip(`Already exists: ${name}`); summary.skipped++; }
  for (const { name, error } of oppResult.failed) { fail(`${name}: ${error}`); summary.failed++; }

  // ── 3. Tag taxonomy ───────────────────────────────────────────────────────
  sep();
  console.log(`\n${BOLD}3. Tag Taxonomy${RESET}\n`);

  const tagResult = await primeTags();
  if (tagResult.ok) {
    if (tagResult.warned) {
      skip(`${YELLOW}${tagResult.warning}${RESET}`);
    } else {
      ok(`Primed ${tagResult.count} tags into GHL tag library`);
      summary.created++;
    }
  } else {
    fail(`Tag priming failed: ${tagResult.error}`);
    summary.failed++;
  }

  // ── 4. Pipeline check ─────────────────────────────────────────────────────
  sep();
  console.log(`\n${BOLD}4. Sales Pipeline${RESET}\n`);

  const pipeResult = await checkPipelines();
  if (!pipeResult.ok) {
    fail(`Pipeline check failed: ${pipeResult.error}`);
    summary.failed++;
  } else if (pipeResult.exists) {
    ok(`"${pipeResult.name}" pipeline found (id: ${pipeResult.id})`);
    if (pipeResult.stages?.length) {
      info(`Stages: ${pipeResult.stages.join(' → ')}`);
    }
  } else {
    skip(`"i3 Sales Pipeline" not found. Manual creation required:`);
    console.log(`\n   GHL → Sub-Account → Opportunities → Pipelines → + New Pipeline`);
    console.log(`   Name: "i3 Sales Pipeline"\n`);
    console.log(`   Add these stages in order:`);
    console.log(`     1. Discovery`);
    console.log(`     2. Qualified`);
    console.log(`     3. Scoping`);
    console.log(`     4. Proposal`);
    console.log(`     5. Negotiation`);
    console.log(`     6. Won (mark as Won stage)`);
    console.log(`     7. Post-Launch`);
    console.log(`     8. Churn Risk (mark as Lost stage)\n`);
    summary.failed++;
  }

  // ── 5. Automation Features (Beta) ──────────────────────────────────────────
  sep();
  console.log(`\n${BOLD}5. Automation Features (Beta)${RESET}\n`);
  console.log(`Real-time webhooks, lead scoring, auto-assignment, and more\n`);

  const webhookResult = await setupWebhooks();
  if (webhookResult.ok) {
    ok(`Webhooks configuration ready`);
    info(`Events available:`);
    webhookResult.events.forEach((evt) => console.log(`   • ${evt}`));
    console.log(webhookResult.instructions);
    summary.created++;
  }

  const scoringResult = await setupLeadScoring();
  if (scoringResult.ok) {
    ok(`Lead Scoring rules ready for implementation:`);
    info(`Rules available: ${scoringResult.rulesCount}`);
    scoringResult.rules.forEach((r) => console.log(`   • ${r.condition} → +${r.points} points`));
    console.log(scoringResult.implementation);
    summary.created++;
  }

  const taggingResult = await setupSmartTagging();
  if (taggingResult.ok) {
    ok(`Smart auto-tagging rules configured (${taggingResult.rulesCount} rules)`);
    taggingResult.rules.forEach((r) => {
      console.log(`   ${r.name}`);
      console.log(`      When: ${r.condition}`);
      console.log(`      Then: ${r.tags.join(', ')}`);
    });
    console.log(taggingResult.implementation);
    summary.created++;
  }

  const assignmentResult = await setupAutoAssignment();
  if (assignmentResult.ok) {
    ok(`Opportunity auto-assignment strategies ready:`);
    assignmentResult.strategies.forEach((s) => {
      console.log(`   ${s.name}: ${s.description}`);
      if (s.examples) {
        s.examples.forEach((ex) => console.log(`     → ${ex}`));
      }
    });
    console.log(assignmentResult.implementation);
    summary.created++;
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  sep();
  console.log(`\n${BOLD}Setup Complete${RESET}\n`);
  console.log(`  ${GREEN}✅${RESET} Created:  ${summary.created}`);
  console.log(`  ${YELLOW}⏭️ ${RESET} Skipped:  ${summary.skipped}`);
  console.log(`  ${RED}❌${RESET} Failed:   ${summary.failed}`);

  console.log(`\n${BOLD}All done. Verify in GHL:${RESET}`);
  console.log(`  → Settings → Custom Fields (contact + opportunity tabs)`);
  console.log(`  → Contacts → Tags search (confirm taxonomy is searchable)`);
  console.log(`  → Opportunities → Pipelines (follow instructions above if needed)`);

  console.log(`\n${BOLD}New Automation Features Available (in Beta):${RESET}`);
  console.log(`  • Webhook listener for real-time event handling`);
  console.log(`  • Lead scoring engine (auto-calculates ICP scores)`);
  console.log(`  • Smart auto-tagging (rules based on contact attributes)`);
  console.log(`  • Opportunity auto-assignment (load-balanced or service-based)`);

  console.log(`\n`);
}

run().catch((error) => {
  console.error(`${RED}Fatal error:${RESET}`, error);
  process.exit(1);
});
