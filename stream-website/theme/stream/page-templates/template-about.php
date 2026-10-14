<?php
/**
 * Template Name: Stream about
 * Description: Story, values and team.
 */
get_header();
the_post();

$values = array(
	array( 'target', 'Focus on conversations', 'Every screen exists to get a rep closer to a real conversation.' ),
	array( 'handshake', 'Honest numbers', 'A win is a signed contract. We would rather show a smaller truth than a bigger fiction.' ),
	array( 'flame', 'Make work fun', 'Competition and celebration are part of how great sales teams stay sharp.' ),
	array( 'shield', 'Respect the client', 'Private links, clear consent and tidy handovers. Clients should feel looked after.' ),
);
$team = array( array( 'Alex Morgan', 'Founder', 'AM', '#8B5CF6' ), array( 'Jamie Kerr', 'Product', 'JK', '#FF5C8A' ), array( 'Sam Rahman', 'Engineering', 'SR', '#19C8A0' ), array( 'Priya Nair', 'Customer success', 'PN', '#FFB020' ) );

get_template_part(
	'template-parts/page-hero',
	null,
	array(
		'eyebrow' => 'About',
		'icon'    => 'building',
		'title'   => 'We built the sales workspace <em>we always wanted</em>',
		'lead'    => 'Stream started inside a working sales team. Every feature exists because someone was tired of switching tabs, retyping data or chasing a signature.',
		'art'     => 'achievements',
		'crumbs'  => array( array( 'About' ) ),
	)
);
?>
<section class="section">
	<div class="container">
		<?php stream_section_head( 'What we believe', 'Four principles <em>behind the product</em>', '' ); ?>
		<div class="cards cols-4">
			<?php foreach ( $values as $v ) : ?>
				<div class="card point" data-reveal data-glow>
					<span class="card-ico big"><?php echo stream_icon( $v[0], 22 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
					<h3><?php echo esc_html( $v[1] ); ?></h3>
					<p><?php echo esc_html( $v[2] ); ?></p>
				</div>
			<?php endforeach; ?>
		</div>
	</div>
</section>

<section class="section">
	<div class="container">
		<?php stream_section_head( 'The team', 'People who <em>care about sales</em>', 'Placeholder team. Swap in your own people and photos.' ); ?>
		<div class="team-row">
			<?php foreach ( $team as $m ) : ?>
				<div class="member" data-reveal><span class="avatar xl" style="background:<?php echo esc_attr( $m[3] ); ?>"><?php echo esc_html( $m[2] ); ?></span><strong><?php echo esc_html( $m[0] ); ?></strong><small><?php echo esc_html( $m[1] ); ?></small></div>
			<?php endforeach; ?>
		</div>
		<?php if ( '' !== trim( wp_strip_all_tags( get_the_content() ) ) ) : ?><div class="prose hub-extra"><?php the_content(); ?></div><?php endif; ?>
	</div>
</section>
<?php get_template_part( 'template-parts/cta-band', null, array( 'title' => 'Want to help build it?', 'text' => 'We are a small team hiring carefully. See what is open.', 'primary' => array( 'See careers', stream_page_url( 'careers' ) ), 'secondary' => array( 'Contact us', stream_page_url( 'contact' ) ) ) ); ?>
<?php get_footer(); ?>
