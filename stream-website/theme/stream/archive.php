<?php
/**
 * Archives (category, tag, author, date).
 */
get_header();
get_template_part(
	'template-parts/page-hero',
	null,
	array(
		'eyebrow' => 'Archive',
		'title'   => esc_html( wp_strip_all_tags( get_the_archive_title() ) ),
		'lead'    => wp_strip_all_tags( get_the_archive_description() ),
		'crumbs'  => array( array( 'Blog', stream_page_url( 'blog' ) ), array( wp_strip_all_tags( get_the_archive_title() ) ) ),
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
			<nav class="pager"><?php the_posts_pagination( array( 'prev_text' => '&larr;', 'next_text' => '&rarr;' ) ); ?></nav>
		<?php else : ?>
			<p class="center">No posts found.</p>
		<?php endif; ?>
	</div>
</section>
<?php get_footer(); ?>
