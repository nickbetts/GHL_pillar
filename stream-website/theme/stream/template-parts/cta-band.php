<?php
/**
 * CTA band. Args: title, text, primary [label, link], secondary [label, link].
 */
$a = wp_parse_args(
	isset( $args ) ? $args : array(),
	array(
		'title'     => 'Ready to put your sales in the stream?',
		'text'      => 'See Stream with your own pipeline in a 20-minute walkthrough. No slides, just the product.',
		'primary'   => array( stream_opt( 'cta_text' ), stream_link( stream_opt( 'cta_link' ) ) ),
		'secondary' => array( 'See pricing', stream_page_url( 'pricing' ) ),
	)
);
?>
<section class="cta-band">
		<div class="cta-card spot edge-slant-t">
			<div class="cta-lines" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
			<h2><?php echo esc_html( $a['title'] ); ?></h2>
			<p><?php echo esc_html( $a['text'] ); ?></p>
			<div class="cta-actions">
				<?php echo stream_btn( $a['primary'][0], $a['primary'][1], 'light' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<?php if ( $a['secondary'] ) : ?>
					<a class="btn btn-outline-light" href="<?php echo esc_url( $a['secondary'][1] ); ?>"><span><?php echo esc_html( $a['secondary'][0] ); ?></span></a>
				<?php endif; ?>
			</div>
		</div>
</section>
