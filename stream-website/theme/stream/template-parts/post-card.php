<?php
/**
 * Blog card.
 */
$cats = get_the_category();
?>
<article id="post-<?php the_ID(); ?>" <?php post_class( 'card post-card' ); ?> data-reveal>
	<a class="post-thumb" href="<?php the_permalink(); ?>" tabindex="-1" aria-hidden="true">
		<?php if ( has_post_thumbnail() ) : ?>
			<?php the_post_thumbnail( 'stream-card' ); ?>
		<?php else : ?>
			<?php
			$arts = array( 'call-list', 'proposals', 'leaderboard', 'campaigns', 'reports', 'waves', 'opportunities', 'email-copy' );
			echo stream_art( $arts[ get_the_ID() % count( $arts ) ], '', 'img' ); // phpcs:ignore WordPress.Security.EscapeOutput
			?>
		<?php endif; ?>
	</a>
	<div class="post-body">
		<div class="post-meta">
			<?php if ( $cats ) : ?><span class="tag"><?php echo esc_html( $cats[0]->name ); ?></span><?php endif; ?>
			<time datetime="<?php echo esc_attr( get_the_date( 'c' ) ); ?>"><?php echo esc_html( get_the_date() ); ?></time>
			<span><?php echo esc_html( stream_reading_time() ); ?> min read</span>
		</div>
		<h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
		<p><?php echo esc_html( wp_strip_all_tags( get_the_excerpt() ) ); ?></p>
	</div>
</article>
