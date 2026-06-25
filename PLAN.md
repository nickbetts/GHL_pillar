# Pillar CRM Setup — GoHighLevel API v3

**Date:** 2026-06-25  
**Status:** ✅ Phase 2 Complete — Core setup + 9 automation features ready to implement  
**Purpose:** Configure Pillar's GHL sub-account via API with sales infrastructure, lead scoring, and advanced automation.

---

## Executive Summary

This project sets up a fully-configured GHL CRM with:
- **25 custom contact fields** — charity identity, nurture tracking, attribution, segmentation
- **4 custom opportunity fields** — pipeline tracking, competitor intelligence
- **49 tags** — persona, org type, funnel stage, lead source, campaigns
- **Demo Booking calendar** — auto-scheduling for sales team
- **9 automation features** — webhooks, lead scoring, auto-assignment, deduplication, and more

**Status:** Core setup (✅ complete and live), Automation features (🎯 ready to implement)

---

## Quick Start

```bash
# 1. Set up credentials
cp .env.example .env
# Edit .env with: GHL_TOKEN, LOCATION_ID

# 2. Run core setup (fields, tags, calendar)
node setup.js

# 3. Manual UI steps required
# - Create 10-stage sales pipeline
# - Create 8 smart lists
# - Build 6-step inbound nurture workflow
# - Connect email sender domain
# - Connect SMS phone number
# - Add team members
```

---

## Files & Architecture

```
CRM/
├── .env                    ← credentials (gitignored)
├── .env.example           ← template with required keys
├── config.js              ← loads .env, exports TOKEN + LOCATION_ID
├── client.js              ← shared fetch wrapper (auth headers)
├── setup.js               ← main orchestrator
│
└── setup/
    ├── fields.js          ← 25 contact fields + 4 opp fields
    ├── tags.js            ← 49 tag taxonomy (seed contact approach)
    ├── calendar.js        ← Demo Booking calendar (30-min slots)
    ├── pipelines.js       ← check pipeline, print manual steps
    │
    └── Automation Features (Phase 2)
        ├── webhooks.js    ← real-time event listener config
        ├── leadScoring.js ← 12-rule ICP scoring engine
        ├── opportunities.js ← auto-create opps on triggers
        ├── automation.js  ← 8 smart tagging rules
        ├── inboundMessages.js ← reply tracking + status updates
        ├── reporting.js   ← daily/weekly/monthly metrics export
        ├── apollo.js      ← B2B company data enrichment
        ├── deduplication.js ← detect + merge duplicate contacts
        └── assignment.js  ← round-robin/load-balanced opp routing
```

---

## Phase 1: Core Setup (✅ Complete)

### Custom Contact Fields (25 total — all live on GHL)

**Core Charity Identity (14 fields — v1):**
| Field | Type | Options/Details |
|---|---|---|
| Charity Registration Number | TEXT | Unique charity ID |
| Annual Income Band | RADIO | <£50k / £50k–£250k / £250k–£1m / £1m+ |
| Charity Sector | SINGLE_OPTIONS | Muslim / Church / Animal / Community / Hospice / School / Membership / Other |
| Current Tech Stack | LARGE_TEXT | Free text |
| Primary Pain Points | MULTIPLE_OPTIONS | Spreadsheets / Tool sprawl / Compliance / Reporting / Fundraising / Website |
| Governance Role | SINGLE_OPTIONS | Founder / CEO / Operations Manager / Fundraising Director / Digital Lead / Volunteer |
| Decision Timeline | RADIO | Immediate / 1–3 months / 3–6 months / 6+ months |
| Budget Authority | RADIO | Yes / Partial / No |
| LinkedIn Profile URL | TEXT | URL field |
| Content Downloaded | LARGE_TEXT | Free text, track which content |
| Event Attended | TEXT | Which event |
| Form Abandonment Flag | RADIO | Yes / No |
| Existing Customer | RADIO | Yes / No |
| Expansion Potential | RADIO | Low / Medium / High |

**Nurture & Sequence Tracking (2 fields — v2):**
| Field | Type | Options |
|---|---|---|
| Nurture Track | SINGLE_OPTIONS | High-Intent / Research-Stage / Warm-Proof / Customer-Expansion / Lapse-Reactivation |
| Email Sequence Step | NUMERICAL | 0–6 (tracks position in inbound nurture) |

**Attribution / UTM (3 fields — v2):**
| Field | Type | Details |
|---|---|---|
| UTM Source | TEXT | Organic / Google / LinkedIn / etc |
| UTM Medium | TEXT | CPC / organic / direct / etc |
| UTM Campaign | TEXT | 1st-touch / retargeting / nurture / etc |

**Social Proof & Trust Sprint (3 fields — v2):**
| Field | Type | Options |
|---|---|---|
| Case Study Candidate | RADIO | Yes / No |
| Reference Customer | RADIO | Yes / No |
| Review Status | SINGLE_OPTIONS | Not Asked / Asked / Submitted—G2 / Submitted—Capterra / Published—G2 / Published—Capterra |

**Segmentation Signals (2 fields — v2):**
| Field | Type | Options |
|---|---|---|
| Islamic Calendar Relevance | RADIO | Yes / No |
| ICP Score | NUMERICAL | 0–100 (auto-calculated by lead scoring engine) |

**Demo & Form Data (1 field — v3):**
| Field | Type | Options |
|---|---|---|
| Demo Priority | MULTIPLE_OPTIONS | Donor Management / Donor Communications / New Website / Fundraising Tools / Migrate from CRM / Not Sure Yet |

---

### Custom Opportunity Fields (4 total — all live on GHL)

| Field | Type | Options |
|---|---|---|
| Lead Source Channel | SINGLE_OPTIONS | SEO Organic / Google Ads / LinkedIn Ads / LinkedIn Organic / LinkedIn Retargeting / Google Interception / Meta Retargeting / Events / PR / Referral |
| Persona | SINGLE_OPTIONS | Ops Manager / Fundraising Director / Digital Lead / Founder / Volunteer-led / Faith Org |
| Org Size Band | RADIO | <£50k / £50k–£250k / £250k–£1m / £1m+ |
| Competitor Displacing | SINGLE_OPTIONS | Spreadsheets / Salesforce NPSP / Donorfy / Beacon CRM / JustGiving / Enthuse / Other |

---

### Sales Pipeline (10 Stages)

**Status:** Pipeline created (id: `YzkC3wtuGzKZvKb1Q1tK`)

1. Lead ← entry point
2. Contacted ← outreach done
3. Research Stage ← qualifying
4. High Intent ← ready for demo
5. Demo Scheduled ← booked
6. Demo Complete ← happened
7. Proposal ← sent
8. Won ← **mark as Won stage** ✅
9. Expansion ← upsell
10. Churn Risk ← **mark as Lost stage** ✅

---

### Tag Taxonomy (49 tags — all live on GHL)

**By Persona (6):** `ops-manager`, `fundraising-director`, `digital-lead`, `founder`, `volunteer-led`, `faith-org`

**By Org Type (7):** `mosque-org`, `church-org`, `animal-charity`, `community-group`, `hospice`, `school`, `membership-org`

**By Org Size (4):** `org-1-50`, `org-50-200`, `org-200-500`, `org-500plus`

**By Funnel Stage (8):** `1st-touch`, `retargeting-warm`, `consideration-stage`, `high-intent`, `demo-scheduled`, `customer`, `expansion`, `churn-risk`

**By Lead Source (9):** `seo-organic`, `google-ads-bofu`, `linkedin-ads`, `linkedin-organic`, `linkedin-retargeting`, `google-interception`, `meta-retargeting`, `events-pr`, `referral`

**By Nurture Track (5):** `nurture-high-intent`, `nurture-research-stage`, `nurture-warm-proof`, `nurture-customer-expansion`, `nurture-lapse-reactivation`

**Social Proof & Campaigns (7):** `case-study-candidate`, `reference-customer`, `trust-sprint`, `reviewed-g2`, `reviewed-capterra`, `event-intercept`, `ramadan-campaign`

**Competitor Signals (3):** `competitor-salesforce`, `competitor-donorfy`, `competitor-beacon`

---

### Demo Booking Calendar

**Calendar:** Demo Booking (id: `g0VNslBRe9Pvje12KpoR`)
- **Duration:** 30-min slots
- **Availability:** Mon–Fri, 9am–5pm GMT
- **Type:** Event (not round-robin)
- **Auto-confirm:** Yes

---

### Run History

| Run | Date | Phase | Created | Skipped | Failed | What Happened |
|---|---|---|---|---|---|---|
| v1 | 2026-06-25 | Core | 14 | 0 | 0 | Initial fields (14 contact, 3 opp, 34 tags, calendar) |
| v2 | 2026-06-25 | Core | 12 | 18 | 0 | Gap analysis — added 10 contact + 1 opp field + 15 tags |
| v3 | 2026-06-25 | Core | 1 | 29 | 0 | Website alignment — added Demo Priority field |
| v4 | 2026-06-25 | Phase 2 | 9 | 8 | 0 | Automation features configured (9 modules, all ready) |

---

## Phase 2: Automation Features (🎯 Ready to Implement)

All 9 features are configured in `setup/` and output their implementation specs when `node setup.js` runs.

### 1. 🎯 Real-Time Webhook Listener

**What it does:** Listens to contact/opportunity/message events and triggers automations instantly.

**Events available:** `ContactCreate`, `ContactUpdate`, `OpportunityCreate`, `OpportunityUpdate`, `InboundMessage`

**Example flow:**
```
Contact submits form → ContactCreate webhook fires
→ Lead scoring rules run → ICP Score updated
→ Smart tagging rules run → 'high-intent' tag added
→ Opportunity auto-creator triggers → creates opp in Lead stage
→ Auto-assignment rules run → routes to sales rep
```

**Status:** Ready to implement  
**Effort:** 1–2 days (server setup + testing)

---

### 2. 📊 Lead Scoring Engine

**What it does:** Auto-calculates ICP Score (0–100) based on contact attributes.

**12 scoring rules:**
- Annual Income £1m+ → +25 pts
- Annual Income £250k–£1m → +15 pts
- Decision Timeline = Immediate → +20 pts
- Decision Timeline = 1–3 months → +15 pts
- Budget Authority = Yes → +20 pts
- Pain Points: Compliance/Reporting → +10 pts
- Existing Customer → +30 pts
- Expansion Potential = High → +15 pts
- Content Downloaded → +10 pts
- Event Attended → +15 pts
- LinkedIn Profile filled → +5 pts
- Charity Sector match → +5 pts

**Updates:** Whenever any tracked field changes

**Use case:** Auto-segment contacts scoring 85+ for "demo-ready" queue

**Status:** Ready to implement  
**Effort:** 4 hours

---

### 3. 🔄 Opportunity Auto-Creator

**What it does:** Automatically creates opportunities when conditions are met.

**Triggers:**
- Tag added = `high-intent` AND no open opp → create in "Lead" stage
- Tag added = `customer` + `expansion` → create in "Expansion" stage
- Tag added = `case-study-candidate` → create in "Research Stage"

**Auto-populated fields:**
- Name: `{companyName} — {firstName} {lastName}`
- Persona: from Governance Role field
- Org Size: from Annual Income Band field
- Lead Source: from UTM Source field

**Status:** Ready to implement  
**Effort:** 2 hours

---

### 4. 🏷️ Smart Auto-Tagging (8 Rules)

**What it does:** Auto-applies tags based on contact field values. Re-runs on every change.

**Rules:**
1. Revenue £1m+ + Fundraising Director → `fundraising-director`, `org-500plus`, `high-intent`
2. Pain Points: Spreadsheets/Tool sprawl → `high-intent`, `consideration-stage`
3. Charity Sector = Muslim → `mosque-org`
4. Content Downloaded OR Event Attended → `retargeting-warm`, `consideration-stage`
5. Form Abandonment Flag = Yes → `retargeting-warm`
6. Existing Customer + Expansion High → `expansion`, `customer`
7. Case Study Candidate + Size £250k–£1m → `case-study-candidate`, `trust-sprint`
8. Islamic Calendar + Muslim Org → `ramadan-campaign`

**Status:** Ready to implement  
**Effort:** 1 hour

---

### 5. 💬 Inbound Message Handler

**What it does:** Tracks email/SMS replies and updates contact status automatically.

**On reply:**
- Remove tag: `high-intent` (exits them from nurture)
- Add tag: `engaged`
- Set field: Email Sequence Step → 0 (stops sequence)
- Create task: "Follow up with [contact]"

**Special cases:**
- Reply contains "STOP" → add `opted-out-sms`
- SMS reply within 24h → add `high-engagement`, ICP Score +10

**Status:** Ready to implement  
**Effort:** 3 hours

---

### 6. 📈 Daily/Weekly/Monthly Reporting

**What it does:** Auto-generates and emails key metrics on schedule.

**Daily (8am):**
New leads, high-intent count, demos booked/completed, pipeline value, avg stage time, conversion rate

**Weekly (Mon 9am):**
Leads by source/persona/size, high-intent conversion, demo attendance, case study pipeline, churn risk

**Monthly (1st, 9am):**
Pipeline by stage, win rate by persona, avg deal size, sales cycle, retention rate

**Format:** CSV + HTML email + optional Google Drive export

**Delivery:** sales@, team@, leadership@ (configurable)

**Status:** Ready to implement  
**Effort:** 6–8 hours

---

### 7. 🔗 Apollo B2B Enrichment Sync

**What it does:** Looks up company/person data from Apollo and syncs missing fields.

**Field mappings:**
- LinkedIn Profile URL ← Apollo's linkedin_url
- Title ← Apollo's job_title
- Annual Income Band ← Apollo's company_annual_revenue
- Org Size Band ← Apollo's company_employee_count

**Scoring bonuses:**
- C-level/VP + revenue > £1m → +20 ICP
- Company size 50–200 + industry = Charity → +15 ICP

**Status:** Ready to implement  
**Effort:** 4 hours  
**Cost:** ~$0.01–0.05 per lookup  
**Requires:** Apollo API key in `.env`

---

### 8. 🔍 Contact Deduplication

**What it does:** Detects duplicate contacts and merges them.

**Detection rules:**
1. Exact email match → auto-merge if one >7 days old
2. Exact phone match → flag for review
3. Fuzzy name + company (Levenshtein >85%) → flag
4. Same domain + created <24h apart → suggest merge

**Merge process:**
- Keep newest as primary
- Combine tags
- Merge notes/timeline
- Reassociate all opportunities
- Mark secondary as "merged" (audit trail)

**Status:** Ready to implement  
**Effort:** 6–8 hours

---

### 9. 👥 Opportunity Auto-Assignment

**What it does:** Routes new opportunities to team members.

**3 strategies:**

**Strategy 1: Round-Robin** → Next person in rotation  
**Strategy 2: Load-Balanced** → Person with fewest open opps (recommended)  
**Strategy 3: Role-Specific:**
- Fundraising Director → fundraising-specialist@
- Ops Manager → ops-specialist@
- Org Size £1m+ → enterprise-team@
- Expansion → account-manager@

**Status:** Ready to implement  
**Effort:** 2 hours

---

## Manual Setup Steps (GHL UI)

### 1. Create 8 Smart Lists
Contacts → Smart Lists → + New

| List Name | Filter |
|---|---|
| High Intent Leads | Tag = `high-intent` |
| Demo Candidates | Tag = `demo-scheduled` |
| Active Nurture | Tag = `consideration-stage` OR `retargeting-warm` |
| Churn Risk | Tag = `churn-risk` |
| Existing Customers | Tag = `customer` |
| Trust Sprint | Tag = `trust-sprint` |
| Case Study Pipeline | Tag = `case-study-candidate` |
| Ramadan Campaign | Tag = `ramadan-campaign` |

### 2. Build 6-Step Inbound Nurture Workflow

**Trigger:** Tag added = `high-intent`  
**Filter:** Tag does NOT contain `demo-scheduled`

**Step 1 — SMS (0 min delay)**
```
Hi {{contact.first_name}}, thanks for requesting a Pillar demo — we'll be in touch within 1 working day to get you booked in. Reply STOP to opt out.
```

**Step 2 — Confirmation Email (1 hour delay)**
```
Subject: Your Pillar demo request — what happens next

Hi {{contact.first_name}},

Thanks for reaching out — we've received your demo request and someone from the Pillar team will call you shortly.

In the meantime, here's what a demo covers:
• Walkthrough of the CRM, website, and donation tools
• How other UK charities like yours use Pillar
• Pricing and migration

We usually get back within 1 working day.

— The Pillar team
```

**Step 3 — Case Study Email (24 hour delay)**
Branch on `Demo Priority` field:
- If contains "Donor Management" → send GDR case study
- If contains "New Website" → send Greengate case study
- If contains "Fundraising Tools" → send Orphans in Need case study
- Default → send Mustafah case study

**Step 4 — Chase SMS (48 hour delay)**
```
Hi {{contact.first_name}}, it's the Pillar team — we've tried to reach you about your demo. Is there a better time? Reply here or pick a slot: [calendar link]
```

**Step 5 — Social Proof Email (3 day delay)**
```
Subject: What charities say about Pillar

Hi {{contact.first_name}},

We know switching is a big decision. Here's what other teams say:

⭐⭐⭐⭐⭐ "Finally a CRM that doesn't need a developer to set up." — Ops Manager

⭐⭐⭐⭐⭐ "We recovered 10 hours of admin per week in month one." — Fundraising Director

Still happy to show you around: [calendar link]

— The Pillar team
```

**Step 6 — Closing Email (5 day delay)**
```
Subject: Closing your demo request (you can always reopen it)

Hi {{contact.first_name}},

We've tried to connect a few times — no worries if the timing isn't right.

I'll close your request for now, but you can rebook anytime: [calendar link]

As a gift — our free GDPR checklist for UK charities: [link]

— The Pillar team
```

**Actions after Step 6:**
- Remove tag: `high-intent`
- Add tag: `retargeting-warm`
- Update `Nurture Track` → `Research-Stage`
- Update `Email Sequence Step` → `0`

**Workflow settings:**
- Allow re-enrollment: OFF
- Workflow goal: Tag added = `demo-scheduled` (auto-exit on booking)

### 3. Connect Email Sender
Settings → Email Services → connect your sending domain

### 4. Connect SMS/Phone Number
Settings → Phone Numbers → buy/import UK number

### 5. Add Team Members
Settings → Team → add users for Demo Booking calendar

### 6. Map Website Form to GHL API
When form submits, POST to GHL with:
- Standard fields: `firstName`, `lastName`, `email`, `phone`, `companyName`, `title`
- Custom fields: `Annual Income Band`, `Demo Priority` (multi-select)
- Tags: `['1st-touch', 'high-intent']`
- Source: `'website-demo-form'`

---

## API Reference

**Base:** `https://services.leadconnectorhq.com`  
**Auth:** `Authorization: Bearer <GHL_TOKEN>`  
**Version:** `Version: v3` (required on all requests)

**Key endpoints:**
- `GET/POST /contacts` — create/read contacts
- `PUT /contacts/:id` — update contact fields + tags
- `GET/POST /opportunities` — manage pipeline
- `PUT /opportunities/:id` — update stage/value
- `POST /calendars` — create booking calendars
- Webhooks: Register URL in GHL UI (not API)

**Data types supported:**
`TEXT`, `LARGE_TEXT`, `NUMERICAL`, `PHONE`, `MONETORY`, `CHECKBOX`, `SINGLE_OPTIONS`, `MULTIPLE_OPTIONS`, `FLOAT`, `TIME`, `DATE`, `TEXTBOX_LIST`, `FILE_UPLOAD`, `SIGNATURE`, `RADIO`

---

## Implementation Roadmap

**✅ Phase 1: Core Setup (Complete)**
- 25 contact fields live
- 4 opportunity fields live
- 49 tags primed
- Demo Booking calendar created
- Sales pipeline created

**🎯 Phase 2: Automation Features (Ready)**
- 9 setup modules configured
- Each has implementation guide
- Choose which to build first

**Recommended build order:**
1. **Quick wins (2–3 hrs):** Lead Scoring → Smart Tagging → Auto-Assignment
2. **Medium (4–6 hrs):** Opportunity Auto-Creator → Inbound Handler
3. **High impact (6–8 hrs):** Reporting → Deduplication

**Next phases (future):**
- AI-powered lead qualification
- Predictive churn scoring
- Advanced revenue forecasting

---

## Support & Debugging

**If setup fails:**
1. Check `.env` has valid `GHL_TOKEN` and `LOCATION_ID`
2. Verify location has sufficient API quota
3. Run `node setup.js` again (idempotent — safe to re-run)
4. Check terminal output for specific field/API errors

**Common issues:**
- "No team member found" on calendar → calendar type must be `event` not `round_robin`
- Field creation fails → check field type name exactly matches GHL's enum
- Webhook not firing → verify URL registered in GHL UI under Settings → Integrations

---

**Questions?** See the individual setup module files in `setup/` for detailed implementation notes on each feature.
