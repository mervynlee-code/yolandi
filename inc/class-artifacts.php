<?php
/**
 * YOLANDI Artifacts – secure filesystem helpers & streaming
 *
 * Artifacts are written under a local directory (default:
 *   wp-content/plugins/yolandi/artifacts/
 * ) which may be backed by a mounted S3 bucket on the WP host.
 *
 * This class centralizes path resolution, traversal protection, and
 * streaming responses for downloads/previews.
 *
 * @package YOLANDI
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

if ( ! class_exists( 'YOLANDI_Artifacts' ) ) {

class YOLANDI_Artifacts {

    /**
     * Return the configured artifact base directory. Ensures existence.
     */
    public static function base_dir() : string {
        $dir = YOLANDI_Queue::settings()['artifact_dir'] ?? '';
        if ( ! $dir ) {
            $dir = trailingslashit( dirname( __DIR__ ) ) . 'artifacts';
        }
        // Normalize
        $dir = wp_normalize_path( $dir );
        if ( ! file_exists( $dir ) ) {
            wp_mkdir_p( $dir );
        }
        return rtrim( $dir, '/' );
    }

    /**
     * Build the per-job directory path (not created).
     */
    public static function job_dir( int $job_id ) : string {
        $base = self::base_dir();
        return $base . '/job-' . absint( $job_id );
    }

    /**
     * Ensure the per-job directory exists (mkdir -p).
     */
    public static function ensure_job_dir( int $job_id ) : string {
        $dir = self::job_dir( $job_id );
        if ( ! file_exists( $dir ) ) {
            wp_mkdir_p( $dir );
        }
        return $dir;
    }

    /**
     * Sanitize a relative path from the client (prevents traversal). Returns a
     * normalized relative path like "screens/shot.png" without leading slash.
     */
    public static function sanitize_rel( string $rel ) : string {
        $rel = str_replace( '\\', '/', $rel );
        $rel = ltrim( $rel, '/' );
        $parts = array_filter( explode( '/', $rel ), function( $p ) {
            return $p !== '' && $p !== '.' && $p !== '..';
        } );
        return implode( '/', $parts );
    }

    /**
     * Resolve an absolute artifact path for a job + relative path. Optionally
     * creates parent directories.
     */
    public static function path_for( int $job_id, string $rel, bool $ensure_parent = false ) : string {
        $rel = self::sanitize_rel( $rel );
        $dir = self::job_dir( $job_id );
        $abs = wp_normalize_path( $dir . '/' . $rel );
        if ( $ensure_parent ) {
            $parent = dirname( $abs );
            if ( ! file_exists( $parent ) ) { wp_mkdir_p( $parent ); }
        }
        return $abs;
    }

    /**
     * Verify a given absolute path is within the job's directory.
     */
    protected static function assert_within_job( int $job_id, string $abs ) : bool {
        $root = realpath( self::job_dir( $job_id ) );
        $real = realpath( $abs );
        if ( ! $root || ! $real ) { return false; }
        $root = rtrim( wp_normalize_path( $root ), '/' ) . '/';
        $real = rtrim( wp_normalize_path( $real ), '/' );
        return str_starts_with( $real, $root );
    }

    /**
     * List artifact files under a job directory (recursive, depth-limited).
     * Returns an array of [ rel, bytes, mtime, mime ].
     */
    public static function list( int $job_id, int $max = 500 ) : array {
        $dir = self::job_dir( $job_id );
        if ( ! is_dir( $dir ) ) { return []; }
        $items = [];
        $iter  = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS )
        );
        foreach ( $iter as $file ) {
            /** @var SplFileInfo $file */
            if ( count( $items ) >= $max ) { break; }
            if ( $file->isFile() ) {
                $abs = wp_normalize_path( $file->getPathname() );
                $rel = ltrim( substr( $abs, strlen( wp_normalize_path( $dir ) ) ), '/' );
                $mime = self::mime_type( $abs );
                $items[] = [
                    'rel'   => $rel,
                    'bytes' => (int) $file->getSize(),
                    'mtime' => (int) $file->getMTime(),
                    'mime'  => $mime,
                ];
            }
        }
        // Sort by mtime asc
        usort( $items, function( $a, $b ) { return $a['mtime'] <=> $b['mtime']; } );
        return $items;
    }

    /**
     * Return file metadata for a given job + rel path.
     */
    public static function stat( int $job_id, string $rel ) : ?array {
        $abs = self::path_for( $job_id, $rel );
        if ( ! file_exists( $abs ) || ! self::assert_within_job( $job_id, $abs ) ) {
            return null;
        }
        return [
            'rel'   => self::sanitize_rel( $rel ),
            'bytes' => (int) filesize( $abs ),
            'mtime' => (int) filemtime( $abs ),
            'mime'  => self::mime_type( $abs ),
            'abs'   => $abs,
        ];
    }

    /**
     * Stream a file to the HTTP response, respecting disposition.
     * Caller must ensure permission checks.
     */
    public static function stream( int $job_id, string $rel, string $disposition = 'inline' ) : WP_Error|bool {
        $info = self::stat( $job_id, $rel );
        if ( ! $info ) {
            return new WP_Error( 'not_found', 'Artifact not found' );
        }
        $abs  = $info['abs'];
        $mime = $info['mime'];
        $name = basename( $info['rel'] );

        // Headers
        nocache_headers();
        status_header( 200 );
        header( 'Content-Type: ' . $mime );
        header( 'Content-Length: ' . (string) $info['bytes'] );
        header( 'X-Content-Type-Options: nosniff' );
        $disp = ( strtolower( $disposition ) === 'attachment' ) ? 'attachment' : 'inline';
        header( 'Content-Disposition: ' . $disp . '; filename="' . rawurlencode( $name ) . '"' );

        // Stream in chunks to avoid memory spikes
        $fp = fopen( $abs, 'rb' );
        if ( ! $fp ) {
            return new WP_Error( 'io_error', 'Failed to open artifact' );
        }
        while ( ! feof( $fp ) ) {
            echo fread( $fp, 8192 );
            @ob_flush();
            flush();
        }
        fclose( $fp );
        return true;
    }

    /**
     * Build a REST download URL for an artifact (used by Admin UI tables).
     */
    public static function download_url( int $job_id, string $rel, string $disposition = 'inline' ) : string {
        $args = [ 'path' => self::sanitize_rel( $rel ), 'disp' => $disposition ];
        return add_query_arg( $args, rest_url( 'yolandi/v1/artifacts/' . absint( $job_id ) ) );
    }

    /**
     * Detect a reasonable MIME type for a file path.
     */
    protected static function mime_type( string $abs ) : string {
        if ( function_exists( 'finfo_open' ) ) {
            $fi = finfo_open( FILEINFO_MIME_TYPE );
            if ( $fi ) {
                $mt = finfo_file( $fi, $abs );
                finfo_close( $fi );
                if ( is_string( $mt ) && $mt !== '' ) { return $mt; }
            }
        }
        if ( function_exists( 'mime_content_type' ) ) {
            $mt = @mime_content_type( $abs );
            if ( is_string( $mt ) && $mt !== '' ) { return $mt; }
        }
        $ext = strtolower( pathinfo( $abs, PATHINFO_EXTENSION ) );
        $ft  = wp_check_filetype( 'f.' . $ext );
        return $ft['type'] ?: 'application/octet-stream';
    }
}

} // class_exists guard
