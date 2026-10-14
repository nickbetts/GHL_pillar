<?php
/**
 * Comments.
 */
if ( post_password_required() ) {
	return;
}
?>
<section id="comments" class="comments">
	<?php if ( have_comments() ) : ?>
		<h2 class="comments-title"><?php echo esc_html( number_format_i18n( get_comments_number() ) ); ?> comments</h2>
		<ol class="comment-list"><?php wp_list_comments( array( 'style' => 'ol', 'avatar_size' => 40, 'short_ping' => true ) ); ?></ol>
		<?php the_comments_pagination(); ?>
	<?php endif; ?>
	<?php comment_form(); ?>
</section>
