<?php
/**
 * Template Name: Stream pricing
 * Description: Pricing tiers with a monthly/annual toggle and FAQ. Edit the numbers in inc/data.php.
 */
get_header();
the_post();

$tiers = stream_tiers();
$faqs   = stream_faqs();

get_template_part(
	'template-parts/page-hero',
	null,
	array(
		'eyebrow' => 'Pricing',
		'icon'    => 'dollar',
		'title'   => 'Simple pricing that <em>grows with your team</em>',
		'lead'    => 'Per seat, no hidden extras. Every plan starts with a free trial. These prices are placeholders: edit them in the theme data file.',
		'crumbs'  => array( array( 'Pricing' ) ),
	)
);
?>
<section class="section pricing" data-billing>
	<div class="container">
		<div class="billing-toggle" role="group" aria-label="Billing period" data-reveal>
			<button type="button" class="is-active" data-period="monthly">Monthly</button>
			<button type="button" data-period="annual">Annual <span class="save">Save 17%</span></button>
		</div>
		<div class="tiers">
			<?php foreach ( $tiers as $t ) : ?>
				<div class="tier card<?php echo ! empty( $t['popular'] ) ? ' is-popular' : ''; ?>" data-reveal>
					<?php if ( ! empty( $t['popular'] ) ) : ?><span class="popular">Most popular</span><?php endif; ?>
					<h3><?php echo esc_html( $t['name'] ); ?></h3>
					<p class="tier-blurb"><?php echo esc_html( $t['blurb'] ); ?></p>
					<div class="price">
						<?php if ( ! empty( $t['custom'] ) ) : ?>
							<strong class="amount">Custom</strong>
						<?php else : ?>
							<strong class="amount">&pound;<span data-monthly="<?php echo (int) $t['monthly']; ?>" data-annual="<?php echo (int) $t['annual']; ?>"><?php echo (int) $t['monthly']; ?></span></strong>
							<span class="per">per seat / month</span>
						<?php endif; ?>
					</div>
					<?php echo stream_btn( $t['cta'], stream_link( stream_opt( 'cta_link' ) ), ! empty( $t['popular'] ) ? 'primary' : 'ghost' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					<ul class="ticks">
						<?php foreach ( $t['features'] as $f ) : ?><li><?php echo stream_icon( 'check', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?><?php echo esc_html( $f ); ?></li><?php endforeach; ?>
					</ul>
				</div>
			<?php endforeach; ?>
		</div>
		<ul class="guarantee" data-reveal>
			<li><?php echo stream_icon( 'shield', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>Free 14-day trial</li>
			<li><?php echo stream_icon( 'check', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>Cancel anytime</li>
			<li><?php echo stream_icon( 'check', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>Per-seat billing, no hidden extras</li>
			<li><?php echo stream_icon( 'check', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>Your data stays yours</li>
		</ul>
	</div>
</section>
<?php get_template_part( 'template-parts/logos' ); ?>

<section class="section faq">
	<div class="container narrow">
		<?php stream_section_head( 'FAQ', 'Questions, <em>answered</em>', '' ); ?>
		<div class="accordion">
			<?php foreach ( $faqs as $i => $f ) : ?>
				<details class="acc" data-reveal<?php echo 0 === $i ? ' open' : ''; ?>>
					<summary><span><?php echo esc_html( $f[0] ); ?></span><?php echo stream_icon( 'chevron', 18, 'acc-chev' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></summary>
					<p><?php echo esc_html( $f[1] ); ?></p>
				</details>
			<?php endforeach; ?>
		</div>
	</div>
</section>
<?php get_template_part( 'template-parts/cta-band' ); ?>
<?php get_footer(); ?>
