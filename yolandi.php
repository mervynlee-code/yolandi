<?php
/**
 * Plugin Name:  YOLANDI – Stealth Puppeteer Orchestrator
 * Description:  WordPress admin + REST queue + runners for modular Puppeteer scripts using the stealth-api core.
 * Version:      0.1.0
 * Requires PHP: 8.1
 * Requires at least: 6.5
 * Author:       YOLANDI Team
 * License:      GPL-2.0-or-later
 * Text Domain:  yolandi
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

if ( ! defined( 'YOLANDI_VERSION' ) ) define( 'YOLANDI_VERSION', '0.1.0' );
if ( ! defined( 'YOLANDI_FILE' ) )    define( 'YOLANDI_FILE', __FILE__ );
if ( ! defined( 'YOLANDI_DIR' ) )     define( 'YOLANDI_DIR', plugin_dir_path( __FILE__ ) );
if ( ! defined( 'YOLANDI_URL' ) )     define( 'YOLANDI_URL', plugin_dir_url( __FILE__ ) );

/* -------------------------------------------------------------------------- */
/* Includes                                                                   */
/* -------------------------------------------------------------------------- */

// Utilities & Security
$__inc = function( string $rel ) {
    $path = YOLANDI_DIR . 'inc/' . ltrim( $rel, '/' );
    if ( file_exists( $path ) ) { require_once $path; return true; }
    return false;
};

$__inc( 'utils.php' );
$__inc( 'security.php' );
$__inc( 'class-settings.php' );
$__inc( 'class-queue.php' );
$__inc( 'class-artifacts.php' );
$__inc( 'class-rest.php' );
$__inc( 'class-nodes.php' );       // optional until implemented
$__inc( 'class-admin-page.php' );  // provides the Admin SPA mount and assets

/* -------------------------------------------------------------------------- */
/* i18n                                                                        */
/* -------------------------------------------------------------------------- */
add_action( 'plugins_loaded', function () {
    load_plugin_textdomain( 'yolandi', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );
});

/* -------------------------------------------------------------------------- */
/* Cron: add a minutely schedule                                               */
/* -------------------------------------------------------------------------- */
add_filter( 'cron_schedules', function ( array $schedules ) : array {
    if ( ! isset( $schedules['yolandi_minutely'] ) ) {
        $schedules['yolandi_minutely'] = [
            'interval' => 60,
            'display'  => __( 'Every Minute (YOLANDI)', 'yolandi' ),
        ];
    }
    return $schedules;
});

/* -------------------------------------------------------------------------- */
/* Activation / Deactivation                                                   */
/* -------------------------------------------------------------------------- */

register_activation_hook( __FILE__, function () {
    global $wpdb;

    // Create queue table
    $table   = $wpdb->prefix . 'yolandi_jobs';
    $charset = $wpdb->get_charset_collate();
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';

    $sql = "CREATE TABLE IF NOT EXISTS `$table` (
      `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      `script_slug` VARCHAR(190) NOT NULL,
      `script_version` INT NOT NULL,
      `params_json` JSON NULL,
      `priority` TINYINT UNSIGNED NOT NULL DEFAULT 5,
      `status` ENUM('queued','running','retrying','succeeded','failed','dead_letter') NOT NULL DEFAULT 'queued',
      `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
      `max_attempts` TINYINT UNSIGNED NOT NULL DEFAULT 3,
      `lease_expires_at` DATETIME NULL,
      `runner_id` VARCHAR(64) NULL,
      `error_json` JSON NULL,
      `artifacts_json` JSON NULL,
      `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      KEY `idx_status_priority_created` (`status`,`priority`,`created_at`),
      KEY `idx_lease` (`status`,`lease_expires_at`),
      KEY `idx_script` (`script_slug`,`script_version`)
    ) $charset;";

    dbDelta( $sql );

    // Ensure base artifact directory exists
    if ( class_exists( 'YOLANDI_Artifacts' ) ) {
        YOLANDI_Artifacts::base_dir();
    }

    // Initialize settings if missing
    if ( class_exists( 'YOLANDI_Settings' ) ) {
        $existing = get_option( YOLANDI_Settings::OPTION, null );
        if ( $existing === null ) {
            update_option( YOLANDI_Settings::OPTION, YOLANDI_Settings::defaults() );
        }
        // Ensure roles/caps
        YOLANDI_Settings::ensure_roles_and_caps();
    }

    // Schedule watchdog every minute
    if ( ! wp_next_scheduled( 'yolandi_queue_watchdog' ) ) {
        wp_schedule_event( time() + 30, 'yolandi_minutely', 'yolandi_queue_watchdog' );
    }
});

register_deactivation_hook( __FILE__, function () {
    // Clear watchdog
    wp_clear_scheduled_hook( 'yolandi_queue_watchdog' );
});

/* -------------------------------------------------------------------------- */
/* Init classes                                                                */
/* -------------------------------------------------------------------------- */
add_action( 'init', function () {
    if ( class_exists( 'YOLANDI_Settings' ) )   { YOLANDI_Settings::init(); }
    if ( class_exists( 'YOLANDI_Rest' ) )       { YOLANDI_Rest::init(); }
    if ( class_exists( 'YOLANDI_Admin_Page' ) ) { YOLANDI_Admin_Page::init(); }
    // if ( class_exists( 'YOLANDI_Nodes' ) )      { YOLANDI_Nodes::init(); }
});

/* -------------------------------------------------------------------------- */
/* Watchdog: cron task to handle expired leases                                */
/* -------------------------------------------------------------------------- */
add_action( 'yolandi_queue_watchdog', function () {
    if ( ! class_exists( 'YOLANDI_Queue' ) ) { return; }
    global $wpdb;
    $table = YOLANDI_Queue::table();
    // Expired leases → retry or DLQ
    $rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM `$table` WHERE status='running' AND lease_expires_at < UTC_TIMESTAMP() LIMIT %d", 500 ) );
    foreach ( (array) $rows as $r ) {
        if ( (int) $r->attempts < (int) $r->max_attempts ) {
            $wpdb->update( $table, [ 'status' => 'retrying', 'lease_expires_at' => null ], [ 'id' => (int) $r->id ] );
        } else {
            $wpdb->update( $table, [ 'status' => 'dead_letter' ], [ 'id' => (int) $r->id ] );
        }
    }
});

require_once __DIR__ . '/inc/class-security.php';
require_once __DIR__ . '/inc/class-rest-jobs.php';
require_once __DIR__ . '/inc/class-queue.php'; // ensure the queue class is loaded

    function rest_lease(WP_REST_Request $req)
    {
      var_dump($req);
      $j = $req->get_json_params() ?: [];
      $runner_id = sanitize_text_field($j['runner_id'] ?? '');

      var_dump($runner_id);
      if (!$runner_id)
        $runner_id = 'runner-unknown';
      $lease_seconds = isset($j['lease_seconds']) ? (int) $j['lease_seconds'] : (int) YOLANDI_Queue::settings()['lease_seconds'];

      $job = YOLANDI_Queue::lease($lease_seconds, $runner_id);
      if (!$job)
        return new WP_REST_Response(null, 204); // no jobs available
      return rest_ensure_response($job);
    }

add_action('rest_api_init', function ($server) {

  register_rest_route('yolandi/v1', '/jobs/lease', [
    'methods'             => 'POST',
    'callback'            => ['YOLANDI_Rest_Jobs', 'lease'],       // <— use wrapper
    'permission_callback' => ['YOLANDI_Security', 'permission_callback'],
    // 'permission_callback' => '__return_true',
  ]);

  register_rest_route('yolandi/v1', '/jobs/(?P<id>[A-Za-z0-9._-]+)/heartbeat', [
    'methods'             => 'POST',
    'callback'            => ['YOLANDI_Rest_Jobs', 'rest_heartbeat'],   // <— wrapper
    // 'permission_callback' => ['YOLANDI_Security', 'permission_callback'],
    'permission_callback' => '__return_true',
  ]);

  register_rest_route('yolandi/v1', '/jobs/(?P<id>[A-Za-z0-9._-]+)/report', [
    'methods'             => 'POST',
    'callback'            => ['YOLANDI_Rest_Jobs', 'rest_report'],      // <— wrapper
    // 'permission_callback' => ['YOLANDI_Security', 'permission_callback'],
    'permission_callback' => '__return_true',
  ]);

  // DEBUG: log which callback is actually registered for lease
  if (defined('WP_DEBUG') && WP_DEBUG) {
    $routes = $server->get_routes();
    error_log('YOLANDI lease route callback: ' . print_r($routes['/yolandi/v1/jobs/lease'][0]['callback'] ?? null, true));
  }
}, 100); // run late so we can override any earlier registrations

define('YOLANDI_DEBUG_AUTH', true); // <-- our toggle
add_filter('rest_authentication_errors', function($result){
  if (!defined('YOLANDI_DEBUG_AUTH') || !YOLANDI_DEBUG_AUTH) return $result;
  if (is_wp_error($result)) {
    error_log('[REST_AUTH] ' . $result->get_error_code() . ' :: ' . $result->get_error_message());
  } elseif ($result === true) {
    error_log('[REST_AUTH] core auth: allowed');
  } else {
    error_log('[REST_AUTH] core auth: not decided');
  }
  return $result;
});