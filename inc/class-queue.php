<?php
/**
 * YOLANDI Queue – custom MySQL-backed job queue with REST-driven runners
 *
 * @package YOLANDI
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Queue table helper & operations.
 *
 * Schema is created in the plugin activation hook. Table name: {$wpdb->prefix}yolandi_jobs
 */
class YOLANDI_Queue {

    /**
     * Get fully-qualified table name for jobs.
     * @return string
     */
    public static function table() : string {
        global $wpdb;
        return $wpdb->prefix . 'yolandi_jobs';
    }

    /**
     * Load plugin root directory (…/wp-content/plugins/yolandi).
     * @return string
     */
    public static function plugin_root() : string {
        // This file sits in …/yolandi/inc/class-queue.php
        return dirname( __DIR__ );
    }

    /**
     * Settings with sane defaults.
     * @return array
     */
    public static function settings() : array {
        $defaults = [
            'max_concurrency'        => 10,
            'runner_max_concurrency' => 5,
            'lease_seconds'          => 90,
            'retries'                => 3,   // additional retries after first attempt
            'backoff_base_ms'        => 1000,
            'backoff_max_sec'        => 300,
            'artifact_dir'           => self::plugin_root() . '/artifacts',
            'default_proxy_director' => 'webshare-main',
            'default_device'         => 'Pixel7',
            'runner_secret'          => '',
        ];
        $opts = get_option( 'yolandi_settings', [] );
        if ( ! is_array( $opts ) ) { $opts = []; }
        return array_merge( $defaults, $opts );
    }

    /**
     * Compute exponential backoff seconds given an attempt count.
     * attempt=1 means first try; attempt>=2 means retries.
     */
    public static function backoff_seconds( int $attempt ) : int {
        $s = self::settings();
        $base_ms = max( 1, (int) $s['backoff_base_ms'] );
        $max_s   = max( 1, (int) $s['backoff_max_sec'] );
        // For attempt 1 (first run) → 0; attempt 2 → base, attempt 3 → base*2, etc.
        $retries_done = max( 0, $attempt - 1 );
        $ms = $base_ms * ( 2 ** max( 0, $retries_done - 1 ) );
        return min( $max_s, (int) ceil( $ms / 1000 ) );
    }

    /**
     * Enqueue a job.
     *
     * @param string $script_slug e.g. "example-search"
     * @param int    $script_version
     * @param array  $params arbitrary params passed to the runner
     * @param int    $priority 1..9 (1 highest)
     * @param int|null $max_attempts if null, derive from settings (retries + 1)
     * @return array|WP_Error job row
     */
    public static function enqueue( string $script_slug, int $script_version, array $params = [], int $priority = 5, ?int $max_attempts = null ) {
        global $wpdb;
        $table = self::table();
        $script_slug = sanitize_key( $script_slug );
        $priority = max( 1, min( 9, (int) $priority ) );
        if ( $max_attempts === null ) {
            $s = self::settings();
            $max_attempts = max( 1, (int) $s['retries'] + 1 );
        }

        $ok = $wpdb->insert( $table, [
            'script_slug'     => $script_slug,
            'script_version'  => $script_version,
            'params_json'     => wp_json_encode( $params, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ),
            'priority'        => $priority,
            'status'          => 'queued',
            'attempts'        => 0,
            'max_attempts'    => $max_attempts,
            'lease_expires_at'=> null,
            'runner_id'       => null,
            'error_json'      => null,
            'artifacts_json'  => null,
            'created_at'      => gmdate( 'Y-m-d H:i:s' ),
            'updated_at'      => gmdate( 'Y-m-d H:i:s' ),
        ], [ '%s','%d','%s','%d','%s','%d','%d','%s','%s','%s','%s','%s','%s' ] );

        if ( ! $ok ) {
            return new WP_Error( 'db_insert_failed', 'Failed to enqueue job' );
        }
        $id = (int) $wpdb->insert_id;
        return self::get( $id );
    }

    /**
     * Lease a job atomically. Increments attempts, sets status=running, runner_id, lease_expires_at.
     * Also loads the script graph JSON from disk for convenience.
     *
     * @param int    $lease_seconds
     * @param string $runner_id
     * @return array|null job payload with `graph` key, or null if none available
     */
    public static function lease( int $lease_seconds, string $runner_id ) : ?array {
        // return ["msg" => "TESTING"];
        global $wpdb;
        $table = self::table();
        $lease_seconds = max( 30, $lease_seconds );

        $wpdb->query( 'START TRANSACTION' );

        // Select next available job under row lock
        $row = $wpdb->get_row( `SELECT * FROM $table
            WHERE status IN ('queued','retrying')
              AND (lease_expires_at IS NULL OR lease_expires_at < UTC_TIMESTAMP())
            ORDER BY priority ASC, created_at ASC
            LIMIT 1
            FOR UPDATE` );
            return $row;

        if ( ! $row ) {
            $wpdb->query( 'COMMIT' );
            return null;
        }

        $id = (int) $row->id;

        // Bump attempts and set running state
        $expires = gmdate( 'Y-m-d H:i:s', time() + $lease_seconds );
        $updated = $wpdb->query( $wpdb->prepare(
            "UPDATE `{$table}`
             SET status='running', runner_id=%s, lease_expires_at=%s, attempts = attempts + 1, updated_at=UTC_TIMESTAMP()
             WHERE id=%d",
             $runner_id, $expires, $id
        ) );

        $wpdb->query( 'COMMIT' );

        if ( $updated === false ) {
            return null;
        }


        $job = self::get( $id );
        if ( ! $job ) {
            return null;
        }

        // Attach script graph from disk
        $graph = self::load_script_graph( $job['script_slug'], (int) $job['script_version'] );
        if ( is_wp_error( $graph ) ) {
            // Mark job failed immediately if script missing
            self::mark_failed_now( $id, $runner_id, [ 'message' => $graph->get_error_message() ] );
            return null;
        }
        $job['graph'] = $graph;
        return $job;
    }

    /**
     * Heartbeat: extend lease if caller owns the job and it is running.
     * @return bool true if extended
     */
    public static function heartbeat( int $job_id, string $runner_id, int $lease_seconds ) : bool {
        global $wpdb;
        $table = self::table();
        $expires = gmdate( 'Y-m-d H:i:s', time() + max( 30, $lease_seconds ) );

        $updated = $wpdb->query( $wpdb->prepare(
            "UPDATE `{$table}` SET lease_expires_at=%s, updated_at=UTC_TIMESTAMP()
             WHERE id=%d AND runner_id=%s AND status='running'",
             $expires, $job_id, $runner_id
        ) );
        return ( $updated && $updated > 0 );
    }

    /**
     * Report job result. If status='failed', this will transition to 'retrying' with backoff or 'dead_letter'.
     * If status='succeeded', it becomes final.
     *
     * @param int    $job_id
     * @param string $runner_id
     * @param string $status 'succeeded'|'failed'
     * @param array|null $error optional error structure
     * @param array|null $artifacts optional artifact metadata
     * @param int|null $run_ms optional total runtime in ms (stored in artifacts_json)
     * @return array|WP_Error updated job row
     */
    public static function report( int $job_id, string $runner_id, string $status, ?array $error = null, ?array $artifacts = null, ?int $run_ms = null ) {
        global $wpdb;
        $table = self::table();
        $status = in_array( $status, [ 'succeeded', 'failed' ], true ) ? $status : 'failed';

        $row = self::get( $job_id );
        if ( ! $row ) {
            return new WP_Error( 'not_found', 'Job not found' );
        }
        if ( $row['status'] !== 'running' || (string) $row['runner_id'] !== (string) $runner_id ) {
            return new WP_Error( 'conflict', 'Job is not owned by this runner or not running' );
        }

        // Merge run_ms into artifacts
        if ( $run_ms !== null ) {
            $artifacts = is_array( $artifacts ) ? $artifacts : [];
            $artifacts['run_ms'] = (int) $run_ms;
        }

        if ( $status === 'succeeded' ) {
            $ok = $wpdb->update( $table, [
                'status'          => 'succeeded',
                'lease_expires_at'=> null,
                'error_json'      => $error ? wp_json_encode( $error, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) : null,
                'artifacts_json'  => $artifacts ? wp_json_encode( $artifacts, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) : null,
                'updated_at'      => gmdate( 'Y-m-d H:i:s' ),
            ], [ 'id' => $job_id ], [ '%s','%s','%s','%s','%s' ], [ '%d' ] );
            if ( ! $ok ) { return new WP_Error( 'db_update_failed', 'Failed to mark succeeded' ); }
            return self::get( $job_id );
        }

        // Failed: decide retry vs DLQ based on attempts vs max_attempts
        $attempts = (int) $row['attempts'];
        $max      = (int) $row['max_attempts'];
        if ( $attempts < $max ) {
            $backoff = self::backoff_seconds( $attempts + 1 );
            $next    = gmdate( 'Y-m-d H:i:s', time() + $backoff );
            $ok = $wpdb->update( $table, [
                'status'          => 'retrying',
                'runner_id'       => null,
                'lease_expires_at'=> $next, // not eligible until this time
                'error_json'      => $error ? wp_json_encode( $error, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) : null,
                'artifacts_json'  => $artifacts ? wp_json_encode( $artifacts, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) : null,
                'updated_at'      => gmdate( 'Y-m-d H:i:s' ),
            ], [ 'id' => $job_id ], [ '%s','%s','%s','%s','%s','%s' ], [ '%d' ] );
            if ( ! $ok ) { return new WP_Error( 'db_update_failed', 'Failed to requeue (retrying)' ); }
            return self::get( $job_id );
        }

        // No retries left → dead letter
        $ok = $wpdb->update( $table, [
            'status'          => 'dead_letter',
            'runner_id'       => null,
            'lease_expires_at'=> null,
            'error_json'      => $error ? wp_json_encode( $error, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) : null,
            'artifacts_json'  => $artifacts ? wp_json_encode( $artifacts, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) : null,
            'updated_at'      => gmdate( 'Y-m-d H:i:s' ),
        ], [ 'id' => $job_id ], [ '%s','%s','%s','%s','%s','%s' ], [ '%d' ] );
        if ( ! $ok ) { return new WP_Error( 'db_update_failed', 'Failed to dead-letter' ); }
        return self::get( $job_id );
    }

    /**
     * Cancel a queued/retrying job (send to DLQ).
     */
    public static function cancel( int $job_id ) : bool {
        global $wpdb; $table = self::table();
        $updated = $wpdb->query( $wpdb->prepare(
            "UPDATE `{$table}` SET status='dead_letter', updated_at=UTC_TIMESTAMP() WHERE id=%d AND status IN ('queued','retrying')",
            $job_id
        ) );
        return (bool) $updated;
    }

    /**
     * Fetch a job row by id and decode JSON columns.
     * @return array|null
     */
    public static function get( int $job_id ) : ?array {
        global $wpdb; $table = self::table();
        $row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM `{$table}` WHERE id=%d", $job_id ), ARRAY_A );
        if ( ! $row ) { return null; }
        return self::normalize_row( $row );
    }

    /**
     * Helper used when a script graph fails to load on lease.
     */
    protected static function mark_failed_now( int $job_id, string $runner_id, array $error ) : void {
        global $wpdb; $table = self::table();
        $wpdb->update( $table, [
            'status'          => 'failed',
            'runner_id'       => $runner_id,
            'lease_expires_at'=> null,
            'error_json'      => wp_json_encode( $error, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ),
            'updated_at'      => gmdate( 'Y-m-d H:i:s' ),
        ], [ 'id' => $job_id ] );
    }

    /**
     * Normalize DB row to typed array: decode JSON, cast ints.
     * @param array $row
     * @return array
     */
    protected static function normalize_row( array $row ) : array {
        $row['id']             = (int) $row['id'];
        $row['script_version'] = (int) $row['script_version'];
        $row['priority']       = (int) $row['priority'];
        $row['attempts']       = (int) $row['attempts'];
        $row['max_attempts']   = (int) $row['max_attempts'];
        $row['params']         = self::safe_json_decode( $row['params_json'] ?? null );
        $row['error']          = self::safe_json_decode( $row['error_json'] ?? null );
        $row['artifacts']      = self::safe_json_decode( $row['artifacts_json'] ?? null );
        unset( $row['params_json'], $row['error_json'], $row['artifacts_json'] );
        return $row;
    }

    /**
     * Load script graph JSON from disk.
     * @param string $slug
     * @param int    $version
     * @return array|WP_Error
     */
    public static function load_script_graph( string $slug, int $version ) {
        $slug = sanitize_key( $slug );
        $ver  = sprintf( 'v%03d.json', $version );
        $path = trailingslashit( self::plugin_root() ) . 'scripts/' . $slug . '/' . $ver;
        if ( ! file_exists( $path ) ) {
            return new WP_Error( 'not_found', sprintf( 'Script file not found: %s', $path ) );
        }
        $raw = file_get_contents( $path );
        if ( $raw === false ) {
            return new WP_Error( 'io_error', 'Failed to read script file' );
        }
        $json = json_decode( $raw, true );
        if ( json_last_error() !== JSON_ERROR_NONE || ! is_array( $json ) ) {
            return new WP_Error( 'json_error', 'Invalid script JSON' );
        }
        return $json;
    }

    /**
     * Safely decode JSON to array.
     */
    protected static function safe_json_decode( $maybe_json ) : array {
        if ( ! is_string( $maybe_json ) || $maybe_json === '' ) { return []; }
        $out = json_decode( $maybe_json, true );
        return is_array( $out ) ? $out : [];
    }
}
