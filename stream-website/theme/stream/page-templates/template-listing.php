<?php
/**
 * Template Name: Stream listing
 * Description: Guides, case studies and help centre cards from the data model.
 */
get_header();
the_post();

$slug  = get_post_field( 'post_name' );
$items = stream_listing_items( $slug );
$leads = array(
	'guides'       => 'Practical playbooks you can run this week.',
	'case-studies' => 'Real teams, real numbers. Placeholder stories to replace with your own.',
	'help-centre'  => 'Everything you need to get set up and stay productive.',
);

get_template_part(
	'template-parts/page-hero',
	null,
	array(
		'eyebrow' => 'Resources',
		'title'   => esc_html( get_the_title() ),
		'lead'    => isset( $leads[ $slug ] ) ? $leads[ $slug ] : '',
		'crumbs'  => array( array( 'Resources', stream_page_url( 'resources' ) ), array( get_the_title() ) ),
	)
);
?>
<section class="section hub">
	<div class="container">
		<div class="cards cols-3">
			<?php foreach ( $items as $it ) : ?>
				<a class="card entry-card" href="<?php echo esc_url( $it['url'] ); ?>" data-reveal>
					<span class="card-art"><?php echo stream_art( $it['svg'], '', 'img' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
					<span class="card-body">
						<?php if ( $it['kind'] ) : ?><span class="tag"><?php echo esc_html( $it['kind'] ); ?></span><?php endif; ?>
						<strong><?php echo esc_html( $it['title'] ); ?></strong>
						<span><?php echo esc_html( $it['meta'] ); ?></span>
						<span class="card-more">Read more <?php echo stream_icon( 'arrow', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
					</span>
				</a>
			<?php endforeach; ?>
		</div>
		<?php if ( '' !== trim( wp_strip_all_tags( get_the_content() ) ) ) : ?><div class="prose hub-extra"><?php the_content(); ?></div><?php endif; ?>
	</div>
</section>
<?php get_template_part( 'template-parts/cta-band' ); ?>
<?php get_footer(); ?>
