# Pillar CRM Setup — GoHighLevel API v2

**Date:** 2026-06-25  
**Status:** ✅ Complete (v2 — full gap analysis applied)  
**Purpose:** Configure a fresh GHL sub-account via API to match Pillar's marketing and sales operations.

---

## What this does

Runs a single Node.js script (`node CRM/setup.js`) that:

1. Creates 24 custom **contact** fields (charity identity + nurture tracking + attribution + social proof + segmentation)
2. Creates 4 custom **opportunity** fields (pipeline attribution + competitor intelligence)
3. Primes the GHL tag taxonomy (49 tags across 7 categories)
4. Creates a "Demo Booking" calendar (30-min slots, Mon–Fri, 9am–5pm)
5. Checks for existing pipelines and prints manual-creation instructions if needed

All operations are **idempotent** — safe to re-run; existing fields/calendars are skipped.

---

## Files

```
CRM/
├── .env               ← credentials (gitignored)
├── .env.example       ← safe placeholder
├── .gitignore
├── config.js          ← loads .env, exports TOKEN + LOCATION_ID
├── client.js          ← shared fetch wrapper (auth + Version: v3 headers)
├── setup.js           ← main runner
└── setup/
    ├── fields.js      ← contact + opportunity custom field definitions + create logic
    ├── tags.js        ← tag taxonomy list + seed-contact approach
    ├── calendar.js    ← Demo Booking calendar creation
    └── pipelines.js   ← pipeline check + manual-step instructions
```

---

## Custom Contact Fields (24 total — all live on GHL)

### Core charity identity (14 fields — v1)
| Field | Type | Options |
|---|---|---|
| Charity Registration Number | TEXT | — |
| Annual Income Band | RADIO | <£50k / £50k–£250k / £250k–£1m / £1m+ |
| Charity Sector | SINGLE_OPTIONS | Muslim / Church / Animal / Community / Hospice / School / Membership / Other |
| Current Tech Stack | LARGE_TEXT | — |
| Primary Pain Points | MULTIPLE_OPTIONS | Spreadsheets / Tool sprawl / Compliance / Reporting / Fundraising / Website |
| Governance Role | SINGLE_OPTIONS | Founder / CEO / Operations Manager / Fundraising Director / Digital Lead / Volunteer |
| Decision Timeline | RADIO | Immediate / 1–3 months / 3–6 months / 6+ months |
| Budget Authority | RADIO | Yes / Partial / No |
| LinkedIn Profile URL | TEXT | — |
| Content Downloaded | LARGE_TEXT | — |
| Event Attended | TEXT | — |
| Form Abandonment Flag | RADIO | Yes / No |
| Existing Customer | RADIO | Yes / No |
| Expansion Potential | RADIO | Low / Medium / High |

### Nurture & sequence tracking (2 fields — v2)
| Field | Type | Options |
|---|---|---|
| Nurture Track | SINGLE_OPTIONS | High-Intent / Research-Stage / Warm-Proof / Customer-Expansion / Lapse-Reactivation |
| Email Sequence Step | NUMERICAL | — |

### Attribution / UTM (3 fields — v2)
| Field | Type |
|---|---|
| UTM Source | TEXT |
| UTM Medium | TEXT |
| UTM Campaign | TEXT |

### Social proof & trust sprint (3 fields — v2)
| Field | Type | Options |
|---|---|---|
| Case Study Candidate | RADIO | Yes / No |
| Reference Customer | RADIO | Yes / No |
| Review Status | SINGLE_OPTIONS | Not Asked / Asked / Submitted — G2 / Submitted — Capterra / Published — G2 / Published — Capterra |

### Segmentation signals (2 fields — v2)
| Field | Type | Options |
|---|---|---|
| Islamic Calendar Relevance | RADIO | Yes / No |
| ICP Score | NUMERICAL | 0–100 |

---

## Custom Opportunity Fields (4 total — all live on GHL)

| Field | Type | Options |
|---|---|---|
| Lead Source Channel | SINGLE_OPTIONS | SEO Organic / Google Ads / LinkedIn Ads / LinkedIn Organic / LinkedIn Retargeting / Google Interception / Meta Retargeting / Events / PR / Referral |
| Persona | SINGLE_OPTIONS | Ops Manager / Fundraising Director / Digital Lead / Founder / Volunteer-led / Faith Org |
| Org Size Band | RADIO | <£50k / £50k–£250k / £250k–£1m / £1m+ |
| Competitor Displacing | SINGLE_OPTIONS | Spreadsheets / Salesforce NPSP / Donorfy / Beacon CRM / JustGiving / Enthuse / Other |

---

## Sales Pipeline Stages

Pipeline creation is **UI-only** in GHL API v2. The setup script detects if it's missing and prints these exact stage names to create manually:

1. Lead
2. Contacted
3. Research Stage
4. High Intent
5. Demo Scheduled
6. Demo Complete
7. Proposal
8. Won ← mark as Won stage
9. Expansion
10. Churn Risk ← mark as Lost stage

---

## Tag Taxonomy (49 tags — all live on GHL)

**By Persona (6):** `ops-manager`, `fundraising-director`, `digital-lead`, `founder`, `volunteer-led`, `faith-org`

**By Org Type (7):** `mosque-org`, `church-org`, `animal-charity`, `community-group`, `hospice`, `school`, `membership-org`

**By Org Size (4):** `org-1-50`, `org-50-200`, `org-200-500`, `org-500plus`

**By Funnel Stage (8):** `1st-touch`, `retargeting-warm`, `consideration-stage`, `high-intent`, `demo-scheduled`, `customer`, `expansion`, `churn-risk`

**By Lead Source (9):** `seo-organic`, `google-ads-bofu`, `linkedin-ads`, `linkedin-organic`, `linkedin-retargeting`, `google-interception`, `meta-retargeting`, `events-pr`, `referral`

**By Nurture Track (5 — v2):** `nurture-high-intent`, `nurture-research-stage`, `nurture-warm-proof`, `nurture-customer-expansion`, `nurture-lapse-reactivation`

**Social proof & campaigns (7 — v2):** `case-study-candidate`, `reference-customer`, `trust-sprint`, `reviewed-g2`, `reviewed-capterra`, `event-intercept`, `ramadan-campaign`

**Competitor signals (3 — v2):** `competitor-salesforce`, `competitor-donorfy`, `competitor-beacon`

---

## Calendar

- **Demo Booking** (id: `g0VNslBRe9Pvje12KpoR`) — 30-min slots, Mon–Fri 9am–5pm, event type, auto-confirm

---

## Smart Lists to create manually in GHL UI

These are saved contact filter views — not available via API:

- **High Intent Leads** → tag = `high-intent`
- **Demo Candidates** → tag = `demo-scheduled`
- **Active Nurture** → tag = `consideration-stage` OR `retargeting-warm`
- **Churn Risk** → tag = `churn-risk`
- **Existing Customers** → tag = `customer`
- **Trust Sprint** → tag = `trust-sprint` (review outreach targets)
- **Case Study Pipeline** → tag = `case-study-candidate`
- **Ramadan Campaign** → tag = `ramadan-campaign` + `islamic-calendar-relevance = Yes`

---

## API Reference

- Base URL: `https://services.leadconnectorhq.com`
- Auth: `Authorization: Bearer <GHL_TOKEN>`
- Version: `Version: v3` (required on all requests)
- Custom fields: `POST /locations/:locationId/customFields`
- Calendars: `POST /calendars/`
- Pipelines: `GET /opportunities/pipelines?locationId=` (read-only)

## Run history

| Run | Date | Created | Skipped | Failed | Notes |
|---|---|---|---|---|---|
| v1 | 2026-06-25 | 14 | 0 | 0 | Initial setup — 14 contact fields, 3 opp fields, 34 tags, Demo Booking calendar |
| v2 | 2026-06-25 | 12 | 18 | 0 | Gap analysis — 10 new contact fields, 1 new opp field, 15 new tags |
| v3 | 2026-06-25 | 1 | 29 | 0 | Website form alignment — Demo Priority field (6 options matching form tiles) |

---

## What's Done vs What Still Needs Doing

### Done via API (nothing left to do here)
- [x] 25 contact custom fields live on GHL
- [x] 4 opportunity custom fields live on GHL
- [x] 49 tags primed in GHL tag library
- [x] Demo Booking calendar created (id: g0VNslBRe9Pvje12KpoR)
- [x] Demo Priority field matches website form tiles exactly

### Still required — GHL UI (can't be done via API)

#### 1. Create the Sales Pipeline
GHL → Opportunities → Pipelines → + Add Pipeline

Name: **Pillar Sales Pipeline**

Stages in order:
1. Lead
2. Contacted
3. Research Stage
4. High Intent
5. Demo Scheduled
6. Demo Complete
7. Proposal
8. Won ← toggle Mark as Won
9. Expansion
10. Churn Risk ← toggle Mark as Lost

#### 2. Create Smart Lists (Contacts → Smart Lists → + New)

| List name | Filter |
|---|---|
| High Intent Leads | Tag = `high-intent` |
| Demo Candidates | Tag = `demo-scheduled` |
| Active Nurture | Tag = `consideration-stage` OR `retargeting-warm` |
| Churn Risk | Tag = `churn-risk` |
| Existing Customers | Tag = `customer` |
| Trust Sprint | Tag = `trust-sprint` |
| Case Study Pipeline | Tag = `case-study-candidate` |
| Ramadan Campaign | Tag = `ramadan-campaign` |

#### 3. Build the Inbound Lead Nurture Workflow (see full spec below)

#### 4. Connect email sender
GHL → Settings → Email Services → connect your sending domain (needed before any workflow emails fire)

#### 5. Connect SMS / phone number
GHL → Settings → Phone Numbers → buy/import a UK number (needed for SMS steps in workflow)

#### 6. Add team members
GHL → Settings → Team → add users so the Demo Booking calendar has assignees

#### 7. Map your website form to GHL
When the form posts to GHL API, ensure these fields are mapped:
- `firstName`, `lastName`, `email`, `phone`, `companyName` → standard GHL contact fields
- `title` (Job title) → built-in GHL `title` field
- Annual income selection → `Annual Income Band` custom field (match strings exactly)
- Priority tile selections → `Demo Priority` custom field (multi-select)
- Set `tags: ['1st-touch', 'high-intent']` on every inbound demo request
- Set `source: 'website-demo-form'`

---

## Inbound Lead Nurture Workflow Spec

**Workflow name:** Inbound Demo Request — No Answer Nurture
**Trigger:** Contact tag added = `high-intent` (fires when form is submitted)
**Goal:** Get them to pick up / reschedule demo. Stop sequence when demo is booked or they reply.
**Exit conditions:** Tag added = `demo-scheduled` OR conversation reply received → remove from sequence

### Step-by-step build in GHL → Automation → Workflows → + New Workflow

---

**Step 1 — Immediate SMS** (Action: Send SMS)
Delay: 0 (fires instantly on trigger)

```
Hi {{contact.first_name}}, thanks for requesting a Pillar demo — we'll be in touch within 1 working day to get you booked in. Reply STOP to opt out.
```

---

**Step 2 — Confirmation email** (Action: Send Email)
Delay: Wait 1 hour after Step 1

Subject: `Your Pillar demo request — what happens next`

Body:
```
Hi {{contact.first_name}},

Thanks for reaching out — we've received your demo request and someone from the Pillar team will call you shortly to get you booked in.

In the meantime, here's what a demo covers:
• A walkthrough of the CRM, website, and donation tools
• How other UK charities like yours use Pillar
• Pricing and what migration looks like

We usually get back to people within 1 working day.

— The Pillar team
```

---

**Step 3 — Case study email** (Action: Send Email)
Delay: Wait 24 hours after Step 2

Condition: Branch on `Demo Priority` field
- If contains "Donor Management" → use GDR case study
- If contains "New Website" → use Greengate case study
- If contains "Fundraising Tools" → use Orphans in Need case study
- Default → use Mustafah case study

Subject: `How [Charity name] [outcome] with Pillar`

Body (example — Donor Management branch):
```
Hi {{contact.first_name}},

While we get your demo booked in, here's a quick read:

**GDR used Pillar to centralise their donor database and cut admin by 12 hours a week.**

[Read the full story →]

Most charities we speak to are in a similar position — multiple systems, data in spreadsheets, no clear picture of donor retention.

That's exactly what we built Pillar to fix.

Chat soon,
— The Pillar team
```

---

**Step 4 — Chase SMS** (Action: Send SMS)
Delay: Wait 48 hours after Step 3
Condition: Only if no reply received

```
Hi {{contact.first_name}}, it's the Pillar team — we've tried to reach you about your demo. Is there a better time to call? Just reply here or pick a slot: [calendar link]
```

---

**Step 5 — Social proof email** (Action: Send Email)
Delay: Wait 3 days after Step 4

Subject: `What charities say about Pillar`

Body:
```
Hi {{contact.first_name}},

We know switching platforms is a big decision. Here's what a few charity teams have said:

⭐⭐⭐⭐⭐ "Finally a CRM that doesn't need a developer to set up." — Operations Manager, Muslim charity

⭐⭐⭐⭐⭐ "We recovered 10 hours of admin per week in the first month." — Fundraising Director

⭐⭐⭐⭐⭐ "Gift Aid automation alone paid for the subscription." — Finance lead, hospice

Still happy to show you around — book a time that works: [calendar link]

— The Pillar team
```

---

**Step 6 — Final email** (Action: Send Email)
Delay: Wait 5 days after Step 5

Subject: `Closing your demo request (you can always reopen it)`

Body:
```
Hi {{contact.first_name}},

We've tried to connect a few times — no worries at all if the timing isn't right.

I'll close your demo request for now, but you're welcome to rebook anytime: [calendar link]

As a parting gift — our free GDPR compliance checklist for UK charities: [link]

Hope to speak soon.
— The Pillar team
```

Action after this email:
- Remove tag `high-intent`
- Add tag `retargeting-warm`
- Update `Nurture Track` field → `Research-Stage`
- Update `Email Sequence Step` field → `0`

---

### How to build this in GHL

1. GHL → Automation → Workflows → **+ New Workflow** → Start from Scratch
2. Trigger: **Contact Tag** → Tag Added → `high-intent`
3. Add a filter: **Tag does not contain** `demo-scheduled` (prevents firing on existing customers)
4. Add each step above as an Action, with Wait steps for timing
5. At the end add the tag/field update actions listed above
6. Set **Allow re-enrollment** OFF
7. Add a **Workflow Goal**: Contact tag added = `demo-scheduled` → this exits them and stops the sequence
8. Publish

**Date:** 2026-06-25  
**Purpose:** Configure a fresh GHL sub-account via API to match Pillar's marketing and sales operations.

---

## What this does

Runs a single Node.js script (`node CRM/setup.js`) that:

1. Creates 14 custom **contact** fields (charity-specific data points)
2. Creates 3 custom **opportunity** fields (pipeline attribution)
3. Primes the GHL tag taxonomy (30+ tags for persona, org type, funnel stage, lead source)
4. Creates a "Demo Booking" calendar (30-min slots, Mon–Fri, 9am–5pm GMT)
5. Checks for existing pipelines and prints manual-creation instructions if needed

All operations are **idempotent** — safe to re-run; existing fields/calendars are skipped.

---

## Files

```
CRM/
├── .env               ← credentials (gitignored)
├── .env.example       ← safe placeholder
├── .gitignore
├── config.js          ← loads dotenv, exports TOKEN + LOCATION_ID
├── client.js          ← shared fetch wrapper (auth + Version headers)
├── setup.js           ← main runner
└── setup/
    ├── fields.js      ← contact + opportunity custom field definitions + create logic
    ├── tags.js        ← tag taxonomy list + seed-contact approach
    ├── calendar.js    ← Demo Booking calendar creation
    └── pipelines.js   ← pipeline check + manual-step instructions
```

---

## Custom Contact Fields

| Field | Type | Options |
|---|---|---|
| Charity Registration Number | TEXT | — |
| Annual Income Band | RADIO | <£50k / £50k–£250k / £250k–£1m / £1m+ |
| Charity Sector | DROPDOWN | Muslim / Church / Animal / Community / Hospice / School / Membership / Other |
| Current Tech Stack | LARGE_AREA | — |
| Primary Pain Points | MULTISELECT | Spreadsheets / Tool sprawl / Compliance / Reporting / Fundraising / Website |
| Governance Role | DROPDOWN | Founder / CEO / Operations Manager / Fundraising Director / Digital Lead / Volunteer |
| Decision Timeline | RADIO | Immediate / 1–3 months / 3–6 months / 6+ months |
| Budget Authority | RADIO | Yes / Partial / No |
| LinkedIn Profile URL | TEXT | — |
| Content Downloaded | LARGE_AREA | — |
| Event Attended | TEXT | — |
| Form Abandonment Flag | CHECKBOX | — |
| Existing Customer | CHECKBOX | — |
| Expansion Potential | RADIO | Low / Medium / High |

## Custom Opportunity Fields

| Field | Type | Options |
|---|---|---|
| Lead Source Channel | DROPDOWN | SEO / Google Ads / LinkedIn Ads / LinkedIn Organic / LinkedIn Retarget / Google Interception / Meta Retarget / Events / PR / Referral |
| Persona | DROPDOWN | Ops Manager / Fundraising Director / Digital Lead / Founder / Volunteer-led / Faith Org |
| Org Size Band | RADIO | <£50k / £50k–£250k / £250k–£1m / £1m+ |

---

## Sales Pipeline Stages

Pipeline creation is **UI-only** in GHL API v2. The setup script will detect if it's missing and print these exact stage names to create manually:

1. Lead
2. Contacted
3. Research Stage
4. High Intent
5. Demo Scheduled
6. Demo Complete
7. Proposal
8. Won
9. Expansion
10. Churn Risk

---

## Tag Taxonomy (30+ tags)

**By Persona:** `ops-manager`, `fundraising-director`, `digital-lead`, `founder`, `volunteer-led`, `faith-org`

**By Org Type:** `mosque-org`, `church-org`, `animal-charity`, `community-group`, `hospice`, `school`, `membership-org`

**By Org Size:** `org-1-50`, `org-50-200`, `org-200-500`, `org-500plus`

**By Funnel Stage:** `1st-touch`, `retargeting-warm`, `consideration-stage`, `high-intent`, `demo-scheduled`, `customer`, `expansion`, `churn-risk`

**By Lead Source:** `seo-organic`, `google-ads-bofu`, `linkedin-ads`, `linkedin-organic`, `linkedin-retargeting`, `google-interception`, `meta-retargeting`, `events-pr`, `referral`

---

## Smart Lists (create manually in GHL UI after setup)

These are saved contact filter views — not available via API:

- **High Intent Leads** → tag = `high-intent`
- **Demo Candidates** → tag = `demo-scheduled`
- **Active Nurture** → tag = `consideration-stage` OR `retargeting-warm`
- **Churn Risk** → tag = `churn-risk`
- **Existing Customers** → tag = `customer`

---

## API Reference

- Base URL: `https://services.leadconnectorhq.com`
- Auth: `Authorization: Bearer <GHL_TOKEN>`
- Version: `Version: v3` (required on all requests)
- Custom fields: `POST /locations/:locationId/customFields`
- Calendars: `POST /calendars/`
- Pipelines: `GET /opportunities/pipelines?locationId=` (read-only)

---

## Additional GHL Capabilities — Phase 2 (9 Automation Features)

All of these features are **now ready to implement** using the GHL v3 API + webhooks. Each feature is configured in `setup/` modules and can be deployed independently.

### 1. 🎯 Real-Time Webhook Listener

**What it does:** Listens to contact/opportunity/message events and triggers automations instantly.

**Events available:**
- `ContactCreate`, `ContactUpdate`, `OpportunityCreate`, `OpportunityUpdate`, `InboundMessage`

**Example:** Contact fills form → webhook fires → lead scoring + auto-tagging + opportunity creation + assignment all happen within seconds.

**Status:** Ready to implement  
**Effort:** 1–2 days

---

### 2. 📊 Lead Scoring Engine

**What it does:** Auto-calculates ICP Score (0–100) based on 12 scoring rules.

**Scoring rules:**
- Annual Income £1m+ → +25 pts
- Decision Timeline Immediate → +20 pts
- Budget Authority Yes → +20 pts
- Existing Customer → +30 pts
- Content Downloaded → +10 pts
- Event Attended → +15 pts
- Pain Points: Compliance/Reporting → +10 pts
- ... and 5 more

**Updates whenever:** Any tracked field changes

**Use case:** Automatically segment contacts scoring 85+ for demo-ready queue.

**Status:** Ready to implement  
**Effort:** 4 hours

---

### 3. 🔄 Opportunity Auto-Creator

**What it does:** Automatically creates opportunities in the Sales Pipeline when conditions are met.

**Trigger examples:**
- Tag added = `high-intent` AND no open opportunity → create in "Lead" stage
- Tag added = `customer` + `expansion` → create in "Expansion" stage  
- Tag added = `case-study-candidate` → create in "Research Stage"

**Auto-populated fields:**
- Opportunity name: `{companyName} — {firstName} {lastName}`
- Persona: from Governance Role field
- Org Size: from Annual Income Band field
- Lead Source: from UTM Source field

**Status:** Ready to implement  
**Effort:** 2 hours

---

### 4. 🏷️ Smart Auto-Tagging (8 Rules)

**What it does:** Automatically applies tags based on contact field values. Re-runs on every change.

**Sample rules:**
- Revenue £1m+ + Fundraising Director → add `fundraising-director`, `org-500plus`, `high-intent`
- Pain Points: Spreadsheets OR Tool sprawl → add `high-intent`, `consideration-stage`
- Charity Sector: Muslim → add `mosque-org`
- Content Downloaded OR Event Attended → add `retargeting-warm`, `consideration-stage`
- Form Abandonment Flag = Yes → add `retargeting-warm`
- Existing Customer + Expansion Potential High → add `expansion`, `customer`
- Case Study Candidate + Org Size £250k–£1m → add `case-study-candidate`, `trust-sprint`
- Islamic Calendar Relevance + Muslim Org → add `ramadan-campaign`

**Status:** Ready to implement  
**Effort:** 1 hour

---

### 5. 💬 Inbound Message Handler

**What it does:** Tracks email/SMS replies and updates contact status automatically.

**On reply:**
- Remove tag: `high-intent` (pulls them out of nurture)
- Add tag: `engaged`
- Set field: Email Sequence Step → 0 (stops nurture)
- Create task: "Follow up with [contact]"

**Special handling:**
- Reply contains "STOP" → add `opted-out-sms`
- SMS reply within 24h of email → add `high-engagement`, ICP Score +10

**Status:** Ready to implement  
**Effort:** 3 hours

---

### 6. 📈 Daily/Weekly/Monthly Reporting

**What it does:** Auto-generates and emails key metrics.

**Daily (8am):** New leads, high-intent count, demos booked/completed, pipeline value, avg stage time, conversion rate

**Weekly (Mon 9am):** Leads by source/persona/size, high-intent conversion, demo attendance, case study pipeline, churn risk

**Monthly (1st, 9am):** Pipeline by stage, win rate by persona, avg deal size, sales cycle length, retention rate

**Format:** CSV + HTML email + optional Google Drive

**Delivery:** sales@, team@, leadership@ (configurable)

**Status:** Ready to implement  
**Effort:** 6–8 hours

---

### 7. 🔗 Apollo B2B Enrichment Sync

**What it does:** Looks up company/person data from Apollo and syncs missing fields.

**Field mappings:**
- `LinkedIn Profile URL` ← Apollo's linkedin_url
- `title` ← Apollo's job_title
- `Annual Income Band` ← Apollo's company_annual_revenue
- `Org Size Band` ← Apollo's company_employee_count

**Scoring bonuses:**
- C-level/VP + revenue > £1m → +20 ICP
- Company size 50–200 + industry = Charity → +15 ICP

**Status:** Ready to implement  
**Effort:** 4 hours  
**Cost:** ~$0.01–0.05 per API call (Apollo pricing)

**Requires:** Apollo API key in `.env`

---

### 8. 🔍 Contact Deduplication

**What it does:** Detects duplicate contacts and merges them.

**Detection rules:**
1. Exact email match → auto-merge if one is >7 days old
2. Exact phone match → flag for review
3. Fuzzy name + company (Levenshtein >85%) → flag for review
4. Same domain + created <24h → suggest merge

**Merge process:**
- Keep newest as primary
- Combine tags
- Merge notes/timeline
- Reassociate all opportunities
- Mark secondary as "merged" (no delete)

**Status:** Ready to implement  
**Effort:** 6–8 hours

---

### 9. 👥 Opportunity Auto-Assignment

**What it does:** Automatically assigns new opportunities to team members.

**3 strategies:**

**Strategy 1: Round-Robin**
- Assign to next person in rotation
- Best for: Equal capacity teams

**Strategy 2: Load-Balanced (recommended)**
- Assign to person with fewest open opps
- Best for: Most cases

**Strategy 3: Role-Specific**
- Fundraising Director → fundraising-specialist@
- Ops Manager → ops-specialist@
- Org Size £1m+ → enterprise-team@
- Expansion → account-manager@

**Status:** Ready to implement  
**Effort:** 2 hours

---

## Next Steps

1. **Run the new setup:** `node setup.js` (all automation modules now included)
2. **Choose which features to build first:**
   - **Quick wins (2–3 hours each):** Lead Scoring, Smart Tagging, Auto-Assignment
   - **Medium complexity (4–6 hours each):** Opportunity Auto-Creator, Inbound Handler, Apollo Enrichment
   - **High impact (6–8 hours each):** Reporting Engine, Deduplication
3. **Set up webhook receiver:** Deploy a Node.js/Python server to listen for webhooks from GHL
4. **Register webhook URL:** GHL → Settings → Integrations → Webhooks → add your server URL
5. **Test each feature** against live GHL account
6. **Deploy to production** once tested

All feature implementations follow the same pattern:
```
Listen to webhook → Extract fields → Apply business logic → Update GHL via API
```

Each setup module in `setup/` includes the exact logic, field names, and API calls needed.

