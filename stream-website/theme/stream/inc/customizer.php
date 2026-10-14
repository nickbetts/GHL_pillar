<?php
/**
 * Customizer controls and the contact / demo form handler.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'customize_register',
	function ( $wp_customize ) {
		$d = stream_defaults();
		$wp_customize->add_panel( 'stream', array( 'title' => __( 'Stream', 'stream' ), 'priority' => 30 ) );

		$sections = array(
			'header' => array(
				'title'  => __( 'Header and announcement', 'stream' ),
				'fields' => array(
					'announce_on'   => array( 'Show announcement bar', 'checkbox' ),
					'announce_text' => array( 'Announcement text', 'text' ),
					'announce_link' => array( 'Announcement link (page path or URL)', 'text' ),
					'cta_text'      => array( 'Header button text', 'text' ),
					'cta_link'      => array( 'Header button link (page path or URL)', 'text' ),
					'login_text'    => array( 'Log in text', 'text' ),
					'login_link'    => array( 'Log in URL (your Stream app)', 'text' ),
				),
			),
			'hero'   => array(
				'title'  => __( 'Home hero', 'stream' ),
				'fields' => array(
					'hero_title' => array( 'Headline', 'text' ),
					'hero_sub'   => array( 'Sub headline', 'textarea' ),
				),
			),
			'footer' => array(
				'title'  => __( 'Footer and contact', 'stream' ),
				'fields' => array(
					'footer_blurb'  => array( 'Footer blurb', 'textarea' ),
					'contact_email' => array( 'Form notifications email', 'text' ),
					'linkedin'      => array( 'LinkedIn URL', 'text' ),
					'x'             => array( 'X URL', 'text' ),
					'youtube'       => array( 'YouTube URL', 'text' ),
				),
			),
		);

		foreach ( $sections as $sid => $section ) {
			$wp_customize->add_section( 'stream_' . $sid, array( 'title' => $section['title'], 'panel' => 'stream' ) );
			foreach ( $section['fields'] as $key => $f ) {
				$wp_customize->add_setting(
					'stream_' . $key,
					array(
						'default'           => isset( $d[ $key ] ) ? $d[ $key ] : '',
						'sanitize_callback' => 'checkbox' === $f[1] ? 'absint' : ( 'textarea' === $f[1] ? 'sanitize_textarea_field' : 'sanitize_text_field' ),
					)
				);
				$wp_customize->add_control( 'stream_' . $key, array( 'label' => $f[0], 'section' => 'stream_' . $sid, 'type' => $f[1] ) );
			}
		}
	}
);

add_action( 'admin_post_nopriv_stream_contact', 'stream_handle_contact' );
add_action( 'admin_post_stream_contact', 'stream_handle_contact' );

function stream_handle_contact() {
	$back = wp_get_referer() ? wp_get_referer() : home_url( '/' );
	if ( ! isset( $_POST['stream_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['stream_nonce'] ) ), 'stream_contact' ) ) {
		wp_safe_redirect( add_query_arg( 'sent', 'error', $back ) );
		exit;
	}
	// Honeypot: real people leave this empty.
	if ( ! empty( $_POST['website'] ) ) {
		wp_safe_redirect( add_query_arg( 'sent', '1', $back ) );
		exit;
	}
	$name    = isset( $_POST['name'] ) ? sanitize_text_field( wp_unslash( $_POST['name'] ) ) : '';
	$email   = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
	$company = isset( $_POST['company'] ) ? sanitize_text_field( wp_unslash( $_POST['company'] ) ) : '';
	$team    = isset( $_POST['team_size'] ) ? sanitize_text_field( wp_unslash( $_POST['team_size'] ) ) : '';
	$message = isset( $_POST['message'] ) ? sanitize_textarea_field( wp_unslash( $_POST['message'] ) ) : '';
	$kind    = isset( $_POST['kind'] ) && 'demo' === $_POST['kind'] ? 'Demo request' : 'Contact enquiry';

	if ( '' === $name || ! is_email( $email ) ) {
		wp_safe_redirect( add_query_arg( 'sent', 'invalid', $back ) );
		exit;
	}
	$to   = stream_opt( 'contact_email' ) ? stream_opt( 'contact_email' ) : get_option( 'admin_email' );
	$body = "Type: {$kind}\nName: {$name}\nEmail: {$email}\nCompany: {$company}\nTeam size: {$team}\n\n{$message}\n";
	$ok   = wp_mail( $to, '[' . get_bloginfo( 'name' ) . '] ' . $kind . ' from ' . $name, $body, array( 'Reply-To: ' . $name . ' <' . $email . '>' ) );
	wp_safe_redirect( add_query_arg( 'sent', $ok ? '1' : 'error', $back ) );
	exit;
}
