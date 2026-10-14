<?php
/**
 * Search results.
 */
get_header();
get_template_part(
	'template-parts/page-hero',
	null,
	array(
		'eyebrow' => 'Search',
		'icon'    => 'filter',
		/* translators: %s: search query */
		'title'   => sprintf( 'Results for <em>%s</em>', esc_html( get_search_query() ) ),
		'lead'    => '',
		'crumbs'  => array( array( 'Search' ) ),
	)
);
?>
<section class="section">
	<div class="container">
		<form role="search" method="get" class="search-form" action="<?php echo esc_url( home_url( '/' ) ); ?>">
			<input type="search" name="s" value="<?php echo esc_attr( get_search_query() ); ?>" placeholder="Search Stream">
			<button class="btn btn-primary" type="submit"><span>Search</span></button>
		</form>
		<?php if ( have_posts() ) : ?>
			<div class="cards cols-3 posts">
				<?php
				while ( have_posts() ) :
					the_post();
					get_template_part( 'template-parts/post-card' );
				endwhile;
				?>
			</div>
			<nav class="pager"><?php the_posts_pagination(); ?></nav>
		<?php else : ?>
			<p class="center">No results. Try a different search.</p>
		<?php endif; ?>
	</div>
</section>
<?php get_footer(); ?>
