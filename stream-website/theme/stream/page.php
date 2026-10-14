<?php
/**
 * Default page (legal pages, careers and anything built in the block editor).
 */
get_header();
while ( have_posts() ) :
	the_post();
	get_template_part( 'template-parts/page-hero', null, array( 'title' => esc_html( get_the_title() ), 'crumbs' => array( array( get_the_title() ) ) ) );
	?>
	<section class="section">
		<div class="container narrow">
			<article <?php post_class( 'prose' ); ?>>
				<?php the_content(); ?>
				<?php wp_link_pages(); ?>
			</article>
		</div>
	</section>
	<?php
endwhile;
get_template_part( 'template-parts/cta-band' );
get_footer();
