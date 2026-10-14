<?php
/**
 * Inner page hero. Args: eyebrow, title (allows <em>), lead, art, crumbs [[label,url]...], actions (html), icon.
 */
$a = wp_parse_args(
	isset( $args ) ? $args : array(),
	array( 'eyebrow' => '', 'title' => '', 'lead' => '', 'art' => '', 'crumbs' => array(), 'actions' => '', 'icon' => '' )
);
?>
<section class="page-hero <?php echo $a['art'] ? 'has-art' : 'no-art'; ?>">
	<div class="container page-hero-grid">
		<div class="page-hero-copy">
			<?php if ( $a['crumbs'] ) : ?>
				<nav class="crumbs" aria-label="Breadcrumb">
					<a href="<?php echo esc_url( home_url( '/' ) ); ?>">Home</a>
					<?php foreach ( $a['crumbs'] as $c ) : ?>
						<?php echo stream_icon( 'chevron', 12, 'crumb-sep' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
						<?php if ( ! empty( $c[1] ) ) : ?>
							<a href="<?php echo esc_url( $c[1] ); ?>"><?php echo esc_html( $c[0] ); ?></a>
						<?php else : ?>
							<span><?php echo esc_html( $c[0] ); ?></span>
						<?php endif; ?>
					<?php endforeach; ?>
				</nav>
			<?php endif; ?>
			<?php if ( $a['eyebrow'] ) : ?>
				<span class="eyebrow"><?php echo $a['icon'] ? stream_icon( $a['icon'], 14 ) : ''; // phpcs:ignore WordPress.Security.EscapeOutput ?><?php echo esc_html( $a['eyebrow'] ); ?></span>
			<?php endif; ?>
			<h1><?php echo wp_kses( $a['title'], array( 'em' => array(), 'br' => array() ) ); ?></h1>
			<?php if ( $a['lead'] ) : ?>
				<p class="lead"><?php echo esc_html( $a['lead'] ); ?></p>
			<?php endif; ?>
			<?php if ( $a['actions'] ) : ?>
				<div class="hero-cta"><?php echo $a['actions']; // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
				<ul class="proof-chips">
					<li><?php echo stream_icon( 'check', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>20-minute walkthrough</li>
					<li><?php echo stream_icon( 'check', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>No card needed</li>
					<li><?php echo stream_icon( 'check', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>Import your leads in minutes</li>
				</ul>
			<?php endif; ?>
		</div>
		<?php if ( $a['art'] ) : ?>
			<div class="page-hero-art" data-reveal><div class="frame"><?php echo stream_art( $a['art'], 'art-hero' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div></div>
		<?php endif; ?>
	</div>
</section>
