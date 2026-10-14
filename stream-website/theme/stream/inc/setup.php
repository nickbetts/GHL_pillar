<?php
/**
 * Demo content importer: pages, hierarchy, templates, menus and sample posts.
 * Idempotent. Never overwrites existing page content.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function stream_create_pages( $nodes, $parent_id = 0, $parent_path = '', &$map = array(), &$log = array() ) {
	foreach ( $nodes as $node ) {
		$path     = ltrim( $parent_path . '/' . $node['slug'], '/' );
		$existing = 'home' === $node['slug'] && ! $parent_id ? get_page_by_path( 'home' ) : get_page_by_path( $path );
		if ( $existing ) {
			$id = $existing->ID;
			if ( in_array( $existing->post_status, array( 'draft', 'pending', 'auto-draft' ), true ) ) {
				wp_update_post( array( 'ID' => $id, 'post_status' => 'publish' ) );
			}
		} else {
			$id = wp_insert_post(
				array(
					'post_type'    => 'page',
					'post_status'  => 'publish',
					'post_title'   => $node['title'],
					'post_name'    => $node['slug'],
					'post_parent'  => $parent_id,
					'post_content' => isset( $node['content'] ) ? $node['content'] : '',
				)
			);
			if ( is_wp_error( $id ) || ! $id ) {
				continue;
			}
			if ( ! empty( $node['template'] ) ) {
				update_post_meta( $id, '_wp_page_template', $node['template'] );
			}
			update_post_meta( $id, '_stream_demo', 1 );
			$log[] = 'Created page: ' . $path;
		}
		$map[ 'home' === $node['slug'] && ! $parent_id ? '' : $path ] = $id;
		if ( ! empty( $node['front'] ) ) {
			update_option( 'show_on_front', 'page' );
			update_option( 'page_on_front', $id );
		}
		if ( ! empty( $node['posts'] ) ) {
			update_option( 'page_for_posts', $id );
		}
		if ( ! empty( $node['children'] ) ) {
			stream_create_pages( $node['children'], $id, $path, $map, $log );
		}
	}
	return $map;
}

function stream_menu_item( $menu_id, $title, $path, $page_map, $parent = 0, $classes = '', $desc = '', $attr = '' ) {
	$args = array(
		'menu-item-title'       => $title,
		'menu-item-parent-id'   => $parent,
		'menu-item-status'      => 'publish',
		'menu-item-classes'     => $classes,
		'menu-item-description' => $desc,
		'menu-item-attr-title'  => $attr,
	);
	if ( $path && isset( $page_map[ $path ] ) ) {
		$args['menu-item-type']      = 'post_type';
		$args['menu-item-object']    = 'page';
		$args['menu-item-object-id'] = $page_map[ $path ];
	} else {
		$args['menu-item-type'] = 'custom';
		$args['menu-item-url']  = '#';
	}
	return wp_update_nav_menu_item( $menu_id, 0, $args );
}

function stream_menu_reset( $name ) {
	$menu = wp_get_nav_menu_object( $name );
	if ( $menu ) {
		foreach ( (array) wp_get_nav_menu_items( $menu->term_id ) as $it ) {
			wp_delete_post( $it->ID, true );
		}
		return $menu->term_id;
	}
	return wp_create_nav_menu( $name );
}

function stream_build_menus( $page_map, $rebuild, &$log ) {
	$locations = get_theme_mod( 'nav_menu_locations', array() );
	$existing  = wp_get_nav_menu_object( 'Stream primary' );
	if ( $existing && ! $rebuild && wp_get_nav_menu_items( $existing->term_id ) ) {
		$log[] = 'Kept existing primary menu';
	} else {
		$menu_id = stream_menu_reset( 'Stream primary' );
		foreach ( stream_menu_blueprint() as $top ) {
			$cls = 'mega' === $top['type'] ? 'menu-mega' : ( 'dropdown' === $top['type'] ? 'menu-dropdown' : '' );
			$tid = stream_menu_item( $menu_id, $top['title'], $top['path'], $page_map, 0, $cls );
			if ( 'mega' === $top['type'] ) {
				foreach ( $top['cols'] as $col ) {
					$cid = stream_menu_item( $menu_id, $col['title'], '', $page_map, $tid, 'mega-col' );
					foreach ( $col['items'] as $it ) {
						stream_menu_item( $menu_id, $it[1], $it[0], $page_map, $cid, 'ico-' . $it[3] . ( isset( $it[4] ) ? ' svg-' . $it[4] : '' ), $it[2] );
					}
				}
				$f = $top['feature'];
				stream_menu_item( $menu_id, $f['title'], $f['path'], $page_map, $tid, 'mega-feature svg-' . $f['svg'], $f['desc'], $f['cta'] );
			} elseif ( 'dropdown' === $top['type'] ) {
				foreach ( $top['items'] as $it ) {
					stream_menu_item( $menu_id, $it[1], $it[0], $page_map, $tid, 'ico-' . $it[3], $it[2] );
				}
			}
		}
		$locations['primary'] = $menu_id;
		$log[]                = 'Built primary mega menu';
	}

	$foot = array(
		'footer_product'   => array( 'Stream footer: Product', array( 'Call list' => 'product/call-list', 'Proposal Hub' => 'product/proposals', 'Opportunities' => 'product/opportunities', 'Campaigns' => 'product/campaigns', 'Leaderboard' => 'product/leaderboard', 'All features' => 'product' ) ),
		'footer_solutions' => array( 'Stream footer: Solutions', array( 'Sales reps' => 'solutions/sales-reps', 'Sales managers' => 'solutions/sales-managers', 'Agencies & studios' => 'solutions/agencies-studios', 'B2B SaaS' => 'solutions/b2b-saas', 'All solutions' => 'solutions' ) ),
		'footer_resources' => array( 'Stream footer: Resources', array( 'Blog' => 'blog', 'Guides & playbooks' => 'resources/guides', 'Case studies' => 'resources/case-studies', 'Changelog' => 'resources/changelog', 'Help centre' => 'resources/help-centre' ) ),
		'footer_company'   => array( 'Stream footer: Company', array( 'About' => 'about', 'Careers' => 'careers', 'Security' => 'security', 'Contact' => 'contact', 'Pricing' => 'pricing' ) ),
	);
	foreach ( $foot as $loc => $def ) {
		$m = wp_get_nav_menu_object( $def[0] );
		if ( $m && ! $rebuild && wp_get_nav_menu_items( $m->term_id ) ) {
			$locations[ $loc ] = $m->term_id;
			continue;
		}
		$mid = stream_menu_reset( $def[0] );
		foreach ( $def[1] as $label => $path ) {
			stream_menu_item( $mid, $label, $path, $page_map );
		}
		$locations[ $loc ] = $mid;
	}
	$legal = wp_get_nav_menu_object( 'Stream legal' );
	$lid   = $legal ? $legal->term_id : wp_create_nav_menu( 'Stream legal' );
	if ( ! wp_get_nav_menu_items( $lid ) ) {
		foreach ( array( 'Privacy policy' => 'privacy-policy', 'Terms of service' => 'terms', 'Cookie notice' => 'cookies' ) as $label => $path ) {
			stream_menu_item( $lid, $label, $path, $page_map );
		}
	}
	$locations['footer_legal'] = $lid;
	set_theme_mod( 'nav_menu_locations', $locations );
}

function stream_create_posts( &$log ) {
	if ( get_posts( array( 'meta_key' => '_stream_demo', 'meta_value' => 1, 'post_type' => 'post', 'numberposts' => 1, 'fields' => 'ids' ) ) ) {
		return;
	}
	if ( ! function_exists( 'wp_create_category' ) ) {
		require_once ABSPATH . 'wp-admin/includes/taxonomy.php';
	}
	$cats  = array( 'Playbooks' => wp_create_category( 'Playbooks' ), 'Product' => wp_create_category( 'Product' ), 'Team' => wp_create_category( 'Team' ) );
	$posts = array(
		array( 'How to run a 25-minute call blitz that actually books meetings', 'Playbooks', 'A simple structure for a focused calling block: warm up, volume, and a clean five-minute log at the end.' ),
		array( 'Why a win should only count when the contract is signed', 'Product', 'Counting proposals as wins flatters the pipeline. Here is what changes when the signature is the finish line.' ),
		array( 'Make the leaderboard fun: three rules for healthy competition', 'Team', 'Points work best when they reward habits, celebrate wins out loud and reset often enough that everyone has a shot.' ),
		array( 'Your follow-up sequence is too long (and too short)', 'Playbooks', 'Most sequences stop just before the reply arrives. A look at pacing, tone and when to break up politely.' ),
		array( 'Introducing Double Point Frenzy', 'Product', 'The moment a deal is signed, every point in the workspace is doubled for 48 hours. Here is why we built it.' ),
		array( 'From proposal to handover without the chaos', 'Product', 'One link, three stages: proposal, contract and onboarding, ending in a clean handover page for the delivery team.' ),
	);
	foreach ( $posts as $i => $p ) {
		$pid = wp_insert_post(
			array(
				'post_title'    => $p[0],
				'post_status'   => 'publish',
				'post_excerpt'  => $p[2],
				'post_date'     => gmdate( 'Y-m-d H:i:s', time() - ( $i + 1 ) * 4 * DAY_IN_SECONDS ),
				'post_category' => array( $cats[ $p[1] ] ),
				'post_content'  => '<!-- wp:paragraph --><p>' . esc_html( $p[2] ) . '</p><!-- /wp:paragraph --><!-- wp:heading --><h2>The short version</h2><!-- /wp:heading --><!-- wp:paragraph --><p>This is placeholder article content. Replace it with your own writing, or delete these demo posts from Posts in the dashboard.</p><!-- /wp:paragraph --><!-- wp:list --><ul><li>Start with the outcome you want.</li><li>Make the first step small.</li><li>Measure it every week.</li></ul><!-- /wp:list -->',
			)
		);
		if ( $pid && ! is_wp_error( $pid ) ) {
			update_post_meta( $pid, '_stream_demo', 1 );
		}
	}
	$log[] = 'Created sample blog posts';
}


// Child pages make listing cards, releases and pricing tiers editable like any page.
function stream_seed_children( &$log ) {
	$make = static function ( $parent_path, $slug, $title, $meta, $order ) use ( &$log ) {
		$path = $parent_path . '/' . $slug;
		if ( get_page_by_path( $path ) ) {
			return;
		}
		$parent = get_page_by_path( $parent_path );
		if ( ! $parent ) {
			return;
		}
		$id = wp_insert_post(
			array(
				'post_type'    => 'page',
				'post_status'  => 'publish',
				'post_title'   => $title,
				'post_name'    => $slug,
				'post_parent'  => $parent->ID,
				'menu_order'   => $order,
				'post_content' => '',
			)
		);
		if ( is_wp_error( $id ) || ! $id ) {
			return;
		}
		foreach ( $meta as $k => $v ) {
			update_post_meta( $id, 'stream_' . $k, $v );
		}
		update_post_meta( $id, '_stream_demo', 1 );
		$log[] = 'Created page: ' . $path;
	};

	$slugify = static function ( $t ) {
		return sanitize_title( $t );
	};

	foreach ( stream_listings() as $slug => $items ) {
		$i = 0;
		foreach ( $items as $it ) {
			$make( 'resources/' . $slug, $slugify( $it[0] ), $it[0], array( 'kind' => $it[1], 'meta_line' => $it[2], 'svg' => $it[3] ), $i++ );
		}
	}
	foreach ( stream_changelog() as $i => $r ) {
		$make( 'resources/changelog', $slugify( $r[2] ), $r[2], array( 'version' => $r[1], 'release_date' => $r[0], 'points' => implode( "\n", $r[3] ) ), $i );
	}
	foreach ( stream_pricing()['tiers'] as $i => $t ) {
		$make( 'pricing', strtolower( $t['name'] ), $t['name'], array( 'price_monthly' => $t['monthly'], 'price_annual' => $t['annual'], 'blurb' => $t['blurb'], 'cta' => $t['cta'], 'popular' => ! empty( $t['popular'] ) ? 1 : 0, 'points' => implode( "\n", $t['features'] ) ), $i );
	}
}

function stream_run_setup( $rebuild = false ) {
	$log = array();
	$map = array();
	stream_create_pages( stream_site_map(), 0, '', $map, $log );

	foreach ( array( 'hello-world' => 'post', 'sample-page' => 'page' ) as $slug => $type ) {
		$posts = get_posts( array( 'name' => $slug, 'post_type' => $type, 'numberposts' => 1 ) );
		if ( $posts && $posts[0]->post_date === $posts[0]->post_modified ) {
			wp_trash_post( $posts[0]->ID );
			$log[] = 'Trashed default ' . $slug;
		}
	}

	if ( 'Just another WordPress site' === get_option( 'blogdescription' ) || '' === get_option( 'blogdescription' ) ) {
		update_option( 'blogdescription', 'The sales workspace for teams who live in conversations' );
	}
	if ( in_array( get_option( 'blogname' ), array( '', 'My WordPress Website', 'WordPress' ), true ) || 0 === strpos( (string) get_option( 'blogname' ), 'My WordPress' ) ) {
		update_option( 'blogname', 'Stream' );
	}
	if ( ! get_option( 'permalink_structure' ) ) {
		update_option( 'permalink_structure', '/%postname%/' );
	}

	stream_seed_children( $log );
	stream_build_menus( $map, $rebuild, $log );
	stream_create_posts( $log );
	flush_rewrite_rules();
	update_option( 'stream_setup_done', time() );
	return $log;
}

// Fresh sites get the demo on activation; existing sites get a prompt instead.
add_action(
	'after_switch_theme',
	function () {
		$count = (int) wp_count_posts( 'page' )->publish;
		if ( $count <= 1 && ! get_option( 'stream_setup_done' ) ) {
			stream_run_setup();
		} else {
			set_transient( 'stream_setup_prompt', 1, DAY_IN_SECONDS );
		}
	}
);

add_action(
	'admin_menu',
	function () {
		add_theme_page( __( 'Stream setup', 'stream' ), __( 'Stream setup', 'stream' ), 'manage_options', 'stream-setup', 'stream_setup_screen' );
	}
);

add_action(
	'admin_post_stream_setup',
	function () {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'stream_setup' ) ) {
			wp_die( esc_html__( 'Not allowed.', 'stream' ) );
		}
		$log = stream_run_setup( ! empty( $_POST['rebuild'] ) );
		set_transient( 'stream_setup_log', $log, 60 );
		delete_transient( 'stream_setup_prompt' );
		wp_safe_redirect( admin_url( 'themes.php?page=stream-setup&done=1' ) );
		exit;
	}
);

add_action(
	'admin_notices',
	function () {
		if ( get_transient( 'stream_setup_prompt' ) && current_user_can( 'manage_options' ) ) {
			echo '<div class="notice notice-info"><p><strong>Stream theme:</strong> import the demo pages, menus and sample posts? ';
			echo '<a class="button button-primary" href="' . esc_url( admin_url( 'themes.php?page=stream-setup' ) ) . '">Open Stream setup</a></p></div>';
		}
	}
);

function stream_setup_screen() {
	$log = get_transient( 'stream_setup_log' );
	echo '<div class="wrap"><h1>Stream setup</h1>';
	if ( ! empty( $_GET['done'] ) ) {
		echo '<div class="notice notice-success"><p>Demo content is ready. <a href="' . esc_url( home_url( '/' ) ) . '">View your site</a></p></div>';
		if ( $log ) {
			echo '<ul style="list-style:disc;margin-left:20px">';
			foreach ( $log as $l ) {
				echo '<li>' . esc_html( $l ) . '</li>';
			}
			echo '</ul>';
		}
	}
	echo '<p>Creates the full Stream site structure: home, product, solutions, automations, integrations, pricing, resources, company and legal pages, plus editable child pages for guides, case studies, changelog entries and pricing tiers, the mega menu, footer menus and sample blog posts. Existing pages are never overwritten. After import, edit anything under Pages: every page has a Stream content panel below the editor.</p>';
	echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
	wp_nonce_field( 'stream_setup' );
	echo '<input type="hidden" name="action" value="stream_setup">';
	echo '<p><label><input type="checkbox" name="rebuild" value="1"> Rebuild the menus from scratch (replaces menu items you changed)</label></p>';
	submit_button( __( 'Import demo content', 'stream' ) );
	echo '</form>';
	echo '<p>Customise colours, header buttons, hero copy and footer under <a href="' . esc_url( admin_url( 'customize.php' ) ) . '">Appearance &rarr; Customize &rarr; Stream</a>.</p></div>';
}
