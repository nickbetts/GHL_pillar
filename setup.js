#!/usr/bin/env node
import { setupContactFields, setupOpportunityFields } from './setup/fields.js';
import { primeTags } from './setup/tags.js';
import { setupCalendar } from './setup/calendar.js';
import { checkPipelines } from './setup/pipelines.js';
import { setupWebhooks } from './setup/webhooks.js';
import { setupLeadScoring } from './setup/leadScoring.js';
import { setupOpportunityAutoCreator } from './setup/opportunities.js';
import { setupSmartTagging } from './setup/automation.js';
import { setupInboundMessageHandler } from './setup/inboundMessages.js';
import { setupReporting } from './setup/reporting.js';
import { setupApolloEnrichment } from './setup/apollo.js';
import { setupDeduplication } from './setup/deduplication.js';
import { setupAutoAssignment } from './setup/assignment.js';

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
  console.log(`\n${BOLD}${CYAN}Pillar CRM Setup — GoHighLevel API v2${RESET}`);
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

  // ── 4. Demo Booking calendar ──────────────────────────────────────────────
  sep();
  console.log(`\n${BOLD}4. Demo Booking Calendar${RESET}\n`);

  const calResult = await setupCalendar();
  if (calResult.ok) {
    if (calResult.skipped) {
      skip(`"Demo Booking" calendar already exists (id: ${calResult.id})`);
      summary.skipped++;
    } else {
      ok(`Created "Demo Booking" calendar (id: ${calResult.id})`);
      summary.created++;
    }
  } else {
    fail(`Calendar setup failed: ${calResult.error}`);
    summary.failed++;
  }

  // ── 5. Pipeline check ─────────────────────────────────────────────────────
  sep();
  console.log(`\n${BOLD}5. Sales Pipeline${RESET}\n`);

  const pipeResult = await checkPipelines();
  if (!pipeResult.ok) {
    fail(`Pipeline check failed: ${pipeResult.error}`);
    summary.failed++;
  } else if (pipeResult.exists) {
    ok(`"${pipeResult.name}" pipeline found (id: ${pipeResult.id})`);
    if (pipeResult.stages?.length) {
      info(`Stages: ${pipeResult.stages.join(' → ')}`);
    }
    summary.skipped++;
  } else {
    if (pipeResult.allPipelines?.length) {
      info(`Existing pipelines: ${pipeResult.allPipelines.map((p) => `"${p.name}"`).join(', ')}`);
    } else {
      info('No pipelines found in this sub-account.');
    }
    console.log(`${YELLOW}${pipeResult.instructions}${RESET}`);
  }

  // ── 6. Automation Features ─────────────────────────────────────────────────
  sep();
  console.log(`\n${BOLD}6. Automation Features (Beta)${RESET}\n`);
  console.log(`${CYAN}Real-time webhooks, lead scoring, auto-assignment, and more${RESET}\n`);

  const webhookResult = await setupWebhooks();
  webhookResult.created > 0 && ok(`Webhooks configuration ready`);
  webhookResult.skipped > 0 && skip(`Webhooks already configured`);
  webhookResult.failed > 0 && fail(`Webhook setup failed`);
  summary.created += webhookResult.created;
  summary.skipped += webhookResult.skipped;
  summary.failed += webhookResult.failed;

  const scoringResult = await setupLeadScoring();
  scoringResult.created > 0 && ok(`Lead scoring engine ready`);
  scoringResult.failed > 0 && fail(`Lead scoring setup failed`);
  summary.created += scoringResult.created;
  summary.failed += scoringResult.failed;

  const oppResult2 = await setupOpportunityAutoCreator();
  oppResult2.created > 0 && ok(`Opportunity auto-creator ready`);
  oppResult2.failed > 0 && fail(`Opportunity auto-creator setup failed`);
  summary.created += oppResult2.created;
  summary.failed += oppResult2.failed;

  const taggingResult = await setupSmartTagging();
  taggingResult.created > 0 && ok(`Smart auto-tagging rules configured (${taggingResult.created} rules)`);
  taggingResult.failed > 0 && fail(`Smart tagging setup failed`);
  summary.created += taggingResult.created;
  summary.failed += taggingResult.failed;

  const msgResult = await setupInboundMessageHandler();
  msgResult.created > 0 && ok(`Inbound message handler ready`);
  msgResult.failed > 0 && fail(`Inbound message handler setup failed`);
  summary.created += msgResult.created;
  summary.failed += msgResult.failed;

  const reportResult = await setupReporting();
  reportResult.created > 0 && ok(`Reporting engine ready (daily/weekly/monthly)`);
  reportResult.failed > 0 && fail(`Reporting setup failed`);
  summary.created += reportResult.created;
  summary.failed += reportResult.failed;

  const apolloResult = await setupApolloEnrichment();
  apolloResult.created > 0 && ok(`Apollo B2B enrichment integration ready`);
  apolloResult.failed > 0 && fail(`Apollo setup failed`);
  summary.created += apolloResult.created;
  summary.failed += apolloResult.failed;

  const dedupeResult = await setupDeduplication();
  dedupeResult.created > 0 && ok(`Contact deduplication engine ready`);
  dedupeResult.failed > 0 && fail(`Deduplication setup failed`);
  summary.created += dedupeResult.created;
  summary.failed += dedupeResult.failed;

  const assignResult = await setupAutoAssignment();
  assignResult.created > 0 && ok(`Opportunity auto-assignment ready`);
  assignResult.failed > 0 && fail(`Auto-assignment setup failed`);
  summary.created += assignResult.created;
  summary.failed += assignResult.failed;

  // ── Summary ───────────────────────────────────────────────────────────────
  sep();
  console.log(`\n${BOLD}Setup Complete${RESET}\n`);
  console.log(`  ${GREEN}✅ Created:${RESET}  ${summary.created}`);
  console.log(`  ${YELLOW}⏭️  Skipped:${RESET}  ${summary.skipped}`);
  console.log(`  ${RED}❌ Failed:${RESET}   ${summary.failed}`);

  if (summary.failed > 0) {
    console.log(`\n${RED}${BOLD}Some steps failed — check errors above.${RESET}`);
    process.exit(1);
  }

  console.log(`\n${GREEN}${BOLD}All done. Verify in GHL:${RESET}`);
  console.log('  → Settings → Custom Fields (contact + opportunity tabs)');
  console.log('  → Contacts → Tags search (confirm taxonomy is searchable)');
  console.log('  → Calendars → Demo Booking');
  console.log('  → Opportunities → Pipelines (follow instructions above if needed)\n');

  console.log(`${CYAN}${BOLD}New Automation Features Available (in Beta):${RESET}`);
  console.log('  • Webhook listener for real-time event handling');
  console.log('  • Lead scoring engine (auto-calculates ICP scores)');
  console.log('  • Opportunity auto-creator (creates opps when contacts hit high-intent)');
  console.log('  • Smart auto-tagging (8 rules based on contact attributes)');
  console.log('  • Inbound message handler (tracks replies, pulls from nurture)');
  console.log('  • Daily/weekly/monthly reporting (automated metrics export)');
  console.log('  • Apollo B2B enrichment (auto-lookup company/person data)');
  console.log('  • Contact deduplication (detect and merge duplicates)');
  console.log('  • Opportunity auto-assignment (round-robin or role-based)\n');

  console.log(`${CYAN}See PLAN.md for full documentation of all capabilities.${RESET}\n`);
}

run().catch((err) => {
  console.error(`\n${RED}${BOLD}Fatal error:${RESET} ${err.message}`);
  process.exit(1);
});
