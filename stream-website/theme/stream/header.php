<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<a class="skip-link" href="#main"><?php esc_html_e( 'Skip to content', 'stream' ); ?></a>

<?php if ( stream_opt( 'announce_on' ) && stream_opt( 'announce_text' ) ) : ?>
	<div class="announce">
		<a href="<?php echo esc_url( stream_link( stream_opt( 'announce_link' ) ) ); ?>">
			<span class="announce-dot"></span>
			<span><?php echo esc_html( stream_opt( 'announce_text' ) ); ?></span>
			<?php echo stream_icon( 'arrow', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
		</a>
	</div>
<?php endif; ?>

<header class="site-header" data-header>
	<div class="hdr-inner container">
		<a class="brand" href="<?php echo esc_url( home_url( '/' ) ); ?>" aria-label="<?php echo esc_attr( get_bloginfo( 'name' ) ); ?>">
			<?php if ( has_custom_logo() ) : ?>
				<?php the_custom_logo(); ?>
			<?php else : ?>
				<img src="<?php echo esc_url( get_theme_file_uri( 'assets/img/stream-logo.svg' ) ); ?>" alt="<?php echo esc_attr( get_bloginfo( 'name' ) ); ?>" width="132" height="32">
			<?php endif; ?>
		</a>

		<nav class="primary-nav" id="primary-nav" aria-label="<?php esc_attr_e( 'Primary', 'stream' ); ?>" data-nav>
			<?php stream_primary_nav(); ?>
			<div class="nav-mobile-cta">
				<a class="btn btn-ghost" href="<?php echo esc_url( stream_link( stream_opt( 'login_link' ) ) ); ?>"><span><?php echo esc_html( stream_opt( 'login_text' ) ); ?></span></a>
				<?php echo stream_btn( stream_opt( 'cta_text' ), stream_link( stream_opt( 'cta_link' ) ) ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			</div>
		</nav>

		<div class="hdr-actions">
			<a class="hdr-login" href="<?php echo esc_url( stream_link( stream_opt( 'login_link' ) ) ); ?>"><?php echo esc_html( stream_opt( 'login_text' ) ); ?></a>
			<?php echo stream_btn( stream_opt( 'cta_text' ), stream_link( stream_opt( 'cta_link' ) ) ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			<button class="burger" type="button" aria-label="<?php esc_attr_e( 'Menu', 'stream' ); ?>" aria-expanded="false" aria-controls="primary-nav" data-burger><span></span><span></span><span></span></button>
		</div>
	</div>
	<div class="progress" aria-hidden="true"><span data-progress></span></div>
</header>
<div class="mega-scrim" data-scrim></div>

<main id="main" class="site-main">
