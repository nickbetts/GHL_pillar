<?php
/**
 * Trust strip: logo row reused across inner pages (CRO). Args: label.
 */
$a      = wp_parse_args( isset( $args ) ? $args : array(), array( 'label' => 'Trusted by sales teams at' ) );
$front  = (int) get_option( 'page_on_front' );
$raw    = $front ? get_post_meta( $front, 'stream_home_logos', true ) : '';
$logos  = '' !== $raw ? stream_csv( $raw ) : stream_logos();
?>
<section class="logos mini" aria-label="<?php echo esc_attr( $a['label'] ); ?>">
	<div class="container">
		<p><?php echo esc_html( $a['label'] ); ?></p>
		<div class="logo-row">
			<?php foreach ( $logos as $l ) : ?><span class="logo-name"><?php echo esc_html( $l ); ?></span><?php endforeach; ?>
		</div>
	</div>
</section>
