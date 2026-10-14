<?php
/**
 * Home page.
 */
get_header();

$all   = stream_all_entries();
$auto  = stream_automations();
$ints  = stream_integrations();
$title = stream_home( 'title' );
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

$rows     = array( 'product/call-list', 'product/proposals', 'product/opportunities', 'product/campaigns' );
$skip     = array_merge( $rows, array( 'product/double-point-frenzy', 'product/settings' ) );
$more     = array_diff_key( stream_features(), array_flip( array_map( static function ( $k ) { return substr( $k, 8 ); }, $skip ) ) );
$group_of = stream_feature_groups();

$roles = array(
	array( 'Reps', 'call-list', 'Spend the day selling', array( 'A queue that is ready every morning', 'One-click calling and instant logging', 'Points, badges and a live leaderboard' ), 'solutions/sales-reps' ),
	array( 'Managers', 'reports', 'Coach with facts, not hunches', array( 'Live activity and pipeline by rep', 'Spot stalled deals before they die', 'Calendars and capacity at a glance' ), 'solutions/sales-managers' ),
	array( 'Admins', 'team', 'Keep the plumbing running', array( 'Roles and permissions you control', 'Imports, routing and scoring rules', 'Nine automations that clean data for you' ), 'solutions/admins-revops' ),
);

$logos_raw = '' !== get_post_meta( get_the_ID(), 'stream_home_logos', true ) ? get_post_meta( get_the_ID(), 'stream_home_logos', true ) : implode( ', ', stream_logos() );
$stats_raw = '' !== get_post_meta( get_the_ID(), 'stream_home_stats', true ) ? get_post_meta( get_the_ID(), 'stream_home_stats', true ) : "18 | | connected modules\n9 | | background automations\n48 | h | Double Point Frenzy\n1 | | link from proposal to handover";
$testi_raw = '' !== get_post_meta( get_the_ID(), 'stream_home_testimonials', true ) ? get_post_meta( get_the_ID(), 'stream_home_testimonials', true ) : '';
$quotes    = $testi_raw ? array_map( 'stream_split', stream_lines( $testi_raw ) ) : stream_testimonials();
?>

<section class="hero">
	<div class="container hero-top">
		<a class="hero-note" href="<?php echo esc_url( stream_page_url( 'product/proposals' ) ); ?>" data-reveal>
			<b>New</b><span>Proposal Hub with e-signature</span><?php echo stream_icon( 'arrow', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
		</a>
		<h1 data-split><?php echo wp_kses( $title, array( 'em' => array() ) ); ?></h1>
		<p class="lead" data-reveal><?php echo esc_html( stream_home( 'sub' ) ); ?></p>
		<div class="hero-cta" data-reveal>
			<?php echo stream_btn( stream_opt( 'cta_text' ), stream_link( stream_opt( 'cta_link' ) ), 'primary big' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			<a class="btn btn-ghost big" href="#flow"><span>Take the tour</span></a>
		</div>
		<ul class="hero-proof" data-reveal>
			<li><?php echo stream_icon( 'check', 15 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>20-minute walkthrough</li>
			<li><?php echo stream_icon( 'check', 15 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>No card needed</li>
			<li><?php echo stream_icon( 'check', 15 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>Import your leads in minutes</li>
		</ul>
	</div>
	<div class="container hero-stage">
		<div class="frame frame-hero" data-hero-frame><?php echo stream_art( 'hero', 'art-hero' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
	</div>
</section>

<section class="logos" aria-label="Trusted by">
	<div class="container">
		<p>Trusted by sales teams at</p>
		<div class="logo-row">
			<?php foreach ( stream_csv( $logos_raw ) as $l ) : ?><span class="logo-name"><?php echo esc_html( $l ); ?></span><?php endforeach; ?>
		</div>
	</div>
</section>

<section class="stats">
	<div class="container stats-grid">
		<?php foreach ( array_map( 'stream_split', stream_lines( $stats_raw ) ) as $s ) : ?>
			<div class="stat" data-reveal>
				<strong><span data-counter="<?php echo (int) $s[0]; ?>">0</span><?php echo esc_html( isset( $s[1] ) ? $s[1] : '' ); ?></strong>
				<span><?php echo esc_html( isset( $s[2] ) ? $s[2] : '' ); ?></span>
			</div>
		<?php endforeach; ?>
	</div>
</section>

<section class="flow" id="flow" data-flow>
	<div class="container">
		<?php stream_section_head( '01 / The Stream', 'One continuous flow, <em>from first dial to signed deal.</em>', 'Every step hands off to the next, so nothing gets dropped between tools.' ); ?>
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

<section class="section features">
	<div class="container">
		<?php stream_section_head( '02 / Features', 'Everything a sales team needs. <em>Nothing it does not.</em>', 'Eighteen modules that share one login, one lead record and one source of truth.' ); ?>
		<?php foreach ( $rows as $i => $key ) :
			if ( empty( $all[ $key ] ) ) { continue; }
			$e   = $all[ $key ];
			$grp = isset( $group_of[ $e['group'] ] ) ? $group_of[ $e['group'] ][0] : 'Feature';
			?>
			<div class="frow<?php echo $i % 2 ? ' rev' : ''; ?>">
				<div class="frow-copy" data-reveal>
					<span class="eyebrow"><?php echo stream_icon( $e['icon'], 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?><?php echo esc_html( $grp . ' / ' . $e['name'] ); ?></span>
					<h3><?php echo esc_html( $e['tagline'] ); ?></h3>
					<p><?php echo esc_html( $e['intro'] ); ?></p>
					<ul class="ticks">
						<?php foreach ( array_slice( $e['points'], 0, 3 ) as $p ) : ?><li><?php echo stream_icon( 'check', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?><span><?php echo esc_html( $p[0] ); ?></span></li><?php endforeach; ?>
					</ul>
					<a class="link-arrow" href="<?php echo esc_url( stream_entry_url( $e ) ); ?>">Explore <?php echo esc_html( $e['name'] ); ?> <?php echo stream_icon( 'arrow', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></a>
				</div>
				<div class="frame" data-reveal><?php echo stream_art( $e['svg'] ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
			</div>
		<?php endforeach; ?>

		<div class="more-head" data-reveal style="margin:72px 0 28px"><span class="eyebrow">And everything else</span></div>
		<div class="index">
			<?php foreach ( $more as $slug => $e ) : ?>
				<a href="<?php echo esc_url( stream_page_url( 'product/' . $slug ) ); ?>" data-reveal>
					<span class="ix-ico"><?php echo stream_icon( $e['icon'], 20 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
					<strong><?php echo esc_html( $e['name'] ); ?></strong>
					<span class="ix-txt"><?php echo esc_html( $e['blurb'] ); ?></span>
				</a>
			<?php endforeach; ?>
		</div>
	</div>
</section>

<?php get_template_part( 'template-parts/ribbon' ); ?>

<section class="section alt roles" data-tabs>
	<div class="container">
		<?php stream_section_head( '03 / Your team', 'A different view for <em>every role.</em>', 'Reps, managers and admins each get exactly the workspace they need.' ); ?>
		<div class="tab-bar" role="tablist">
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
							<?php foreach ( $r[3] as $t ) : ?><li><?php echo stream_icon( 'check', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?><span><?php echo esc_html( $t ); ?></span></li><?php endforeach; ?>
						</ul>
						<a class="link-arrow" href="<?php echo esc_url( stream_page_url( $r[4] ) ); ?>">Stream for <?php echo esc_html( strtolower( $r[0] ) ); ?> <?php echo stream_icon( 'arrow', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></a>
					</div>
					<div class="frame"><?php echo stream_art( $r[1] ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
				</div>
			<?php endforeach; ?>
		</div>
	</div>
</section>

<section class="frenzy-band spot edge-slant-t edge-slant-b">
	<div class="frenzy-ticker" aria-hidden="true"><div class="ticker-track" data-ticker>
		<?php for ( $i = 0; $i < 4; $i++ ) : ?>
			<span><?php echo stream_icon( 'flame', 15 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>ALEX CLOSED A DEAL AND HAS TRIGGERED DOUBLE POINT FRENZY. YOU ALL HAVE <b data-countdown>47h 59m 12s</b> LEFT!</span>
		<?php endfor; ?>
	</div></div>
	<div class="container frenzy-grid">
		<div class="frenzy-copy" data-reveal>
			<span class="eyebrow on-dark">04 / Gamification</span>
			<h2>Make winning <em>contagious.</em></h2>
			<p>When one rep closes a deal, everyone feels it. A banner appears on every page, a live countdown starts and every point in the workspace is doubled for 48 hours.</p>
			<ul class="ticks on-dark" style="margin-top:24px">
				<li><?php echo stream_icon( 'check', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?><span>Triggered by a signed contract, never a manual switch</span></li>
				<li><?php echo stream_icon( 'check', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?><span>Live leaderboard, badges and streaks</span></li>
				<li><?php echo stream_icon( 'check', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?><span>Celebrates the closer by name</span></li>
			</ul>
			<div class="frenzy-actions"><?php echo stream_btn( 'See Double Point Frenzy', stream_page_url( 'product/double-point-frenzy' ), 'light' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
		</div>
		<div class="frame dark" data-reveal><?php echo stream_art( 'frenzy' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
	</div>
</section>

<section class="section plumb">
	<div class="container plumb-grid">
		<div>
			<?php stream_section_head( '05 / Automations', 'The busywork <em>runs itself.</em>', 'Nine automations score, route, tag, enrich and report in the background, so your reps stay in conversations.' ); ?>
			<ul class="rows" data-reveal>
				<?php foreach ( $auto as $slug => $a ) : ?>
					<li><a href="<?php echo esc_url( stream_page_url( 'automations/' . $slug ) ); ?>"><?php echo stream_icon( $a['icon'], 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?><span><?php echo esc_html( $a['name'] ); ?></span><?php echo stream_icon( 'arrow', 16, 'go' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></a></li>
				<?php endforeach; ?>
			</ul>
			<div class="works-with" data-reveal>
				<span>Works with</span>
				<?php foreach ( $ints as $slug => $a ) : ?><a href="<?php echo esc_url( stream_page_url( 'integrations/' . $slug ) ); ?>"><?php echo esc_html( $a['name'] ); ?></a><?php endforeach; ?>
			</div>
		</div>
		<div class="frame" data-reveal><?php echo stream_art( 'flow' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
	</div>
</section>

<section class="section alt proof">
	<div class="container">
		<?php stream_section_head( '06 / Customers', 'Teams that <em>feel the difference.</em>' ); ?>
		<div class="quotes">
			<?php
			foreach ( $quotes as $qi => $t ) :
				$t += array( '', '', '', '', '#4463FF' );
				?>
				<figure class="quote<?php echo 0 === $qi ? ' first' : ''; ?>" data-reveal>
					<blockquote><?php echo esc_html( $t[0] ); ?></blockquote>
					<figcaption><span class="avatar" style="background:<?php echo esc_attr( $t[4] ); ?>"><?php echo esc_html( $t[3] ); ?></span><span><strong><?php echo esc_html( $t[1] ); ?></strong><small><?php echo esc_html( $t[2] ); ?></small></span></figcaption>
				</figure>
			<?php endforeach; ?>
		</div>
		<p class="fineprint" data-reveal style="margin-top:20px">Placeholder testimonials. Replace with real customer quotes.</p>
	</div>
</section>

<?php get_template_part( 'template-parts/ribbon', null, array( 'items' => array( 'Calls today', 'Pipeline', 'Proposals', 'Contracts', 'Handovers', 'Wins' ), 'alt' => true ) ); ?>

<?php get_template_part( 'template-parts/cta-band' ); ?>

<?php get_footer(); ?>
