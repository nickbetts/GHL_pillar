<?php
/**
 * Template Name: Stream contact
 * Description: Contact and demo request form. The page slug "book-a-demo" switches it to demo mode.
 */
get_header();
the_post();

$demo = 'book-a-demo' === get_post_field( 'post_name' );
$sent = isset( $_GET['sent'] ) ? sanitize_key( wp_unslash( $_GET['sent'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification

get_template_part(
	'template-parts/page-hero',
	null,
	array(
		'eyebrow' => $demo ? 'Book a demo' : 'Contact',
		'icon'    => $demo ? 'calendar' : 'email',
		'title'   => $demo ? 'See Stream with <em>your own pipeline</em>' : 'Let\'s <em>talk</em>',
		'lead'    => $demo ? 'A 20-minute walkthrough tailored to how your team sells. No slides, just the product.' : 'Questions, ideas or a problem to solve? Send us a note and a human will reply.',
		'crumbs'  => array( array( $demo ? 'Book a demo' : 'Contact' ) ),
	)
);
?>
<section class="section contact">
	<div class="container contact-grid">
		<div class="contact-info" data-reveal>
			<h2><?php echo $demo ? 'What happens next' : 'How we can help'; ?></h2>
			<ol class="steps-list">
				<?php foreach ( $demo ? array( array( 'We reply within a working day', 'A real person, not a bot, will suggest a time.' ), array( 'A 20-minute walkthrough', 'We use your sector and team size to show what matters.' ), array( 'Your trial, set up', 'Import a list and start calling the same day.' ) ) : array( array( 'Sales questions', 'Pricing, plans and how Stream fits your team.' ), array( 'Support', 'Stuck on something? Check the help centre or write to us.' ), array( 'Partnerships', 'Agencies and consultants, we would love to hear from you.' ) ) as $i => $s ) : ?>
					<li><span class="step-n"><?php echo (int) $i + 1; ?></span><div><strong><?php echo esc_html( $s[0] ); ?></strong><p><?php echo esc_html( $s[1] ); ?></p></div></li>
				<?php endforeach; ?>
			</ol>
			<p class="fineprint" data-reveal style="margin:18px 0 0">We reply to every message within one working day.</p>
			<div class="contact-art"><?php echo stream_art( $demo ? 'calendar' : 'inbound' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
		</div>

		<form class="card form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" data-reveal>
			<?php if ( '1' === $sent ) : ?>
				<div class="notice ok" role="status"><?php echo stream_icon( 'check', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> Thanks, we have your message and will be in touch shortly.</div>
			<?php elseif ( $sent ) : ?>
				<div class="notice bad" role="alert">Something went wrong. Please check your details and try again.</div>
			<?php endif; ?>
			<input type="hidden" name="action" value="stream_contact">
			<input type="hidden" name="kind" value="<?php echo $demo ? 'demo' : 'contact'; ?>">
			<?php wp_nonce_field( 'stream_contact', 'stream_nonce' ); ?>
			<p class="hp" aria-hidden="true"><label>Leave blank <input type="text" name="website" tabindex="-1" autocomplete="off"></label></p>
			<div class="field-row">
				<label class="field"><span>Name</span><input type="text" name="name" required autocomplete="name"></label>
				<label class="field"><span>Work email</span><input type="email" name="email" required autocomplete="email"></label>
			</div>
			<div class="field-row">
				<label class="field"><span>Company</span><input type="text" name="company" autocomplete="organization"></label>
				<label class="field"><span>Team size</span>
					<select name="team_size"><option>1 to 5</option><option>6 to 15</option><option>16 to 50</option><option>50+</option></select>
				</label>
			</div>
			<label class="field"><span><?php echo $demo ? 'What would you like to see?' : 'How can we help?'; ?></span><textarea name="message" rows="5"></textarea></label>
			<button class="btn btn-primary big" type="submit"><span><?php echo $demo ? 'Request my demo' : 'Send message'; ?></span><?php echo stream_icon( 'arrow', 16, 'btn-arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></button>
			<p class="fineprint">We only use your details to reply to you.</p>
		</form>
	</div>
</section>
<?php get_template_part( 'template-parts/logos' ); ?>
<?php get_footer(); ?>
