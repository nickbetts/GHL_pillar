<?php
/**
 * Single blog post.
 */
get_header();
while ( have_posts() ) :
	the_post();
	$cats = get_the_category();
	?>
	<section class="page-hero no-art post-hero">
		<div class="hero-bg" aria-hidden="true"><span class="grid"></span><span class="orb o1"></span></div>
		<div class="container narrow page-hero-copy">
			<nav class="crumbs" aria-label="Breadcrumb">
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>">Home</a><?php echo stream_icon( 'chevron', 12, 'crumb-sep' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<a href="<?php echo esc_url( stream_page_url( 'blog' ) ); ?>">Blog</a>
			</nav>
			<?php if ( $cats ) : ?><span class="eyebrow"><?php echo esc_html( $cats[0]->name ); ?></span><?php endif; ?>
			<h1><?php the_title(); ?></h1>
			<div class="post-meta big">
				<span class="byline"><?php echo get_avatar( get_the_author_meta( 'ID' ), 32 ); // phpcs:ignore WordPress.Security.EscapeOutput ?><?php the_author(); ?></span>
				<time datetime="<?php echo esc_attr( get_the_date( 'c' ) ); ?>"><?php echo esc_html( get_the_date() ); ?></time>
				<span><?php echo esc_html( stream_reading_time() ); ?> min read</span>
			</div>
		</div>
	</section>
	<section class="section">
		<div class="container narrow">
			<?php if ( has_post_thumbnail() ) : ?><div class="post-feature"><?php the_post_thumbnail( 'large' ); ?></div><?php endif; ?>
			<article <?php post_class( 'prose' ); ?>>
				<?php the_content(); ?>
				<?php wp_link_pages(); ?>
			</article>
			<div class="post-nav">
				<?php previous_post_link( '<span class="pn prev">%link</span>', '&larr; %title' ); ?>
				<?php next_post_link( '<span class="pn next">%link</span>', '%title &rarr;' ); ?>
			</div>
			<?php
			if ( comments_open() || get_comments_number() ) {
				comments_template();
			}
			?>
		</div>
	</section>
	<?php
endwhile;
get_template_part( 'template-parts/cta-band' );
get_footer();
