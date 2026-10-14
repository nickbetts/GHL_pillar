<?php
/**
 * Template helpers, icons, SVG art, and the primary-menu blueprint.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function stream_defaults() {
	return array(
		'announce_on'   => 1,
		'announce_text' => 'New: Double Point Frenzy turns every closed deal into a team-wide boost.',
		'announce_link' => 'product/double-point-frenzy',
		'cta_text'      => 'Book a demo',
		'cta_link'      => 'book-a-demo',
		'login_text'    => 'Log in',
		'login_link'    => '#',
		'hero_title'    => 'Run your whole sales flow in one stream.',
		'hero_sub'      => 'Stream is the sales workspace that takes a lead from first call to signed contract to studio handover, with the leaderboard to keep everyone fired up.',
		'contact_email' => '',
		'linkedin'      => '#',
		'x'             => '#',
		'youtube'       => '#',
		'footer_blurb'  => 'The sales workspace for teams who want to spend their day in conversations.',
	);
}

function stream_opt( $key ) {
	$d = stream_defaults();
	return get_theme_mod( 'stream_' . $key, isset( $d[ $key ] ) ? $d[ $key ] : '' );
}

function stream_icons_map() {
	static $map = null;
	if ( null === $map ) {
		$file = get_theme_file_path( 'inc/icons.json' );
		$map  = is_readable( $file ) ? json_decode( file_get_contents( $file ), true ) : array();
	}
	return $map;
}

function stream_icon( $name, $size = 20, $class = '' ) {
	$map = stream_icons_map();
	if ( empty( $map[ $name ] ) ) {
		return '';
	}
	return sprintf(
		'<svg class="ico %1$s" width="%2$d" height="%2$d" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">%3$s</svg>',
		esc_attr( $class ),
		(int) $size,
		$map[ $name ] // phpcs:ignore WordPress.Security.EscapeOutput -- trusted theme asset.
	);
}

// Animated illustration. 'inline' keeps CSS/SMIL controllable; 'img' is lighter for big grids.
function stream_art( $name, $class = '', $mode = 'inline' ) {
	$path = get_theme_file_path( 'assets/svg/' . sanitize_file_name( $name ) . '.svg' );
	if ( ! is_readable( $path ) ) {
		return '';
	}
	if ( 'img' === $mode ) {
		return sprintf( '<span class="art art-img %s"><img src="%s" alt="" loading="lazy" decoding="async"></span>', esc_attr( $class ), esc_url( get_theme_file_uri( 'assets/svg/' . $name . '.svg' ) ) );
	}
	static $cache = array();
	if ( ! isset( $cache[ $name ] ) ) {
		$cache[ $name ] = preg_replace( '/<\?xml[^>]*>/', '', file_get_contents( $path ) );
	}
	return '<span class="art ' . esc_attr( $class ) . '" data-art>' . $cache[ $name ] . '</span>'; // phpcs:ignore WordPress.Security.EscapeOutput -- trusted theme asset.
}

function stream_page_url( $path ) {
	static $cache = array();
	$path = trim( (string) $path, '/' );
	if ( '' === $path || '#' === $path ) {
		return '#' === $path ? '#' : home_url( '/' );
	}
	if ( isset( $cache[ $path ] ) ) {
		return $cache[ $path ];
	}
	$page = get_page_by_path( $path );
	$cache[ $path ] = $page ? get_permalink( $page ) : home_url( '/' . $path . '/' );
	return $cache[ $path ];
}

// Resolve a link option that is either a path ('pricing'), a hash or a full URL.
function stream_link( $value ) {
	$value = (string) $value;
	if ( preg_match( '#^(https?:)?//#', $value ) || 0 === strpos( $value, '#' ) || 0 === strpos( $value, 'mailto:' ) ) {
		return $value;
	}
	return stream_page_url( $value );
}

function stream_all_entries() {
	$all = array();
	foreach ( stream_collections() as $ckey => $c ) {
		foreach ( $c['items'] as $slug => $entry ) {
			$all[ $ckey . '/' . $slug ] = $entry + array( 'collection' => $ckey, 'slug' => $slug );
		}
	}
	// Anything saved in the editor overrides the defaults.
	foreach ( array_keys( $all ) as $key ) {
		$page = get_page_by_path( $key );
		if ( $page ) {
			$all[ $key ] = stream_entry_meta( $page->ID ) + $all[ $key ];
		}
	}
	foreach ( stream_extra_entries() as $slug => $entry ) {
		$all[ $slug ] = $entry + array( 'collection' => '', 'slug' => $slug );
	}
	return $all;
}

// The data entry behind a detail page: by ancestor collection, or by bare slug.
function stream_entry_for_post( $post = null ) {
	$post = get_post( $post );
	if ( ! $post ) {
		return null;
	}
	$all = stream_all_entries();
	$parent = $post->post_parent ? get_post( $post->post_parent ) : null;
	if ( $parent ) {
		$key = $parent->post_name . '/' . $post->post_name;
		if ( isset( $all[ $key ] ) ) {
			return $all[ $key ];
		}
	}
	if ( isset( $all[ $post->post_name ] ) ) {
		return $all[ $post->post_name ];
	}
	// Child pages without a data entry (guides, releases, pricing tiers): build from meta alone.
	$meta = stream_entry_meta( $post->ID );
	if ( $meta && isset( $meta['tagline'] ) ) {
		return $meta + array( 'name' => $post->post_title, 'collection' => '', 'slug' => $post->post_name, 'points' => array() );
	}
	return null;
}

function stream_entry_url( $entry ) {
	$path = $entry['collection'] ? $entry['collection'] . '/' . $entry['slug'] : $entry['slug'];
	return stream_page_url( $path );
}

function stream_btn( $label, $href, $style = 'primary', $extra = '' ) {
	return sprintf(
		'<a class="btn btn-%s" href="%s"%s><span>%s</span>%s</a>',
		esc_attr( $style ),
		esc_url( $href ),
		$extra ? ' ' . $extra : '', // phpcs:ignore WordPress.Security.EscapeOutput
		esc_html( $label ),
		'link' === $style ? '' : stream_icon( 'arrow', 16, 'btn-arrow' ) // phpcs:ignore WordPress.Security.EscapeOutput
	);
}

function stream_section_head( $eyebrow, $title, $lead = '', $align = 'left' ) {
	echo '<div class="sec-head ' . esc_attr( $align ) . '" data-reveal>';
	if ( $eyebrow ) {
		echo '<span class="eyebrow">' . esc_html( $eyebrow ) . '</span>';
	}
	echo '<h2>' . wp_kses( $title, array( 'em' => array(), 'br' => array() ) ) . '</h2>';
	if ( $lead ) {
		echo '<p class="lead">' . esc_html( $lead ) . '</p>';
	}
	echo '</div>';
}

// Cards for any data collection. $items is slug => entry, $base is the parent page path.
function stream_entry_cards( $items, $base, $cols = 3, $art = false ) {
	echo '<div class="cards cols-' . (int) $cols . '">';
	foreach ( $items as $slug => $e ) {
		$url = isset( $e['url'] ) ? stream_page_url( $e['url'] ) : stream_page_url( $base . '/' . $slug );
		echo '<a class="card entry-card" href="' . esc_url( $url ) . '" data-reveal>';
		if ( $art ) {
			echo '<span class="card-art">' . stream_art( $e['svg'], '', 'img' ) . '</span>'; // phpcs:ignore WordPress.Security.EscapeOutput
		}
		echo '<span class="card-body">';
		if ( ! $art ) {
			echo '<span class="card-ico">' . stream_icon( $e['icon'], 18 ) . '</span>'; // phpcs:ignore WordPress.Security.EscapeOutput
		}
		echo '<strong>' . esc_html( $e['name'] ) . '</strong>';
		echo '<span>' . esc_html( $e['blurb'] ) . '</span>';
		echo '<span class="card-more">Learn more ' . stream_icon( 'arrow', 14 ) . '</span></span></a>'; // phpcs:ignore WordPress.Security.EscapeOutput
	}
	echo '</div>';
}

// Short one-liners for the mega menu (the full blurbs are too long for narrow columns).
function stream_menu_short() {
	return array(
		'call-list' => 'Zen-mode calling, one lead at a time', 'outbound' => 'Import, prioritise and assign lists', 'opportunities' => 'A pipeline that moves itself',
		'proposals' => 'Proposals, e-signature, handover', 'inbound' => 'Score, tag and route every enquiry', 'calendar' => 'Meetings, callbacks and booking',
		'campaigns' => 'Email sequences on autopilot', 'email-copy' => 'Proven templates, ready to send', 'waves' => 'Release outreach in batches',
		'reports' => 'Activity, queue and deal reports', 'leaderboard' => 'Weekly points and live rankings', 'double-point-frenzy' => 'Wins double everyone\'s points',
		'achievements' => 'Badges, streaks, milestones', 'market-size' => 'TAM, SAM and SOM by sector', 'ai-insights' => 'Ask your pipeline anything',
		'team' => 'Roles, permissions, invites', 'landing-studio' => 'Pages that book meetings', 'settings' => 'Profile, alerts, availability',
		'sales-reps' => 'More conversations, less admin', 'sales-managers' => 'Coach with facts, not hunches', 'admins-revops' => 'Automate the plumbing',
		'founders-owners' => 'Win work without a sales team', 'agencies-studios' => 'Proposal to handover, no chaos', 'professional-services' => 'Turn expertise into meetings',
		'b2b-saas' => 'Outbound and inbound together', 'outbound-teams' => 'Built for people on the phone', 'book-more-meetings' => 'More conversations, fewer clicks',
		'close-deals-faster' => 'Shorten proposal to signature', 'motivate-your-team' => 'Make performance fun', 'forecast-with-confidence' => 'Know what is coming',
	);
}

// ── Mega-menu blueprint (used by the demo importer to build an editable WP menu) ──
function stream_menu_blueprint() {
	$feat   = stream_features();
	$groups = stream_feature_groups();
	$map    = stream_menu_short();
	$short  = static function ( $s ) {
		return mb_strlen( $s ) > 44 ? rtrim( mb_substr( $s, 0, 41 ) ) . '...' : $s;
	};

	$layout = array(
		'Sell'               => array( 'sell' ),
		'Insights'           => array( 'insight' ),
		'Engage & workspace' => array( 'engage', 'workspace' ),
	);
	$product_cols = array();
	foreach ( $layout as $title => $keys ) {
		$items = array();
		foreach ( $feat as $slug => $e ) {
			if ( in_array( $e['group'], $keys, true ) ) {
				$items[] = array( 'product/' . $slug, $e['name'], $e['blurb'], $e['icon'], $e['svg'] );
			}
		}
		$product_cols[] = array( 'title' => $title, 'items' => $items );
	}

	$sol_cols = array();
	foreach ( stream_solution_groups() as $gk => $g ) {
		$items = array();
		foreach ( stream_solutions() as $slug => $e ) {
			if ( $e['group'] === $gk ) {
				$items[] = array( 'solutions/' . $slug, $e['name'], $e['blurb'], $e['icon'], $e['svg'] );
			}
		}
		$sol_cols[] = array( 'title' => $g[0], 'items' => $items );
	}

	$auto = stream_automations();
	$pick = static function ( $keys, $base ) use ( $auto, $short ) {
		$out = array();
		foreach ( $keys as $k ) {
			$out[] = array( $base . '/' . $k, $auto[ $k ]['name'], $auto[ $k ]['blurb'], $auto[ $k ]['icon'], $auto[ $k ]['svg'] );
		}
		return $out;
	};
	$int_items = array();
	foreach ( stream_integrations() as $slug => $e ) {
		$int_items[] = array( 'integrations/' . $slug, $e['name'], $e['blurb'], $e['icon'], $e['svg'] );
	}

	$res = stream_resources();
	return array(
		array(
			'title' => 'Product', 'path' => 'product', 'type' => 'mega', 'cols' => $product_cols,
			'feature' => array( 'path' => 'product/proposals', 'title' => 'Proposal Hub', 'desc' => 'Proposals, e-signature and onboarding on one client link.', 'svg' => 'proposals', 'cta' => 'Explore Proposal Hub' ),
		),
		array(
			'title' => 'Solutions', 'path' => 'solutions', 'type' => 'mega', 'cols' => $sol_cols,
			'feature' => array( 'path' => 'solutions/motivate-your-team', 'title' => 'Motivate your team', 'desc' => 'Leaderboards, badges and Double Point Frenzy.', 'svg' => 'leaderboard', 'cta' => 'See how' ),
		),
		array(
			'title' => 'Automations', 'path' => 'automations', 'type' => 'mega',
			'cols' => array(
				array( 'title' => 'Capture and route', 'items' => $pick( array( 'inbound-handler', 'assignment-router', 'deduplication', 'apollo-enrichment' ), 'automations' ) ),
				array( 'title' => 'Qualify and act', 'items' => $pick( array( 'lead-scoring', 'smart-tagging', 'opportunity-creation', 'automated-reporting', 'webhook-orchestration' ), 'automations' ) ),
				array( 'title' => 'Integrations', 'items' => $int_items ),
			),
			'feature' => array( 'path' => 'automations', 'title' => 'Nine automations', 'desc' => 'Score, route, tag, enrich and report without lifting a finger.', 'svg' => 'flow', 'cta' => 'See them all' ),
		),
		array(
			'title' => 'Resources', 'path' => 'resources', 'type' => 'mega',
			'cols' => array(
				array( 'title' => 'Learn', 'items' => array(
					array( 'blog', $res['blog']['name'], $res['blog']['blurb'], $res['blog']['icon'], $res['blog']['svg'] ),
					array( 'resources/guides', $res['guides']['name'], $res['guides']['blurb'], $res['guides']['icon'], $res['guides']['svg'] ),
					array( 'resources/case-studies', $res['case-studies']['name'], $res['case-studies']['blurb'], $res['case-studies']['icon'], $res['case-studies']['svg'] ),
				) ),
				array( 'title' => 'Support', 'items' => array(
					array( 'resources/help-centre', $res['help-centre']['name'], $res['help-centre']['blurb'], $res['help-centre']['icon'], $res['help-centre']['svg'] ),
					array( 'resources/changelog', $res['changelog']['name'], $res['changelog']['blurb'], $res['changelog']['icon'], $res['changelog']['svg'] ),
					array( 'book-a-demo', 'Book a demo', 'A 20-minute walkthrough, tailored to how your team sells.', 'calendar', 'calendar' ),
				) ),
			),
			'feature' => array( 'path' => 'resources/changelog', 'title' => 'What is new', 'desc' => 'Signatures at the foot of every contract, and more.', 'svg' => 'waves', 'cta' => 'Read the changelog' ),
		),
		array( 'title' => 'Pricing', 'path' => 'pricing', 'type' => 'link' ),
		array(
			'title' => 'Company', 'path' => '', 'type' => 'dropdown',
			'items' => array(
				array( 'about', 'About', 'Why we are building Stream.', 'building' ),
				array( 'careers', 'Careers', 'Join a small, focused team.', 'rocket' ),
				array( 'security', 'Security', 'How we protect your data.', 'shield' ),
				array( 'contact', 'Contact', 'Get in touch.', 'email' ),
			),
		),
	);
}

function stream_fallback_menu() {
	echo '<ul class="nav-list">';
	foreach ( array( 'product' => 'Product', 'solutions' => 'Solutions', 'automations' => 'Automations', 'resources' => 'Resources', 'pricing' => 'Pricing', 'about' => 'Company' ) as $path => $label ) {
		echo '<li class="nav-item"><a class="nav-link" href="' . esc_url( stream_page_url( $path ) ) . '">' . esc_html( $label ) . '</a></li>';
	}
	echo '</ul>';
}

function stream_footer_menu_fallback( $which ) {
	$map = array(
		'product'   => array( 'Call list' => 'product/call-list', 'Proposal Hub' => 'product/proposals', 'Opportunities' => 'product/opportunities', 'Campaigns' => 'product/campaigns', 'Leaderboard' => 'product/leaderboard', 'All features' => 'product' ),
		'solutions' => array( 'Sales reps' => 'solutions/sales-reps', 'Sales managers' => 'solutions/sales-managers', 'Agencies' => 'solutions/agencies-studios', 'B2B SaaS' => 'solutions/b2b-saas', 'All solutions' => 'solutions' ),
		'resources' => array( 'Blog' => 'blog', 'Guides' => 'resources/guides', 'Case studies' => 'resources/case-studies', 'Changelog' => 'resources/changelog', 'Help centre' => 'resources/help-centre' ),
		'company'   => array( 'About' => 'about', 'Careers' => 'careers', 'Security' => 'security', 'Contact' => 'contact', 'Pricing' => 'pricing' ),
	);
	echo '<ul class="foot-list">';
	foreach ( $map[ $which ] as $label => $path ) {
		echo '<li><a href="' . esc_url( stream_page_url( $path ) ) . '">' . esc_html( $label ) . '</a></li>';
	}
	echo '</ul>';
}
