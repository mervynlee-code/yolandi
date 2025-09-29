<?php
/**
 * YOLANDI Utils – filesystem helpers, JSON IO, slugs
 *
 * @package YOLANDI
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! class_exists( 'YOLANDI_Util' ) ) {

class YOLANDI_Util {

    /**
     * Absolute plugin root path (…/wp-content/plugins/yolandi).
     */
    public static function plugin_root() : string {
        return wp_normalize_path( dirname( __DIR__ ) );
    }

    /**
     * Resolve a YOLANDI content directory path under the plugin directory.
     * $type: 'scripts' | 'macros' | 'proxy-directors' | 'nodes' | 'artifacts' | ''
     */
    public static function dir( string $type = '' ) : string {
        $root = self::plugin_root();
        $rel  = trim( $type, '/' );
        $path = $rel ? $root . '/' . $rel : $root;
        return wp_normalize_path( $path );
    }

    /**
     * Ensure directory exists (mkdir -p). Returns absolute path.
     */
    public static function ensure_dir( string $abs ) : string {
        $abs = wp_normalize_path( $abs );
        if ( ! file_exists( $abs ) ) { wp_mkdir_p( $abs ); }
        return $abs;
    }

    /**
     * Safely join plugin path with a relative path, preventing traversal.
     */
    public static function join( string $base, string $rel ) : string {
        $base = rtrim( wp_normalize_path( $base ), '/' );
        $rel  = str_replace( '\\', '/', (string) $rel );
        $rel  = ltrim( $rel, '/' );
        $parts = array_filter( explode( '/', $rel ), function( $p ) { return $p !== '' && $p !== '.' && $p !== '..'; } );
        return $base . '/' . implode( '/', $parts );
    }

    /**
     * Read a JSON file into an array. Returns WP_Error on failure.
     */
    public static function read_json( string $abs ) {
        $abs = wp_normalize_path( $abs );
        if ( ! file_exists( $abs ) ) {
            return new WP_Error( 'not_found', sprintf( 'File not found: %s', $abs ) );
        }
        $raw = file_get_contents( $abs );
        if ( $raw === false ) { return new WP_Error( 'io_error', 'Failed to read file' ); }
        $json = json_decode( $raw, true );
        if ( json_last_error() !== JSON_ERROR_NONE || ! is_array( $json ) ) {
            return new WP_Error( 'json_error', 'Invalid JSON' );
        }
        return $json;
    }

    /**
     * Write an array as JSON atomically. Creates parent dirs.
     */
    public static function write_json_atomic( string $abs, array $data ) : bool|WP_Error {
        $abs = wp_normalize_path( $abs );
        $dir = dirname( $abs );
        if ( ! file_exists( $dir ) ) { wp_mkdir_p( $dir ); }
        $tmp = wp_tempnam( 'yolandi-json' );
        if ( ! $tmp ) { return new WP_Error( 'io_error', 'Failed to create temp file' ); }
        $json = wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT );
        if ( file_put_contents( $tmp, $json ) === false ) { @unlink( $tmp ); return new WP_Error( 'io_error', 'Failed to write temp file' ); }
        if ( ! @rename( $tmp, $abs ) ) { @unlink( $tmp ); return new WP_Error( 'io_error', 'Failed to replace target file' ); }
        return true;
    }

    /**
     * Convert a string to a slug (lowercase, dashes).
     */
    public static function slug( string $s ) : string {
        return sanitize_title_with_dashes( $s );
    }

    /**
     * List JSON files under a directory, returning [ slug => path ].
     */
    public static function list_json( string $dir, bool $recurse = false ) : array {
        $dir = wp_normalize_path( $dir );
        if ( ! is_dir( $dir ) ) { return []; }
        $out = [];
        $iter = $recurse
            ? new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ) )
            : new DirectoryIterator( $dir );
        foreach ( $iter as $file ) {
            if ( $file instanceof SplFileInfo && $file->isFile() && strtolower( $file->getExtension() ) === 'json' ) {
                $abs  = wp_normalize_path( $file->getPathname() );
                $slug = basename( $abs, '.json' );
                $out[ $slug ] = $abs;
            }
        }
        ksort( $out );
        return $out;
    }
}

} // class_exists guard
