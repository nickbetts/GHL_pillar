<?php
/**
 * Stream theme bootstrap.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'STREAM_VERSION', '2.1.1' );

require_once get_template_directory() . '/inc/data.php';
require_once get_template_directory() . '/inc/helpers.php';
require_once get_template_directory() . '/inc/walker.php';
require_once get_template_directory() . '/inc/editor.php';
require_once get_template_directory() . '/inc/customizer.php';
require_once get_template_directory() . '/inc/setup.php';

add_action(
	'after_setup_theme',
	function () {
		load_theme_textdomain( 'stream', get_template_directory() . '/languages' );
		add_theme_support( 'title-tag' );
		add_theme_support( 'post-thumbnails' );
		add_theme_support( 'automatic-feed-links' );
		add_theme_support( 'responsive-embeds' );
		add_theme_support( 'wp-block-styles' );
		add_theme_support( 'align-wide' );
		add_theme_support( 'editor-styles' );
		add_theme_support( 'html5', array( 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script' ) );
		add_theme_support( 'custom-logo', array( 'height' => 60, 'width' => 240, 'flex-width' => true, 'flex-height' => true ) );
		add_editor_style( 'assets/css/editor.css' );
		add_image_size( 'stream-card', 720, 450, true );
		register_nav_menus(
			array(
				'primary'          => __( 'Primary (mega menu)', 'stream' ),
				'footer_product'   => __( 'Footer: Product', 'stream' ),
				'footer_solutions' => __( 'Footer: Solutions', 'stream' ),
				'footer_resources' => __( 'Footer: Resources', 'stream' ),
				'footer_company'   => __( 'Footer: Company', 'stream' ),
				'footer_legal'     => __( 'Footer: Legal', 'stream' ),
			)
		);
	}
);

add_action(
	'wp_enqueue_scripts',
	function () {
		$ver = STREAM_VERSION;
		wp_enqueue_style( 'stream-main', get_theme_file_uri( 'assets/css/main.css' ), array(), $ver );
		wp_enqueue_script( 'gsap', get_theme_file_uri( 'assets/js/gsap.min.js' ), array(), '3.15.0', array( 'in_footer' => true, 'strategy' => 'defer' ) );
		wp_enqueue_script( 'gsap-st', get_theme_file_uri( 'assets/js/ScrollTrigger.min.js' ), array( 'gsap' ), '3.15.0', array( 'in_footer' => true, 'strategy' => 'defer' ) );
		wp_enqueue_script( 'lenis', get_theme_file_uri( 'assets/js/lenis.min.js' ), array(), '1.3', array( 'in_footer' => true, 'strategy' => 'defer' ) );
		wp_enqueue_script( 'stream-main', get_theme_file_uri( 'assets/js/main.js' ), array( 'gsap', 'gsap-st', 'lenis' ), $ver, array( 'in_footer' => true, 'strategy' => 'defer' ) );
		if ( is_singular() && comments_open() && get_option( 'thread_comments' ) ) {
			wp_enqueue_script( 'comment-reply' );
		}
	}
);

add_action(
	'wp_head',
	function () {
		echo '<link rel="preload" href="' . esc_url( get_theme_file_uri( 'assets/fonts/geist-latin-wght-normal.woff2' ) ) . '" as="font" type="font/woff2" crossorigin>' . "\n";
		echo '<meta name="theme-color" content="#4463FF">' . "\n";
		echo '<script>document.documentElement.classList.add("js");</script>' . "\n";
	},
	1
);

add_filter(
	'body_class',
	function ( $c ) {
		$c[] = 'stream-theme';
		if ( stream_opt( 'announce_on' ) ) {
			$c[] = 'has-announce';
		}
		return $c;
	}
);

add_filter( 'excerpt_length', function () { return 24; } );
add_filter( 'excerpt_more', function () { return '&hellip;'; } );

// Primary nav helper used by header.php.
function stream_primary_nav() {
	wp_nav_menu(
		array(
			'theme_location' => 'primary',
			'container'      => false,
			'menu_class'     => 'nav-list',
			'items_wrap'     => '<ul class="%2$s">%3$s</ul>',
			'walker'         => new Stream_Mega_Walker(),
			'depth'          => 3,
			'fallback_cb'    => 'stream_fallback_menu',
		)
	);
}

function stream_footer_nav( $loc, $key ) {
	if ( has_nav_menu( $loc ) ) {
		wp_nav_menu( array( 'theme_location' => $loc, 'container' => false, 'menu_class' => 'foot-list', 'depth' => 1, 'fallback_cb' => false ) );
	} else {
		stream_footer_menu_fallback( $key );
	}
}

function stream_reading_time( $post = null ) {
	$words = str_word_count( wp_strip_all_tags( get_post_field( 'post_content', $post ) ) );
	return max( 1, (int) ceil( $words / 220 ) );
}
