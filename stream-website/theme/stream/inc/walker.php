<?php
/**
 * Mega-menu walker. Menu shape (all editable under Appearance > Menus):
 *   top item  (class menu-mega | menu-dropdown)
 *     column  (class mega-col)               children = links (class ico-xxx svg-xxx, description = hover text)
 *     feature (class mega-feature svg-xxx)   the default preview card; description = text, title attribute = button label
 * Hovering a link swaps the preview pane to that link's illustration and description.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Stream_Mega_Walker extends Walker_Nav_Menu {

	private $top_mega = false;
	private $preview  = '';

	private function find( $classes, $prefix ) {
		foreach ( (array) $classes as $c ) {
			if ( 0 === strpos( $c, $prefix ) ) {
				return substr( $c, strlen( $prefix ) );
			}
		}
		return '';
	}

	private function art_url( $name ) {
		return $name ? get_theme_file_uri( 'assets/svg/' . sanitize_file_name( $name ) . '.svg' ) : '';
	}

	public function start_lvl( &$output, $depth = 0, $args = null ) {
		if ( 0 === $depth ) {
			$output .= $this->top_mega
				? '<div class="mega" data-mega><div class="mega-inner"><ul class="mega-cols">'
				: '<div class="drop"><ul class="drop-list">';
		} elseif ( 1 === $depth && $this->top_mega ) {
			$output .= '<ul class="mega-links">';
		}
	}

	public function end_lvl( &$output, $depth = 0, $args = null ) {
		if ( 0 === $depth ) {
			if ( $this->top_mega ) {
				$output        .= '</ul>' . $this->preview . '</div></div>';
				$this->preview  = '';
			} else {
				$output .= '</ul></div>';
			}
		} elseif ( 1 === $depth && $this->top_mega ) {
			$output .= '</ul>';
		}
	}

	public function start_el( &$output, $data_object, $depth = 0, $args = null, $current_object_id = 0 ) {
		$item     = $data_object;
		$classes  = empty( $item->classes ) ? array() : (array) $item->classes;
		$has_kids = in_array( 'menu-item-has-children', $classes, true );
		$active   = array_intersect( $classes, array( 'current-menu-item', 'current-menu-ancestor', 'current-menu-parent', 'current_page_item' ) ) ? ' is-current' : '';
		$title    = esc_html( $item->title );
		$href     = ! empty( $item->url ) ? esc_url( $item->url ) : '#';

		if ( 0 === $depth ) {
			$this->top_mega = in_array( 'menu-mega', $classes, true );
			$kind           = $this->top_mega ? ' has-mega' : ( $has_kids ? ' has-drop' : '' );
			$output        .= '<li class="nav-item' . $kind . $active . '">';
			$output        .= '<a class="nav-link" href="' . $href . '"' . ( $has_kids ? ' aria-haspopup="true" aria-expanded="false"' : '' ) . '><span>' . $title . '</span>' . ( $has_kids ? stream_icon( 'chevron', 14, 'chev' ) : '' ) . '</a>';
			if ( $has_kids ) {
				$output .= '<button class="sub-toggle" type="button" aria-label="' . esc_attr( sprintf( /* translators: %s: menu item */ __( 'Toggle %s menu', 'stream' ), $item->title ) ) . '">' . stream_icon( 'chevron', 18 ) . '</button>';
			}
			return;
		}

		if ( 1 === $depth && $this->top_mega ) {
			if ( in_array( 'mega-feature', $classes, true ) ) {
				$svg           = $this->find( $classes, 'svg-' );
				$cta           = $item->attr_title ? $item->attr_title : __( 'Learn more', 'stream' );
				$this->preview = '<aside class="mega-preview" data-preview-default>'
					. '<a class="mp-frame" href="' . $href . '"><span class="mp-art"><img src="' . esc_url( $this->art_url( $svg ) ) . '" alt="" width="480" height="360"></span></a>'
					. '<div class="mp-body"><strong>' . $title . '</strong><p>' . esc_html( $item->description ) . '</p><a class="mp-cta" href="' . $href . '">' . esc_html( $cta ) . stream_icon( 'arrow', 14 ) . '</a></div></aside>';
				return;
			}
			$output .= '<li class="mega-col"><div class="mega-col-title">' . $title . '</div>';
			return;
		}

		// Link row (mega depth 2, or any dropdown child).
		$ico     = $this->find( $classes, 'ico-' );
		$svg     = $this->find( $classes, 'svg-' );
		$attrs   = $svg ? ' data-art="' . esc_url( $this->art_url( $svg ) ) . '" data-title="' . esc_attr( $item->title ) . '" data-desc="' . esc_attr( $item->description ) . '"' : '';
		$output .= '<li class="mega-link' . $active . '"><a href="' . $href . '"' . $attrs . '>'
			. ( $ico ? '<span class="ml-ico">' . stream_icon( $ico, 18 ) . '</span>' : '' )
			. '<span class="ml-body"><strong>' . $title . '</strong>' . ( $item->description ? '<small>' . esc_html( $item->description ) . '</small>' : '' ) . '</span></a>';
	}

	public function end_el( &$output, $data_object, $depth = 0, $args = null ) {
		$output .= '</li>';
	}
}
