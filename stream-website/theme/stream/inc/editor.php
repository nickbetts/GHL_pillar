<?php
/**
 * Admin editing: every content field is editable on its page under "Stream content".
 * Page meta overrides the theme defaults (inc/data.php); empty fields fall back to defaults.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// ── Normalisers ──────────────────────────────────────────────
function stream_lines( $raw ) {
	return array_values( array_filter( array_map( 'trim', preg_split( '/\r?\n/', (string) $raw ) ) ) );
}
function stream_split( $line ) {
	return array_map( 'trim', explode( '|', (string) $line ) );
}
function stream_csv( $raw ) {
	return array_values( array_filter( array_map( 'trim', explode( ',', (string) $raw ) ) ) );
}

function stream_svg_options() {
	static $files = null;
	if ( null === $files ) {
		$files = array();
		foreach ( glob( get_theme_file_path( 'assets/svg/*.svg' ) ) ?: array() as $f ) {
			$files[] = basename( $f, '.svg' );
		}
		sort( $files );
	}
	return $files;
}

function stream_default_entry( $post ) {
	$post   = get_post( $post );
	$parent = $post && $post->post_parent ? get_post( $post->post_parent ) : null;
	$key    = $post ? ( $parent ? $parent->post_name . '/' . $post->post_name : $post->post_name ) : '';
	$all    = array();
	foreach ( stream_collections() as $ck => $c ) {
		foreach ( $c['items'] as $slug => $e ) {
			$all[ $ck . '/' . $slug ] = $e;
		}
	}
	foreach ( stream_extra_entries() as $slug => $e ) {
		$all[ $slug ] = $e;
	}
	return isset( $all[ $key ] ) ? $all[ $key ] : array();
}

// The live entry for a page: defaults merged with anything saved in the editor.
function stream_entry_meta( $post_id ) {
	$out = array();
	foreach ( array( 'tagline', 'blurb', 'intro', 'icon', 'svg', 'roles', 'features' ) as $k ) {
		$v = get_post_meta( $post_id, 'stream_' . $k, true );
		if ( '' !== $v ) {
			$out[ $k ] = 'roles' === $k || 'features' === $k ? stream_csv( $v ) : $v;
		}
	}
	$points = get_post_meta( $post_id, 'stream_points', true );
	if ( '' !== $points ) {
		$out['points'] = array_map( 'stream_split', stream_lines( $points ) );
	}
	return $out;
}

// ── Child-page driven content (listing cards, changelog, pricing tiers) ──────
function stream_child_pages( $parent_path ) {
	$parent = get_page_by_path( $parent_path );
	if ( ! $parent ) {
		return array();
	}
	return get_posts(
		array(
			'post_type'      => 'page',
			'post_parent'    => $parent->ID,
			'post_status'    => 'publish',
			'posts_per_page' => 50,
			'orderby'        => 'menu_order date',
			'order'          => 'ASC',
		)
	);
}

function stream_listing_items( $slug ) {
	$pages = stream_child_pages( 'resources/' . $slug );
	if ( ! $pages ) {
		$lists = stream_listings();
		return array_map(
			static function ( $it ) {
				return array( 'title' => $it[0], 'kind' => $it[1], 'meta' => $it[2], 'svg' => $it[3], 'url' => '#' );
			},
			isset( $lists[ $slug ] ) ? $lists[ $slug ] : array()
		);
	}
	return array_map(
		static function ( $p ) {
			return array(
				'title' => get_the_title( $p ),
				'kind'  => get_post_meta( $p->ID, 'stream_kind', true ),
				'meta'  => get_post_meta( $p->ID, 'stream_meta_line', true ),
				'svg'   => get_post_meta( $p->ID, 'stream_svg', true ) ?: 'reports',
				'url'   => get_permalink( $p ),
			);
		},
		$pages
	);
}

function stream_releases() {
	$pages = stream_child_pages( 'resources/changelog' );
	if ( ! $pages ) {
		return array_map(
			static function ( $r ) {
				return array( 'date' => $r[0], 'version' => $r[1], 'title' => $r[2], 'points' => $r[3] );
			},
			stream_changelog()
		);
	}
	$rows = array_map(
		static function ( $p ) {
			return array(
				'date'    => get_post_meta( $p->ID, 'stream_release_date', true ) ?: get_the_date( 'Y-m-d', $p ),
				'version' => get_post_meta( $p->ID, 'stream_version', true ),
				'title'   => get_the_title( $p ),
				'points'  => stream_lines( get_post_meta( $p->ID, 'stream_points', true ) ),
			);
		},
		$pages
	);
	usort( $rows, static function ( $a, $b ) { return strcmp( $b['date'], $a['date'] ); } );
	return $rows;
}

function stream_tiers() {
	$pages = stream_child_pages( 'pricing' );
	$defs  = stream_pricing();
	if ( ! $pages ) {
		return $defs['tiers'];
	}
	return array_map(
		static function ( $p ) {
			$popular = (bool) get_post_meta( $p->ID, 'stream_popular', true );
			return array(
				'name'     => get_the_title( $p ),
				'monthly'  => (int) get_post_meta( $p->ID, 'stream_price_monthly', true ),
				'annual'   => (int) get_post_meta( $p->ID, 'stream_price_annual', true ),
				'blurb'    => get_post_meta( $p->ID, 'stream_blurb', true ),
				'cta'      => get_post_meta( $p->ID, 'stream_cta', true ) ?: 'Start free trial',
				'popular'  => $popular,
				'custom'   => 0 === (int) get_post_meta( $p->ID, 'stream_price_monthly', true ),
				'features' => stream_lines( get_post_meta( $p->ID, 'stream_points', true ) ),
			);
		},
		$pages
	);
}

function stream_faqs() {
	$pricing = get_page_by_path( 'pricing' );
	$raw     = $pricing ? get_post_meta( $pricing->ID, 'stream_faqs', true ) : '';
	if ( '' === $raw ) {
		$defs = stream_pricing();
		return $defs['faqs'];
	}
	return array_map( 'stream_split', stream_lines( $raw ) );
}

// Home page overrides (front page meta beats Customizer, Customizer beats defaults).
function stream_home( $key ) {
	$front = (int) get_option( 'page_on_front' );
	$v     = $front ? get_post_meta( $front, 'stream_home_' . $key, true ) : '';
	if ( '' !== $v ) {
		return $v;
	}
	$d = stream_defaults();
	return isset( $d[ 'hero_' . $key ] ) ? stream_opt( 'hero_' . $key ) : '';
}

// ── Meta boxes ───────────────────────────────────────────────
add_action(
	'add_meta_boxes',
	function () {
		add_meta_box( 'stream-content', __( 'Stream content', 'stream' ), 'stream_content_box', 'page', 'normal', 'high' );
		$screen = get_current_screen();
		if ( $screen && 'page' === $screen->post_type && isset( $_GET['post'] ) && (int) $_GET['post'] === (int) get_option( 'page_on_front' ) ) {
			add_meta_box( 'stream-home', __( 'Stream home sections', 'stream' ), 'stream_home_box', 'page', 'normal', 'high' );
		}
	}
);

function stream_field_text( $id, $label, $value, $placeholder = '', $desc = '' ) {
	echo '<p><label for="' . esc_attr( $id ) . '" style="font-weight:600;display:block;margin-bottom:4px">' . esc_html( $label ) . '</label>';
	echo '<input type="text" class="widefat" id="' . esc_attr( $id ) . '" name="' . esc_attr( $id ) . '" value="' . esc_attr( $value ) . '"' . ( $placeholder ? ' placeholder="' . esc_attr( $placeholder ) . '"' : '' ) . '>';
	if ( $desc ) {
		echo '<span class="description">' . esc_html( $desc ) . '</span>';
	}
	echo '</p>';
}

function stream_field_area( $id, $label, $value, $rows = 4, $desc = '' ) {
	echo '<p><label for="' . esc_attr( $id ) . '" style="font-weight:600;display:block;margin-bottom:4px">' . esc_html( $label ) . '</label>';
	echo '<textarea class="widefat" rows="' . (int) $rows . '" id="' . esc_attr( $id ) . '" name="' . esc_attr( $id ) . '">' . esc_textarea( $value ) . '</textarea>';
	if ( $desc ) {
		echo '<span class="description">' . esc_html( $desc ) . '</span>';
	}
	echo '</p>';
}

function stream_field_select( $id, $label, $value, $options ) {
	echo '<p><label for="' . esc_attr( $id ) . '" style="font-weight:600;display:block;margin-bottom:4px">' . esc_html( $label ) . '</label><select id="' . esc_attr( $id ) . '" name="' . esc_attr( $id ) . '" class="widefat">';
	foreach ( $options as $o ) {
		echo '<option value="' . esc_attr( $o ) . '"' . selected( $value, $o, false ) . '>' . esc_html( $o ) . '</option>';
	}
	echo '</select></p>';
}

function stream_content_box( $post ) {
	wp_nonce_field( 'stream_meta', 'stream_meta_nonce' );
	$def = stream_default_entry( $post );
	$v   = static function ( $k ) use ( $post, $def ) {
		$m = get_post_meta( $post->ID, 'stream_' . $k, true );
		return '' !== $m ? $m : ( isset( $def[ $k ] ) ? $def[ $k ] : '' );
	};

	$template = get_post_meta( $post->ID, '_wp_page_template', true );
	$is_child = (bool) $post->post_parent;

	echo '<p style="margin-top:0">These fields feed the Stream templates. Only the ones this page&rsquo;s template uses are shown on the site; empty fields fall back to the theme defaults.</p>';

	stream_field_text( 'stream_tagline', 'Tagline (big headline)', $v( 'tagline' ) );
	stream_field_text( 'stream_blurb', 'Blurb (cards and menus)', $v( 'blurb' ) );
	stream_field_area( 'stream_intro', 'Intro (under the headline)', $v( 'intro' ), 3 );

	$points = '' !== get_post_meta( $post->ID, 'stream_points', true ) ? get_post_meta( $post->ID, 'stream_points', true ) : implode( "\n", array_map( static function ( $p ) { return implode( ' | ', $p ); }, isset( $def['points'] ) ? $def['points'] : array() ) );
	stream_field_area( 'stream_points', 'Bullet cards / feature list', $points, 6, 'One per line: "Title | Description" (or just "Line" for simple lists).' );

	stream_field_select( 'stream_icon', 'Icon', $v( 'icon' ), array_keys( stream_icons_map() ) );
	stream_field_select( 'stream_svg', 'Animated illustration', $v( 'svg' ) ?: 'reports', stream_svg_options() );
	stream_field_text( 'stream_roles', 'Used by (comma separated)', is_array( $v( 'roles' ) ) ? implode( ', ', $v( 'roles' ) ) : $v( 'roles' ), 'Reps, Managers' );
	stream_field_text( 'stream_features', 'Related features (comma separated slugs)', is_array( $v( 'features' ) ) ? implode( ', ', $v( 'features' ) ) : $v( 'features' ), 'call-list, proposals' );

	if ( $is_child ) {
		echo '<hr><p style="font-weight:700;margin-bottom:4px">Child-page fields (listings, changelog, pricing)</p>';
		stream_field_text( 'stream_kind', 'Kind / tag', get_post_meta( $post->ID, 'stream_kind', true ), 'Playbook' );
		stream_field_text( 'stream_meta_line', 'Meta line', get_post_meta( $post->ID, 'stream_meta_line', true ), '6 min read' );
		stream_field_text( 'stream_version', 'Version (changelog)', get_post_meta( $post->ID, 'stream_version', true ), 'v2.8' );
		stream_field_text( 'stream_release_date', 'Release date (changelog)', get_post_meta( $post->ID, 'stream_release_date', true ), '2026-10-13' );
		stream_field_text( 'stream_price_monthly', 'Price monthly in GBP (pricing tier; 0 = Custom)', get_post_meta( $post->ID, 'stream_price_monthly', true ) );
		stream_field_text( 'stream_price_annual', 'Price annual in GBP (pricing tier)', get_post_meta( $post->ID, 'stream_price_annual', true ) );
		stream_field_text( 'stream_cta', 'Button label (pricing tier)', get_post_meta( $post->ID, 'stream_cta', true ), 'Start free trial' );
		$popular = get_post_meta( $post->ID, 'stream_popular', true );
		echo '<p><label><input type="checkbox" name="stream_popular" value="1"' . checked( $popular, 1, false ) . '> Mark as most popular (pricing tier)</label></p>';
	}

	if ( 'page-templates/template-pricing.php' === $template ) {
		echo '<hr>';
		$defs  = stream_pricing();
		$faqs  = '' !== get_post_meta( $post->ID, 'stream_faqs', true ) ? get_post_meta( $post->ID, 'stream_faqs', true ) : implode( "\n", array_map( static function ( $f ) { return implode( ' | ', $f ); }, $defs['faqs'] ) );
		stream_field_area( 'stream_faqs', 'FAQs', $faqs, 8, 'One per line: "Question | Answer". Tiers are the child pages of Pricing.' );
	}
}

function stream_home_box( $post ) {
	$d  = stream_defaults();
	$v  = static function ( $k ) use ( $post, $d ) {
		$m = get_post_meta( $post->ID, 'stream_home_' . $k, true );
		return '' !== $m ? $m : ( isset( $d[ 'hero_' . $k ] ) ? $d[ 'hero_' . $k ] : '' );
	};
	$stats = '' !== get_post_meta( $post->ID, 'stream_home_stats', true ) ? get_post_meta( $post->ID, 'stream_home_stats', true ) : "18 | | connected modules\n9 | | background automations\n48 | h | Double Point Frenzy\n1 | | link from proposal to handover";
	$logos = '' !== get_post_meta( $post->ID, 'stream_home_logos', true ) ? get_post_meta( $post->ID, 'stream_home_logos', true ) : implode( ', ', stream_logos() );
	$testi = '' !== get_post_meta( $post->ID, 'stream_home_testimonials', true ) ? get_post_meta( $post->ID, 'stream_home_testimonials', true ) : implode( "\n", array_map( static function ( $t ) { return implode( ' | ', array_slice( $t, 0, 5 ) ); }, stream_testimonials() ) );

	stream_field_text( 'stream_home_title', 'Hero headline', $v( 'title' ) );
	stream_field_area( 'stream_home_sub', 'Hero sub headline', $v( 'sub' ), 3 );
	stream_field_area( 'stream_home_stats', 'Stats row', $stats, 4, 'One per line: "Number | Suffix | Label".' );
	stream_field_text( 'stream_home_logos', 'Logo strip names (comma separated)', $logos );
	stream_field_area( 'stream_home_testimonials', 'Testimonials', $testi, 5, 'One per line: "Quote | Name | Role | Initials | Hex colour".' );
}

add_action(
	'save_post_page',
	function ( $post_id ) {
		if ( ! isset( $_POST['stream_meta_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['stream_meta_nonce'] ) ), 'stream_meta' ) ) {
			return;
		}
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}
		if ( ! current_user_can( 'edit_page', $post_id ) ) {
			return;
		}
		$texts = array( 'tagline', 'blurb', 'icon', 'svg', 'roles', 'features', 'kind', 'meta_line', 'version', 'release_date', 'price_monthly', 'price_annual', 'cta', 'home_title', 'home_logos' );
		foreach ( $texts as $k ) {
			if ( isset( $_POST[ 'stream_' . $k ] ) ) {
				update_post_meta( $post_id, 'stream_' . $k, sanitize_text_field( wp_unslash( $_POST[ 'stream_' . $k ] ) ) );
			}
		}
		foreach ( array( 'intro', 'points', 'faqs', 'home_sub', 'home_stats', 'home_testimonials' ) as $k ) {
			if ( isset( $_POST[ 'stream_' . $k ] ) ) {
				update_post_meta( $post_id, 'stream_' . $k, sanitize_textarea_field( wp_unslash( $_POST[ 'stream_' . $k ] ) ) );
			}
		}
		update_post_meta( $post_id, 'stream_popular', ! empty( $_POST['stream_popular'] ) ? 1 : 0 );
	}
);
