<?php
/**
 * Template Name: Stream hub
 * Description: Section landing page (Product, Solutions, Automations, Integrations, Resources). Lists its children from the data model.
 */
get_header();
the_post();

$slug  = get_post_field( 'post_name' );
$metas = stream_hub_meta();
$meta  = isset( $metas[ $slug ] ) ? $metas[ $slug ] : array( 'eyebrow' => '', 'title' => get_the_title(), 'lead' => '', 'svg' => 'hero', 'groups' => array(), 'group_key' => '' );
$colls = stream_collections();

get_template_part(
	'template-parts/page-hero',
	null,
	array(
		'eyebrow' => $meta['eyebrow'],
		'title'   => $meta['title'],
		'lead'    => $meta['lead'],
		'art'     => $meta['svg'],
		'crumbs'  => array( array( get_the_title() ) ),
		'actions' => stream_btn( stream_opt( 'cta_text' ), stream_link( stream_opt( 'cta_link' ) ), 'primary big' ), // phpcs:ignore WordPress.Security.EscapeOutput
	)
);
?>

<section class="section hub">
	<div class="container">
		<?php
		if ( 'resources' === $slug ) {
			stream_entry_cards( stream_resources(), 'resources', 3 );
		} elseif ( isset( $colls[ $slug ] ) ) {
			$items = $colls[ $slug ]['items'];
			if ( $meta['groups'] ) {
				foreach ( $meta['groups'] as $gk => $g ) {
					$subset = array_filter( $items, static function ( $e ) use ( $meta, $gk ) { return isset( $e[ $meta['group_key'] ] ) && $e[ $meta['group_key'] ] === $gk; } );
					if ( ! $subset ) {
						continue;
					}
					echo '<div class="hub-group"><div class="hub-group-head" data-reveal><h2>' . esc_html( $g[0] ) . '</h2><p>' . esc_html( $g[1] ) . '</p></div>';
					stream_entry_cards( $subset, $slug, 3 );
					echo '</div>';
				}
			} else {
				stream_entry_cards( $items, $slug, 3 );
			}
		}
		if ( '' !== trim( wp_strip_all_tags( get_the_content() ) ) ) {
			echo '<div class="prose hub-extra">';
			the_content();
			echo '</div>';
		}
		?>
	</div>
</section>

<?php get_template_part( 'template-parts/cta-band' ); ?>
<?php get_footer(); ?>
