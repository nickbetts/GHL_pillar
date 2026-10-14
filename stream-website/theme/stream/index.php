<?php
/**
 * Blog index and fallback loop.
 */
get_header();

$is_blog = is_home() && ! is_front_page();
get_template_part(
	'template-parts/page-hero',
	null,
	array(
		'eyebrow' => 'Blog',
		'icon'    => 'news',
		'title'   => $is_blog || is_home() ? 'Ideas for teams that <em>love to sell</em>' : esc_html( get_the_archive_title() ),
		'lead'    => 'Playbooks, product thinking and stories from the Stream team.',
		'crumbs'  => array( array( 'Blog' ) ),
	)
);
?>
<section class="section">
	<div class="container">
		<?php if ( have_posts() ) : ?>
			<div class="cards cols-3 posts">
				<?php
				while ( have_posts() ) :
					the_post();
					get_template_part( 'template-parts/post-card' );
				endwhile;
				?>
			</div>
			<nav class="pager"><?php the_posts_pagination( array( 'mid_size' => 1, 'prev_text' => '&larr;', 'next_text' => '&rarr;' ) ); ?></nav>
		<?php else : ?>
			<p class="center">Nothing here yet.</p>
		<?php endif; ?>
	</div>
</section>
<?php
get_template_part( 'template-parts/cta-band' );
get_footer();
