<?php
/**
 * Rotated marquee tape between sections. Args: items (array), alt (bool).
 */
$a = wp_parse_args(
	isset( $args ) ? $args : array(),
	array( 'items' => array( 'Call', 'Meet', 'Propose', 'Sign', 'Hand over', 'Win' ), 'alt' => false )
);
?>
<div class="ribbon<?php echo $a['alt'] ? ' alt' : ''; ?>" aria-hidden="true">
	<div class="ticker-track">
		<?php for ( $i = 0; $i < 4; $i++ ) : foreach ( $a['items'] as $it ) : ?>
			<span><?php echo esc_html( $it ); ?></span><b>·</b>
		<?php endforeach; endfor; ?>
	</div>
</div>
