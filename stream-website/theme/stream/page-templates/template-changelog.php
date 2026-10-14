<?php
/**
 * Template Name: Stream changelog
 * Description: Release timeline from the data model.
 */
get_header();
the_post();

get_template_part(
	'template-parts/page-hero',
	null,
	array(
		'eyebrow' => 'Resources',
		'icon'    => 'rocket',
		'title'   => 'What is <em>new in Stream</em>',
		'lead'    => 'Every release, newest first. Placeholder entries to replace with your own notes.',
		'art'     => 'waves',
		'crumbs'  => array( array( 'Resources', stream_page_url( 'resources' ) ), array( 'Changelog' ) ),
	)
);
?>
<section class="section">
	<div class="container narrow">
		<ol class="timeline">
			<?php foreach ( stream_changelog() as $rel ) : ?>
				<li class="tl-item" data-reveal>
					<div class="tl-meta"><time datetime="<?php echo esc_attr( $rel[0] ); ?>"><?php echo esc_html( date_i18n( 'j M Y', strtotime( $rel[0] ) ) ); ?></time><span class="tag"><?php echo esc_html( $rel[1] ); ?></span></div>
					<div class="tl-body card">
						<h3><?php echo esc_html( $rel[2] ); ?></h3>
						<ul class="ticks"><?php foreach ( $rel[3] as $line ) : ?><li><?php echo stream_icon( 'check', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?><?php echo esc_html( $line ); ?></li><?php endforeach; ?></ul>
					</div>
				</li>
			<?php endforeach; ?>
		</ol>
	</div>
</section>
<?php get_template_part( 'template-parts/cta-band' ); ?>
<?php get_footer(); ?>
