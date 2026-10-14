<?php
/**
 * 404.
 */
get_header();
?>
<section class="notfound">
	<div class="hero-bg" aria-hidden="true"><span class="grid"></span><span class="orb o1"></span><span class="orb o2"></span></div>
	<div class="container nf-grid">
		<div class="nf-copy">
			<span class="eyebrow">Error 404</span>
			<h1>This page got <em>disconnected</em></h1>
			<p class="lead">The link may be old or the page may have moved. Here are some good places to reconnect.</p>
			<div class="hero-cta">
				<?php echo stream_btn( 'Back home', home_url( '/' ), 'primary big' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<a class="btn btn-ghost big" href="<?php echo esc_url( stream_page_url( 'product' ) ); ?>"><span>Explore the product</span></a>
			</div>
		</div>
		<div class="nf-art"><?php echo stream_art( 'lost' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
	</div>
</section>
<?php get_footer(); ?>
