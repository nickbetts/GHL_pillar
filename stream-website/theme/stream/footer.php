</main>

<footer class="site-footer">
	<div class="container foot-grid">
		<div class="foot-brand">
			<a class="brand" href="<?php echo esc_url( home_url( '/' ) ); ?>" aria-label="<?php echo esc_attr( get_bloginfo( 'name' ) ); ?>">
				<img src="<?php echo esc_url( get_theme_file_uri( 'assets/img/stream-logo.svg' ) ); ?>" alt="<?php echo esc_attr( get_bloginfo( 'name' ) ); ?>" width="132" height="32">
			</a>
			<p><?php echo esc_html( stream_opt( 'footer_blurb' ) ); ?></p>
			<div class="socials">
				<?php
				foreach ( array( 'linkedin' => 'LinkedIn', 'x' => 'X', 'youtube' => 'YouTube' ) as $k => $label ) {
					if ( stream_opt( $k ) ) {
						echo '<a href="' . esc_url( stream_opt( $k ) ) . '" aria-label="' . esc_attr( $label ) . '" rel="noopener">' . esc_html( $label ) . '</a>';
					}
				}
				?>
			</div>
		</div>
		<div class="foot-col"><h3>Product</h3><?php stream_footer_nav( 'footer_product', 'product' ); ?></div>
		<div class="foot-col"><h3>Solutions</h3><?php stream_footer_nav( 'footer_solutions', 'solutions' ); ?></div>
		<div class="foot-col"><h3>Resources</h3><?php stream_footer_nav( 'footer_resources', 'resources' ); ?></div>
		<div class="foot-col"><h3>Company</h3><?php stream_footer_nav( 'footer_company', 'company' ); ?></div>
	</div>
	<div class="container foot-bottom">
		<span>&copy; <?php echo esc_html( gmdate( 'Y' ) ); ?> <?php echo esc_html( get_bloginfo( 'name' ) ); ?>. All rights reserved.</span>
		<?php
		if ( has_nav_menu( 'footer_legal' ) ) {
			wp_nav_menu( array( 'theme_location' => 'footer_legal', 'container' => false, 'menu_class' => 'legal-list', 'depth' => 1 ) );
		}
		?>
	</div>
</footer>

<?php if ( ! is_page( array( 'contact', 'book-a-demo' ) ) ) : ?>
<div class="sticky-cta" data-sticky-cta>
	<span class="note"><span class="dot"></span><?php esc_html_e( 'Replies within one working day', 'stream' ); ?></span>
	<?php echo stream_btn( stream_opt( 'cta_text' ), stream_link( stream_opt( 'cta_link' ) ), 'primary' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
</div>
<?php endif; ?>

<?php wp_footer(); ?>
</body>
</html>
