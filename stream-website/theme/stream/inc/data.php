<?php
/**
 * Stream content model: features, solutions, automations, integrations, resources and the site map.
 * Everything the templates, mega menus and demo importer render comes from here.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function stream_features() {
	return array(
		// ── Sell ──────────────────────────────────────────────
		'call-list'           => array(
			'name' => 'Call list', 'group' => 'sell', 'icon' => 'calls', 'svg' => 'call-list',
			'tagline' => 'One lead at a time. Everything on screen.',
			'blurb'   => 'Zen-mode calling with the script, history and outcomes in one view.',
			'intro'   => 'Zen-mode calling puts the next lead, the history and the outcome buttons in one calm view, so reps spend their day talking to people, not clicking between tabs.',
			'points'  => array(
				array( 'Click to call', 'Dial straight from the browser through your phone system. Every call is logged against the lead automatically.' ),
				array( 'Auto-advance', 'Log an outcome and the next lead loads instantly. No tab hopping and no lost momentum.' ),
				array( 'Enriched numbers', 'Direct dials and emails arrive pre-filled from enrichment, so there are fewer dead ends.' ),
				array( 'Notes that stick', 'Capture notes, callbacks and outcomes in two clicks. They follow the lead everywhere.' ),
			),
			'roles'   => array( 'Reps', 'Managers' ),
		),
		'outbound'            => array(
			'name' => 'Outbound queue', 'group' => 'sell', 'icon' => 'board', 'svg' => 'outbound',
			'tagline' => 'Your prospecting engine, loaded and sorted.',
			'blurb'   => 'Import lists, stack them by priority and hand reps a clean queue.',
			'intro'   => 'Import lists from Apollo, Google Maps or a CSV, stack them by priority and give every rep a clean, de-duplicated queue to work each morning.',
			'points'  => array(
				array( 'Import from anywhere', 'Bring in lists from Apollo, Google Maps exports or plain CSVs in a couple of clicks.' ),
				array( 'Industry stacking', 'Push your best-fit sectors to the top so the highest-value leads are always called first.' ),
				array( 'Clean by default', 'Duplicates are caught on the way in, so nobody calls the same company twice.' ),
				array( 'Assign and rebalance', 'Spread leads across the team and move them around when priorities change.' ),
			),
			'roles'   => array( 'Admins', 'Managers' ),
		),
		'opportunities'       => array(
			'name' => 'Opportunities', 'group' => 'sell', 'icon' => 'opportunities', 'svg' => 'opportunities',
			'tagline' => 'A pipeline that moves itself.',
			'blurb'   => 'A clear board of stages, values and owners from first meeting to won.',
			'intro'   => 'Every qualified conversation becomes an opportunity on a clear board with stages, values and owners. A deal is only counted as won when the contract is signed.',
			'points'  => array(
				array( 'Drag-and-drop stages', 'Move deals through your pipeline with a drag. Everyone sees the same truth.' ),
				array( 'Value and owner', 'Every opportunity carries a value, a rep and a next step, so nothing drifts.' ),
				array( 'Won means signed', 'When the client signs the contract the opportunity moves to Won on its own.' ),
				array( 'Opportunity reports', 'Stage conversion and value by rep, one click from the board.' ),
			),
			'roles'   => array( 'Reps', 'Managers', 'Admins' ),
		),
		'proposals'           => array(
			'name' => 'Proposal Hub', 'group' => 'sell', 'icon' => 'proposals', 'svg' => 'proposals',
			'tagline' => 'From proposal to signed contract to handover.',
			'blurb'   => 'Branded proposals, e-signature and onboarding on a single client link.',
			'intro'   => 'Build polished proposals from your opportunities, share them behind a password and an approved email, then take the client from accept to contract to onboarding on one link.',
			'points'  => array(
				array( 'Templates and blocks', 'Start from a template and edit with simple blocks. Styling follows your brand guide automatically.' ),
				array( 'Private client links', 'Each proposal opens only with an approved email address and a password you control.' ),
				array( 'E-signature with an audit trail', 'Signature, date, time and IP address are recorded, so you have proof of who signed what and when.' ),
				array( 'Questionnaire and handover', 'Client answers flow into a pricing-free handover page that your delivery team can run with.' ),
			),
			'roles'   => array( 'Reps', 'Managers' ),
		),
		'inbound'             => array(
			'name' => 'Inbound', 'group' => 'sell', 'icon' => 'inbound', 'svg' => 'inbound',
			'tagline' => 'Every enquiry scored, tagged and routed in seconds.',
			'blurb'   => 'Forms, landing pages and webhooks land in one inbox, already routed.',
			'intro'   => 'Web forms, landing pages and webhooks all land in one inbox, where leads are scored, tagged and sent to the right rep before a competitor has replied.',
			'points'  => array(
				array( 'One inbox', 'Every source in one place, with the original message and context attached.' ),
				array( 'Instant routing', 'Rules assign each lead to the right rep by territory, sector or capacity.' ),
				array( 'Hot lead alerts', 'High-scoring enquiries trigger an immediate notification to the owner.' ),
				array( 'Source tracking', 'See which forms, pages and campaigns actually produce conversations.' ),
			),
			'roles'   => array( 'Reps', 'Admins' ),
		),
		'calendar'            => array(
			'name' => 'Calendar', 'group' => 'sell', 'icon' => 'calendar', 'svg' => 'calendar',
			'tagline' => 'Meetings and callbacks, booked straight into diaries.',
			'blurb'   => 'Every meeting and callback in one place, with self-serve booking.',
			'intro'   => 'See every meeting, demo and callback in one place, and let prospects book themselves into the right diary from your landing pages.',
			'points'  => array(
				array( 'Team view', 'Managers see availability and load across the whole team at a glance.' ),
				array( 'Self-serve booking', 'Landing pages offer real availability and book the meeting without any back-and-forth.' ),
				array( 'Callback reminders', 'Promised callbacks surface at the right time so none are forgotten.' ),
				array( 'Tied to the lead', 'Every meeting links back to the lead, the opportunity and the proposal.' ),
			),
			'roles'   => array( 'Managers', 'Reps' ),
		),
		// ── Engage ────────────────────────────────────────────
		'campaigns'           => array(
			'name' => 'Campaigns', 'group' => 'engage', 'icon' => 'campaigns', 'svg' => 'campaigns',
			'tagline' => 'Email sequences that run themselves.',
			'blurb'   => 'Multi-step sequences with auto-enrolment and stop-on-reply.',
			'intro'   => 'Design multi-step sequences, enrol leads automatically and let Stream send the right email at the right time, stopping the moment someone replies.',
			'points'  => array(
				array( 'Multi-step sequences', 'Chain emails with delays that respect working days and time zones.' ),
				array( 'Auto-enrol rules', 'New leads that match your rules join the right sequence without anyone lifting a finger.' ),
				array( 'Stop on reply', 'A reply ends the sequence and alerts the owner straight away.' ),
				array( 'Unsubscribes handled', 'Every email carries a working unsubscribe link and opt-outs are respected everywhere.' ),
			),
			'roles'   => array( 'Admins', 'Managers' ),
		),
		'email-copy'          => array(
			'name' => 'Email copy library', 'group' => 'engage', 'icon' => 'email', 'svg' => 'email-copy',
			'tagline' => 'Proven templates, ready to personalise.',
			'blurb'   => 'Tested email copy by industry and stage with merge fields.',
			'intro'   => 'A shared library of email copy organised by industry and stage, with merge fields that make every send feel hand-written.',
			'points'  => array(
				array( 'Organised by stage', 'Cold intros, follow-ups, break-ups and re-engagement, all in one place.' ),
				array( 'Merge fields', 'Names, companies and sectors drop in automatically.' ),
				array( 'One click into a campaign', 'Turn any template into a live sequence step instantly.' ),
				array( 'Shared by the team', 'The best copy spreads quickly because everyone uses the same library.' ),
			),
			'roles'   => array( 'Managers', 'Reps' ),
		),
		'waves'               => array(
			'name' => 'Waves', 'group' => 'engage', 'icon' => 'waves', 'svg' => 'waves',
			'tagline' => 'Release outreach in controlled batches.',
			'blurb'   => 'Keep volume in step with follow-up capacity.',
			'intro'   => 'Prospecting in waves keeps volume in step with your capacity to follow up, so no lead is contacted and then forgotten.',
			'points'  => array(
				array( 'Wave planning', 'Decide how many contacts go out, when, and to which owners.' ),
				array( 'Lists per wave', 'Each wave has its own contacts, so results are easy to compare.' ),
				array( 'Pause and release', 'Hold a wave back or let it run as capacity allows.' ),
				array( 'Safe releases', 'Every release follows a checklist and a backup, so nothing is lost.' ),
			),
			'roles'   => array( 'Admins', 'Managers' ),
		),
		// ── Insight ───────────────────────────────────────────
		'reports'             => array(
			'name' => 'Reports', 'group' => 'insight', 'icon' => 'reports', 'svg' => 'reports',
			'tagline' => 'The numbers behind every call, meeting and deal.',
			'blurb'   => 'Activity, queue and opportunity reports without the spreadsheet.',
			'intro'   => 'Queue, activity and opportunity reports show who is doing what and what is working, without a spreadsheet in sight.',
			'points'  => array(
				array( 'Activity by rep', 'Calls, conversations and meetings by person and by week.' ),
				array( 'Queue health', 'See how much of each list has been worked and what is left.' ),
				array( 'Opportunity conversion', 'Stage-to-stage conversion and value by owner.' ),
				array( 'Weekly dashboard', 'A single screen for the Monday meeting.' ),
			),
			'roles'   => array( 'Managers', 'Admins' ),
		),
		'leaderboard'         => array(
			'name' => 'Leaderboard', 'group' => 'insight', 'icon' => 'podium', 'svg' => 'leaderboard',
			'tagline' => 'Weekly points that make the team compete.',
			'blurb'   => 'Live rankings that keep the whole team in the game.',
			'intro'   => 'Calls, conversations, meetings and wins earn points, and a live leaderboard keeps the whole team in the game all week.',
			'points'  => array(
				array( 'Live rankings', 'Standings update as activity happens, not at the end of the week.' ),
				array( 'Fair scoring', 'Points reward the activities that actually lead to revenue.' ),
				array( 'Weekly rhythm', 'A fresh week means a fresh race for everyone.' ),
				array( 'Double Point Frenzy', 'Closed deals trigger a 48-hour double points window for the whole team.' ),
			),
			'roles'   => array( 'Reps', 'Managers' ),
		),
		'double-point-frenzy' => array(
			'name' => 'Double Point Frenzy', 'group' => 'insight', 'icon' => 'flame', 'svg' => 'frenzy',
			'tagline' => 'A win for one is a boost for everyone.',
			'blurb'   => 'A signed contract doubles everyone\'s points for 48 hours.',
			'intro'   => 'The moment a rep closes a deal, a banner appears on every page for every user and all leaderboard points are doubled for the next 48 hours.',
			'points'  => array(
				array( 'Triggered by a signed contract', 'No manual switch. The win itself starts the clock.' ),
				array( 'A banner everyone sees', 'A sticky banner with a live countdown appears across the whole workspace.' ),
				array( 'Points doubled automatically', 'Every call, meeting and win earns double until the timer runs out.' ),
				array( 'Celebrate the closer', 'The banner names the rep who closed it, so wins are shared and seen.' ),
			),
			'roles'   => array( 'Reps', 'Managers' ),
		),
		'achievements'        => array(
			'name' => 'Achievements', 'group' => 'insight', 'icon' => 'trophy', 'svg' => 'achievements',
			'tagline' => 'Badges, streaks and milestones worth chasing.',
			'blurb'   => 'Recognition for the habits that win business.',
			'intro'   => 'Achievements recognise the habits that win business: consistent calling, quick follow-up and closing. Small wins are celebrated alongside the big ones.',
			'points'  => array(
				array( 'Badges', 'Unlock badges for milestones such as first meeting, first win and big weeks.' ),
				array( 'Streaks', 'Keep a streak going and the habit builds itself.' ),
				array( 'Personal progress', 'Every rep sees their own journey, not just the top of the table.' ),
				array( 'Team moments', 'Shared milestones give the whole team something to celebrate.' ),
			),
			'roles'   => array( 'Reps' ),
		),
		'market-size'         => array(
			'name' => 'Market size', 'group' => 'insight', 'icon' => 'market', 'svg' => 'market-size',
			'tagline' => 'See how much of your market you have really touched.',
			'blurb'   => 'Total, serviceable and worked market, by sector.',
			'intro'   => 'Break your imported lists down into total, serviceable and worked market, so you always know how much headroom is left in each sector.',
			'points'  => array(
				array( 'TAM, SAM and SOM', 'Three simple rings that show where you are and where you could be.' ),
				array( 'By sector', 'Compare industries side by side to decide where to focus.' ),
				array( 'Coverage over time', 'Watch the share of your market you have contacted grow week by week.' ),
				array( 'Plan the next list', 'Spot the gaps and know exactly what to import next.' ),
			),
			'roles'   => array( 'Managers', 'Admins' ),
		),
		'ai-insights'         => array(
			'name' => 'AI insights', 'group' => 'insight', 'icon' => 'insights', 'svg' => 'ai-insights',
			'tagline' => 'Ask your pipeline anything in plain English.',
			'blurb'   => 'Plain-English questions about pipeline and team performance.',
			'intro'   => 'Ask questions such as "which industry converts best?" and get an answer built from your own data, with the numbers to back it up.',
			'points'  => array(
				array( 'Plain English', 'No filters or formulas. Just ask.' ),
				array( 'Your data only', 'Answers come from your pipeline, calls and campaigns.' ),
				array( 'Actionable', 'Each answer ends with a suggested next step.' ),
				array( 'Admin controlled', 'Choose who can see and use insights across the workspace.' ),
			),
			'roles'   => array( 'Admins', 'Managers' ),
		),
		// ── Workspace ─────────────────────────────────────────
		'team'                => array(
			'name' => 'Team & roles', 'group' => 'workspace', 'icon' => 'team', 'svg' => 'team',
			'tagline' => 'The right access for every rep, manager and admin.',
			'blurb'   => 'Invite people and give each role exactly the access it needs.',
			'intro'   => 'Invite your team and give each role exactly the access it needs. Reps see their own work, managers see the team, admins run the workspace.',
			'points'  => array(
				array( 'Three clear roles', 'Rep, manager and admin cover almost every team shape.' ),
				array( 'Invite in seconds', 'Add people by email and they are working in minutes.' ),
				array( 'Least-privilege by default', 'Sensitive areas are hidden from roles that do not need them.' ),
				array( 'Easy offboarding', 'Remove access and reassign leads in a few clicks.' ),
			),
			'roles'   => array( 'Admins' ),
		),
		'landing-studio'      => array(
			'name' => 'Landing Studio', 'group' => 'workspace', 'icon' => 'studio', 'svg' => 'landing-studio',
			'tagline' => 'Build pages that capture leads and book meetings.',
			'blurb'   => 'Campaign landing pages that feed the pipeline directly.',
			'intro'   => 'Launch campaign landing pages that capture leads, book meetings straight into diaries and feed your inbound inbox, without waiting for a developer.',
			'points'  => array(
				array( 'Drag-and-drop blocks', 'Assemble heroes, forms, proof and booking in minutes.' ),
				array( 'Built-in booking', 'Visitors pick a real slot in the right rep\'s calendar.' ),
				array( 'Straight into Stream', 'Every submission becomes a scored, routed lead.' ),
				array( 'Publish instantly', 'Go live with one click and update as often as you like.' ),
			),
			'roles'   => array( 'Admins', 'Managers' ),
		),
		'settings'            => array(
			'name' => 'Personal settings', 'group' => 'workspace', 'icon' => 'settings', 'svg' => 'settings',
			'tagline' => 'Make the workspace yours.',
			'blurb'   => 'Profile, avatar, notifications and availability.',
			'intro'   => 'Every person controls their own profile, avatar, notifications and availability, so the workspace fits how they like to work.',
			'points'  => array(
				array( 'Profile and avatar', 'Show your face and your details across the team.' ),
				array( 'Notifications', 'Choose what you hear about and how.' ),
				array( 'Availability', 'Set the hours you can be booked for meetings.' ),
				array( 'Email signature', 'Keep outbound mail looking sharp and consistent.' ),
			),
			'roles'   => array( 'Reps', 'Managers', 'Admins' ),
		),
	);
}

function stream_feature_groups() {
	return array(
		'sell'      => array( 'Sell', 'Everything a rep needs to find, call and close.' ),
		'engage'    => array( 'Engage', 'Outreach that runs while you work.' ),
		'insight'   => array( 'Insights', 'See what is working and keep everyone motivated.' ),
		'workspace' => array( 'Workspace', 'Admin, pages and personal setup.' ),
	);
}

function stream_solutions() {
	return array(
		'sales-reps'            => array( 'name' => 'Sales reps', 'group' => 'role', 'icon' => 'user', 'svg' => 'call-list', 'tagline' => 'Spend the day selling, not updating a CRM.', 'blurb' => 'A calm daily workflow built around the next conversation.', 'intro' => 'Stream gives every rep a prioritised queue, one-click calling and instant logging, so the day is mostly conversations.', 'points' => array( array( 'A queue that is ready', 'Wake up to a sorted list of the best leads to call.' ), array( 'Zero admin', 'Outcomes log themselves and the next lead appears.' ), array( 'Points and badges', 'Daily wins are visible, so momentum builds.' ) ), 'features' => array( 'call-list', 'calendar', 'leaderboard' ) ),
		'sales-managers'        => array( 'name' => 'Sales managers', 'group' => 'role', 'icon' => 'team', 'svg' => 'reports', 'tagline' => 'Coach with facts, not hunches.', 'blurb' => 'Team activity, pipeline and calendars in one view.', 'intro' => 'See what every rep is doing, where deals are stuck and who needs help, then keep the team motivated with live leaderboards.', 'points' => array( array( 'Live team view', 'Activity and pipeline by rep, updated as it happens.' ), array( 'Spot the stalls', 'Find deals that have gone quiet before they die.' ), array( 'Motivate', 'Leaderboards and frenzies keep energy high all week.' ) ), 'features' => array( 'reports', 'opportunities', 'leaderboard' ) ),
		'admins-revops'         => array( 'name' => 'Admins & RevOps', 'group' => 'role', 'icon' => 'settings', 'svg' => 'flow', 'tagline' => 'Automate the plumbing and keep data clean.', 'blurb' => 'Automations, roles and imports under your control.', 'intro' => 'Control imports, routing, scoring and permissions from one place, and let automations keep the data tidy.', 'points' => array( array( 'Rules, not chores', 'Routing, tagging and dedupe run on their own.' ), array( 'Safe permissions', 'Give each role exactly what it needs.' ), array( 'Clean data', 'Duplicates and gaps are fixed at the door.' ) ), 'features' => array( 'outbound', 'team', 'ai-insights' ) ),
		'founders-owners'       => array( 'name' => 'Founders & owners', 'group' => 'role', 'icon' => 'rocket', 'svg' => 'proposals', 'tagline' => 'Win the work without building a sales department.', 'blurb' => 'Proposals, contracts and pipeline without the overhead.', 'intro' => 'Run outreach, send proposals and get contracts signed from one tool, even when sales is only part of your job.', 'points' => array( array( 'One tool', 'Prospect, propose and sign without switching apps.' ), array( 'Look the part', 'Branded proposals and contracts clients trust.' ), array( 'Know the numbers', 'Pipeline and activity at a glance.' ) ), 'features' => array( 'proposals', 'outbound', 'opportunities' ) ),
		'agencies-studios'      => array( 'name' => 'Agencies & studios', 'group' => 'team', 'icon' => 'layers', 'svg' => 'proposals', 'tagline' => 'Proposal to handover without the chaos.', 'blurb' => 'Win projects and brief your delivery team in one flow.', 'intro' => 'Agencies live on proposals. Stream takes a project from first call to signed contract to a clean studio handover.', 'points' => array( array( 'Pitch-ready proposals', 'Beautiful, on-brand and quick to build.' ), array( 'Signed, then briefed', 'Questionnaire answers become the studio handover.' ), array( 'Pipeline you can trust', 'Wins appear when contracts are signed.' ) ), 'features' => array( 'proposals', 'landing-studio', 'campaigns' ) ),
		'professional-services' => array( 'name' => 'Professional services', 'group' => 'team', 'icon' => 'building', 'svg' => 'calendar', 'tagline' => 'Turn expertise into booked conversations.', 'blurb' => 'Outreach, meetings and proposals for advisers and consultancies.', 'intro' => 'Consultancies and advisers win on trust. Stream makes outreach consistent and follow-up reliable without feeling pushy.', 'points' => array( array( 'Consistent follow-up', 'Sequences keep you present without effort.' ), array( 'Easy booking', 'Prospects book straight into your diary.' ), array( 'Professional paperwork', 'Proposals and e-signatures that look the part.' ) ), 'features' => array( 'campaigns', 'calendar', 'proposals' ) ),
		'b2b-saas'              => array( 'name' => 'B2B SaaS', 'group' => 'team', 'icon' => 'code', 'svg' => 'inbound', 'tagline' => 'Run outbound and inbound from the same place.', 'blurb' => 'Score, route and follow up every lead fast.', 'intro' => 'Product-led or sales-led, speed to lead matters. Stream scores and routes enquiries instantly and keeps outbound moving.', 'points' => array( array( 'Speed to lead', 'Hot enquiries reach the right rep in seconds.' ), array( 'Outbound at scale', 'Queues and sequences for SDR teams.' ), array( 'Clear reporting', 'Know what each channel contributes.' ) ), 'features' => array( 'inbound', 'outbound', 'reports' ) ),
		'outbound-teams'        => array( 'name' => 'Outbound teams', 'group' => 'team', 'icon' => 'calls', 'svg' => 'outbound', 'tagline' => 'Built for people who live on the phone.', 'blurb' => 'High-volume calling with the admin removed.', 'intro' => 'SDRs and BDRs need volume with quality. Stream removes every click that is not a conversation.', 'points' => array( array( 'Zen calling', 'One lead, one screen, one flow.' ), array( 'Waves', 'Release volume in step with capacity.' ), array( 'Gamified', 'Points make the grind fun.' ) ), 'features' => array( 'call-list', 'waves', 'double-point-frenzy' ) ),
		'book-more-meetings'    => array( 'name' => 'Book more meetings', 'group' => 'goal', 'icon' => 'calendar', 'svg' => 'calendar', 'tagline' => 'More conversations, fewer clicks.', 'blurb' => 'Calling, sequences and booking pages working together.', 'intro' => 'Combine fast calling, automatic follow-up and self-serve booking so more prospects end up in your calendar.', 'points' => array( array( 'Call faster', 'Zen mode removes the friction.' ), array( 'Follow up automatically', 'Sequences never forget.' ), array( 'Let them book', 'Landing pages offer real slots.' ) ), 'features' => array( 'call-list', 'campaigns', 'landing-studio' ) ),
		'close-deals-faster'    => array( 'name' => 'Close deals faster', 'group' => 'goal', 'icon' => 'handshake', 'svg' => 'opportunities', 'tagline' => 'Shorten the path from proposal to signature.', 'blurb' => 'Proposals, contracts and e-signature on one link.', 'intro' => 'Remove delays between a yes and a signature with a single client link that takes people from proposal to signed contract.', 'points' => array( array( 'One link', 'Proposal, contract and onboarding together.' ), array( 'See engagement', 'Know when your proposal is viewed.' ), array( 'Sign in seconds', 'Draw or type a signature on any device.' ) ), 'features' => array( 'proposals', 'opportunities', 'calendar' ) ),
		'motivate-your-team'    => array( 'name' => 'Motivate your team', 'group' => 'goal', 'icon' => 'flame', 'svg' => 'leaderboard', 'tagline' => 'Make performance visible and fun.', 'blurb' => 'Leaderboards, badges and Double Point Frenzy.', 'intro' => 'Healthy competition lifts everyone. Points, badges and team-wide frenzies keep energy high without adding meetings.', 'points' => array( array( 'Live leaderboard', 'See the race as it happens.' ), array( 'Achievements', 'Celebrate habits as well as wins.' ), array( 'Frenzy moments', 'A signed deal fires up the whole team.' ) ), 'features' => array( 'leaderboard', 'achievements', 'double-point-frenzy' ) ),
		'forecast-with-confidence' => array( 'name' => 'Forecast with confidence', 'group' => 'goal', 'icon' => 'gauge', 'svg' => 'reports', 'tagline' => 'Know what is coming before it lands.', 'blurb' => 'Pipeline, conversion and market coverage in one place.', 'intro' => 'Combine pipeline stages, conversion rates and market coverage to see what next quarter really looks like.', 'points' => array( array( 'Honest pipeline', 'Won only counts when signed.' ), array( 'Conversion data', 'Know your stage-to-stage rates.' ), array( 'Market headroom', 'See how much room is left to grow.' ) ), 'features' => array( 'reports', 'market-size', 'ai-insights' ) ),
	);
}

function stream_solution_groups() {
	return array(
		'role' => array( 'By role', 'Stream for every seat at the table.' ),
		'team' => array( 'By team', 'Tuned for how different teams sell.' ),
		'goal' => array( 'By goal', 'Start from the outcome you want.' ),
	);
}

function stream_automations() {
	return array(
		'apollo-enrichment'     => array( 'name' => 'Apollo enrichment', 'icon' => 'sparkles', 'svg' => 'apollo-enrichment', 'tagline' => 'New leads arrive with phones and emails.', 'blurb' => 'Fill in direct dials, emails and roles automatically.', 'intro' => 'When a lead lands without contact details, Stream asks Apollo for phone numbers, emails and job titles and fills the gaps.', 'points' => array( array( 'Automatic lookups', 'Triggered when a lead is created or imported.' ), array( 'Verified details', 'Prefer direct dials and verified emails.' ), array( 'Syncs on a schedule', 'A background sync keeps records fresh.' ) ) ),
		'assignment-router'     => array( 'name' => 'Assignment router', 'icon' => 'route', 'svg' => 'assignment-router', 'tagline' => 'The right lead goes to the right rep.', 'blurb' => 'Route by territory, sector and capacity.', 'intro' => 'Rules decide who gets each lead so response times stay fast and workloads stay fair.', 'points' => array( array( 'Flexible rules', 'Territory, sector, source or round robin.' ), array( 'Capacity aware', 'Avoid overloading a single rep.' ), array( 'Instant', 'Assigned the moment the lead arrives.' ) ) ),
		'deduplication'         => array( 'name' => 'Deduplication', 'icon' => 'dedupe', 'svg' => 'deduplication', 'tagline' => 'One lead, one record.', 'blurb' => 'Catch duplicates on import and merge them cleanly.', 'intro' => 'Duplicates waste calls and annoy prospects. Stream recognises matches on import and merges them so every company appears once.', 'points' => array( array( 'Smart matching', 'Match on domain, phone and company name.' ), array( 'Clean merges', 'Keep the best data from every copy.' ), array( 'On every import', 'Applied automatically, every time.' ) ) ),
		'inbound-handler'       => array( 'name' => 'Inbound handler', 'icon' => 'inbound', 'svg' => 'inbound-handler', 'tagline' => 'Every enquiry processed in seconds.', 'blurb' => 'Score, tag, assign and notify without a human step.', 'intro' => 'A single pipeline takes each new enquiry through scoring, tagging, assignment and notification the moment it arrives.', 'points' => array( array( 'End to end', 'From form submit to owner notified.' ), array( 'Consistent', 'Every lead gets the same fast treatment.' ), array( 'Auditable', 'See exactly what ran and when.' ) ) ),
		'lead-scoring'          => array( 'name' => 'Lead scoring', 'icon' => 'gauge', 'svg' => 'lead-scoring', 'tagline' => 'Prioritise the leads most likely to buy.', 'blurb' => 'Score on fit and behaviour so reps start with the best.', 'intro' => 'Fit and behaviour combine into a single score, so reps always start with the leads most likely to convert.', 'points' => array( array( 'Fit and activity', 'Industry, size, opens and visits all count.' ), array( 'Transparent', 'See why a lead scored the way it did.' ), array( 'Tunable', 'Adjust weights as you learn.' ) ) ),
		'opportunity-creation'  => array( 'name' => 'Opportunity creation', 'icon' => 'opportunities', 'svg' => 'opportunity-creation', 'tagline' => 'Qualified leads become pipeline automatically.', 'blurb' => 'Create opportunities the moment a lead qualifies.', 'intro' => 'When a lead qualifies, Stream creates the opportunity with the right owner and stage, so nothing falls between the cracks.', 'points' => array( array( 'Triggered by outcomes', 'A meeting held or a call outcome can create the deal.' ), array( 'Pre-filled', 'Owner, company and contact carried over.' ), array( 'No double entry', 'Reps never retype what the system already knows.' ) ) ),
		'automated-reporting'   => array( 'name' => 'Automated reporting', 'icon' => 'reports', 'svg' => 'automation-reporting', 'tagline' => 'The numbers land in inboxes on schedule.', 'blurb' => 'Weekly summaries delivered without anyone building a report.', 'intro' => 'Scheduled summaries put the numbers in front of the right people at the right time.', 'points' => array( array( 'On a schedule', 'Every Monday at 8am, or whenever you choose.' ), array( 'Per audience', 'Managers see the team, reps see themselves.' ), array( 'Always current', 'Built from live data every time.' ) ) ),
		'smart-tagging'         => array( 'name' => 'Smart tagging', 'icon' => 'tag', 'svg' => 'smart-tagging', 'tagline' => 'Leads labelled by what they are and what they did.', 'blurb' => 'Tags applied from sector, location and behaviour.', 'intro' => 'Tags are applied automatically from sector, location and behaviour, making lists and reports easy to slice.', 'points' => array( array( 'Rule based', 'Apply tags from simple conditions.' ), array( 'Behavioural', 'Opened, replied, visited, booked.' ), array( 'Searchable', 'Filter any list or report by tag.' ) ) ),
		'webhook-orchestration' => array( 'name' => 'Webhook orchestration', 'icon' => 'webhook', 'svg' => 'webhook-orchestration', 'tagline' => 'Every system kept in step.', 'blurb' => 'Events flow between Stream and the tools around it.', 'intro' => 'Contacts and opportunities created or updated anywhere are kept in step everywhere, through reliable webhooks.', 'points' => array( array( 'Two-way', 'Changes flow in both directions.' ), array( 'Reliable', 'Retries and logging built in.' ), array( 'Extensible', 'Point any tool at a Stream webhook.' ) ) ),
	);
}

function stream_integrations() {
	return array(
		'apollo'         => array( 'name' => 'Apollo', 'icon' => 'sparkles', 'svg' => 'apollo-enrichment', 'tagline' => 'Prospect data on tap.', 'blurb' => 'Import lists and enrich leads with phones and emails.', 'intro' => 'Import prospect lists and enrich leads with direct dials, emails and roles straight from Apollo.', 'points' => array( array( 'List imports', 'Pull whole segments into your outbound queue.' ), array( 'Enrichment', 'Fill the gaps on any lead.' ), array( 'Scheduled sync', 'Keep data fresh in the background.' ) ) ),
		'gohighlevel'    => array( 'name' => 'GoHighLevel', 'icon' => 'webhook', 'svg' => 'webhook-orchestration', 'tagline' => 'Stay in step with your marketing CRM.', 'blurb' => 'Two-way sync of contacts and opportunities.', 'intro' => 'Contacts and opportunities stay in step between Stream and GoHighLevel through webhooks.', 'points' => array( array( 'Contacts', 'Created and updated both ways.' ), array( 'Opportunities', 'Stages stay aligned.' ), array( 'Inbound messages', 'Replies surface in Stream.' ) ) ),
		'3cx'            => array( 'name' => '3CX', 'icon' => 'headset', 'svg' => 'call-list', 'tagline' => 'Calling without leaving the page.', 'blurb' => 'Click to call and automatic call logging.', 'intro' => 'Click a number to call through your 3CX phone system and have the call logged against the lead automatically.', 'points' => array( array( 'Click to call', 'One click from the call list.' ), array( 'Auto-logging', 'Every call recorded on the lead.' ), array( 'Caller lookup', 'Inbound callers matched to leads.' ) ) ),
		'mailgun'        => array( 'name' => 'Mailgun', 'icon' => 'email', 'svg' => 'campaigns', 'tagline' => 'Reliable email delivery.', 'blurb' => 'Send campaigns and proposal notifications reliably.', 'intro' => 'Campaign emails and proposal notifications are delivered through Mailgun for dependable inbox placement.', 'points' => array( array( 'Campaign sends', 'Scheduled and throttled.' ), array( 'Transactional emails', 'Proposal and contract notifications.' ), array( 'Unsubscribe handling', 'Opt-outs respected everywhere.' ) ) ),
		'google-maps'    => array( 'name' => 'Google Maps lists', 'icon' => 'globe', 'svg' => 'outbound', 'tagline' => 'Local businesses, ready to call.', 'blurb' => 'Import local business exports into your queue.', 'intro' => 'Import exports from Google Maps to build localised outbound lists for trades, services and local industry.', 'points' => array( array( 'CSV import', 'Drop in an export and go.' ), array( 'Local focus', 'Target by town, county or radius.' ), array( 'Deduplicated', 'Matched against existing leads.' ) ) ),
		'webhooks-api'   => array( 'name' => 'Webhooks & API', 'icon' => 'code', 'svg' => 'orbit', 'tagline' => 'Connect anything else.', 'blurb' => 'Send and receive events from any system.', 'intro' => 'Send events out or receive them in from any system that can make an HTTP call.', 'points' => array( array( 'Inbound webhooks', 'Create leads from any form or tool.' ), array( 'Outbound events', 'Notify other systems when things change.' ), array( 'Signed requests', 'Verify every payload.' ) ) ),
	);
}

function stream_collections() {
	return array(
		'product'      => array( 'title' => 'Product', 'items' => stream_features() ),
		'solutions'    => array( 'title' => 'Solutions', 'items' => stream_solutions() ),
		'automations'  => array( 'title' => 'Automations', 'items' => stream_automations() ),
		'integrations' => array( 'title' => 'Integrations', 'items' => stream_integrations() ),
	);
}

function stream_hub_meta() {
	return array(
		'product'      => array( 'eyebrow' => 'Product', 'title' => 'One workspace for the whole sales flow', 'lead' => 'Eighteen connected modules that take a lead from first call to signed contract to studio handover.', 'svg' => 'hero', 'groups' => stream_feature_groups(), 'group_key' => 'group' ),
		'solutions'    => array( 'eyebrow' => 'Solutions', 'title' => 'Built for the way your team sells', 'lead' => 'Whatever your role, team or goal, Stream shapes itself around the work that matters.', 'svg' => 'leaderboard', 'groups' => stream_solution_groups(), 'group_key' => 'group' ),
		'automations'  => array( 'eyebrow' => 'Automations', 'title' => 'The busywork runs itself', 'lead' => 'Nine automations score, route, tag, enrich and report in the background so reps can sell.', 'svg' => 'flow', 'groups' => array(), 'group_key' => '' ),
		'integrations' => array( 'eyebrow' => 'Integrations', 'title' => 'Plays nicely with your stack', 'lead' => 'Stream connects to the tools you already use and to anything that can send a webhook.', 'svg' => 'orbit', 'groups' => array(), 'group_key' => '' ),
		'resources'    => array( 'eyebrow' => 'Resources', 'title' => 'Learn, follow along and get help', 'lead' => 'Guides, product updates, customer stories and support for getting the most out of Stream.', 'svg' => 'email-copy', 'groups' => array(), 'group_key' => '' ),
	);
}

function stream_resources() {
	return array(
		'blog'          => array( 'name' => 'Blog', 'icon' => 'news', 'svg' => 'reports', 'blurb' => 'Sales ideas, product thinking and team stories.', 'url' => 'blog' ),
		'guides'        => array( 'name' => 'Guides & playbooks', 'icon' => 'book', 'svg' => 'email-copy', 'blurb' => 'Step-by-step playbooks for outbound, follow-up and closing.', 'url' => 'resources/guides' ),
		'case-studies'  => array( 'name' => 'Case studies', 'icon' => 'star', 'svg' => 'opportunities', 'blurb' => 'How teams use Stream to book more and close faster.', 'url' => 'resources/case-studies' ),
		'changelog'     => array( 'name' => 'Changelog', 'icon' => 'rocket', 'svg' => 'waves', 'blurb' => 'Everything new in Stream, release by release.', 'url' => 'resources/changelog' ),
		'help-centre'   => array( 'name' => 'Help centre', 'icon' => 'lifebuoy', 'svg' => 'ai-insights', 'blurb' => 'Answers to the questions teams ask most.', 'url' => 'resources/help-centre' ),
	);
}

function stream_listings() {
	return array(
		'guides'       => array(
			array( 'The 5-minute morning call blitz', 'Playbook', '6 min read', 'call-list' ),
			array( 'A follow-up sequence that gets replies', 'Playbook', '8 min read', 'campaigns' ),
			array( 'Prioritising a list by industry', 'Guide', '5 min read', 'outbound' ),
			array( 'Writing proposals clients say yes to', 'Guide', '9 min read', 'proposals' ),
			array( 'Running your first outreach wave', 'Playbook', '7 min read', 'waves' ),
			array( 'Making a leaderboard fun, not toxic', 'Guide', '4 min read', 'leaderboard' ),
		),
		'case-studies' => array(
			array( 'Northwind Engineering doubled booked meetings', 'Engineering', '+112% meetings', 'call-list' ),
			array( 'Harbour Studio signs contracts in days, not weeks', 'Agency', '3 days to sign', 'proposals' ),
			array( 'Calder & Co turned a list into a pipeline', 'Consultancy', '£240k pipeline', 'outbound' ),
		),
		'help-centre'  => array(
			array( 'Getting started', 'Guide', '12 articles', 'settings' ),
			array( 'Calling and the call list', 'Guide', '9 articles', 'call-list' ),
			array( 'Proposals and contracts', 'Guide', '14 articles', 'proposals' ),
			array( 'Campaigns and email', 'Guide', '10 articles', 'campaigns' ),
			array( 'Teams and permissions', 'Guide', '7 articles', 'team' ),
			array( 'Billing and account', 'Guide', '6 articles', 'security' ),
		),
	);
}

function stream_changelog() {
	return array(
		array( '2026-10-13', 'v2.8', 'Signatures at the foot of every contract', array( 'Signed contracts now show the drawn signature with date, time and reference.', 'Clients can edit their selection until the contract is signed.', 'A new stepper in the top bar shows exactly where a proposal is.' ) ),
		array( '2026-10-06', 'v2.7', 'Proposal Hub goes end to end', array( 'Proposal, contract and onboarding questionnaire on one client link.', 'Studio handover page with all pricing stripped out.', 'Per-proposal style guide with live preview.' ) ),
		array( '2026-09-22', 'v2.6', 'Double Point Frenzy', array( 'Closing a deal doubles every point for 48 hours.', 'A sticky banner with a live countdown across the workspace.' ) ),
		array( '2026-09-08', 'v2.5', 'Outbound queue stacking', array( 'Pin priority industries to the top of the queue.', 'Faster imports with smarter duplicate detection.' ) ),
		array( '2026-08-25', 'v2.4', 'Campaign auto-enrolment', array( 'New leads that match your rules join sequences automatically.', 'Unsubscribe links on every send.' ) ),
	);
}

function stream_pricing() {
	return array(
		'tiers' => array(
			array( 'name' => 'Starter', 'monthly' => 29, 'annual' => 24, 'blurb' => 'For small teams getting organised.', 'cta' => 'Start free trial', 'features' => array( 'Call list and outbound queue', 'Opportunities board', 'Calendar and booking', 'Email copy library', 'Leaderboard and achievements' ) ),
			array( 'name' => 'Team', 'monthly' => 59, 'annual' => 49, 'blurb' => 'The full sales flow for growing teams.', 'cta' => 'Start free trial', 'popular' => true, 'features' => array( 'Everything in Starter', 'Proposal Hub with e-signature', 'Campaigns and auto-enrolment', 'Landing Studio', 'Reports and market size', 'Double Point Frenzy' ) ),
			array( 'name' => 'Scale', 'monthly' => 0, 'annual' => 0, 'blurb' => 'For larger teams with bespoke needs.', 'cta' => 'Talk to sales', 'custom' => true, 'features' => array( 'Everything in Team', 'AI insights', 'All nine automations', 'Priority support', 'Onboarding and training' ) ),
		),
		'faqs'  => array(
			array( 'Is there a free trial?', 'Yes. Every plan starts with a free trial and no card is needed to look around.' ),
			array( 'Can I change plan later?', 'Of course. Upgrade, downgrade or cancel whenever you like and billing adjusts automatically.' ),
			array( 'How does per-seat pricing work?', 'You pay for each person who logs in. Admins, managers and reps all count as seats.' ),
			array( 'Do you offer onboarding?', 'Team and Scale plans include guided onboarding so you are calling in days, not weeks.' ),
			array( 'Where is my data stored?', 'Data is hosted in secure cloud infrastructure and access is controlled by role.' ),
			array( 'Can I import my existing leads?', 'Yes. Bring lists from Apollo, Google Maps exports or any CSV, with duplicates caught automatically.' ),
		),
	);
}

function stream_testimonials() {
	return array(
		array( 'Calls went from a chore to a game. The leaderboard alone changed the energy on the floor.', 'Alex Morgan', 'Sales lead, Northwind Engineering', 'AM', '#8B5CF6' ),
		array( 'We send a proposal, the client signs, and the studio gets a clean brief. It just flows.', 'Jamie Kerr', 'Founder, Harbour Studio', 'JK', '#FF5C8A' ),
		array( 'Finally a tool that shows me what my team did today without chasing anyone.', 'Sam Rahman', 'Sales manager, Calder & Co', 'SR', '#19C8A0' ),
	);
}

function stream_logos() {
	return array( 'Northwind', 'Calder & Co', 'Fenwick', 'Harbour Studio', 'Brightwell', 'Oakline', 'Marlow Group', 'Tidewater' );
}

function stream_site_map() {
	$tree = array(
		array( 'slug' => 'home', 'title' => 'Home', 'template' => '', 'front' => true, 'content' => '' ),
	);
	foreach ( array(
		'product'      => array( 'Product', 'page-templates/template-hub.php', stream_features() ),
		'solutions'    => array( 'Solutions', 'page-templates/template-hub.php', stream_solutions() ),
		'automations'  => array( 'Automations', 'page-templates/template-hub.php', stream_automations() ),
		'integrations' => array( 'Integrations', 'page-templates/template-hub.php', stream_integrations() ),
	) as $slug => $def ) {
		$children = array();
		foreach ( $def[2] as $cslug => $entry ) {
			$children[] = array( 'slug' => $cslug, 'title' => $entry['name'], 'template' => 'page-templates/template-detail.php' );
		}
		$tree[] = array( 'slug' => $slug, 'title' => $def[0], 'template' => $def[1], 'children' => $children );
	}
	$tree[] = array( 'slug' => 'pricing', 'title' => 'Pricing', 'template' => 'page-templates/template-pricing.php' );
	$tree[] = array(
		'slug' => 'resources', 'title' => 'Resources', 'template' => 'page-templates/template-hub.php',
		'children' => array(
			array( 'slug' => 'guides', 'title' => 'Guides & playbooks', 'template' => 'page-templates/template-listing.php' ),
			array( 'slug' => 'case-studies', 'title' => 'Case studies', 'template' => 'page-templates/template-listing.php' ),
			array( 'slug' => 'changelog', 'title' => 'Changelog', 'template' => 'page-templates/template-changelog.php' ),
			array( 'slug' => 'help-centre', 'title' => 'Help centre', 'template' => 'page-templates/template-listing.php' ),
		),
	);
	$tree[] = array( 'slug' => 'blog', 'title' => 'Blog', 'template' => '', 'posts' => true );
	$tree[] = array( 'slug' => 'about', 'title' => 'About', 'template' => 'page-templates/template-about.php' );
	$tree[] = array( 'slug' => 'careers', 'title' => 'Careers', 'template' => '', 'content' => '<!-- wp:paragraph --><p>We are a small, focused team building the sales workspace we always wanted. We hire slowly and look after the people we hire.</p><!-- /wp:paragraph --><!-- wp:heading --><h2>Open roles</h2><!-- /wp:heading --><!-- wp:list --><ul><li>Senior full-stack engineer (remote, UK)</li><li>Product designer (remote, UK)</li><li>Customer success lead (remote, UK)</li></ul><!-- /wp:list --><!-- wp:paragraph --><p>Do not see your role? Email us and tell us how you would make Stream better.</p><!-- /wp:paragraph -->' );
	$tree[] = array( 'slug' => 'contact', 'title' => 'Contact', 'template' => 'page-templates/template-contact.php' );
	$tree[] = array( 'slug' => 'book-a-demo', 'title' => 'Book a demo', 'template' => 'page-templates/template-contact.php' );
	$tree[] = array( 'slug' => 'security', 'title' => 'Security', 'template' => 'page-templates/template-detail.php' );
	$tree[] = array( 'slug' => 'privacy-policy', 'title' => 'Privacy policy', 'template' => '', 'content' => '<!-- wp:paragraph --><p>This is placeholder privacy policy text. Replace it with your own policy before going live.</p><!-- /wp:paragraph -->' );
	$tree[] = array( 'slug' => 'terms', 'title' => 'Terms of service', 'template' => '', 'content' => '<!-- wp:paragraph --><p>This is placeholder terms text. Replace it with your own terms before going live.</p><!-- /wp:paragraph -->' );
	$tree[] = array( 'slug' => 'cookies', 'title' => 'Cookie notice', 'template' => '', 'content' => '<!-- wp:paragraph --><p>This is placeholder cookie text. Replace it with your own cookie notice before going live.</p><!-- /wp:paragraph -->' );
	return $tree;
}

// Extra detail entries that live outside the four collections.
function stream_extra_entries() {
	return array(
		'security' => array( 'name' => 'Security', 'icon' => 'shield', 'svg' => 'security', 'tagline' => 'Role-based access and a signed audit trail.', 'blurb' => 'Roles, audit trails and encryption.', 'intro' => 'Stream is built around least-privilege access, a clear audit trail and careful handling of client information.', 'points' => array( array( 'Role-based access', 'Reps, managers and admins only see what their role needs.' ), array( 'Signed audit trail', 'Every signature records who signed, when and from where.' ), array( 'Private client links', 'Proposals open only for approved email addresses with a password.' ), array( 'Encrypted in transit', 'All traffic is encrypted between your browser and Stream.' ) ) ),
	);
}
