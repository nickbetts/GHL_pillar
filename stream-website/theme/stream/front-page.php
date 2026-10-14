<?php
/**
 * Home page.
 */
get_header();

$features = stream_features();
$auto     = stream_automations();
$ints     = stream_integrations();
$title    = stream_home( 'title' );
if ( false === stripos( $title, '<em>' ) ) {
	$w = explode( ' ', trim( $title ) );
	if ( count( $w ) > 3 ) {
		$tail  = array_splice( $w, -2 );
		$title = esc_html( implode( ' ', $w ) ) . ' <em>' . esc_html( implode( ' ', $tail ) ) . '</em>';
	}
}

$steps = array(
	array( 'Source', 'Load a prioritised queue', 'Import from Apollo, Google Maps or CSV and stack the best-fit sectors to the top. Duplicates are caught at the door.', 'outbound', 'product/outbound' ),
	array( 'Call', 'Talk to the right people', 'Zen-mode calling puts one lead on screen with click-to-call, notes and outcomes. The next lead loads on its own.', 'call-list', 'product/call-list' ),
	array( 'Qualify', 'Score and route every enquiry', 'Forms, landing pages and webhooks land in one inbox, scored, tagged and sent to the right rep in seconds.', 'inbound', 'product/inbound' ),
	array( 'Propose', 'Send proposals clients can sign', 'Branded proposals, a private client link and e-signature with a full audit trail, then an onboarding questionnaire.', 'proposals', 'product/proposals' ),
	array( 'Win', 'Deals move to Won by themselves', 'The moment the contract is signed the opportunity is won. No manual updates and no flattered pipeline.', 'opportunities', 'product/opportunities' ),
	array( 'Celebrate', 'Fire up the whole team', 'A closed deal triggers Double Point Frenzy: a banner, a countdown and double points for everyone for 48 hours.', 'frenzy', 'product/double-point-frenzy' ),
);

$bento = array(
	array( 'proposals', 'span-7', 'Proposal Hub', 'Proposals, e-signature and onboarding on one client link.', 'product/proposals', 'inline' ),
	array( 'frenzy', 'span-5', 'Double Point Frenzy', 'A signed contract doubles everyone\'s points for 48 hours.', 'product/double-point-frenzy', 'inline' ),
	array( 'call-list', 'span-4', 'Call list', 'One lead at a time. Everything on screen.', 'product/call-list', 'inline' ),
	array( 'reports', 'span-4', 'Reports', 'The numbers behind every call, meeting and deal.', 'product/reports', 'inline' ),
	array( 'ai-insights', 'span-4', 'AI insights', 'Ask your pipeline anything in plain English.', 'product/ai-insights', 'inline' ),
);

$roles = array(
	array( 'Reps', 'call-list', 'Spend the day selling', array( 'A queue that is ready every morning', 'One-click calling and instant logging', 'Points, badges and a live leaderboard' ), 'solutions/sales-reps' ),
	array( 'Managers', 'reports', 'Coach with facts, not hunches', array( 'Live activity and pipeline by rep', 'Spot stalled deals before they die', 'Calendars and capacity at a glance' ), 'solutions/sales-managers' ),
	array( 'Admins', 'team', 'Keep the plumbing running', array( 'Roles and permissions you control', 'Imports, routing and scoring rules', 'Nine automations that clean data for you' ), 'solutions/admins-revops' ),
);
?>

<section class="hero">
	<div class="hero-bg" aria-hidden="true"><span class="grid"></span><span class="orb o1"></span><span class="orb o2"></span><span class="orb o3"></span></div>
	<div class="container hero-grid">
		<div class="hero-copy">
			<a class="pill" href="<?php echo esc_url( stream_page_url( 'product/proposals' ) ); ?>" data-reveal>
				<span class="pill-tag">New</span>
				<span>Proposal Hub with e-signature</span>
				<?php echo stream_icon( 'arrow', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			</a>
			<h1 data-split><?php echo wp_kses( $title, array( 'em' => array() ) ); ?></h1>
			<p class="lead" data-reveal><?php echo esc_html( stream_home( 'sub' ) ); ?></p>
			<div class="hero-cta" data-reveal>
				<?php echo stream_btn( stream_opt( 'cta_text' ), stream_link( stream_opt( 'cta_link' ) ), 'primary big', 'data-magnetic' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<a class="btn btn-ghost big" href="#flow"><span>Take the tour</span><?php echo stream_icon( 'play', 14, 'btn-arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></a>
			</div>
			<ul class="hero-proof" data-reveal>
				<li><?php echo stream_icon( 'check', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> 20-minute walkthrough</li>
				<li><?php echo stream_icon( 'check', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> No card needed</li>
				<li><?php echo stream_icon( 'check', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> Import your leads in minutes</li>
			</ul>
		</div>
		<div class="hero-art" data-parallax><?php echo stream_art( 'hero', 'art-hero' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
	</div>
	<div class="logos" aria-label="Trusted by">
		<p>Trusted by sales teams at</p>
		<div class="marquee"><div class="marquee-track">
			<?php
			$logos_raw = '' !== get_post_meta( get_the_ID(), 'stream_home_logos', true ) ? get_post_meta( get_the_ID(), 'stream_home_logos', true ) : implode( ', ', stream_logos() );
			for ( $i = 0; $i < 2; $i++ ) : foreach ( stream_csv( $logos_raw ) as $l ) :
				?>
				<span class="logo-chip"><i></i><?php echo esc_html( $l ); ?></span>
			<?php endforeach; endfor; ?>
		</div></div>
	</div>
</section>

<section class="stats">
	<div class="container stats-grid">
		<?php
		$stats_raw = '' !== get_post_meta( get_the_ID(), 'stream_home_stats', true ) ? get_post_meta( get_the_ID(), 'stream_home_stats', true ) : "18 | | connected modules
9 | | background automations
48 | h | Double Point Frenzy
1 | | link from proposal to handover";
		foreach ( array_map( 'stream_split', stream_lines( $stats_raw ) ) as $s ) :
			?>
			<div class="stat" data-reveal>
				<strong><span data-counter="<?php echo (int) $s[0]; ?>">0</span><?php echo esc_html( isset( $s[1] ) ? $s[1] : '' ); ?></strong>
				<span><?php echo esc_html( isset( $s[2] ) ? $s[2] : '' ); ?></span>
			</div>
		<?php endforeach; ?>
	</div>
</section>

<section class="flow" id="flow" data-flow>
	<div class="container">
		<?php stream_section_head( 'The Stream', 'One continuous flow, <em>from first dial to signed deal</em>', 'Every step hands off to the next, so nothing gets dropped between tools.' ); ?>
		<div class="flow-grid">
			<ol class="flow-steps">
				<?php foreach ( $steps as $i => $s ) : ?>
					<li class="flow-step<?php echo 0 === $i ? ' is-active' : ''; ?>" data-step="<?php echo (int) $i; ?>">
						<span class="flow-num"><?php echo esc_html( str_pad( $i + 1, 2, '0', STR_PAD_LEFT ) ); ?></span>
						<div>
							<span class="flow-tag"><?php echo esc_html( $s[0] ); ?></span>
							<h3><?php echo esc_html( $s[1] ); ?></h3>
							<p><?php echo esc_html( $s[2] ); ?></p>
							<a class="link-arrow" href="<?php echo esc_url( stream_page_url( $s[4] ) ); ?>">Learn more <?php echo stream_icon( 'arrow', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></a>
						</div>
					</li>
				<?php endforeach; ?>
			</ol>
			<div class="flow-stage" aria-hidden="true">
				<div class="flow-sticky">
					<?php foreach ( $steps as $i => $s ) : ?>
						<div class="flow-art<?php echo 0 === $i ? ' is-active' : ''; ?>" data-art-for="<?php echo (int) $i; ?>"><?php echo stream_art( $s[3] ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
					<?php endforeach; ?>
				</div>
			</div>
		</div>
	</div>
</section>

<section class="bento">
	<div class="container">
		<?php stream_section_head( 'Features', 'Everything a sales team needs, <em>nothing it does not</em>', 'Eighteen modules that share one login, one lead record and one source of truth.' ); ?>
		<div class="bento-grid">
			<?php foreach ( $bento as $b ) : ?>
				<a class="bento-tile <?php echo esc_attr( $b[1] ); ?>" href="<?php echo esc_url( stream_page_url( $b[4] ) ); ?>" data-reveal data-glow>
					<span class="bento-art"><?php echo stream_art( $b[0] ); // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
					<span class="bento-copy"><strong><?php echo esc_html( $b[2] ); ?></strong><span><?php echo esc_html( $b[3] ); ?></span></span>
					<span class="bento-go"><?php echo stream_icon( 'arrow', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
				</a>
			<?php endforeach; ?>
		</div>
		<p class="center-cta" data-reveal><a class="btn btn-ghost" href="<?php echo esc_url( stream_page_url( 'product' ) ); ?>"><span>Explore all 18 features</span><?php echo stream_icon( 'arrow', 16, 'btn-arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></a></p>
	</div>
</section>

<section class="roles" data-tabs>
	<div class="container">
		<?php stream_section_head( 'Made for your team', 'A different view for <em>every role</em>', 'Reps, managers and admins each get exactly the workspace they need.' ); ?>
		<div class="tab-bar" role="tablist" data-reveal>
			<?php foreach ( $roles as $i => $r ) : ?>
				<button class="tab<?php echo 0 === $i ? ' is-active' : ''; ?>" role="tab" type="button" data-tab="<?php echo (int) $i; ?>" aria-selected="<?php echo 0 === $i ? 'true' : 'false'; ?>"><?php echo esc_html( $r[0] ); ?></button>
			<?php endforeach; ?>
		</div>
		<div class="tab-panels">
			<?php foreach ( $roles as $i => $r ) : ?>
				<div class="tab-panel<?php echo 0 === $i ? ' is-active' : ''; ?>" role="tabpanel" data-panel="<?php echo (int) $i; ?>">
					<div class="tab-copy">
						<h3><?php echo esc_html( $r[2] ); ?></h3>
						<ul class="ticks">
							<?php foreach ( $r[3] as $t ) : ?><li><?php echo stream_icon( 'check', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?><?php echo esc_html( $t ); ?></li><?php endforeach; ?>
						</ul>
						<a class="btn btn-primary" href="<?php echo esc_url( stream_page_url( $r[4] ) ); ?>"><span>Stream for <?php echo esc_html( strtolower( $r[0] ) ); ?></span><?php echo stream_icon( 'arrow', 16, 'btn-arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></a>
					</div>
					<div class="tab-art"><?php echo stream_art( $r[1] ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
				</div>
			<?php endforeach; ?>
		</div>
	</div>
</section>

<section class="frenzy-band">
	<div class="frenzy-ticker" aria-hidden="true"><div class="ticker-track" data-ticker>
		<?php for ( $i = 0; $i < 4; $i++ ) : ?>
			<span><?php echo stream_icon( 'flame', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> ALEX CLOSED A DEAL AND HAS TRIGGERED DOUBLE POINT FRENZY. YOU ALL HAVE <b data-countdown>47h 59m 12s</b> LEFT!</span>
		<?php endfor; ?>
	</div></div>
	<div class="container frenzy-grid">
		<div class="frenzy-copy" data-reveal>
			<span class="eyebrow on-dark"><?php echo stream_icon( 'flame', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>Gamification</span>
			<h2>Make winning <em>contagious</em></h2>
			<p>When one rep closes a deal, everyone feels it. A banner appears on every page, a live countdown starts and every point in the workspace is doubled for 48 hours.</p>
			<ul class="ticks on-dark">
				<li><?php echo stream_icon( 'check', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>Triggered by a signed contract, never a manual switch</li>
				<li><?php echo stream_icon( 'check', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>Live leaderboard, badges and streaks</li>
				<li><?php echo stream_icon( 'check', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>Celebrates the closer by name</li>
			</ul>
			<div class="frenzy-actions"><?php echo stream_btn( 'See Double Point Frenzy', stream_page_url( 'product/double-point-frenzy' ), 'light' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
		</div>
		<div class="frenzy-art" data-reveal><?php echo stream_art( 'frenzy' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
	</div>
</section>

<section class="auto">
	<div class="container auto-grid">
		<div class="auto-art" data-reveal><?php echo stream_art( 'flow' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
		<div class="auto-copy">
			<span class="eyebrow" data-reveal>Automations</span>
			<h2 data-reveal>The busywork <em>runs itself</em></h2>
			<p class="lead" data-reveal>Nine automations score, route, tag, enrich and report in the background, so your reps stay in conversations.</p>
			<div class="chip-cloud" data-reveal>
				<?php foreach ( $auto as $slug => $a ) : ?>
					<a class="chip-link" href="<?php echo esc_url( stream_page_url( 'automations/' . $slug ) ); ?>"><?php echo stream_icon( $a['icon'], 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?><?php echo esc_html( $a['name'] ); ?></a>
				<?php endforeach; ?>
			</div>
		</div>
	</div>
</section>

<section class="orbit-sec">
	<div class="container orbit-grid">
		<div class="orbit-copy">
			<span class="eyebrow" data-reveal>Integrations</span>
			<h2 data-reveal>Plays nicely with <em>your stack</em></h2>
			<p class="lead" data-reveal>Pull prospects from Apollo, call through 3CX, send through Mailgun and keep GoHighLevel in step. Anything else can talk to Stream through webhooks.</p>
			<div class="chip-cloud" data-reveal>
				<?php foreach ( $ints as $slug => $a ) : ?>
					<a class="chip-link" href="<?php echo esc_url( stream_page_url( 'integrations/' . $slug ) ); ?>"><?php echo stream_icon( $a['icon'], 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?><?php echo esc_html( $a['name'] ); ?></a>
				<?php endforeach; ?>
			</div>
		</div>
		<div class="orbit-art" data-reveal><?php echo stream_art( 'orbit' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
	</div>
</section>

<section class="proof">
	<div class="container">
		<?php stream_section_head( 'Loved by sales teams', 'Teams that <em>feel the difference</em>', '' ); ?>
		<div class="cards cols-3">
			<?php
			$testi_raw = '' !== get_post_meta( get_the_ID(), 'stream_home_testimonials', true ) ? get_post_meta( get_the_ID(), 'stream_home_testimonials', true ) : '';
			$quotes    = $testi_raw ? array_map( 'stream_split', stream_lines( $testi_raw ) ) : stream_testimonials();
			foreach ( $quotes as $t ) :
				$t += array( '', '', '', '', '#4463FF' );
				?>
				<figure class="card quote" data-reveal data-glow>
					<div class="stars" aria-label="5 out of 5"><?php echo str_repeat( stream_icon( 'star', 16 ), 5 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
					<blockquote><?php echo esc_html( $t[0] ); ?></blockquote>
					<figcaption><span class="avatar" style="background:<?php echo esc_attr( $t[4] ); ?>"><?php echo esc_html( $t[3] ); ?></span><span><strong><?php echo esc_html( $t[1] ); ?></strong><small><?php echo esc_html( $t[2] ); ?></small></span></figcaption>
				</figure>
			<?php endforeach; ?>
		</div>
		<p class="fineprint center" data-reveal>Placeholder testimonials. Replace with real customer quotes.</p>
	</div>
</section>

<?php get_template_part( 'template-parts/cta-band' ); ?>

<?php get_footer(); ?>
