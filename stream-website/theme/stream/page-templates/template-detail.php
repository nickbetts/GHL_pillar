<?php
/**
 * Template Name: Stream detail
 * Description: Feature, solution, automation and integration pages. Content comes from the theme data model.
 */
get_header();
the_post();

$entry = stream_entry_for_post();
$post  = get_post();

if ( ! $entry ) {
	get_template_part( 'template-parts/page-hero', null, array( 'title' => get_the_title(), 'crumbs' => array( array( get_the_title() ) ) ) );
	echo '<section class="section"><div class="container prose">';
	the_content();
	echo '</div></section>';
	get_template_part( 'template-parts/cta-band' );
	get_footer();
	return;
}

$coll       = $entry['collection'];
$colls      = stream_collections();
$coll_title = $coll && isset( $colls[ $coll ] ) ? $colls[ $coll ]['title'] : '';
$groups     = 'product' === $coll ? stream_feature_groups() : ( 'solutions' === $coll ? stream_solution_groups() : array() );
$group_lbl  = isset( $entry['group'], $groups[ $entry['group'] ] ) ? $groups[ $entry['group'] ][0] : $coll_title;
$crumbs     = array();
if ( $coll_title ) {
	$crumbs[] = array( $coll_title, stream_page_url( $coll ) );
}
$crumbs[] = array( $entry['name'] );

$actions = stream_btn( stream_opt( 'cta_text' ), stream_link( stream_opt( 'cta_link' ) ), 'primary big' )
	. '<a class="btn btn-ghost big" href="' . esc_url( $coll ? stream_page_url( $coll ) : stream_page_url( 'product' ) ) . '"><span>' . esc_html( $coll_title ? 'All ' . strtolower( $coll_title ) : 'Explore the product' ) . '</span></a>';

get_template_part(
	'template-parts/page-hero',
	null,
	array(
		'eyebrow' => $entry['name'] . ( $group_lbl && $group_lbl !== $entry['name'] ? ' · ' . $group_lbl : '' ),
		'icon'    => $entry['icon'],
		'title'   => esc_html( $entry['tagline'] ),
		'lead'    => $entry['intro'],
		'art'     => $entry['svg'],
		'crumbs'  => $crumbs,
		'actions' => $actions, // already escaped above
	)
);
?>

<section class="section points">
	<div class="container">
		<?php stream_section_head( 'What you get', 'Built to remove <em>the friction</em>', '' ); ?>
		<div class="cards cols-<?php echo count( $entry['points'] ) >= 4 ? 4 : 3; ?>">
			<?php foreach ( $entry['points'] as $i => $p ) : ?>
				<div class="card point" data-reveal>
					<span class="point-num"><?php echo esc_html( str_pad( $i + 1, 2, '0', STR_PAD_LEFT ) ); ?></span>
					<h3><?php echo esc_html( $p[0] ); ?></h3>
					<p><?php echo esc_html( $p[1] ); ?></p>
				</div>
			<?php endforeach; ?>
		</div>
	</div>
</section>

<section class="section mid-cta">
	<div class="container">
		<div class="mid-cta-card" data-reveal>
			<div>
				<h3>See <?php echo esc_html( $entry['name'] ); ?> on your own pipeline</h3>
				<p>A 20-minute walkthrough with your team, your sectors and your numbers.</p>
			</div>
			<div class="hero-cta"><?php echo stream_btn( stream_opt( 'cta_text' ), stream_link( stream_opt( 'cta_link' ) ), 'primary' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
		</div>
	</div>
</section>

<?php if ( ! empty( $entry['roles'] ) ) : ?>
<section class="section roles-strip">
	<div class="container strip">
		<span class="strip-label">Used by</span>
		<?php foreach ( $entry['roles'] as $r ) : ?><span class="role-chip"><?php echo stream_icon( 'user', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?><?php echo esc_html( $r ); ?></span><?php endforeach; ?>
	</div>
</section>
<?php endif; ?>

<?php if ( '' !== trim( wp_strip_all_tags( get_the_content() ) ) ) : ?>
<section class="section"><div class="container prose"><?php the_content(); ?></div></section>
<?php endif; ?>

<?php
// Related: solutions point to features; features point to their flow neighbours; others to siblings.
$related = array();
$base    = $coll;
if ( 'solutions' === $coll && ! empty( $entry['features'] ) ) {
	$all = stream_features();
	foreach ( $entry['features'] as $fk ) {
		if ( isset( $all[ $fk ] ) ) {
			$related[ $fk ] = $all[ $fk ];
		}
	}
	$base      = 'product';
	$rel_title = 'Features that power it';
} elseif ( 'product' === $coll ) {
	$keys = array_keys( $colls['product']['items'] );
	$pos  = array_search( $entry['slug'], $keys, true );
	foreach ( array( $keys[ ( $pos + count( $keys ) - 1 ) % count( $keys ) ], $keys[ ( $pos + 1 ) % count( $keys ) ], $keys[ ( $pos + 2 ) % count( $keys ) ] ) as $k ) {
		$related[ $k ] = $colls['product']['items'][ $k ];
	}
	$rel_title = 'Keep exploring';
} elseif ( $coll && isset( $colls[ $coll ] ) ) {
	foreach ( $colls[ $coll ]['items'] as $k => $e ) {
		if ( $k !== $entry['slug'] && count( $related ) < 3 ) {
			$related[ $k ] = $e;
		}
	}
	$rel_title = 'More ' . strtolower( $coll_title );
}
if ( $related ) :
	?>
<section class="section related">
	<div class="container">
		<?php stream_section_head( '', $rel_title, '' ); ?>
		<?php stream_entry_cards( $related, $base, 3 ); ?>
	</div>
</section>
<?php endif; ?>

<?php get_template_part( 'template-parts/logos' ); ?>
<?php get_template_part( 'template-parts/cta-band' ); ?>
<?php get_footer(); ?>
